/**
 * Gas for the agent's Solana wallet (W7 contract — implemented by workstream A).
 *
 * An agent is funded with USDC only, and since W8 it never needs SOL to trade: every
 * Jupiter order an agent places names the platform Solana wallet as Ultra's `payer`, so
 * the platform is the transaction's fee payer and the payer of any token account the
 * swap opens, and co-signs through `cosignAsPlatform` within
 * {@link sponsoredSwapBudget} (see `src/lib/trading/jupiter.ts`).
 *
 * The drip below is what is left of the W7 design, kept as the **fallback** for when the
 * platform cannot cover a swap even after refuelling ({@link SPONSORED_SWAP_RESERVE_LAMPORTS}),
 * when Jupiter cannot build a sponsored order at all, and for `SOLANA_SPONSORED_SWAPS=0`: when
 * an Ultra order comes back with the taker as fee payer and the wallet cannot cover
 * `signatureFeeLamports + prioritizationFeeLamports + rentFeeLamports`, the platform
 * Solana wallet drips {@link GAS_DRIP_SOL} to it (a plain SystemProgram transfer, signed
 * and sent through Privy, confirmed before the order is retried) and an audit line is
 * written. Non-swap callers (withdrawals, fee sweeps) may call `ensureAgentGas` too.
 *
 * A drip is bounded twice (W8 review): it never covers a requirement past
 * {@link MAX_DRIP_REQUIREMENT_LAMPORTS}, whatever an order's JSON declares, and swap drips
 * stop at {@link MAX_SWAP_DRIPS_PER_DAY} per agent per day, counted from the audit lines.
 *
 * The same module prices what the platform pays for directly: {@link sponsoredSwapBudget}
 * (the co-sign bound, from the transaction's bytes), {@link sponsoredPriorityAllowance}
 * (priority fee tied to the trade's size), and the floors a sponsored swap must clear.
 *
 * The same platform wallet pre-creates the agent's USDC associated token account, so a
 * user funding the agent never pays the ~0.00204 SOL rent from their own wallet.
 *
 * Constants and pure helpers live here so the readiness checklist and tests can import
 * them without pulling Privy in; the effectful functions import Privy lazily, exactly
 * as `src/lib/platform/wallets.ts` does.
 */
import type { Chain } from "@/server/types";

/** Below this the agent's wallet is considered dry and the platform tops it up. */
export const MIN_AGENT_SOL = 0.005;
/** What one top-up sends. Covers a few dozen swaps plus a couple of new-token ATAs. */
export const GAS_DRIP_SOL = 0.01;
/** What the platform Solana wallet should hold to be able to drip and to create ATAs. */
export const MIN_PLATFORM_SOL = 0.02;
/** Rent-exempt minimum for a token account, in SOL. */
export const ATA_RENT_SOL = 0.00203928;

export const LAMPORTS_PER_SOL = 1_000_000_000;

/** CAIP-2 id of Solana mainnet-beta, as Privy's RPC endpoint wants it. */
export const CAIP2_SOLANA_MAINNET = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";

// ------------------------------------------------------ what one transfer costs

/** One signature on Solana. Two signers on one transaction still cost 5000 each. */
export const SIGNATURE_FEE_LAMPORTS = 5_000;
/**
 * {@link ATA_RENT_SOL} in lamports — the rent-exempt minimum for a token account.
 *
 * This is the long-standing figure and is now an **upper bound**: mainnet rent is lower
 * today. `getMinimumBalanceForRentExemption` answered 1,488,440 lamports for a 165-byte
 * token account and 1,513,840 for a 170-byte Token-2022 one (probed 2026-09-23), and
 * Ultra's `rentFeeLamports` matched those numbers. Kept as is because every estimate
 * built on it is a "can we afford this?" check, where overestimating is the safe error.
 */
export const ATA_RENT_LAMPORTS = 2_039_280;
/**
 * The cushion on the platform's "can I sponsor this?" check: 0.001 SOL.
 *
 * Generous on purpose. A wallet that holds exactly the fee is a wallet that answers
 * "yes" and then fails at broadcast against a busier block, and the failure the operator
 * sees would be an RPC error rather than the honest "top the platform wallet up".
 */
