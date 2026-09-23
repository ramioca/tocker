/**
 * Solana execution via Jupiter Ultra.
 *
 *   GET  https://api.jup.ag/ultra/v1/order?inputMint&outputMint&amount&taker=<sol address>[&payer=<platform>]
 *        → { transaction: base64 | null, requestId, inAmount, outAmount, ... }
 *   the agent signs the returned VersionedTransaction **unmodified** with its Privy wallet
 *   (and, when the platform is the payer, the platform co-signs it after checking it)
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
 * ## Gas: the platform pays every agent swap (W8)
 *
 * An agent never holds SOL to trade. Every `/order` an agent places carries
 * `payer=<platform Solana wallet>` — Ultra's "Integrator Gas Payer" — so the platform is
 * the transaction's fee payer and pays the rent of any account the swap opens. What was
 * verified on 2026-09-23 (docs, then read-only probes; nothing was signed or sent):
 *
 *  - **Docs** (jup-ag/docs `ultra/add-payer.mdx`, `ultra/gasless.mdx`, OpenAPI
 *    `openapi-spec/ultra/ultra.yaml`): `payer` covers the signature fee, the priority
 *    fee/tips and every rent; it "always takes precedent" over Ultra's own gasless, needs
 *    no minimum trade size and no SOL-balance check, and restricts routing to Metis (no
 *    JupiterZ RFQ). "The transaction returned will require both taker and payer signature
 *    before submitting to `/execute`": Jupiter adds no signature of its own, `/execute`
 *    takes the fully signed bytes, and a changed message is its code -3. The docs say
 *    `payer` "is expected to be used with" `referralAccount`/`referralFee`; live that is
 *    not enforced — every probe below omitted them, and `feeBps` stayed Ultra's default
 *    (10 on a memecoin, identical to the same order without `payer`). Unlike Ultra's own
 *    gasless, the payer does not raise the swap fee. The docs also mark Ultra as
 *    superseded by Swap V2 and no longer actively maintained.
 *  - **Order** (a funded taker, `payer` = the platform; buys and sells, new and existing
 *    output accounts, legacy and Token-2022 mints, ultra and manual mode): `gasless: true`;
 *    `signatureFeePayer`, `prioritizationFeePayer` and `rentFeePayer` all name the
 *    platform; `signatureFeeLamports` is 10000 (two signers). `slippageBps` keeps the
 *    order sponsored (`mode: "manual"`, `gasless: true`) — Ultra's own gasless does not
 *    survive manual mode, the payer does.
 *  - **Transaction**: v0, exactly two required signatures, both slots zero. Static account
 *    0 is the platform (writable signer: the fee payer), static 1 the taker. The platform
 *    appears in instructions only as the funding account of a top-level
 *    `CreateIdempotent` for the taker's new output-token account and, on pump.fun routes,
 *    once inside the JUP6 route's accounts (PumpSwap takes a payer). Never in an address
 *    lookup table, never on a token instruction.
 *  - **SOL routes** (buying or selling SOL itself; re-probed 2026-09-23): the platform
 *    funds the taker's wrapped-SOL account (`CreateIdempotent`), the route runs, the
 *    account is closed back to the taker (`CloseAccount`), and a top-level
 *    `SystemProgram.transfer` **from the taker to the platform** repays that rent. Ultra
 *    declares `rentFeeLamports: 0`, and the simulation agrees: the platform loses only the
 *    fees (10,116 lamports on a $1 USDC→SOL buy, 14,426 on a SOL→USDC sell).
 *  - **An unfunded payer** is not a code: `/order` with a zero-SOL `payer` answers HTTP
 *    400 "Failed to get quotes" (three probes against an empty address, while the same
 *    order with the funded platform answered 200). So the platform's balance is confirmed
 *    — and refuelled from its own USDC when short — before its address goes on an order.
 *  - **Simulation** of the exact bytes: the platform's lamport loss equalled
 *    `signatureFeeLamports + prioritizationFeeLamports + rentFeeLamports` to the lamport
 *    on all seven orders — 11,343 for a buy into an existing account, 1,550,140 with a new
 *    Token-2022 account, 259,247 for a manual-mode sell. The taker's lamports do not move.
 *  - A taker without the input tokens still gets `errorCode 1 "Insufficient funds"` and no
 *    transaction with `payer` set, so code 1 on a sponsored order is about the tokens,
 *    never about SOL.
 *
 * So a sponsored swap is: the agent has not failed on chain
 * {@link MAX_SPONSORED_FAILURES_PER_HOUR} times this hour → the platform can pay
 * ({@link SPONSORED_SWAP_RESERVE_LAMPORTS}, through `ensureSponsorCapacity`, which refuels
 * it first when it is short) → the order names it as `payer` → the order's JSON clears the
 * floors (Jupiter names the platform as fee payer, the declared priority fits
 * {@link sponsoredPriorityAllowance} for the trade's size, an account-opening buy is at
 * least `MIN_ACCOUNT_OPENING_BUY_USD` ($5), a manual-mode ceiling is at least
 * {@link MIN_SPONSORED_SLIPPAGE_BPS}) → check the bytes ({@link checkSwapShape}) → the
 * co-sign budget is priced from the bytes ({@link sponsoredSwapBudget}) → the agent signs →
 * the message must come back byte-identical → `cosignAsPlatform` within that budget → the
 * transaction id, now the platform's slot-0 signature, goes to `hooks.onSigned` →
 * `/execute`.
 *
 * ### The byte check (W8 review)
 *
 * Every top-level instruction is allowed by shape, not only the ones that name the
 * platform, and the one route instruction is decoded (live layouts `route_v2` and
 * `shared_accounts_route_v2`, read off Ultra orders on 2026-09-23):
 *
 *  - two signers exactly on a sponsored swap — the platform (account 0) and the agent;
 *  - ComputeBudget; the associated-token program only to open an account the agent owns,
 *    funded by the fee payer or the agent; the token programs only to wrap and unwrap the
 *    agent's own SOL (SyncNative, CloseAccount of its wrapped-SOL account back to it); the
 *    System Program only for a plain transfer from the agent — into its own wrapped-SOL
 *    account, or at most one wrapped-SOL rent repayment (≤ {@link ATA_RENT_LAMPORTS}) to
 *    the fee payer. Nothing ever moves SOL out of the platform but the fee and the rent it
 *    agreed to front, and a durable-nonce advance cannot appear, so the transaction expires;
 *  - exactly one route, spending from the agent's own input-token account with the agent
 *    as authority, paying out to its own output-token account, for exactly the amount
 *    asked, at no more slippage and fee than the order reports, with a quoted output
 *    within 1% of the order's; the platform in none of the route's fixed accounts;
 *  - none of the platform's own token accounts anywhere in the resolved keys.
 *
 * The same check runs before the agent signs an agent-paid order and before the
 * platform signs its own refuel swap — which goes through `signAsPlatformTaker`, never a
 * raw signature over Jupiter's bytes.
 *
 * ### Kill switch and fallback
 *
 * `SOLANA_SPONSORED_SWAPS=0` turns this off and restores the W7 flow below. The W7 flow
 * is also the fallback — one log line, then the agent pays its own gas through
 * `ensureAgentGas` — when the platform fee wallet cannot be resolved or cannot cover a
 * swap even after a refuel, and when the payer order cannot be built for a reason that is
 * not Jupiter misbehaving (an HTTP failure other than a 429, no transaction, any
 * `errorCode` but 1). It never falls back on code 1, on the slippage ceiling or floor, on a
 * 429, or on a `sponsor` refusal (Jupiter named someone else as fee payer, gas over the
 * cap or the allowance, the floors, the failure budget): a refusal that means the order
 * is wrong or not worth paying for is not fixed by dripping SOL so the agent pays instead.
 *
 * Nothing falls back at execute time. A byte-check problem, a refused signature, a
 * refused co-sign (including a simulation that fails — the trade would fail anyway) and
 * anything `/execute` answers all end as a failed fill. After `/execute` the sponsored
 * transaction's id is the trade's record and `settle.ts` asks the chain about it; an
 * agent-paid retry there could fill twice if `/execute` said "not sent" and sent it anyway.
 *
 * "Failed to get quotes" is the one failure that is usually the pool rather than the
 * payer (a dead pool on a stop-loss exit, a keyless-tier hiccup), so it falls back only
 * when one plain `/order` — no payer, no top-up — shows the route exists without the
 * payer ({@link isNoQuoteFailure}). A dead pool no longer costs a 0.01 SOL drip.
 *
 * The platform's own refuel executor (no agent id) never passes `payer`: it is already
 * its own fee payer.
 *
 * ## Slippage (W7)
 *
 * The first order is fetched **without** `slippageBps`. Probed live 2026-09-21: sending
 * it puts the order in `mode: "manual"`; omitting it leaves `mode: "ultra"`, where
 * Jupiter picks the slippage per route (27 bps on a $1 USDC→SOL order). The operator's
 * configured number is a **ceiling** on that choice. When Jupiter's pick is looser than
 * the ceiling — routine on a launch-day memecoin, where Ultra chooses 300-500 bps — the
 * order is fetched again in manual mode with the ceiling as the instruction, so the
 * route is built to refuse any fill worse than the operator allows (the chain rejects
 * it, and a rejected swap costs a fee of a few hundred lamports, not the position).
 * Refusing to sign outright, as this module did before, meant a 100 bps agent could never
 * buy the tokens it was built to buy, and the operator learned that only on Approve.
 *
 * ## Gas on the agent-paid path (W7)
 *
 * Without a payer, Ultra's own gasless is Jupiter's call per route, and manual mode is
 * never gasless. When the order comes back with the taker as `signatureFeePayer`,
 * `ensureAgentGas` tops the agent's wallet up from the platform Solana wallet and the
 * order is re-fetched. See `src/lib/wallets/gas.ts`.
 */
