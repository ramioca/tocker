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
 *  - **0.5% of each executed fill's USD size**: buy or sell, agent, approved proposal,
 *    guardian exit or manual, live or paper. No minimum and no cap per fill. The amount
 *    is kept to the ledger's six decimals and never rounded up, so no fill is charged
 *    more than the rate.
 *  - One setting, `PLATFORM_FEE_BPS` (default 50). `0` turns the fee off completely:
 *    nothing is written, nothing is shown, and no accounting anywhere shifts by a cent.
 *    `PLATFORM_FEE_USD` is ignored: it is not read anywhere.
 *  - A fee that is needed **before** a fill (a cash check, a ceiling, a preview) is
 *    worked out from that fill's size by `feeForFill`, the one function the guard, the
 *    sizing and the charge share. A fee **already charged** is read from its ledger
 *    row, never worked out again at today's rate.
 *  - The fee is **accrued at fill and settled in batches**, never on the trade path. A
 *    live agent's fees are swept once they total `PLATFORM_FEE_SETTLE_MIN_USD`
 *    (default $1.00), because many small transfers cost more in gas and latency than
 *    they collect, and because a failed transfer must never be able to fail a fill.
 *
 * Only the server knows the rate: `platformFeeBps()` reads the environment, which a
 * browser does not have. Every helper below therefore takes the rate as an argument,
 * and a client component is handed it as a prop.
 */
import { toNumeric } from "@/lib/money";
import type { Chain } from "@/server/types";

/** The share of a fill that is charged, in basis points, before the env is consulted. */
export const DEFAULT_PLATFORM_FEE_BPS = 50;

/** The most the setting may ask for: a tenth of a fill. */
export const MAX_PLATFORM_FEE_BPS = 1000;

/** How much has to pile up before a live agent's fees are swept on-chain. */
export const DEFAULT_SETTLE_MIN_USD = 1;

/** Micro-dollars in a dollar: the ledger's six decimals, as whole numbers. */
const MICROS = 1_000_000;

function readEnvUsd(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const trimmed = raw.trim();
  if (trimmed === "") return fallback;
  const n = Number(trimmed);
  // A malformed value falls back rather than reading as zero.
  if (!Number.isFinite(n) || n < 0) return fallback;
  // Sub-cent precision is kept; anything finer than the ledger's six decimals is
  // rounded to it.
  return Math.round(n * 1e6) / 1e6;
}

/**
 * The share of each fill that is charged, in basis points. `0` means the fee is off.
 *
 * A value that is not a number, is negative or is above `MAX_PLATFORM_FEE_BPS` falls
 * back to the default: a typo in an env var must neither make the product free nor take
 * a tenth of a trade. Only a zero switches the fee off. A fraction of a basis point is
 * a number and is taken, to the hundredth the arithmetic below is exact at.
 *
 * Read at call time rather than captured at module load, so a test (or an operator
 * flipping the env on a redeploy) sees the change without a process restart.
 */
export function platformFeeBps(): number {
  const raw = process.env.PLATFORM_FEE_BPS;
  if (raw === undefined) return DEFAULT_PLATFORM_FEE_BPS;
  const trimmed = raw.trim();
  if (trimmed === "") return DEFAULT_PLATFORM_FEE_BPS;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0 || n > MAX_PLATFORM_FEE_BPS) return DEFAULT_PLATFORM_FEE_BPS;
  if (n === 0) return 0;
  const kept = Math.round(n * 100) / 100;
  // A positive rate too small to keep is not a zero, so it does not switch the fee off.
  return kept > 0 ? kept : DEFAULT_PLATFORM_FEE_BPS;
}

/** True when the platform charges anything at all. */
export function feeEnabled(): boolean {
  return platformFeeBps() > 0;
}

/**
 * The rate for a sentence: 50 is "0.5%", 25 is "0.25%", 100 is "1%". The one place a
 * rate is put into words, so every surface and the model's prompt say the same thing.
 */
export function formatFeeRate(bps: number): string {
  const pct = Number.isFinite(bps) && bps > 0 ? bps / 100 : 0;
  return `${Number(pct.toFixed(4))}%`;
}

/** The rate in millionths of a fill: a hundredth of a basis point each. */
function ratePpm(bps: number): number {
  return Number.isFinite(bps) && bps > 0 ? Math.round(bps * 100) : 0;
}