export const SPONSOR_MARGIN_LAMPORTS = 1_000_000;
/**
 * The cushion on a drip taken *before* an agent wallet signs a transfer: 10_000 lamports.
 *
 * Small on purpose, and for the opposite reason: the drip itself already rounds up to
 * {@link GAS_DRIP_SOL}, so this only has to stop a rounding edge from deciding the
 * wallet is exactly covered when it is one lamport short.
 */
export const TRANSFER_MARGIN_LAMPORTS = 10_000;

/**
 * Pure: what the **platform** wallet must hold to fee-pay one user→agent USDC funding
 * transfer — the signature, the destination token account's rent when it does not exist
 * yet, and a margin.
 *
 * Note which rent this is. The platform is the `payer` on the idempotent
 * create-associated-token-account instruction, so on a first funding it pays ~0.00204
 * SOL out of its own pocket; on every funding after that the instruction is a no-op and
 * the whole thing costs one signature.
 */
export function sponsoredFundingLamports(input: { ataExists: boolean }): number {
  return SIGNATURE_FEE_LAMPORTS + (input.ataExists ? 0 : ATA_RENT_LAMPORTS) + SPONSOR_MARGIN_LAMPORTS;
}

/**
 * Pure: what an **agent's own** Solana wallet must hold to sign one USDC transfer out of
 * itself — a withdrawal to the owner, or a platform-fee sweep.
 *
 * The agent is the fee payer there, and it is the payer on the destination's token
 * account too when that account does not exist yet. A USDC-only agent wallet holds no
 * SOL at all, which is exactly why `ensureAgentGas` runs before either call.
 */
export function agentTransferLamports(input: { ataExists: boolean }): number {
  return SIGNATURE_FEE_LAMPORTS + (input.ataExists ? 0 : ATA_RENT_LAMPORTS) + TRANSFER_MARGIN_LAMPORTS;
}

// ------------------------------------------------------ what one sponsored swap costs

/**
 * Headroom over a sponsored swap's exact cost when the platform co-signs it: 10,000
 * lamports. The signature and priority fees are read from the transaction's own bytes
 * (header and ComputeBudget instructions), which is what the runtime charges; the rent is
 * what the order declares. Measured on live payer orders (2026-09-23) the simulated loss
 * equalled that sum to the lamport, so the margin only absorbs a rounding edge. An
 * undeclared token account (≈1.5M lamports) does not fit in it, and is refused.
 */
export const SPONSORED_SWAP_MARGIN_LAMPORTS = 10_000;
/**
 * The most the platform fronts for one agent swap: 0.004 SOL. Two signatures, the
 * priority ceiling below and two new token accounts at today's rent (≈1.5M lamports
 * each) fit; a pump.fun route opening two accounts measured 3,017,083 live. Anything past
 * it is not a swap the platform pays for, and the trade is refused.
 */
export const MAX_SPONSORED_SWAP_LAMPORTS = 4_000_000;

/**
 * The priority fee the platform covers on any sponsored swap, however small: 0.00015 SOL
 * (≈$0.018). Jupiter's own estimate had a median of about 15k lamports across live payer
 * orders, and an ultra-mode sell of $0.25 of WIF asked 125,096 — an exit that small still
 * goes through. The attack shapes do not: 243,392 on a $0.005 sell, 1.05M-1.19M on $0.01
 * manual-mode buys (all live, 2026-09-23).
 */
export const SPONSORED_PRIORITY_BASE_LAMPORTS = 150_000;
/**
 * Past the base, the platform spends at most this share of the trade's USD size on its
 * priority fee: 30 bps. A $10 trade gets ≈$0.03 of priority, a $0.01 one gets the base.
 * The platform earns a flat fee per fill, so a sub-cent ticket carrying Jupiter's
 * 1.2M-lamport manual-mode priority (seen live) was a guaranteed loss, and a repeatable one.
 */
