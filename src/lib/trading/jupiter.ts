/**
 * Solana execution via Jupiter Ultra.
 *
 *   GET  https://api.jup.ag/ultra/v1/order?inputMint&outputMint&amount&taker=<sol address>
 *        → { transaction: base64 | null, requestId, inAmount, outAmount, ... }
 *   sign the returned VersionedTransaction **unmodified** with the agent's Privy wallet
 *   POST https://api.jup.ag/ultra/v1/execute { signedTransaction, requestId }
 *        → { status, signature, inputAmountResult, outputAmountResult, code, error }
 *
 * Signing goes through `privy.wallets().solana().signTransaction(walletId, {
 * transaction: <base64 string>, authorization_context })` — the service wraps the
 * string into `{ encoding: 'base64', transaction }` itself. Verified against
 * `node_modules/@privy-io/node/public-api/services/solana.d.ts` (`SignTransactionInput`)
 * and `resources/wallets/wallets.d.ts` (`SolanaSignTransactionRpcInputParams`), whose
 * response is `{ encoding: 'base64', signed_transaction }`.
 *
 * ## Slippage (W7)
 *
 * The first order is fetched **without** `slippageBps`. Probed live 2026-09-21: sending
 * it puts the order in `mode: "manual"` with `gasless: false`; omitting it leaves
 * `mode: "ultra"`, where Jupiter picks the slippage per route (27 bps on a $1 USDC→SOL
 * order) and pays the signature itself when the taker is nearly dry. The operator's
 * configured number is a **ceiling** on that choice. When Jupiter's pick is looser than
 * the ceiling — routine on a launch-day memecoin, where Ultra chooses 300-500 bps — the
 * order is fetched again in manual mode with the ceiling as the instruction, so the
 * route is built to refuse any fill worse than the operator allows (the chain rejects
 * it, and a rejected swap costs a fee of a few hundred lamports, not the position).
 * Manual mode is never gasless; the gas step below covers the taker's fee. Refusing to
 * sign outright, as this module did before, meant a 100 bps agent could never buy the
 * tokens it was built to buy, and the operator learned that only on Approve.
 *
 * ## Gas (W7)
 *
 * Ultra's own gasless is Jupiter's call per route. When the order comes back with the
 * taker as `signatureFeePayer`, `ensureAgentGas` tops the agent's wallet up from the
 * platform Solana wallet and the order is re-fetched. See `src/lib/wallets/gas.ts`.
 */
import type { AgentWalletRef } from "@/lib/x402/types";
import {
  clampToHeld,
  floorBaseUnits,
  fromBaseUnits,
  toBaseUnits,
  type Fill,
  type Quote,
  type TradeExecutor,
  type TradeRequest,
  type ExecuteHooks,
} from "./executor";
import { jupiterHeaders, USDC_SOLANA, jupiterBase } from "./tokens";

const orderUrl = () => `${jupiterBase()}/ultra/v1/order`;
const executeUrl = () => `${jupiterBase()}/ultra/v1/execute`;
const USDC_DECIMALS = 6;

/**
 * Everything the money path needs from an Ultra order. The fee-payer and error fields
 * used to be dropped on the floor, which is how "no route or taker cannot fill" came to
 * stand in for "Insufficient funds (code 1)" and for a silent 429.
 */
export interface UltraOrder {
  transaction: string | null;
  requestId: string;
  inAmount: string;
  outAmount: string;
  /** The tolerance Jupiter actually applied, in basis points. */
  slippageBps?: number;
  /** `"ultra"` (dynamic slippage, Jupiter may pay gas) or `"manual"`. */
  mode?: string;
  router?: string;
  /** True when Jupiter pays the network fee for this order. */
  gasless?: boolean;
  signatureFeePayer?: string | null;
  signatureFeeLamports?: number | null;
  prioritizationFeePayer?: string | null;
  prioritizationFeeLamports?: number | null;
  rentFeePayer?: string | null;
  rentFeeLamports?: number | null;
  /** Jupiter's own take on the route, in basis points. Non-zero on nearly every route. */
  feeBps?: number;
  /** Non-null when Jupiter priced the route but the taker cannot actually fill it. */
  errorCode?: number | null;
  errorMessage?: string | null;
}

/** An Ultra failure that carries Jupiter's own words, so a run log can print them. */
export class JupiterError extends Error {
  readonly errorCode: number | null;
  readonly httpStatus: number | null;
  constructor(message: string, options: { errorCode?: number | null; httpStatus?: number | null } = {}) {
    super(message);
    this.name = "JupiterError";
    this.errorCode = options.errorCode ?? null;
    this.httpStatus = options.httpStatus ?? null;
  }
}