/**
 * A dollar amount in whole micro-dollars, rounded the way `toNumeric` writes it into a
 * `numeric(18,6)` column, so a fee is the rate times the size the ledger holds.
 */
function toMicros(usd: number): number {
  return Number.isFinite(usd) && usd > 0 ? Math.round(Number(toNumeric(usd, 6)) * MICROS) : 0;
}

/**
 * The fee on a size, both in whole micro-dollars, rounded down.
 *
 * Worked in whole numbers because the same figure decides three things that must agree:
 * what the guard asks cash to cover, the largest buy the cash allows, and what the
 * ledger is charged. In floating point `1.005 * 50 / 10_000` is a hair under 0.005025,
 * so a fee worked out two ways can differ by a micro-dollar, and the buy the guard
 * cleared is then not the buy the ledger bills. The whole dollars and the remainder are
 * multiplied apart so neither product leaves the range a double holds exactly.
 */
function feeMicros(sizeMicros: number, ppm: number): number {
  if (!(sizeMicros > 0) || !(ppm > 0)) return 0;
  const dollars = Math.floor(sizeMicros / MICROS);
  const rest = sizeMicros - dollars * MICROS;
  return dollars * ppm + Math.floor((rest * ppm) / MICROS);
}

/**
 * The fee on one fill of `amountUsd`, in USD, at `bps`. Zero when the rate is zero, when
 * the size is not a positive number, or when the fill is too small for its fee to reach
 * a millionth of a dollar.
 */
export function feeForFill(amountUsd: number, bps: number): number {
  return feeMicros(toMicros(amountUsd), ratePpm(bps)) / MICROS;
}

/**
 * What a buy actually costs the agent: the notional plus the fee that will be charged
 * the moment it fills. The risk guard checks *this* against cash, so an agent can never
 * spend its last dollar and owe a fee it cannot pay.
 */
export function buyCostUsd(amountUsd: number, bps: number): number {
  const size = toMicros(amountUsd);
  return (size + feeMicros(size, ratePpm(bps))) / MICROS;
}

/**
 * The largest buy a cash balance covers: the largest amount whose cost, fee included,
 * is no more than the cash. With the fee off that is the cash itself.
 *
 * It is not `cash × (1 − rate)`, which under-sizes, and it is searched rather than
 * divided because the fee is rounded to a micro-dollar: the division lands within one
 * of the answer and the loop settles it. The cash is read with the same billionth of a
 * dollar of tolerance the guard's comparison allows, so the answer here is one the
 * guard passes and a micro-dollar more is one it refuses.
 */
export function maxBuyUsd(cashUsd: number, bps: number): number {
  if (!Number.isFinite(cashUsd) || !(cashUsd > 0)) return 0;
  const ppm = ratePpm(bps);
  if (ppm === 0) return cashUsd;
  const cash = Math.floor(cashUsd * MICROS + 1e-3);
  let size = Math.floor(cash / (1 + ppm / MICROS)) + 2;
  while (size > 0 && size + feeMicros(size, ppm) > cash) size -= 1;
  return size / MICROS;
}

/**
 * A ceiling in the whole cents an order is written in, rounded down: a ceiling printed
 * to the nearest cent can be a cent more than the cash covers, and an order for it is
 * refused. Worked in whole micro-dollars first, because 9.45 × 100 is 944.99… in
 * floating point and a plain floor would answer $9.44.
 */
export function floorToCents(usd: number): number {
  if (!Number.isFinite(usd) || !(usd > 0)) return 0;
  return Math.floor(Math.floor(usd * MICROS + 1e-3) / 1e4) / 100;
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
 * already owed. Showing the raw balance would let an agent size a trade with money
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
 * The most USDC an owner may take out of a wallet that still owes fees: the balance less
 * what is owed, floored to a cent, never negative. The fees stay behind so the sweep that
 * follows the withdrawal has something to collect.
 *
 * Worked in whole micro-USDC before the floor: 10 − 0.3 is 9.699999… in floating point,
 * and flooring that to cents would answer $9.69 for a wallet that can spare $9.70.
 */
export function withdrawableAfterFees(walletUsdc: number, owedUsd: number): number {
  const wallet = Number.isFinite(walletUsdc) && walletUsdc > 0 ? walletUsdc : 0;
  const owed = Number.isFinite(owedUsd) && owedUsd > 0 ? owedUsd : 0;
  const micros = Math.round((wallet - owed) * 1e6);
  return micros > 0 ? Math.floor(micros / 1e4) / 100 : 0;
}