export const SPONSORED_PRIORITY_SHARE_BPS = 30;
/** And never more than this on one swap, however large: 0.0015 SOL. */
export const MAX_SPONSORED_PRIORITY_LAMPORTS = 1_500_000;
/**
 * The smallest buy the platform opens a token account for: $2 — the clip the "First
 * fifteen minutes" preset trades. The rent (≈$0.18 per account, up to three on a fresh
 * pump.fun route) is fronted by the platform and comes back only when the account is
 * emptied and recycled; a $0.01 buy of each of hundreds of tokens, held forever, never
 * comes back. At $2 that griefing locks $2 of the attacker's own money per $0.18–0.35
 * fronted, and the per-user trade rate limit caps how fast it can happen.
 */
export const MIN_ACCOUNT_OPENING_BUY_USD = 2;
/**
 * The tightest manual-mode slippage the platform pays for: 30 bps. An order asked well
 * under Jupiter's own pick passes the co-sign simulation a second after the quote and
 * then fails on chain a few slots later — and a failed swap still costs its fee payer the
 * signature and the priority fee, with no fill and no platform fee to show for it.
 */
export const MIN_SPONSORED_SLIPPAGE_BPS = 30;
/**
 * On-chain failures in an hour after which the platform stops paying for an agent's
 * swaps until the hour rolls over: 5. Every one of them cost a fee.
 */
export const MAX_SPONSORED_FAILURES_PER_HOUR = 5;

/**
 * Pure: the priority fee (lamports) the platform will pay on a sponsored swap of this
 * size — {@link SPONSORED_PRIORITY_BASE_LAMPORTS}, or {@link SPONSORED_PRIORITY_SHARE_BPS}
 * of the notional when that is more, never past {@link MAX_SPONSORED_PRIORITY_LAMPORTS}.
 * Without a usable size or SOL price it is the base.
 */
export function sponsoredPriorityAllowance(input: { notionalUsd: number; solPriceUsd: number | null }): number {
  const base = SPONSORED_PRIORITY_BASE_LAMPORTS;
  const { notionalUsd, solPriceUsd } = input;
  if (!(Number.isFinite(notionalUsd) && notionalUsd > 0)) return base;
  if (solPriceUsd === null || !(Number.isFinite(solPriceUsd) && solPriceUsd > 0)) return base;
  const share = Math.floor(((notionalUsd * SPONSORED_PRIORITY_SHARE_BPS) / 10_000 / solPriceUsd) * LAMPORTS_PER_SOL);
  return Math.min(MAX_SPONSORED_PRIORITY_LAMPORTS, Math.max(base, share));
}

/** Pure: the priority fee a transaction pays, from its ComputeBudget limit and price. */
export function priorityFeeLamports(computeUnitLimit: number, microLamportsPerUnit: number): number {
  if (!(computeUnitLimit > 0) || !(microLamportsPerUnit > 0)) return 0;
  return Math.ceil((computeUnitLimit * microLamportsPerUnit) / 1_000_000);
}

/** What one sponsored swap costs the platform, read from the transaction itself. */
export interface SponsoredSwapCost {
  /** 5,000 × the message's required signatures. */
  signatureLamports: number;
  /** Compute-unit limit × price, from the transaction's ComputeBudget instructions. */
  priorityLamports: number;
  /** Top-level token accounts the transaction has the platform fund. */
  platformFundedAccounts: number;
  /** The order's `rentFeeLamports`. It can only lower the rent bound, never raise it. */
  declaredRentLamports?: number | null;
}

export type SponsoredSwapBudget = { ok: true; lamports: number } | { ok: false; reason: string };

/**
 * Pure: the `maxOutflowLamports` the platform co-signs one sponsored swap under, or why it
 * will not. Built from the bytes, not from Jupiter's JSON: the signature and priority fees
 * are what the runtime will charge, and the rent is the order's declaration bounded by
 * {@link ATA_RENT_LAMPORTS} per account the platform funds at the top level — so an order
 * cannot raise its own allowance by declaring a larger fee, and there is no slack in it
 * for a transfer to hide in.
 */