import type { AddressLookupTableAccount } from "@solana/web3.js";
import type { AgentWalletRef } from "@/lib/x402/types";
import {
  accountOpeningProblem,
  declaredOrderLamports,
  priorityFeeLamports,
  sponsoredFailureProblem,
  sponsoredPriorityAllowance,
  sponsoredSwapBudget,
  withinSponsoredSwapCap,
  ATA_RENT_LAMPORTS,
  MAX_SPONSORED_FAILURES_PER_HOUR,
  MAX_SPONSORED_PRIORITY_LAMPORTS,
  MAX_SPONSORED_SWAP_LAMPORTS,
  MIN_SPONSORED_SLIPPAGE_BPS,
  SIGNATURE_FEE_LAMPORTS,
  SPONSORED_PRIORITY_BASE_LAMPORTS,
  SPONSORED_SWAP_RESERVE_LAMPORTS,
} from "@/lib/wallets/gas";
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
import { jupiterHeaders, SOL_MINT, USDC_SOLANA, jupiterBase } from "./tokens";

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
  /** True when someone other than the taker (Jupiter, a market maker, our `payer`) pays the network fee. */
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

/** What `/order` was asked for — kept on the quote so a fallback can ask again without the payer. */
export interface OrderRoute {
  inputMint: string;
  outputMint: string;
  /** Base units of `inputMint`. */
  amount: string;
}

/**
 * `Quote.handle` for this venue: the order itself (so older readers keep working), plus
 * who pays its gas and what it was asked for. No field here is named like a signature —
 * `settle.ts` digs one out of the handle by key name.
 */
export interface JupiterHandle extends UltraOrder {
  /** The platform fee wallet when it is this order's `payer`; null on an agent-paid order. */
  sponsorPayer: string | null;
  route: OrderRoute;
  /** The priority fee the platform pays on this trade ({@link sponsoredPriorityAllowance}). */
  priorityAllowanceLamports?: number;
}

/**
 * What kind of failure a {@link JupiterError} is, where it matters for the fallback:
 * `funds` (code 1, the taker lacks the input tokens) and `slippage` (the operator's
 * ceiling, or the platform's floor under it) are about the trade itself, so paying gas
 * differently cannot help; `sponsor` is "Tocker will not pay for this order" — Jupiter
 * built it wrong, or it is past what the platform pays for — and is not retried
 * agent-paid either.
 */
export type JupiterErrorKind = "funds" | "slippage" | "sponsor";