function asString(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

function asNumber(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function asNullableNumber(v: unknown): number | null | undefined {
  if (v === null) return null;
  return asNumber(v);
}

/** Parses an Ultra `/order` response without trusting its shape. */
export function parseUltraOrder(body: unknown): UltraOrder | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const requestId = asString(b.requestId);
  const inAmount = asString(b.inAmount) ?? (typeof b.inAmount === "number" ? String(b.inAmount) : null);
  const outAmount = asString(b.outAmount) ?? (typeof b.outAmount === "number" ? String(b.outAmount) : null);
  if (!requestId || !inAmount || !outAmount) return null;
  return {
    transaction: asString(b.transaction),
    requestId,
    inAmount,
    outAmount,
    slippageBps: asNumber(b.slippageBps),
    mode: asString(b.mode) ?? undefined,
    router: asString(b.router) ?? undefined,
    gasless: typeof b.gasless === "boolean" ? b.gasless : undefined,
    signatureFeePayer: asString(b.signatureFeePayer),
    signatureFeeLamports: asNullableNumber(b.signatureFeeLamports),
    prioritizationFeePayer: asString(b.prioritizationFeePayer),
    prioritizationFeeLamports: asNullableNumber(b.prioritizationFeeLamports),
    rentFeePayer: asString(b.rentFeePayer),
    rentFeeLamports: asNullableNumber(b.rentFeeLamports),
    feeBps: asNumber(b.feeBps) ?? asNumber((b.platformFee as Record<string, unknown> | undefined)?.feeBps),
    // Jupiter sends `errorMessage` and a duplicate `error`; either one is the sentence
    // a person needs to read.
    errorCode: asNullableNumber(b.errorCode) ?? null,
    errorMessage: asString(b.errorMessage) ?? asString(b.error),
  };
}

/** Lamports the order says its fee payer must cover. */
export function orderFeeLamports(order: UltraOrder): number {
  return (
    (order.signatureFeeLamports ?? 0) +
    (order.prioritizationFeeLamports ?? 0) +
    (order.rentFeeLamports ?? 0)
  );
}

/**
 * The slippage to ask Jupiter for in manual mode, or null to keep the Ultra-mode order:
 * only when Jupiter's own pick is looser than the operator's ceiling (and there is a
 * ceiling). Pure, so the decision is testable without an order.
 */
export function manualSlippageFor(orderSlippageBps: number | undefined, ceilingBps: number): number | null {
  if (!(ceilingBps > 0) || orderSlippageBps === undefined) return null;
  return orderSlippageBps > ceilingBps ? Math.round(ceilingBps) : null;
}

/**
 * SOL the agent wallet must hold before any order is quoted: 0.006 SOL. Covers the rent
 * on a first-time token account (0.00204), a wrapped-SOL scratch account when a route
 * needs one, the signature and a manual-mode priority fee (measured 86k lamports), with
 * headroom — Jupiter's manual-slippage route refused a wallet holding 0.0037 SOL for a
 * new token (probed live 2026-09-21) while a funded wallet was quoted at once.
 */
const PRE_QUOTE_SOL_LAMPORTS = 6_000_000;
/** The loosest tolerance Tocker signs when Jupiter refuses the operator's ceiling: 15%. */
const MAX_ACCEPTED_SLIPPAGE_BPS = 1_500;
/** Rent on a new token account, for the error message only (the real constant lives in gas.ts). */
const ATA_RENT_HINT_LAMPORTS = 2_039_280;

/** True when the *taker* (not Jupiter, not a relayer) has to pay this order's fees. */
export function takerPaysGas(order: UltraOrder, taker: string): boolean {
  if (order.gasless === true) return false;
  const payers = [order.signatureFeePayer, order.prioritizationFeePayer, order.rentFeePayer];
  return payers.some((p) => p === taker);
}

/**
 * Jupiter's own fee on a fill, in USD. Ultra prices its take into the route as
 * `feeBps` — reporting `$0` made every receipt claim a free trade.
 */
export function venueFeeUsd(feeBps: number | undefined, amountUsd: number): number {
  if (!feeBps || !(feeBps > 0) || !(amountUsd > 0)) return 0;
  return (amountUsd * feeBps) / 10_000;
}

/**
 * Whether an `/order` failure is the kind that a second try a moment later usually
 * clears: a rate limit, a server error, or Jupiter's own "Failed to get quotes" (a 400
 * its routing tier returns when it briefly has no quote for a pool it priced seconds
 * earlier — seen live on a launch-day token, 2026-09-21). Pure, for tests.
 */
export function isTransientOrderFailure(status: number, body: string): boolean {
  if (status === 429 || status >= 500) return true;
  return status === 400 && /failed to get quotes/i.test(body);
}

/** Backoff between `/order` attempts; the keyless tier needs the second pause more often than not. */
const ORDER_RETRY_DELAYS_MS = [900, 2_500];

/**
 * One `/order` call, retried once on a transient failure. Throws {@link JupiterError}
 * with the body — a 429 from an unkeyed Ultra used to return `null` here and surface
 * three frames later as "no route".
 */
async function fetchOrder(params: Record<string, string>, attempt = 0): Promise<UltraOrder> {
  const url = `${orderUrl()}?${new URLSearchParams(params).toString()}`;
  let res: Response;
  try {
    res = await fetch(url, { headers: jupiterHeaders(), signal: AbortSignal.timeout(12_000) });
  } catch (err) {
    if (attempt < ORDER_RETRY_DELAYS_MS.length) {
      await new Promise((resolve) => setTimeout(resolve, ORDER_RETRY_DELAYS_MS[attempt]));
      return fetchOrder(params, attempt + 1);
    }
    throw new JupiterError(
      `Jupiter Ultra did not answer: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const raw = await res.text().catch(() => "");
  if (!res.ok) {
    if (attempt < ORDER_RETRY_DELAYS_MS.length && isTransientOrderFailure(res.status, raw)) {
      await new Promise((resolve) => setTimeout(resolve, ORDER_RETRY_DELAYS_MS[attempt]));
      return fetchOrder(params, attempt + 1);
    }
    const hint =
      res.status === 429
        ? " Ultra is rate-limiting this app — set JUPITER_API_KEY."
        : /failed to get quotes/i.test(raw)
          ? ` Jupiter's routers had no quote for this pool three times in a row — usually a keyless-tier hiccup that clears within a minute; a JUPITER_API_KEY makes it rare.`
          : "";
    throw new JupiterError(
      `Jupiter Ultra /order failed (HTTP ${res.status}).${hint} ${raw.slice(0, 300)}`.trim(),
      { httpStatus: res.status },
    );
  }

  let body: unknown = null;
  try {
    body = raw ? JSON.parse(raw) : null;
  } catch {
    throw new JupiterError(`Jupiter Ultra /order returned a body that is not JSON: ${raw.slice(0, 200)}`);
  }

  const order = parseUltraOrder(body);
  if (!order) throw new JupiterError(`Jupiter Ultra /order returned no usable order: ${raw.slice(0, 200)}`);
  return order;
}

/** `null` rather than a throw, for the paper executor's best-effort route price. */
async function tryFetchOrder(params: Record<string, string>): Promise<UltraOrder | null> {
  try {
    return await fetchOrder(params);
  } catch (err) {
    console.warn("[jupiter]", err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * A routed USD price for one whole token, derived from a taker-less Ultra order.
 * Used by the paper executor so simulated fills include real route impact.
 */
export async function jupiterQuotePrice(mint: string, decimals: number, amountUsd: number): Promise<number | null> {
  if (mint === USDC_SOLANA) return 1;
  const order = await tryFetchOrder({
    inputMint: USDC_SOLANA,
    outputMint: mint,
    amount: toBaseUnits(Math.max(amountUsd, 1), USDC_DECIMALS),
  });
  if (!order) return null;
  const inUsd = fromBaseUnits(order.inAmount, USDC_DECIMALS);
  const outTokens = fromBaseUnits(order.outAmount, decimals);
  if (inUsd <= 0 || outTokens <= 0) return null;
  return inUsd / outTokens;
}

/**
 * How many base units a sell should actually send: what the caller asked for, clamped
 * to what the wallet holds.
 */
export function sellBaseUnits(input: {
  amountToken?: number;
  amountUsd: number;
  priceUsd: number;
  decimals: number;
  heldBaseUnits: bigint | null;
}): string {
  const requested =
    input.amountToken !== undefined && input.amountToken > 0
      ? floorBaseUnits(input.amountToken, input.decimals)
      : input.priceUsd > 0
        ? floorBaseUnits(input.amountUsd / input.priceUsd, input.decimals)
        : "0";
  return clampToHeld(requested, input.heldBaseUnits);
}

/**
 * The transaction id of a signed Solana transaction: its first signature, base58.
 * Returns null when slot 0 is still unsigned (all zeros — a gasless Ultra order whose
 * fee payer signs later) or the bytes do not parse. Never throws.
 */
export async function signatureOfSignedTransaction(base64: string): Promise<string | null> {
  try {
    const [{ VersionedTransaction }, { base58 }] = await Promise.all([import("@solana/web3.js"), import("@scure/base")]);
    const tx = VersionedTransaction.deserialize(Uint8Array.from(Buffer.from(base64, "base64")));
    const first = tx.signatures[0];
    if (!first || first.every((byte) => byte === 0)) return null;
    return base58.encode(first);
  } catch {
    return null;
  }
}

export class JupiterExecutor implements TradeExecutor {
  readonly venue = "jupiter" as const;
  readonly isPaper = false;
  private readonly wallet: AgentWalletRef;
  private readonly agentId: string | null;

  constructor(wallet: AgentWalletRef, agentId?: string) {
    this.wallet = wallet;
    this.agentId = agentId ?? null;
  }

  /**
   * Base units of `mint` the agent's wallet holds, or `null` when it could not be read.
   *
   * Both token programs are tried: a Token-2022 mint's associated account is derived
   * from a different program id, and deriving it from the legacy one produces an
   * address that does not exist — which would read as "holds nothing" on exactly the
   * kind of freshly minted token this product trades.
   */
  private async heldBaseUnits(mint: string): Promise<bigint | null> {
    try {
      const { PublicKey } = await import("@solana/web3.js");
      const { associatedTokenAddress, TOKEN_2022_PROGRAM_ID } = await import(
        "@/lib/wallets/solana-transfer"
      );
      const { getTokenAccountBalance } = await import("@/lib/wallets/solana-rpc");
      const owner = new PublicKey(this.wallet.address);
      const mintKey = new PublicKey(mint);

      const legacy = await getTokenAccountBalance(associatedTokenAddress(owner, mintKey).toBase58());
      if (legacy !== null) return legacy;
      return await getTokenAccountBalance(
        associatedTokenAddress(owner, mintKey, TOKEN_2022_PROGRAM_ID).toBase58(),
      );
    } catch (err) {
      console.warn(
        `[jupiter] could not read the ${mint} balance of ${this.wallet.address}:`,
        err instanceof Error ? err.message : err,
      );
      return null;
    }
  }

  async quote(req: TradeRequest): Promise<Quote> {
    const isBuy = req.side === "buy";
    const inputMint = isBuy ? USDC_SOLANA : req.tokenAddress;
    const outputMint = isBuy ? req.tokenAddress : USDC_SOLANA;

    let amount: string;
    let fallbackPrice = 0;
    if (isBuy) {
      amount = toBaseUnits(req.amountUsd, USDC_DECIMALS);
    } else {
      // A sell is sized by what the wallet holds, never by a buy-side quote: W7 H1.
      // Only fall back to a price when the caller gave no token amount at all.
      const held = await this.heldBaseUnits(req.tokenAddress);
      if (req.amountToken === undefined) {
        const price = await jupiterQuotePrice(req.tokenAddress, req.decimals, req.amountUsd);
        if (price === null || price <= 0) throw new JupiterError(`Jupiter has no route for ${req.symbol}.`);
        fallbackPrice = price;
      }
      amount = sellBaseUnits({
        amountToken: req.amountToken,
        amountUsd: req.amountUsd,
        priceUsd: fallbackPrice,
        decimals: req.decimals,
        heldBaseUnits: held,
      });
      if (amount === "0") {
        throw new JupiterError(
          `${req.symbol} position is already empty on chain — nothing left to sell.`,
        );
      }
    }

    // A wallet with USDC and no SOL cannot fill anything: Ultra's gasless mode pays the
    // signature, not the rent on the token account a first buy creates, and answers
    // `errorCode 1 "Insufficient funds"` for a taker holding thousands of USDC and zero
    // SOL (probed live 2026-09-21 against real gasless takers). A fresh Privy wallet is
    // exactly that wallet, so top it up first — a no-op once it holds a little SOL.
    if (this.agentId) {
      const { ensureAgentGas } = await import("@/lib/wallets/gas");
      await ensureAgentGas({
        agentId: this.agentId,
        chain: "solana",
        walletId: this.wallet.walletId,
        address: this.wallet.address,
        requiredLamports: PRE_QUOTE_SOL_LAMPORTS,
      });
    }

    // No `slippageBps` first: see the module comment. `req.slippageBps` is the ceiling.
    const params: Record<string, string> = { inputMint, outputMint, amount, taker: this.wallet.address };
    let order = await fetchOrder(params);

    // Jupiter chose looser than the operator allows: ask again with the ceiling as the
    // instruction. The second order is built so the fill cannot be worse than that.
    const manual = manualSlippageFor(order.slippageBps, req.slippageBps);
    // Jupiter's own pick, taken when it will not build the order at the operator's
    // number. Null when the order we sign honours the ceiling.
    let acceptedJupiterBps: number | null = null;
    if (manual !== null && (order.errorCode === null || order.errorCode === undefined)) {
      params.slippageBps = String(manual);
      const ultraOrder = order;
      try {
        order = await fetchOrder(params);
      } catch (err) {
        // Reproduced live 2026-09-21 with the agent's own wallet as taker: the same
        // token quotes in ultra mode and answers 400 "Failed to get quotes" in manual
        // mode (first-time token account, thin SOL, a route only ultra has — Jupiter
        // does not say). The operator's call that day: take the fill at Jupiter's own
        // tolerance rather than miss it, within a hard cap. Ultra's number is its live
        // estimate of what the route needs, recorded on the receipt as the tolerance used.
        if (err instanceof JupiterError && err.httpStatus === 400) {
          const jupiterBps = ultraOrder.slippageBps ?? null;
          if (jupiterBps !== null && jupiterBps <= MAX_ACCEPTED_SLIPPAGE_BPS) {
            delete params.slippageBps;
            order = ultraOrder;
            acceptedJupiterBps = jupiterBps;
            console.warn(
              `[jupiter] ${req.symbol}: manual ${manual} bps refused (400); taking Jupiter's ${jupiterBps} bps for ${this.wallet.address}`,
            );
          } else {
            throw new JupiterError(
              `${err.message} Jupiter priced ${req.symbol} at ${jupiterBps ?? "?"} bps and refused to build an order at this agent's ${req.slippageBps} bps ceiling; ${jupiterBps ?? "?"} bps is past the ${MAX_ACCEPTED_SLIPPAGE_BPS} bps Tocker will accept on its own, so nothing was signed.`,
              { httpStatus: 400 },
            );
          }
        } else {
          throw err;
        }
      }
    }

    // Ultra says who pays. If that is the agent and the agent cannot, top it up and ask
    // again — the second order is the one we sign, with the drip already confirmed.
    if (takerPaysGas(order, this.wallet.address) && this.agentId) {
      const { ensureAgentGas } = await import("@/lib/wallets/gas");
      const result = await ensureAgentGas({
        agentId: this.agentId,
        chain: "solana",
        walletId: this.wallet.walletId,
        address: this.wallet.address,
        requiredLamports: orderFeeLamports(order),
      });
      if (result.dripped) order = await fetchOrder(params);
    }

    if (order.errorCode !== null && order.errorCode !== undefined) {
      const why =
        order.errorCode === 1
          ? ` The agent wallet (${this.wallet.address}) must hold the USDC for this order plus about ${(
              ATA_RENT_HINT_LAMPORTS / 1e9
            ).toFixed(4)} SOL for the token account; Tocker tops the SOL up from the platform Solana wallet when that wallet has any.`
          : "";
      throw new JupiterError(
        `Jupiter: ${order.errorMessage ?? "the taker cannot fill this order"} (code ${order.errorCode}).${why}`,
        { errorCode: order.errorCode },
      );
    }
    if (!order.transaction) {
      throw new JupiterError(
        `Jupiter Ultra returned no transaction for ${req.symbol}${
          order.errorMessage ? `: ${order.errorMessage}` : " (no route)."
        }`,
      );
    }

    // Belt and braces: even asked for the ceiling, an order looser than it is not signed —
    // unless Jupiter refused the ceiling outright and its own number was accepted above.
    const applied = order.slippageBps;
    if (applied !== undefined && req.slippageBps > 0 && applied > req.slippageBps && acceptedJupiterBps === null) {
      throw new JupiterError(
        `Jupiter would only fill ${req.symbol} with ${applied} bps of slippage and this agent's ceiling is ${req.slippageBps} bps, so nothing was signed. ${req.symbol} is thinner than the agent's risk settings allow — raise Slippage tolerance in Risk, or leave this one alone.`,
      );
    }

    const inAmount = fromBaseUnits(order.inAmount, isBuy ? USDC_DECIMALS : req.decimals);
    const outAmount = fromBaseUnits(order.outAmount, isBuy ? req.decimals : USDC_DECIMALS);
    const amountToken = isBuy ? outAmount : inAmount;
    const amountUsd = isBuy ? inAmount : outAmount;

    return {
      request: req,
      venue: "jupiter",
      priceUsd: amountToken > 0 ? amountUsd / amountToken : fallbackPrice,
      amountToken,
      amountUsd,
      feeUsd: venueFeeUsd(order.feeBps, amountUsd),
      appliedSlippageBps: applied,
      handle: order,
    };
  }

  async execute(quote: Quote, hooks?: ExecuteHooks): Promise<Fill> {
    const order = quote.handle as UltraOrder;
    const failed = (error: string, txHash: string | null = null): Fill => ({
      status: "failed",
      txHash,
      priceUsd: quote.priceUsd,
      amountToken: quote.amountToken,
      amountUsd: quote.amountUsd,
      feeUsd: quote.feeUsd,
      error,
    });
    if (!order.transaction) return failed("Jupiter order carried no transaction.");

    const { privy, authorizationContext } = await import("@/lib/privy");
    const signed = await privy()
      .wallets()
      .solana()
      .signTransaction(this.wallet.walletId, {
        transaction: order.transaction,
        authorization_context: authorizationContext(),
      });

    // W7 H2: the transaction id is the fee payer's signature (slot 0) and exists the
    // moment the transaction is signed. Hand it to the settlement layer *before*
    // `/execute`, so an invocation frozen after broadcast still leaves a record that can
    // be checked against the chain. In Ultra's gasless mode Jupiter is the fee payer and
    // fills slot 0 at `/execute` time; until then the slot is zeros and there is no id yet.
    const signature = await signatureOfSignedTransaction(signed.signed_transaction);
    if (signature !== null && hooks?.onSigned) {
      try {
        await hooks.onSigned(signature);
      } catch (err) {
        console.warn(`[jupiter] onSigned hook failed for ${signature}:`, err instanceof Error ? err.message : err);
      }
    }

    const res = await fetch(executeUrl(), {
      method: "POST",
      headers: { "content-type": "application/json", ...jupiterHeaders() },
      body: JSON.stringify({ signedTransaction: signed.signed_transaction, requestId: order.requestId }),
      signal: AbortSignal.timeout(30_000),
    });
    const raw = await res.text().catch(() => "");
    let body: unknown = null;
    try {
      body = raw ? JSON.parse(raw) : null;
    } catch {
      body = null;
    }
    if (!res.ok || !body || typeof body !== "object") {
      return failed(`Jupiter execute failed (HTTP ${res.status}). ${raw.slice(0, 300)}`.trim(), signature);
    }

    const b = body as Record<string, unknown>;
    const status = asString(b.status);
    if (status !== "Success") {
      const code = asNullableNumber(b.code);
      const detail = asString(b.error) ?? `status ${status ?? "unknown"}`;
      // Jupiter reports the signature of a transaction that landed but failed; fall back
      // to the one we computed, so the settlement layer can ask the chain either way.
      return failed(
        `Jupiter execute: ${detail}${code === null || code === undefined ? "" : ` (code ${code})`}.`,
        asString(b.signature) ?? signature,
      );
    }

    const isBuy = quote.request.side === "buy";
    const inResult = asString(b.inputAmountResult);
    const outResult = asString(b.outputAmountResult);
    const amountToken = isBuy
      ? outResult
        ? fromBaseUnits(outResult, quote.request.decimals)
        : quote.amountToken
      : inResult
        ? fromBaseUnits(inResult, quote.request.decimals)
        : quote.amountToken;
    const amountUsd = isBuy
      ? inResult
        ? fromBaseUnits(inResult, USDC_DECIMALS)
        : quote.amountUsd
      : outResult
        ? fromBaseUnits(outResult, USDC_DECIMALS)
        : quote.amountUsd;

    return {
      status: "filled",
      txHash: asString(b.signature),
      priceUsd: amountToken > 0 ? amountUsd / amountToken : quote.priceUsd,
      amountToken,
      amountUsd,
      feeUsd: venueFeeUsd(order.feeBps, amountUsd),
    };
  }
}