export function sponsoredSwapBudget(cost: SponsoredSwapCost, priorityAllowanceLamports: number): SponsoredSwapBudget {
  const whole = (n: number | null | undefined) => (typeof n === "number" && Number.isFinite(n) && n > 0 ? Math.ceil(n) : 0);
  const priority = whole(cost.priorityLamports);
  if (priority > priorityAllowanceLamports) {
    return {
      ok: false,
      reason: `its priority fee is ${priority} lamports, over the ${priorityAllowanceLamports} Tocker pays on a trade this size`,
    };
  }
  const rent = Math.min(whole(cost.declaredRentLamports), whole(cost.platformFundedAccounts) * ATA_RENT_LAMPORTS);
  const lamports = whole(cost.signatureLamports) + priority + rent + SPONSORED_SWAP_MARGIN_LAMPORTS;
  if (lamports > MAX_SPONSORED_SWAP_LAMPORTS) {
    return { ok: false, reason: `it would cost ${lamports} lamports, over the ${MAX_SPONSORED_SWAP_LAMPORTS} a single swap is allowed` };
  }
  return { ok: true, lamports };
}

/**
 * Pure: why the platform will not open a token account for this buy, or null. Only a buy
 * whose order declares rent is an account-opening one; sells and buys into accounts the
 * agent already has are never refused here.
 */
export function accountOpeningProblem(input: {
  side: "buy" | "sell";
  notionalUsd: number;
  declaredRentLamports?: number | null;
}): string | null {
  if (input.side !== "buy") return null;
  const rent = input.declaredRentLamports;
  if (!(typeof rent === "number" && Number.isFinite(rent) && rent > 0)) return null;
  if (input.notionalUsd >= MIN_ACCOUNT_OPENING_BUY_USD) return null;
  return `a first buy of a token opens an account for it, and Tocker does that for buys of $${MIN_ACCOUNT_OPENING_BUY_USD} or more — this one is $${input.notionalUsd.toFixed(2)}`;
}

/**
 * Pure: why the platform stops paying for this agent's swaps for now, or null. Counts
 * on-chain failures of its live Solana trades in the last hour.
 */
export function sponsoredFailureProblem(failuresLastHour: number): string | null {
  if (!(failuresLastHour >= MAX_SPONSORED_FAILURES_PER_HOUR)) return null;
  return `${failuresLastHour} of this agent's trades failed on chain in the last hour, and each one still cost a network fee, so Tocker has paused paying for its trades until the hour rolls over — a looser slippage tolerance usually stops the failures`;
}

/** An Ultra order's three fee fields, as Jupiter reports them (any may be missing or null). */
export interface OrderFeeFields {
  signatureFeeLamports?: number | null;
  prioritizationFeeLamports?: number | null;
  rentFeeLamports?: number | null;
}

/** Pure: lamports an order says its fee payer must cover. Junk (negative, NaN) counts as zero. */
export function declaredOrderLamports(fields: OrderFeeFields): number {
  const part = (n: number | null | undefined) => (typeof n === "number" && Number.isFinite(n) && n > 0 ? n : 0);
  return part(fields.signatureFeeLamports) + part(fields.prioritizationFeeLamports) + part(fields.rentFeeLamports);
}

/** Pure: whether an order's declared gas fits under the per-swap cap at all. */
export function withinSponsoredSwapCap(fields: OrderFeeFields): boolean {
  return declaredOrderLamports(fields) <= MAX_SPONSORED_SWAP_LAMPORTS;
}

/**
 * What the platform wallet must hold before its address goes on an agent's order as
 * Ultra's `payer`: the most one swap may cost it ({@link MAX_SPONSORED_SWAP_LAMPORTS})
 * plus {@link SPONSOR_MARGIN_LAMPORTS}, so paying never takes it below its own
 * rent-exempt minimum — 0.005 SOL. Checked (and refuelled toward) through
 * `ensureSponsorCapacity` before the order is fetched, because Jupiter answers an
 * unfunded payer with a bare 400 "Failed to get quotes" rather than a code.
 */