/** An Ultra failure that carries Jupiter's own words, so a run log can print them. */
export class JupiterError extends Error {
  readonly errorCode: number | null;
  readonly httpStatus: number | null;
  readonly kind: JupiterErrorKind | null;
  constructor(
    message: string,
    options: { errorCode?: number | null; httpStatus?: number | null; kind?: JupiterErrorKind | null } = {},
  ) {
    super(message);
    this.name = "JupiterError";
    this.errorCode = options.errorCode ?? null;
    this.httpStatus = options.httpStatus ?? null;
    this.kind = options.kind ?? null;
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

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
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
 * SOL the agent wallet must hold before any order is quoted **on the agent-paid path**:
 * 0.006 SOL. Covers the rent on a first-time token account (0.00204), a wrapped-SOL
 * scratch account when a route needs one, the signature and a manual-mode priority fee
 * (measured 86k lamports), with headroom — Jupiter's manual-slippage route refused a
 * wallet holding 0.0037 SOL for a new token (probed live 2026-09-21) while a funded
 * wallet was quoted at once. A sponsored order never needs it.
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

// ---------------------------------------------------------------- sponsored swaps (W8)

/**
 * The kill switch. `SOLANA_SPONSORED_SWAPS=0` (or `false` / `off`) puts every agent
 * back on the W7 agent-paid flow; anything else, including unset, leaves the platform
 * paying. Pure over its argument.
 */
export function sponsoredSwapsEnabled(value: string | undefined = process.env.SOLANA_SPONSORED_SWAPS): boolean {
  const v = value?.trim().toLowerCase();
  return !(v === "0" || v === "false" || v === "off");
}

/**
 * Pure: the `payer` to put on an order, or null for an agent-paid one. Only an agent's
 * executor is ever sponsored — the platform's own refuel swap has no agent id and is its
 * own fee payer — and never when the kill switch is off or no fee wallet is known.
 */
export function orderPayerFor(input: {
  agentId: string | null;
  enabled: boolean;
  platformAddress: string | null;
  taker: string;
}): string | null {
  if (!input.agentId || !input.enabled || !input.platformAddress) return null;
  if (input.platformAddress === input.taker) return null;
  return input.platformAddress;
}

/**
 * Pure: the `/order` query. Key order is fixed (`inputMint, outputMint, amount, taker`,
 * then `payer`, then `slippageBps`) so an agent-paid order asks exactly what W7 asked.
 */
export function ultraOrderParams(input: OrderRoute & {
  taker: string;
  payer?: string | null;
  slippageBps?: number | null;
}): Record<string, string> {
  const params: Record<string, string> = {
    inputMint: input.inputMint,
    outputMint: input.outputMint,
    amount: input.amount,
    taker: input.taker,
  };
  if (input.payer) params.payer = input.payer;
  if (input.slippageBps !== undefined && input.slippageBps !== null) params.slippageBps = String(input.slippageBps);
  return params;
}

/**
 * Pure: why an order fetched with `payer` cannot be sponsored as it stands, or null when
 * it can. Called after the order's own error code and transaction were checked.
 */
export function sponsoredOrderProblem(
  order: UltraOrder,
  payer: string,
  taker: string,
  priorityAllowanceLamports?: number,
): string | null {
  if (order.signatureFeePayer !== payer) {
    return `Jupiter named ${order.signatureFeePayer ?? "no one"} as the fee payer, not Tocker's fee wallet`;
  }
  if ([order.prioritizationFeePayer, order.rentFeePayer].some((p) => p === taker)) {
    return "Jupiter left part of the gas on the agent's wallet";
  }
  if (!withinSponsoredSwapCap(order)) {
    return `the order needs ${declaredOrderLamports(order)} lamports of gas, over the ${MAX_SPONSORED_SWAP_LAMPORTS} a single swap is allowed`;
  }
  const priority = order.prioritizationFeeLamports ?? 0;
  if (priorityAllowanceLamports !== undefined && priority > priorityAllowanceLamports) {
    return `network fees are running high: Jupiter wants a ${priority}-lamport priority fee, more than the ${priorityAllowanceLamports} Tocker pays on a trade this size — try again shortly, or trade a larger amount`;
  }
  return null;
}

/**
 * Pure: whether a failed `/order` on the sponsored path may be retried agent-paid.
 * No for the failures that are about the trade (code 1, the slippage ceiling), for a
 * `sponsor` refusal (the order is wrong, or past what the platform pays for — dripping SOL
 * so the agent pays it instead would pay for it anyway) and for a rate limit (the second
 * attempt would be limited too); yes for everything else — the payer path is Metis-only,
 * so "no quote" or "no transaction" can be the payer's doing. A "no quote" answer is
 * checked once more before the fallback runs: see {@link isNoQuoteFailure}.
 */
export function fallsBackToAgentGas(err: unknown): boolean {
  if (!(err instanceof JupiterError)) return true;
  if (err.kind === "funds" || err.kind === "slippage" || err.kind === "sponsor") return false;
  return err.httpStatus !== 429;
}

/**
 * Pure: whether `/order` failed with Jupiter's 400 "Failed to get quotes". That answer
 * usually comes from the pool (dead or illiquid, or the keyless tier hiccuping), and
 * only now and then from the payer (Metis-only routing, or an unfunded payer, which the
 * capacity check rules out). So before the agent-paid fallback, and its drip, runs, one
 * plain `/order` has to show that the route exists without the payer.
 */
export function isNoQuoteFailure(err: unknown): boolean {
  return err instanceof JupiterError && err.httpStatus === 400 && /failed to get quotes/i.test(err.message);
}

/**
 * Pure: the sentence after "Jupiter: … (code N)." On code 1 the agent-paid path keeps its
 * W7 advice (hold USDC plus a little SOL); a sponsored order never mentions SOL, because
 * the platform pays the fee and the rent and the only thing missing is the input token.
 */
export function orderErrorHint(
  errorCode: number | null | undefined,
  input: { sponsored: boolean; address: string; spends: string },
): string {
  if (errorCode !== 1) return "";
  if (input.sponsored) {
    return ` The agent wallet (${input.address}) holds less ${input.spends} than this order spends. Tocker pays this trade's network fee and any token-account rent, so the ${input.spends} is all it needs.`;
  }
  return ` The agent wallet (${input.address}) must hold the USDC for this order plus about ${(
    ATA_RENT_HINT_LAMPORTS / 1e9
  ).toFixed(4)} SOL for the token account; Tocker tops the SOL up from the platform Solana wallet when that wallet has any.`;
}

const PROGRAM = {
  system: "11111111111111111111111111111111",
  computeBudget: "ComputeBudget111111111111111111111111111111",
  ata: "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
  token: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  token2022: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
  jupiterV6: "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4",
  memo: "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",
} as const;

/** Top-level programs a Metis route carries (plus Memo, harmless). Anything else is refused. */
const SWAP_PROGRAMS = new Set<string>(Object.values(PROGRAM));

/** One top-level instruction, with its accounts resolved to base58. */
export interface SwapInstructionView {
  programId: string;
  accounts: string[];
  data: Uint8Array;
}

/** What {@link checkSwapShape} needs from a transaction. */
export interface SwapTransactionView {
  numRequiredSignatures: number;
  staticKeys: string[];
  /** Every address the lookup tables contribute, writable and read-only. */
  lookupKeys: string[];
  instructions: SwapInstructionView[];
}

/**
 * Decode a serialized transaction into a {@link SwapTransactionView}. Pure given the
 * lookup tables it references (`[]` for a message that uses none); throws when the bytes
 * do not parse or a table is missing.
 */
export async function viewSwapTransaction(
  base64: string,
  lookupTables: AddressLookupTableAccount[] = [],
): Promise<SwapTransactionView> {
  const { VersionedTransaction } = await import("@solana/web3.js");
  const tx = VersionedTransaction.deserialize(Uint8Array.from(Buffer.from(base64, "base64")));
  const message = tx.message;
  const keys = message.getAccountKeys({ addressLookupTableAccounts: lookupTables });
  const staticKeys = keys.staticAccountKeys.map((k) => k.toBase58());
  const lookupKeys = [
    ...(keys.accountKeysFromLookups?.writable ?? []),
    ...(keys.accountKeysFromLookups?.readonly ?? []),
  ].map((k) => k.toBase58());
  const all = [...staticKeys, ...lookupKeys];
  return {
    numRequiredSignatures: message.header.numRequiredSignatures,
    staticKeys,
    lookupKeys,
    instructions: message.compiledInstructions.map((ix) => ({
      programId: all[ix.programIdIndex] ?? "",
      accounts: ix.accountKeyIndexes.map((i) => all[i] ?? ""),
      data: Uint8Array.from(ix.data),
    })),
  };
}

// ------------------------------------------------------------- the byte check (W8 review)

/**
 * The route instructions Ultra builds, and where their fixed accounts sit. Read off live
 * `/order` transactions on 2026-09-23 (buys and sells, SOL and pump.fun routes, sponsored
 * and self-paid); the discriminators are Anchor's `sha256("global:<name>")[..8]`. Both
 * carry, after the discriminator (and `shared_accounts_route_v2`'s `id: u8`):
 * `in_amount u64, quoted_out_amount u64, slippage_bps u16, platform_fee_bps u16,
 * positive_slippage_bps u16, route_plan Vec<…>`. Any other route instruction is refused.
 */
interface RouteLayout {
  name: string;
  discriminator: readonly number[];
  /** Where the arguments start. */
  argsOffset: number;
  fixedAccounts: number;
  authority: number;
  source: number;
  destination: number;
  sourceMint: number;
  destinationMint: number;
  /** `route_v2`'s optional `destination_token_account` (JUP6's own id when unset). */
  redirect: number | null;
}

const ROUTE_LAYOUTS: readonly RouteLayout[] = [
  {
    name: "route_v2",
    discriminator: [0xbb, 0x64, 0xfa, 0xcc, 0x31, 0xc4, 0xaf, 0x14],
    argsOffset: 8,
    fixedAccounts: 10,
    authority: 0,
    source: 1,
    destination: 2,
    sourceMint: 3,
    destinationMint: 4,
    redirect: 7,
  },
  {
    name: "shared_accounts_route_v2",
    discriminator: [0xd1, 0x98, 0x53, 0x93, 0x7c, 0xfe, 0xd8, 0xe9],
    argsOffset: 9,
    fixedAccounts: 12,
    authority: 1,
    source: 2,
    destination: 5,
    sourceMint: 6,
    destinationMint: 7,
    redirect: null,
  },
];

/** One decoded route instruction. */
export interface DecodedRoute {
  instruction: string;
  /** The instruction's fixed accounts (authority, token accounts, mints, programs). */
  fixedAccounts: string[];
  authority: string;
  source: string;
  destination: string;
  sourceMint: string;
  destinationMint: string;
  /** `route_v2`'s optional output redirect; null when the layout has none. */
  redirect: string | null;
  inAmount: bigint;
  quotedOutAmount: bigint;
  slippageBps: number;
  platformFeeBps: number;
}

function readU16(data: Uint8Array, at: number): number {
  return data[at] | (data[at + 1] << 8);
}

function readU32(data: Uint8Array, at: number): number {
  return (data[at] | (data[at + 1] << 8) | (data[at + 2] << 16)) + data[at + 3] * 0x1_00_00_00;
}

function readU64(data: Uint8Array, at: number): bigint {
  return BigInt(readU32(data, at)) + (BigInt(readU32(data, at + 4)) << BigInt(32));
}

/** Pure: decode Ultra's route instruction, or null when it is not one Tocker can read. */
export function decodeJupiterRoute(ix: SwapInstructionView): DecodedRoute | null {
  if (ix.programId !== PROGRAM.jupiterV6) return null;
  const layout = ROUTE_LAYOUTS.find((l) => l.discriminator.every((byte, i) => ix.data[i] === byte));
  if (!layout) return null;
  const at = layout.argsOffset;
  // Five fixed arguments and the route plan's length prefix.
  if (ix.data.length < at + 26 || ix.accounts.length < layout.fixedAccounts) return null;
  return {
    instruction: layout.name,
    fixedAccounts: ix.accounts.slice(0, layout.fixedAccounts),
    authority: ix.accounts[layout.authority],
    source: ix.accounts[layout.source],
    destination: ix.accounts[layout.destination],
    sourceMint: ix.accounts[layout.sourceMint],
    destinationMint: ix.accounts[layout.destinationMint],
    redirect: layout.redirect === null ? null : ix.accounts[layout.redirect],
    inAmount: readU64(ix.data, at),
    quotedOutAmount: readU64(ix.data, at + 8),
    slippageBps: readU16(ix.data, at + 16),
    platformFeeBps: readU16(ix.data, at + 18),
  };
}

/** The most Jupiter's own cut on a route may be, whatever the order says: 1%. Ultra charges 2-10 bps. */
const MAX_ROUTE_FEE_BPS = 100;
/** How far the route's quoted output may sit under the order's `outAmount`: 1%. Live they agree to 0.01%. */
const QUOTED_OUT_TOLERANCE_BPS = 100;

/** What {@link checkSwapShape} holds a transaction to. Build it with {@link swapExpectation}. */
export interface SwapExpectation {
  /** The owner of the funds: the agent, or the platform on its own refuel. */
  taker: string;
  /** The platform on a sponsored swap (account 0, the fee payer). Null when the taker pays, or Jupiter's gasless relayer does. */
  payer: string | null;
  /** Accounts the swap must not name anywhere: the platform's own token accounts, on an agent's swap. */
  forbidden: readonly string[];
  inputMint: string;
  outputMint: string;
  /** Base units of `inputMint` the route must spend — exactly. */
  inAmount: bigint;
  maxSlippageBps: number;
  maxFeeBps: number;
  /** The least the route may quote as its output. */
  minQuotedOut: bigint;
  /** The taker's token accounts for each mint, under both token programs. */
  takerInputAccounts: readonly string[];
  takerOutputAccounts: readonly string[];
  takerWrappedSol: string;
}

/**
 * The expectation for one order: the route that was asked for, the order JSON that came
 * back (already through the ceiling check), and the taker's own accounts.
 */
export async function swapExpectation(input: {
  taker: string;
  payer: string | null;
  forbidden?: readonly string[];
  route: OrderRoute;
  order: Pick<UltraOrder, "slippageBps" | "feeBps" | "outAmount">;
}): Promise<SwapExpectation> {
  const { PublicKey } = await import("@solana/web3.js");
  const { associatedTokenAddress, TOKEN_2022_PROGRAM_ID } = await import("@/lib/wallets/solana-transfer");
  const owner = new PublicKey(input.taker);
  const accountsFor = (mint: string) => {
    const key = new PublicKey(mint);
    return [associatedTokenAddress(owner, key).toBase58(), associatedTokenAddress(owner, key, TOKEN_2022_PROGRAM_ID).toBase58()];
  };
  let outAmount = BigInt(0);
  try {
    outAmount = BigInt(input.order.outAmount);
  } catch {
    // An unreadable outAmount leaves the floor at zero: the route's own number is then
    // bounded only by the slippage check, and the quote itself was already refused upstream.
  }
  return {
    taker: input.taker,
    payer: input.payer,
    forbidden: input.forbidden ?? [],
    inputMint: input.route.inputMint,
    outputMint: input.route.outputMint,
    inAmount: BigInt(input.route.amount),
    maxSlippageBps: input.order.slippageBps ?? MAX_ACCEPTED_SLIPPAGE_BPS,
    maxFeeBps: Math.min(MAX_ROUTE_FEE_BPS, input.order.feeBps ?? MAX_ROUTE_FEE_BPS),
    minQuotedOut: (outAmount * BigInt(10_000 - QUOTED_OUT_TOLERANCE_BPS)) / BigInt(10_000),
    takerInputAccounts: accountsFor(input.route.inputMint),
    takerOutputAccounts: accountsFor(input.route.outputMint),
    takerWrappedSol: associatedTokenAddress(owner, new PublicKey(SOL_MINT)).toBase58(),
  };
}

/** What a transaction that passed {@link checkSwapShape} costs, and who pays it. */
export interface SwapShape {
  /** Static account 0. */
  feePayer: string;
  signatures: number;
  /** The requested limit, or the runtime's 1.4M ceiling when none is set. */
  computeUnitLimit: number;
  microLamportsPerUnit: number;
  priorityLamports: number;
  /** Top-level token accounts opened with the fee payer's SOL (when that is not the taker). */
  payerFundedAccounts: number;
  /** What the taker sends back to the fee payer: a SOL route's wrapped-SOL rent. */
  repaidToPayerLamports: number;
  route: DecodedRoute;
}

export type SwapShapeCheck = { ok: true; shape: SwapShape } | { ok: false; problem: string };

/** The runtime's ceiling on compute units per transaction — the fee when no limit is set. */
const MAX_COMPUTE_UNITS = 1_400_000;

/** Pure: why the route does something other than the order, or null. */
function routeProblem(route: DecodedRoute, expect: SwapExpectation): string | null {
  if (route.authority !== expect.taker) return "the route spends from a wallet other than the swap's owner";
  if (!expect.takerInputAccounts.includes(route.source)) return "the route spends from an account the swap's owner does not own";
  if (!expect.takerOutputAccounts.includes(route.destination)) return "the route pays out to an account the swap's owner does not own";
  if (route.redirect !== null && route.redirect !== PROGRAM.jupiterV6 && route.redirect !== route.destination) {
    return "the route sends its output somewhere else";
  }
  if (route.sourceMint !== expect.inputMint || route.destinationMint !== expect.outputMint) {
    return "the route swaps different tokens than the order";
  }
  if (route.inAmount !== expect.inAmount) return `the route spends ${route.inAmount} base units, not the ${expect.inAmount} asked for`;
  if (route.slippageBps > expect.maxSlippageBps) {
    return `the route allows ${route.slippageBps} bps of slippage, more than the order's ${expect.maxSlippageBps}`;
  }
  if (route.platformFeeBps > expect.maxFeeBps) return `the route takes a ${route.platformFeeBps} bps fee, more than the order's ${expect.maxFeeBps}`;
  if (route.quotedOutAmount < expect.minQuotedOut) return "the route quotes less output than the order promised";
  if (expect.payer !== null && route.fixedAccounts.includes(expect.payer)) {
    return "the route names Tocker's fee wallet in one of its own accounts";
  }
  return null;
}

/**
 * Pure: whether a swap transaction does what the order says and nothing else — see the
 * module comment, "The byte check". The simulation inside `cosignAsPlatform` bounds the
 * platform's **lamports**; this is what bounds everything the simulation cannot see (a
 * token account's authority, an approval, where the output goes, whether the transaction
 * ever expires), and it does not lean on the simulation for SOL either: the only SOL
 * that can leave the fee payer is the fee and the rent of the accounts it funds.
 *
 * Signers can never come from a lookup table, so the signer checks do not depend on the
 * RPC that resolved the tables.
 */
export function checkSwapShape(view: SwapTransactionView, expect: SwapExpectation): SwapShapeCheck {
  const refuse = (problem: string): SwapShapeCheck => ({ ok: false, problem });
  const { taker, payer } = expect;
  const signers = view.numRequiredSignatures;

  let feePayer: string;
  if (payer !== null) {
    if (signers !== 2) return refuse(`the swap wants ${signers} signatures, not the agent's and Tocker's`);
    if (view.staticKeys[0] !== payer) return refuse("Tocker's fee wallet is not the fee payer (account 0)");
    if (view.staticKeys[1] !== taker) return refuse("the agent is not the second signer");
    feePayer = payer;
  } else if (signers === 1 && view.staticKeys[0] === taker) {
    feePayer = taker;
  } else if (signers === 2 && view.staticKeys[1] === taker && view.staticKeys[0] !== taker) {
    // Ultra's own gasless: Jupiter's relayer is account 0 and signs at /execute.
    feePayer = view.staticKeys[0];
  } else {
    return refuse(`the swap wants ${signers} signatures in an arrangement the swap's owner does not sign`);
  }

  const named = new Set([...view.staticKeys, ...view.lookupKeys]);
  for (const account of expect.forbidden) {
    if (named.has(account)) return refuse(`the swap names one of Tocker's own token accounts (${account})`);
  }

  let route: DecodedRoute | null = null;
  let computeUnitLimit: number | null = null;
  let microLamportsPerUnit = 0;
  let payerFundedAccounts = 0;
  let repaidToPayerLamports = 0;
  let repayments = 0;

  for (const ix of view.instructions) {
    if (!SWAP_PROGRAMS.has(ix.programId)) return refuse(`the swap calls ${ix.programId}, which a Jupiter route never does`);
    const kind = ix.data[0];
    switch (ix.programId) {
      case PROGRAM.computeBudget: {
        if (kind === 2 && ix.data.length === 5) computeUnitLimit = readU32(ix.data, 1);
        else if (kind === 3 && ix.data.length === 9) microLamportsPerUnit = Number(readU64(ix.data, 1));
        else if (!((kind === 1 || kind === 4) && ix.data.length === 5)) {
          return refuse("the swap carries a compute-budget instruction Jupiter does not send");
        }
        break;
      }
      case PROGRAM.ata: {
        const creates = ix.data.length === 0 || (ix.data.length === 1 && kind === 1);
        if (!creates) return refuse("the swap uses the token-account program for something other than opening an account");
        const [funder, , owner] = ix.accounts;
        if (owner !== taker) {
          return refuse(
            funder === payer
              ? "the swap has Tocker pay rent for a token account the agent does not own"
              : "the swap opens a token account for someone other than its owner",
          );
        }
        if (funder !== feePayer && funder !== taker) return refuse("the swap has a stranger fund a token account");
        if (funder === feePayer && funder !== taker) payerFundedAccounts += 1;
        break;
      }
      case PROGRAM.token:
      case PROGRAM.token2022: {
        const ownWrappedSol = ix.programId === PROGRAM.token && ix.accounts[0] === expect.takerWrappedSol;
        // SyncNative, after the owner wraps its own SOL.
        if (kind === 17 && ix.data.length === 1 && ownWrappedSol) break;
        // CloseAccount of the owner's wrapped-SOL account, back to the owner, by the owner.
        if (kind === 9 && ix.data.length === 1 && ownWrappedSol && ix.accounts[1] === taker && ix.accounts[2] === taker) break;
        return refuse("the swap has a token instruction other than wrapping or unwrapping its owner's own SOL");
      }
      case PROGRAM.system: {
        // `Transfer { lamports: u64 }`: discriminator 2 as a little-endian u32, then 8 bytes.
        // Nothing else: no nonce advance (a transaction that never expires), no account
        // creation, no assign — and never a transfer out of the fee payer.
        if (!(ix.data.length === 12 && readU32(ix.data, 0) === 2)) {
          return refuse("the swap has a System Program instruction that is not a plain transfer");
        }
        const [from, to] = ix.accounts;
        const lamports = Number(readU64(ix.data, 4));
        if (from !== taker) return refuse("the swap moves SOL out of a wallet other than its owner's");
        if (to === expect.takerWrappedSol) break;
        if (to === feePayer && feePayer !== taker && repayments === 0 && lamports <= ATA_RENT_LAMPORTS) {
          repayments += 1;
          repaidToPayerLamports += lamports;
          break;
        }
        return refuse("the swap sends its owner's SOL somewhere other than its own wrapped-SOL account");
      }
      case PROGRAM.jupiterV6: {
        if (route !== null) return refuse("the swap carries more than one route");
        const decoded = decodeJupiterRoute(ix);
        if (decoded === null) return refuse("the swap's route is not one Tocker can read");
        const problem = routeProblem(decoded, expect);
        if (problem !== null) return refuse(problem);
        route = decoded;
        break;
      }
      default:
        // Memo: it logs a string and checks signatures, and moves nothing.
        break;
    }
  }
  if (route === null) return refuse("the swap carries no route");

  const limit = computeUnitLimit ?? MAX_COMPUTE_UNITS;
  return {
    ok: true,
    shape: {
      feePayer,
      signatures: signers,
      computeUnitLimit: limit,
      microLamportsPerUnit,
      priorityLamports: priorityFeeLamports(limit, microLamportsPerUnit),
      payerFundedAccounts,
      repaidToPayerLamports,
      route,
    },
  };
}

/** Pure: whether two serialized transactions carry byte-identical messages (signatures aside). */
export async function sameMessageBytes(a: string, b: string): Promise<boolean> {
  try {
    const { VersionedTransaction } = await import("@solana/web3.js");
    const one = VersionedTransaction.deserialize(Uint8Array.from(Buffer.from(a, "base64"))).message.serialize();
    const two = VersionedTransaction.deserialize(Uint8Array.from(Buffer.from(b, "base64"))).message.serialize();
    return one.length === two.length && one.every((byte, i) => byte === two[i]);
  } catch {
    return false;
  }
}

/** The lookup tables a transaction references, read from `SOLANA_RPC_URL` in one call. */
async function fetchLookupTables(base64: string): Promise<AddressLookupTableAccount[]> {
  const { AddressLookupTableAccount, VersionedTransaction } = await import("@solana/web3.js");
  const tx = VersionedTransaction.deserialize(Uint8Array.from(Buffer.from(base64, "base64")));
  const keys = tx.message.addressTableLookups.map((l) => l.accountKey);
  if (keys.length === 0) return [];

  const { solanaRpcUrl } = await import("@/lib/wallets/solana-rpc");
  const res = await fetch(solanaRpcUrl(), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getMultipleAccounts",
      params: [keys.map((k) => k.toBase58()), { encoding: "base64", commitment: "confirmed" }],
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Solana RPC getMultipleAccounts failed (HTTP ${res.status})`);
  const body = (await res.json()) as {
    result?: { value?: Array<{ data?: [string, string] } | null> };
    error?: { message?: string };
  };
  if (body.error) throw new Error(`Solana RPC getMultipleAccounts failed: ${body.error.message ?? "unknown error"}`);
  const values = body.result?.value ?? [];
  return keys.map((key, i) => {
    const data = values[i]?.data?.[0];
    if (!data) throw new Error(`address lookup table ${key.toBase58()} was not found`);
    return new AddressLookupTableAccount({ key, state: AddressLookupTableAccount.deserialize(Buffer.from(data, "base64")) });
  });
}

/** The platform's own token accounts a swap must never name: its USDC and wrapped-SOL accounts. */
async function platformTokenAccounts(platform: string): Promise<string[]> {
  const { PublicKey } = await import("@solana/web3.js");
  const { associatedTokenAddress, SOLANA_USDC_MINT } = await import("@/lib/wallets/solana-transfer");
  const owner = new PublicKey(platform);
  const wrappedSol = new PublicKey("So11111111111111111111111111111111111111112");
  return [associatedTokenAddress(owner, SOLANA_USDC_MINT).toBase58(), associatedTokenAddress(owner, wrappedSol).toBase58()];
}

// ---------------------------------------------------------------- order fetching

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

/** An order ready to sign, and what was decided on the way to it. */
interface BuiltOrder {
  order: UltraOrder;
  /** The platform fee wallet when it pays this order's gas. */
  payer: string | null;
  /** The priority fee the platform pays on this trade, when it pays. */
  priorityAllowanceLamports?: number;
}

/** What `/execute` answered, before it is turned into a {@link Fill}. */
interface ExecuteResponse {
  httpStatus: number;
  ok: boolean;
  raw: string;
  body: Record<string, unknown> | null;
}

/** Pure: the error a trade row carries when Tocker declined to sign or send a swap. */
export function notSentNote(reason: string): string {
  return `Tocker did not send this swap: ${reason}. Nothing was sent.`;
}

/** Test and wiring seams for {@link JupiterExecutor}. */
export interface JupiterExecutorOptions {
  /**
   * How many of this agent's live Solana trades failed with a transaction id since
   * `since`. Defaults to a count of `trades` rows.
   */
  countOnChainFailures?: (agentId: string, since: Date) => Promise<number>;
}

/**
 * This agent's live Solana trades that failed after they were signed — the ones the fee
 * payer may have paid for. Unreadable is read as zero: the database also holds the trade
 * row, so a trade that cannot be recorded does not get this far anyway.
 */
async function countOnChainFailuresInDb(agentId: string, since: Date): Promise<number> {
  try {
    const { and, eq, gte, isNotNull, sql } = await import("drizzle-orm");
    const { getDb, trades } = await import("@/db");
    const db = await getDb();
    const [row] = await db
      .select({ n: sql<number>`count(*)` })
      .from(trades)
      .where(
        and(
          eq(trades.agentId, agentId),
          eq(trades.chain, "solana"),
          eq(trades.isPaper, false),
          eq(trades.status, "failed"),
          isNotNull(trades.txHash),
          gte(trades.createdAt, since),
        ),
      );
    return Number(row?.n ?? 0);
  } catch (err) {
    console.warn(`[jupiter] could not count on-chain failures for agent ${agentId}: ${errorText(err)}`);
    return 0;
  }
}

export class JupiterExecutor implements TradeExecutor {
  readonly venue = "jupiter" as const;
  readonly isPaper = false;
  private readonly wallet: AgentWalletRef;
  private readonly agentId: string | null;
  private readonly countOnChainFailures: (agentId: string, since: Date) => Promise<number>;

  constructor(wallet: AgentWalletRef, agentId?: string, options: JupiterExecutorOptions = {}) {
    this.wallet = wallet;
    this.agentId = agentId ?? null;
    this.countOnChainFailures = options.countOnChainFailures ?? countOnChainFailuresInDb;
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

  /** One line per fallback: which agent, which token, why the platform did not pay. */
  private logFallback(symbol: string, reason: string): void {
    console.warn(
      `[jupiter] ${symbol ? `${symbol}: ` : ""}Tocker could not pay the gas for agent ${this.agentId ?? "?"} (${
        this.wallet.address
      }) — ${reason}. Falling back to agent-paid gas.`,
    );
  }

  /**
   * The platform fee wallet to name as `payer`, or null for an agent-paid order.
   *
   * Only once the wallet is known to hold {@link SPONSORED_SWAP_RESERVE_LAMPORTS}:
   * `ensureSponsorCapacity` reads its balance and, when it is short, refuels it from its
   * own USDC first. An unfunded payer does not fail loudly — Jupiter answers 400 "Failed
   * to get quotes" — so skipping this check would quietly send every trade down the
   * agent-paid drip.
   */
  private async sponsorPayer(): Promise<string | null> {
    if (this.agentId === null || !sponsoredSwapsEnabled()) return null;
    try {
      const { ensureSponsorCapacity } = await import("@/lib/wallets/solana-sponsored");
      const capacity = await ensureSponsorCapacity({
        needLamports: SPONSORED_SWAP_RESERVE_LAMPORTS,
        why: "an agent swap",
      });
      if (!capacity.ok) {
        this.logFallback("", `its Solana fee wallet cannot cover a swap right now (${capacity.error})`);
        return null;
      }
      return orderPayerFor({
        agentId: this.agentId,
        enabled: true,
        platformAddress: capacity.address,
        taker: this.wallet.address,
      });
    } catch (err) {
      this.logFallback("", `its Solana fee wallet is unavailable (${errorText(err)})`);
      return null;
    }
  }

  /**
   * One `/order` for the route with no payer and no gas top-up, and no retries: does
   * Jupiter route this at all without the platform as payer? Used only to decide
   * whether a sponsored "Failed to get quotes" is worth an agent-paid attempt.
   */
  private async routesWithoutPayer(route: OrderRoute): Promise<boolean> {
    try {
      await fetchOrder(ultraOrderParams({ ...route, taker: this.wallet.address }), ORDER_RETRY_DELAYS_MS.length);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Fetch the order to sign: Ultra mode first, the operator's ceiling in manual mode when
   * Jupiter picked looser, and on the agent-paid path the W7 gas top-ups. Throws a
   * {@link JupiterError} (with a `kind` where it matters) when there is nothing to sign.
   */
  private async buildOrder(req: TradeRequest, route: OrderRoute, payer: string | null): Promise<BuiltOrder> {
    const sponsored = payer !== null;
    const isBuy = req.side === "buy";

    // A wallet with USDC and no SOL cannot fill anything on its own: Ultra's gasless mode
    // pays the signature, not the rent on the token account a first buy creates, and
    // answers `errorCode 1 "Insufficient funds"` for a taker holding thousands of USDC and
    // zero SOL (probed live 2026-09-21 against real gasless takers). So the agent-paid
    // path tops the wallet up first — a no-op once it holds a little SOL. A sponsored
    // order has the platform as payer and needs none of this.
    if (!sponsored && this.agentId) {
      const { ensureAgentGas } = await import("@/lib/wallets/gas");
      await ensureAgentGas({
        agentId: this.agentId,
        chain: "solana",
        walletId: this.wallet.walletId,
        address: this.wallet.address,
        requiredLamports: PRE_QUOTE_SOL_LAMPORTS,
        purpose: "swap",
      });
    }

    // No `slippageBps` first: see the module comment. `req.slippageBps` is the ceiling.
    const params = ultraOrderParams({ ...route, taker: this.wallet.address, payer });
    let order = await fetchOrder(params);

    // Jupiter chose looser than the operator allows: ask again with the ceiling as the
    // instruction. The second order is built so the fill cannot be worse than that.
    const manual = manualSlippageFor(order.slippageBps, req.slippageBps);
    // An agent's order asked far under Jupiter's own pick passes the simulation and then
    // fails on chain, where a failure still costs its fee payer the fee. Not sent.
    if (
      manual !== null &&
      this.agentId !== null &&
      manual < MIN_SPONSORED_SLIPPAGE_BPS &&
      (order.errorCode === null || order.errorCode === undefined)
    ) {
      throw new JupiterError(
        `Jupiter prices ${req.symbol} at ${order.slippageBps} bps of slippage and this agent's ceiling is ${req.slippageBps} bps. Tocker does not send an order tighter than ${MIN_SPONSORED_SLIPPAGE_BPS} bps below Jupiter's own pick: it tends to fail on chain after it is sent, and a failed trade still costs a network fee. Nothing was signed — raise Slippage tolerance in Risk to at least ${(
          MIN_SPONSORED_SLIPPAGE_BPS / 100
        ).toFixed(1)}%, or leave this one alone.`,
        { kind: "slippage" },
      );
    }
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
              { httpStatus: 400, kind: "slippage" },
            );
          }
        } else {
          throw err;
        }
      }
    }

    // Agent-paid only: Ultra says who pays. If that is the agent and the agent cannot, top
    // it up and ask again — the second order is the one we sign, with the drip confirmed.
    // What Jupiter declares is never the size of a drip on its own: past the per-swap cap
    // it is refused, and `ensureAgentGas` caps what any drip covers.
    if (!sponsored && takerPaysGas(order, this.wallet.address) && this.agentId) {
      const needLamports = orderFeeLamports(order);
      if (needLamports > MAX_SPONSORED_SWAP_LAMPORTS) {
        throw new JupiterError(
          `Jupiter wants ${needLamports} lamports of network fees for this ${req.symbol} trade, more than the ${MAX_SPONSORED_SWAP_LAMPORTS} Tocker covers for one trade, so nothing was signed.`,
          { kind: "sponsor" },
        );
      }
      const { ensureAgentGas } = await import("@/lib/wallets/gas");
      const result = await ensureAgentGas({
        agentId: this.agentId,
        chain: "solana",
        walletId: this.wallet.walletId,
        address: this.wallet.address,
        requiredLamports: needLamports,
        purpose: "swap",
      });
      if (result.dripped) order = await fetchOrder(params);
    }

    if (order.errorCode !== null && order.errorCode !== undefined) {
      const why = orderErrorHint(order.errorCode, {
        sponsored,
        address: this.wallet.address,
        spends: isBuy ? "USDC" : req.symbol,
      });
      throw new JupiterError(
        `Jupiter: ${order.errorMessage ?? "the taker cannot fill this order"} (code ${order.errorCode}).${why}`,
        { errorCode: order.errorCode, kind: order.errorCode === 1 ? "funds" : null },
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
        { kind: "slippage" },
      );
    }

    if (payer === null) return { order, payer };

    // What the platform pays for: the priority fee, scaled to the trade's size, and a new
    // token account only for a buy big enough to be worth one.
    const notionalUsd = orderNotionalUsd(req, order);
    const priorityAllowanceLamports = sponsoredPriorityAllowance({ notionalUsd, solPriceUsd: await solPriceUsd() });
    const problem =
      sponsoredOrderProblem(order, payer, this.wallet.address, priorityAllowanceLamports) ??
      accountOpeningProblem({ side: req.side, notionalUsd, declaredRentLamports: order.rentFeeLamports });
    if (problem !== null) {
      throw new JupiterError(`Tocker did not send this ${req.symbol} trade: ${problem}. Nothing was signed.`, { kind: "sponsor" });
    }
    return { order, payer, priorityAllowanceLamports };
  }

  /**
   * Stops sponsoring an agent that keeps failing on chain. Throws a `sponsor`
   * {@link JupiterError} — which is not retried agent-paid — or returns.
   */
  private async assertSponsorshipNotPaused(symbol: string): Promise<void> {
    if (this.agentId === null || !sponsoredSwapsEnabled()) return;
    const failures = await this.countOnChainFailures(this.agentId, new Date(Date.now() - 60 * 60 * 1000));
    const problem = sponsoredFailureProblem(failures);
    if (problem !== null) {
      console.warn(`[jupiter] agent ${this.agentId}: ${failures} on-chain failures in the last hour (limit ${MAX_SPONSORED_FAILURES_PER_HOUR}); not sponsoring.`);
      throw new JupiterError(`${symbol ? `${symbol}: ` : ""}${problem}. Nothing was sent.`, { kind: "sponsor" });
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

    const route: OrderRoute = { inputMint, outputMint, amount };
    await this.assertSponsorshipNotPaused(req.symbol);
    const payer = await this.sponsorPayer();
    let built: BuiltOrder;
    if (payer === null) {
      built = await this.buildOrder(req, route, null);
    } else {
      try {
        built = await this.buildOrder(req, route, payer);
      } catch (err) {
        if (!fallsBackToAgentGas(err)) throw err;
        // The platform's balance was just confirmed, so "no quote" is most likely the
        // pool. Ask once without the payer, and without topping the agent up, before an
        // agent-paid attempt that would drip SOL to it for nothing.
        if (isNoQuoteFailure(err) && !(await this.routesWithoutPayer(route))) throw err;
        this.logFallback(req.symbol, errorText(err));
        built = await this.buildOrder(req, route, null);
      }
    }
    const { order } = built;

    const inAmount = fromBaseUnits(order.inAmount, isBuy ? USDC_DECIMALS : req.decimals);
    const outAmount = fromBaseUnits(order.outAmount, isBuy ? req.decimals : USDC_DECIMALS);
    const amountToken = isBuy ? outAmount : inAmount;
    const amountUsd = isBuy ? inAmount : outAmount;
    const handle: JupiterHandle = {
      ...order,
      sponsorPayer: built.payer,
      route,
      ...(built.priorityAllowanceLamports === undefined ? {} : { priorityAllowanceLamports: built.priorityAllowanceLamports }),
    };

    return {
      request: req,
      venue: "jupiter",
      priceUsd: amountToken > 0 ? amountUsd / amountToken : fallbackPrice,
      amountToken,
      amountUsd,
      feeUsd: venueFeeUsd(order.feeBps, amountUsd),
      appliedSlippageBps: order.slippageBps,
      handle,
    };
  }

  async execute(quote: Quote, hooks?: ExecuteHooks): Promise<Fill> {
    const handle = quote.handle as JupiterHandle;
    const payer = handle.sponsorPayer ?? null;
    if (payer === null) return this.executeOrder(quote, handle, handle.route, hooks);
    return this.executeSponsored(quote, handle, payer, hooks);
  }

  private failedFill(quote: Quote, error: string, txHash: string | null = null): Fill {
    return {
      status: "failed",
      txHash,
      priceUsd: quote.priceUsd,
      amountToken: quote.amountToken,
      amountUsd: quote.amountUsd,
      feeUsd: quote.feeUsd,
      error,
    };
  }

  /**
   * {@link checkSwapShape} for these bytes against this order. Reads the lookup tables
   * over RPC; throws only when they cannot be read or the bytes do not parse.
   */
  private async checkBytes(
    transaction: string,
    input: { payer: string | null; route: OrderRoute; order: UltraOrder; forbidden?: readonly string[] },
  ): Promise<SwapShapeCheck> {
    const tables = await fetchLookupTables(transaction);
    const view = await viewSwapTransaction(transaction, tables);
    const expect = await swapExpectation({
      taker: this.wallet.address,
      payer: input.payer,
      forbidden: input.forbidden,
      route: input.route,
      order: input.order,
    });
    return checkSwapShape(view, expect);
  }

  /**
   * The platform-paid path. Every refusal before `/execute` is a failed fill with nothing
   * sent — there is no agent-paid retry, so there is no drip to farm by making a
   * sponsored swap fail its checks. After `/execute`, whatever it answers, the platform's
   * slot-0 signature is the trade's id and `settle.ts` asks the chain about it: a retry
   * there could fill twice if `/execute` said "not sent" and had sent it.
   */
  private async executeSponsored(quote: Quote, order: JupiterHandle, payer: string, hooks?: ExecuteHooks): Promise<Fill> {
    const refuse = (reason: string) => {
      console.warn(`[jupiter] ${quote.request.symbol}: not sending agent ${this.agentId ?? "?"}'s sponsored swap — ${reason}`);
      return this.failedFill(quote, notSentNote(reason));
    };
    if (!order.transaction) return refuse("Jupiter's order carried no transaction");

    // 1. The bytes, before anyone signs them, and what they may cost the platform.
    let budgetLamports: number;
    try {
      const checked = await this.checkBytes(order.transaction, {
        payer,
        route: order.route,
        order,
        forbidden: await platformTokenAccounts(payer),
      });
      if (!checked.ok) return refuse(checked.problem);
      const budget = sponsoredSwapBudget(
        {
          signatureLamports: checked.shape.signatures * SIGNATURE_FEE_LAMPORTS,
          priorityLamports: checked.shape.priorityLamports,
          platformFundedAccounts: checked.shape.payerFundedAccounts,
          declaredRentLamports: order.rentFeeLamports,
        },
        order.priorityAllowanceLamports ?? SPONSORED_PRIORITY_BASE_LAMPORTS,
      );
      if (!budget.ok) return refuse(budget.reason);
      budgetLamports = budget.lamports;
    } catch (err) {
      return refuse(`the transaction could not be checked (${errorText(err)})`);
    }

    const { CosignRefused, cosignAsPlatform, signAsServerWallet } = await import("@/lib/wallets/solana-cosign");

    // 2. The agent signs, and must have signed exactly what Jupiter built.
    let agentSigned: string;
    try {
      agentSigned = await signAsServerWallet(this.wallet.walletId, order.transaction);
    } catch (err) {
      return refuse(`the agent's wallet did not sign it (${errorText(err)})`);
    }
    if (!(await sameMessageBytes(order.transaction, agentSigned))) {
      return refuse("the agent's signed transaction is not the one Jupiter built");
    }

    // 3. The platform co-signs within the budget the bytes allow. A simulation that fails
    //    is refused here and is not retried any other way: the trade would fail anyway.
    let signedTransaction: string;
    try {
      signedTransaction = await cosignAsPlatform({
        transactionBase64: agentSigned,
        maxOutflowLamports: budgetLamports,
        purpose: "swap",
      });
    } catch (err) {
      if (err instanceof CosignRefused) {
        console.warn(`[jupiter] ${quote.request.symbol}: ${err.message}`);
        return this.failedFill(quote, err.message);
      }
      return refuse(`Tocker's fee wallet could not sign it (${errorText(err)})`);
    }

    // 4. The id exists now — slot 0 is the platform's signature. Persist it before sending.
    const signature = await signatureOfSignedTransaction(signedTransaction);
    await this.announceSigned(signature, hooks);

    // 5. Send. Whatever /execute answers, the id above is the one the chain is asked about.
    const response = await this.postExecute(signedTransaction, order.requestId);
    return this.fillFromExecute(quote, order, response, signature);
  }

  /**
   * The self-paid path: the agent signs alone and pays its own gas (or Jupiter's gasless
   * does) — or, with no agent id, the platform signs its own refuel swap. Either way the
   * bytes are checked first, and the fee its owner pays is capped.
   */
  private async executeOrder(quote: Quote, order: UltraOrder, route: OrderRoute, hooks?: ExecuteHooks): Promise<Fill> {
    if (!order.transaction) return this.failedFill(quote, "Jupiter order carried no transaction.");

    let shape: SwapShape;
    try {
      const checked = await this.checkBytes(order.transaction, { payer: null, route, order });
      if (!checked.ok) return this.failedFill(quote, notSentNote(checked.problem));
      shape = checked.shape;
    } catch (err) {
      return this.failedFill(quote, notSentNote(`the transaction could not be checked (${errorText(err)})`));
    }
    const selfPaid = shape.feePayer === this.wallet.address;
    if (selfPaid && shape.priorityLamports > MAX_SPONSORED_PRIORITY_LAMPORTS) {
      return this.failedFill(
        quote,
        notSentNote(`its priority fee is ${shape.priorityLamports} lamports, over the ${MAX_SPONSORED_PRIORITY_LAMPORTS} Tocker pays on any trade`),
      );
    }

    let signedTransaction: string;
    if (this.agentId === null) {
      // The platform's own refuel. Its key signs Jupiter's bytes only through the same
      // simulation floor as a co-signature, within the fee it pays itself (a refuel gains
      // SOL, so a legitimate one loses nothing), plus a gasless relayer's rent repayment.
      const { platformFeePayer, signAsPlatformTaker } = await import("@/lib/wallets/solana-cosign");
      const platform = await platformFeePayer();
      if (platform.address !== this.wallet.address) {
        return this.failedFill(quote, notSentNote("an executor with no agent signs only for Tocker's own fee wallet"));
      }
      const feeLamports = selfPaid ? shape.signatures * SIGNATURE_FEE_LAMPORTS + shape.priorityLamports : 0;
      signedTransaction = await signAsPlatformTaker({
        transactionBase64: order.transaction,
        maxOutflowLamports: feeLamports + shape.repaidToPayerLamports,
        purpose: "refuel swap",
      });
    } else {
      const { privy, authorizationContext } = await import("@/lib/privy");
      const signed = await privy()
        .wallets()
        .solana()
        .signTransaction(this.wallet.walletId, {
          transaction: order.transaction,
          authorization_context: authorizationContext(),
        });
      signedTransaction = signed.signed_transaction;
    }

    // W7 H2: the transaction id is the fee payer's signature (slot 0) and exists the
    // moment the transaction is signed. Hand it to the settlement layer *before*
    // `/execute`, so an invocation frozen after broadcast still leaves a record that can
    // be checked against the chain. In Ultra's gasless mode Jupiter is the fee payer and
    // fills slot 0 at `/execute` time; until then the slot is zeros and there is no id yet.
    const signature = await signatureOfSignedTransaction(signedTransaction);
    await this.announceSigned(signature, hooks);

    const response = await this.postExecute(signedTransaction, order.requestId);
    return this.fillFromExecute(quote, order, response, signature);
  }

  /** Hands the id to `hooks.onSigned`. Returns the id when the hook ran, else null. */
  private async announceSigned(signature: string | null, hooks?: ExecuteHooks): Promise<string | null> {
    if (signature === null || !hooks?.onSigned) return null;
    try {
      await hooks.onSigned(signature);
    } catch (err) {
      console.warn(`[jupiter] onSigned hook failed for ${signature}:`, err instanceof Error ? err.message : err);
    }
    return signature;
  }

  /** POST `/execute`. Throws only when Jupiter could not be reached (the tx may be out). */
  private async postExecute(signedTransaction: string, requestId: string): Promise<ExecuteResponse> {
    const res = await fetch(executeUrl(), {
      method: "POST",
      headers: { "content-type": "application/json", ...jupiterHeaders() },
      body: JSON.stringify({ signedTransaction, requestId }),
      signal: AbortSignal.timeout(30_000),
    });
    const raw = await res.text().catch(() => "");
    let body: unknown = null;
    try {
      body = raw ? JSON.parse(raw) : null;
    } catch {
      body = null;
    }
    return {
      httpStatus: res.status,
      ok: res.ok,
      raw,
      body: body && typeof body === "object" ? (body as Record<string, unknown>) : null,
    };
  }

  /**
   * `/execute`'s answer as a fill. The id is the one this process computed from the
   * signed bytes whenever it has one — `/execute` naming a different transaction must not
   * send the settlement layer to ask the chain about the wrong one. Only Ultra's own
   * gasless order, whose id Jupiter assigns, takes Jupiter's.
   */
  private fillFromExecute(quote: Quote, order: UltraOrder, response: ExecuteResponse, signature: string | null): Fill {
    if (!response.ok || !response.body) {
      return this.failedFill(quote, `Jupiter execute failed (HTTP ${response.httpStatus}). ${response.raw.slice(0, 300)}`.trim(), signature);
    }

    const b = response.body;
    const status = asString(b.status);
    if (status !== "Success") {
      const code = asNullableNumber(b.code);
      const detail = asString(b.error) ?? `status ${status ?? "unknown"}`;
      // A transaction that landed but failed, or one Jupiter says it never sent: either
      // way the settlement layer asks the chain about the id.
      return this.failedFill(
        quote,
        `Jupiter execute: ${detail}${code === null || code === undefined ? "" : ` (code ${code})`}.`,
        signature ?? asString(b.signature),
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
      txHash: signature ?? asString(b.signature),
      priceUsd: amountToken > 0 ? amountUsd / amountToken : quote.priceUsd,
      amountToken,
      amountUsd,
      feeUsd: venueFeeUsd(order.feeBps, amountUsd),
    };
  }
}

/**
 * Pure: the USD size the platform prices a sponsored trade's gas against — what the
 * caller asked for and what Jupiter quoted, whichever is smaller, so neither side can
 * raise the allowance on its own.
 */
export function orderNotionalUsd(req: Pick<TradeRequest, "side" | "amountUsd">, order: Pick<UltraOrder, "inAmount" | "outAmount">): number {
  const quoted = req.side === "buy" ? fromBaseUnits(order.inAmount, USDC_DECIMALS) : fromBaseUnits(order.outAmount, USDC_DECIMALS);
  const asked = req.amountUsd;
  if (Number.isFinite(asked) && asked > 0 && Number.isFinite(quoted) && quoted > 0) return Math.min(asked, quoted);
  return Number.isFinite(quoted) && quoted > 0 ? quoted : 0;
}

/** SOL's USD mark for pricing an allowance, or null. Never throws. */
async function solPriceUsd(): Promise<number | null> {
  try {
    const { getPriceUsd } = await import("./prices");
    return await getPriceUsd("solana", SOL_MINT);
  } catch {
    return null;
  }
}
