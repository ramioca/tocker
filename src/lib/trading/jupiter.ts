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
 */
import type { AgentWalletRef } from "@/lib/x402/types";
import { fromBaseUnits, toBaseUnits, type Fill, type Quote, type TradeExecutor, type TradeRequest } from "./executor";
import { jupiterHeaders, USDC_SOLANA } from "./tokens";

const ORDER_URL = "https://api.jup.ag/ultra/v1/order";
const EXECUTE_URL = "https://api.jup.ag/ultra/v1/execute";
const USDC_DECIMALS = 6;

export interface UltraOrder {
  transaction: string | null;
  requestId: string;
  inAmount: string;
  outAmount: string;
  slippageBps?: number;
}

function asString(v: unknown): string | null {
  return typeof v === "string" ? v : null;
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
    slippageBps: typeof b.slippageBps === "number" ? b.slippageBps : undefined,
  };
}

async function fetchOrder(params: Record<string, string>): Promise<UltraOrder | null> {
  const url = `${ORDER_URL}?${new URLSearchParams(params).toString()}`;
  try {
    const res = await fetch(url, { headers: jupiterHeaders(), signal: AbortSignal.timeout(12_000) });
    if (!res.ok) return null;
    return parseUltraOrder(await res.json());
  } catch {
    return null;
  }
}

/**
 * A routed USD price for one whole token, derived from a taker-less Ultra order.
 * Used by the paper executor so simulated fills include real route impact.
 */
export async function jupiterQuotePrice(mint: string, decimals: number, amountUsd: number): Promise<number | null> {
  if (mint === USDC_SOLANA) return 1;
  const order = await fetchOrder({
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

export class JupiterExecutor implements TradeExecutor {
  readonly venue = "jupiter" as const;
  readonly isPaper = false;
  private readonly wallet: AgentWalletRef;

  constructor(wallet: AgentWalletRef) {
    this.wallet = wallet;
  }

  async quote(req: TradeRequest): Promise<Quote> {
    // Price the leg first so we know how many tokens a sell should send.
    const price = await jupiterQuotePrice(req.tokenAddress, req.decimals, req.amountUsd);
    if (price === null || price <= 0) throw new Error(`Jupiter has no route for ${req.symbol}.`);

    const isBuy = req.side === "buy";
    const inputMint = isBuy ? USDC_SOLANA : req.tokenAddress;
    const outputMint = isBuy ? req.tokenAddress : USDC_SOLANA;
    const amount = isBuy
      ? toBaseUnits(req.amountUsd, USDC_DECIMALS)
      : toBaseUnits(req.amountUsd / price, req.decimals);

    const order = await fetchOrder({
      inputMint,
      outputMint,
      amount,
      taker: this.wallet.address,
      slippageBps: String(req.slippageBps),
    });
    if (!order) throw new Error(`Jupiter Ultra returned no order for ${req.symbol}.`);
    if (!order.transaction) throw new Error(`Jupiter Ultra returned no transaction for ${req.symbol} (no route or taker cannot fill).`);

    const inAmount = fromBaseUnits(order.inAmount, isBuy ? USDC_DECIMALS : req.decimals);
    const outAmount = fromBaseUnits(order.outAmount, isBuy ? req.decimals : USDC_DECIMALS);
    const amountToken = isBuy ? outAmount : inAmount;
    const amountUsd = isBuy ? inAmount : outAmount;

    return {
      request: req,
      venue: "jupiter",
      priceUsd: amountToken > 0 ? amountUsd / amountToken : price,
      amountToken,
      amountUsd,
      feeUsd: 0, // Jupiter's fee is already priced into the route
      handle: order,
    };
  }

  async execute(quote: Quote): Promise<Fill> {
    const order = quote.handle as UltraOrder;
    const failed = (error: string): Fill => ({
      status: "failed",
      txHash: null,
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

    const res = await fetch(EXECUTE_URL, {
      method: "POST",
      headers: { "content-type": "application/json", ...jupiterHeaders() },
      body: JSON.stringify({ signedTransaction: signed.signed_transaction, requestId: order.requestId }),
      signal: AbortSignal.timeout(30_000),
    });
    const body: unknown = await res.json().catch(() => null);
    if (!res.ok || !body || typeof body !== "object") return failed(`Jupiter execute failed (HTTP ${res.status}).`);

    const b = body as Record<string, unknown>;
    const status = asString(b.status);
    if (status !== "Success") {
      return failed(asString(b.error) ?? `Jupiter execute returned status ${status ?? "unknown"}.`);
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
      feeUsd: 0,
    };
  }
}