export const SPONSORED_SWAP_RESERVE_LAMPORTS = MAX_SPONSORED_SWAP_LAMPORTS + SPONSOR_MARGIN_LAMPORTS;

/** Pure: how much SOL (whole units) a wallet is short of covering an order's fees. */
export function gasShortfallSol(input: {
  balanceSol: number;
  signatureFeeLamports?: number | null;
  prioritizationFeeLamports?: number | null;
  rentFeeLamports?: number | null;
}): number {
  const need =
    ((input.signatureFeeLamports ?? 0) + (input.prioritizationFeeLamports ?? 0) + (input.rentFeeLamports ?? 0)) /
    LAMPORTS_PER_SOL;
  const short = need - Math.max(0, input.balanceSol);
  return short > 0 ? short : 0;
}

/**
 * The largest requirement a drip covers: 0.006 SOL, the agent-paid swap path's pre-quote
 * top-up and the biggest honest number any caller passes (a transfer to a fresh token
 * account needs ≈0.00205). A requirement past it comes from an order's own fee fields —
 * Jupiter's JSON — and is refused rather than paid: a drip sized by whatever an order
 * declares is a drip anyone who controls the order can size.
 */
export const MAX_DRIP_REQUIREMENT_LAMPORTS = 6_000_000;
/** So no single drip is ever more than 0.011 SOL (the requirement plus {@link MIN_AGENT_SOL}). */
export const MAX_GAS_DRIP_SOL = MAX_DRIP_REQUIREMENT_LAMPORTS / LAMPORTS_PER_SOL + MIN_AGENT_SOL;
/**
 * Drips for swaps per agent per rolling 24 hours: 3. A swap drip is the fallback for when
 * the platform cannot pay a trade itself; one covers several trades, so a fourth in a day
 * is a wallet burning SOL, not trading. Withdrawal drips are not counted.
 */
export const MAX_SWAP_DRIPS_PER_DAY = 3;

export interface GasDripPlan {
  /** Whether the platform should send SOL before this order is signed. */
  drip: boolean;
  /** How much to send, in whole SOL. Zero when `drip` is false. */
  amountSol: number;
  /** What the wallet is short by, for the log line and the error message. */
  shortfallSol: number;
  /**
   * True when the requirement is past {@link MAX_DRIP_REQUIREMENT_LAMPORTS}: nothing is
   * sent, and the caller refuses the transaction instead.
   */
  overCap?: boolean;
}

/**
 * Pure: the drip decision for one pending order.
 *
 * A drip covers the shortfall *plus* a cushion, and never sends less than
 * {@link GAS_DRIP_SOL} — a wallet topped up to exactly the next fee is a wallet that
 * comes back here on the next trade, and every drip costs a signature of its own. It
 * never covers a requirement past {@link MAX_DRIP_REQUIREMENT_LAMPORTS}, so it never
 * sends more than {@link MAX_GAS_DRIP_SOL}.
 *
 * Rounded up to whole lamports so the number we send is the number that arrives.
 */
export function gasDripPlan(input: {
  balanceSol: number;
  /** The three fee fields added up, when the caller already has the total. */
  requiredLamports?: number;
  signatureFeeLamports?: number | null;
  prioritizationFeeLamports?: number | null;
  rentFeeLamports?: number | null;
}): GasDripPlan {
  const requiredLamports =
    input.requiredLamports ??
    (input.signatureFeeLamports ?? 0) + (input.prioritizationFeeLamports ?? 0) + (input.rentFeeLamports ?? 0);
  const shortfallSol =
    input.requiredLamports === undefined
      ? gasShortfallSol(input)
      : gasShortfallSol({ balanceSol: input.balanceSol, signatureFeeLamports: input.requiredLamports });
  if (shortfallSol <= 0) return { drip: false, amountSol: 0, shortfallSol: 0 };
  if (!(requiredLamports <= MAX_DRIP_REQUIREMENT_LAMPORTS)) {
    return { drip: false, amountSol: 0, shortfallSol, overCap: true };
  }
  const wanted = Math.min(MAX_GAS_DRIP_SOL, Math.max(GAS_DRIP_SOL, shortfallSol + MIN_AGENT_SOL));
  const amountSol = Math.ceil(wanted * LAMPORTS_PER_SOL) / LAMPORTS_PER_SOL;
  return { drip: true, amountSol, shortfallSol };
}

