/**
 * The platform fee, as arithmetic.
 *
 * Everything here is pure and free of `server-only`, drizzle and Privy, so the fee
 * rules can be unit-tested and read by the risk guard (which is synchronous) without
 * pulling a database in. The side-effecting half lives in `./fees.ts` (the ledger) and
 * `./settlement.ts` (the sweep).
 *
 * ## The rules
 *
 *  - A flat **$0.10 per executed fill** — buy or sell, agent, approved proposal,
 *    guardian exit or manual, live or paper. Flat rather than basis points on purpose:
 *    a percentage fee makes the platform want bigger tickets than the strategy does.
 *  - `PLATFORM_FEE_USD=0` turns it off completely. Nothing is written, nothing is shown,
 *    and no accounting anywhere shifts by a cent.
 *  - The fee is **accrued at fill and settled in batches**, never on the trade path. A
 *    live agent's fees are swept once they total `PLATFORM_FEE_SETTLE_MIN_USD`
 *    (default $1.00), because ten transfers of ten cents cost more in gas and latency
 *    than they collect, and because a failed transfer must never be able to fail a fill.
 */
import type { Chain } from "@/server/types";

/** What a fill costs, before the env is consulted. */
export const DEFAULT_PLATFORM_FEE_USD = 0.1;

/** How much has to pile up before a live agent's fees are swept on-chain. */
export const DEFAULT_SETTLE_MIN_USD = 1;

function readEnvUsd(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const trimmed = raw.trim();
  if (trimmed === "") return fallback;
  const n = Number(trimmed);
  // A malformed value falls back rather than disabling the fee silently — a typo in an
  // env var should not quietly make the product free.
  if (!Number.isFinite(n) || n < 0) return fallback;
  // Sub-cent precision is kept (a fee of $0.001 is legitimate); anything finer than the
  // ledger's six decimals is rounded to it.
  return Math.round(n * 1e6) / 1e6;
}

/**
 * The fee charged on one fill, in USD. `0` means the fee is off.
 *
 * Read at call time rather than captured at module load, so a test (or an operator
 * flipping the env on a redeploy) sees the change without a process restart.
 */
export function platformFeeUsd(): number {
  return readEnvUsd(process.env.PLATFORM_FEE_USD, DEFAULT_PLATFORM_FEE_USD);
}

/** True when the platform charges anything at all. */
export function feeEnabled(): boolean {
  return platformFeeUsd() > 0;
}

/** The batch threshold in USD. */
export function settleMinUsd(): number {
  return readEnvUsd(process.env.PLATFORM_FEE_SETTLE_MIN_USD, DEFAULT_SETTLE_MIN_USD);
}

/** What the fee is called everywhere a human reads it. */
export const PLATFORM_FEE_LABEL = "Tocker fee";

/** The literal written into a paper agent's fee row: there was no chain to settle on. */
export const SIMULATED_SETTLEMENT_TX = "simulated";

/** One accrued fee row, reduced to what the batching math needs. */
export interface FeeRow {
  id: string;
  chain: Chain;
  amountUsd: number;
}

export interface SettlementBatch {
  chain: Chain;
  amountUsd: number;
  feeIds: string[];
}

export interface SettlementPlan {
  /** Every accrued cent considered, across chains. */
  totalUsd: number;
  /** Empty when the total is under the threshold — the fees simply wait for next pass. */
  batches: SettlementBatch[];
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

/** Sum of a set of fee rows, rounded to the ledger's precision. */
export function sumFees(rows: readonly FeeRow[]): number {
  return round6(rows.reduce((total, row) => total + (Number.isFinite(row.amountUsd) ? row.amountUsd : 0), 0));
}

/**
 * Groups accrued fees into one transfer per chain — but only once the *total* across
 * chains clears the threshold.
 *
 * Total-first, not per-chain-first, deliberately: an agent trading both chains would
 * otherwise sit on $0.90 of Base fees and $0.90 of Solana fees forever, each half
 * waiting for a threshold the other half already justifies. Once the sweep is
 * warranted, every chain with anything owing goes in the same pass.
 */
export function planSettlement(rows: readonly FeeRow[], minUsd: number): SettlementPlan {
  const totalUsd = sumFees(rows);
  if (!(totalUsd > 0) || totalUsd + 1e-9 < minUsd) return { totalUsd, batches: [] };

  const byChain = new Map<Chain, SettlementBatch>();
  for (const row of rows) {
    if (!(row.amountUsd > 0)) continue;
    const batch = byChain.get(row.chain) ?? { chain: row.chain, amountUsd: 0, feeIds: [] };
    batch.amountUsd = round6(batch.amountUsd + row.amountUsd);
    batch.feeIds.push(row.id);
    byChain.set(row.chain, batch);
  }
  return { totalUsd, batches: [...byChain.values()].filter((b) => b.amountUsd > 0) };
}

/**
 * What a live agent's cash *is*, as opposed to what its wallet says.
 *
 * The wallet still holds the fees on every fill since the last sweep, but that money is
 * already owed. Showing the raw balance would let an agent size a trade with ten cents
 * it cannot keep — and the shortfall would surface as a failed settlement, which is the
 * worst place to discover it. Floored at zero: a wallet that went negative against its
 * accruals has no cash, it has a debt, and the sizing math must not see a negative.
 */
export function netLiveCashUsd(walletUsdc: number, accruedUnsettledUsd: number): number {
  const wallet = Number.isFinite(walletUsdc) ? walletUsdc : 0;
  const owed = Number.isFinite(accruedUnsettledUsd) && accruedUnsettledUsd > 0 ? accruedUnsettledUsd : 0;
  return Math.max(0, round6(wallet - owed));
}

/**
 * What a buy actually costs the agent: the notional plus the fee that will be charged
 * the moment it fills. The risk guard checks *this* against cash, so an agent can never
 * spend its last dollar and owe a dime it cannot pay.
 */
export function buyCostUsd(amountUsd: number, feeUsd: number = platformFeeUsd()): number {
  const notional = Number.isFinite(amountUsd) && amountUsd > 0 ? amountUsd : 0;
  const fee = Number.isFinite(feeUsd) && feeUsd > 0 ? feeUsd : 0;
  return round6(notional + fee);
}