/** Pure: why a swap drip is refused today, or null. `recentSwapDrips` covers 24 hours. */
export function swapDripProblem(recentSwapDrips: number): string | null {
  if (!(recentSwapDrips >= MAX_SWAP_DRIPS_PER_DAY)) return null;
  return `Tocker has already topped this agent's wallet up for trading fees ${recentSwapDrips} times in the last 24 hours, which is its daily limit, so nothing was sent — trades resume once the oldest top-up is a day old`;
}

export interface EnsureGasResult {
  /** True when a drip was sent this call. */
  dripped: boolean;
  /** Transaction signature of the drip, when one was sent. */
  signature: string | null;
  /** The agent wallet's SOL after the call (best effort). */
  balanceSol: number;
}

export interface EnsureGasInput {
  agentId: string;
  chain: Chain;
  walletId: string;
  address: string;
  /** Lamports the pending order says the fee payer must cover. */
  requiredLamports: number;
  /**
   * What the SOL is for. `swap` drips are counted against {@link MAX_SWAP_DRIPS_PER_DAY};
   * `transfer` (a withdrawal or a fee sweep, the default) is not, so a limit reached by
   * trading never stands between an owner and their money.
   */
  purpose?: "swap" | "transfer";
}

/**
 * Make sure a live agent's Solana wallet can pay for its next Ultra order.
 *
 * For swaps this runs only on the fallback path — a sponsored order needs no SOL in the
 * agent's wallet at all.
 *
 * Reads the wallet's SOL from `SOLANA_RPC_URL`, and if it cannot cover
 * `requiredLamports`, sends a drip from the platform Solana wallet as a raw
 * `SystemProgram.transfer`, waits for it to confirm, and writes an audit line.
 *
 * Throws a {@link import("@/lib/platform/wallets").PlatformWalletError} when a drip is
 * needed and the platform cannot pay, or the drip does not confirm — and, without sending
 * anything, when the requirement is past {@link MAX_DRIP_REQUIREMENT_LAMPORTS} or a swap
 * drip would be past {@link MAX_SWAP_DRIPS_PER_DAY}. Its message reaches
 * users verbatim (a trade's error, the withdraw form), so it never asks anyone for SOL —
 * the user cannot fix it and should not be asked to. The numbers, the platform address
 * and what the operator can do go to the server log instead; the error still carries
 * the address in `.address`.
 */
export async function ensureAgentGas(input: EnsureGasInput): Promise<EnsureGasResult> {
  if (input.chain !== "solana") {
    throw new Error(`ensureAgentGas only covers Solana; asked for ${input.chain}.`);
  }
  const { PlatformWalletError, ensurePlatformWallet } = await import("@/lib/platform/wallets");
  const { confirmSignature, getSolBalance } = await import("./solana-rpc");

  let balanceSol = 0;
  try {
    balanceSol = await getSolBalance(input.address);
  } catch (err) {
    // An unreadable balance must not be read as zero — that would drip on every trade.
    // Treat it as "cannot decide", and let the order proceed as Jupiter priced it.
    console.warn(
      `[gas] could not read SOL for ${input.address}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return { dripped: false, signature: null, balanceSol: 0 };
  }

  const plan = gasDripPlan({ balanceSol, requiredLamports: input.requiredLamports });
  if (plan.overCap) {
    console.warn(
      `[gas] agent ${input.agentId} (${input.address}) asked for a drip covering ${input.requiredLamports} lamports, over the ${MAX_DRIP_REQUIREMENT_LAMPORTS} a drip covers; nothing sent.`,
    );
    throw new PlatformWalletError(
      "This transaction's network fee is higher than Tocker covers, so nothing was signed or sent.",
      "solana",
    );
  }
  if (!plan.drip) return { dripped: false, signature: null, balanceSol };

  if (input.purpose === "swap") {
    const recent = await recentSwapDrips(input.agentId);
    const problem = swapDripProblem(recent);
    if (problem !== null) {
      console.warn(`[gas] agent ${input.agentId} (${input.address}): ${problem}`);
      throw new PlatformWalletError(`${problem}.`, "solana");
    }
  }

  const platform = await ensurePlatformWallet("solana");
  let platformSol = await getSolBalance(platform.address).catch(() => 0);
  let refuelReason: string | null = null;
  if (platformSol < plan.amountSol + 0.000_01) {
    // Short: the platform wallet converts its own USDC to SOL before this drip gives up.
    const { ensurePlatformSol } = await import("@/lib/platform/sol");
    const refuel = await ensurePlatformSol("a gas drip to an agent");
    refuelReason = refuel.reason;
    platformSol = await getSolBalance(platform.address).catch(() => platformSol);
  }
  if (platformSol < plan.amountSol + 0.000_01) {
    // The operator's half: every number, the address, and the fix. Server log only.
    console.warn(
      `[gas] agent ${input.agentId} (${input.address}) holds ${balanceSol.toFixed(6)} SOL and needs ${(
        input.requiredLamports / LAMPORTS_PER_SOL
      ).toFixed(6)} SOL; the platform Solana wallet ${platform.address} holds ${platformSol.toFixed(
        6,
      )} SOL and cannot drip ${plan.amountSol}. Refuel: ${refuelReason ?? "not attempted"}. Send USDC or ${MIN_PLATFORM_SOL} SOL to that address.`,
    );
    const { FEE_WALLET_REFILLING } = await import("./solana-sponsored");
    throw new PlatformWalletError(FEE_WALLET_REFILLING, "solana", platform.address);
  }

  const { buildSolanaTransfer } = await import("./solana-transfer");
  const { privy, authorizationContext } = await import("@/lib/privy");
  const { solanaRpcUrl } = await import("./solana-rpc");

  const transaction = await buildSolanaTransfer({
    from: platform.address,
    to: input.address,
    asset: "native",
    amount: plan.amountSol,
    rpcUrl: solanaRpcUrl(),
  });

  const sent = await privy()
    .wallets()
    .solana()
    .signAndSendTransaction(platform.walletId, {
      caip2: CAIP2_SOLANA_MAINNET,
      transaction,
      authorization_context: authorizationContext(),
    });

  const signature = sent.hash;
  const status = await confirmSignature(signature, { timeoutMs: 20_000 });
  if (status !== "confirmed") {
    throw new PlatformWalletError(
      `Tocker's network fee top-up for this agent's wallet (${signature}) ${
        status === "failed" ? "failed on chain" : "did not confirm within 20 seconds"
      }, so nothing was signed — try again in a minute.`,
      "solana",
      platform.address,
    );
  }

  const after = await getSolBalance(input.address).catch(() => balanceSol + plan.amountSol);
  await auditDrip(input, plan, platform.address, signature);
  return { dripped: true, signature, balanceSol: after };
}

/**
 * Swap drips this agent received in the last 24 hours, from the audit lines
 * {@link auditDrip} writes. An unreadable count is read as the limit — the fallback this
 * guards is the one a drain would use, so it fails closed.
 */
async function recentSwapDrips(agentId: string): Promise<number> {
  try {
    const { and, eq, gte, sql } = await import("drizzle-orm");
    const { auditEvents, getDb } = await import("@/db");
    const db = await getDb();
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [row] = await db
      .select({ n: sql<number>`count(*)` })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.agentId, agentId),
          gte(auditEvents.createdAt, since),
          sql`${auditEvents.metadata}->>'reason' = 'gas_drip'`,
          sql`${auditEvents.metadata}->>'purpose' = 'swap'`,
        ),
      );
    return Number(row?.n ?? 0);
  } catch (err) {
    console.warn(`[gas] could not count swap drips for agent ${agentId}: ${err instanceof Error ? err.message : String(err)}`);
    return MAX_SWAP_DRIPS_PER_DAY;
  }
}

/** One audit line per drip: whose agent, how much, from where, and the signature. */
async function auditDrip(
  input: EnsureGasInput,
  plan: GasDripPlan,
  platformAddress: string,
  signature: string,
): Promise<void> {
  try {
    const { eq } = await import("drizzle-orm");
    const { agents, getDb } = await import("@/db");
    const db = await getDb();
    const [agent] = await db
      .select({ ownerId: agents.ownerId, name: agents.name })
      .from(agents)
      .where(eq(agents.id, input.agentId))
      .limit(1);
    if (!agent) return;

    const { recordAudit } = await import("@/lib/security/audit");
    await recordAudit({
      userId: agent.ownerId,
      // Borrowing the nearest honest existing kind: the audit enum belongs to another
      // workstream's schema block, and a gas top-up is a wallet-funding event.
      kind: "budget_change",
      agentId: input.agentId,
      agentName: agent.name,
      summary: `Tocker sent ${plan.amountSol} SOL of gas to this agent's Solana wallet so it could pay for its next trade.`,
      metadata: {
        reason: "gas_drip",
        purpose: input.purpose ?? "transfer",
        chain: "solana",
        amountSol: plan.amountSol,
        shortfallSol: plan.shortfallSol,
        toAddress: input.address,
        fromAddress: platformAddress,
        signature,
      },
    });
  } catch {
    // Audit is a record, not a gate: a failure here must not undo a confirmed transfer.
  }
}

/**
 * Create the agent's USDC associated token account on Solana, paid by the platform
 * Solana wallet, if it does not exist yet. Idempotent and best-effort: returns `false`
 * (never throws) when the platform wallet cannot pay, because a user can still fund
 * the agent — they just pay the rent themselves.
 */
export async function ensureAgentUsdcAta(input: { agentId: string; address: string }): Promise<boolean> {
  try {
    const { isPrivyConfigured } = await import("@/lib/privy");
    if (!isPrivyConfigured()) return false;
    if (!input.address || input.address.startsWith("PAPER")) return false;

    const { PublicKey } = await import("@solana/web3.js");
    const { associatedTokenAddress, SOLANA_USDC_MINT } = await import("./solana-transfer");
    const ata = associatedTokenAddress(new PublicKey(input.address), SOLANA_USDC_MINT).toBase58();

    const { accountExists, confirmSignature, getSolBalance, solanaRpcUrl } = await import("./solana-rpc");
    if (await accountExists(ata)) return true;

    const { ensurePlatformWallet } = await import("@/lib/platform/wallets");
    const platform = await ensurePlatformWallet("solana");
    const platformSol = await getSolBalance(platform.address).catch(() => 0);
    if (platformSol < ATA_RENT_SOL + 0.000_01) {
      console.warn(
        `[gas] platform Solana wallet ${platform.address} holds ${platformSol} SOL — not enough to pre-create the USDC account for agent ${input.agentId}. The funder will pay the rent instead.`,
      );
      return false;
    }

    const { buildCreateUsdcAtaTransaction } = await import("./solana-transfer");
    const { privy, authorizationContext } = await import("@/lib/privy");
    const transaction = await buildCreateUsdcAtaTransaction({
      payer: platform.address,
      owner: input.address,
      rpcUrl: solanaRpcUrl(),
    });
    const sent = await privy()
      .wallets()
      .solana()
      .signAndSendTransaction(platform.walletId, {
        caip2: CAIP2_SOLANA_MAINNET,
        transaction,
        authorization_context: authorizationContext(),
      });
    const status = await confirmSignature(sent.hash, { timeoutMs: 15_000 });
    return status === "confirmed";
  } catch (err) {
    console.warn(
      `[gas] could not pre-create the USDC account for agent ${input.agentId}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return false;
  }
}
