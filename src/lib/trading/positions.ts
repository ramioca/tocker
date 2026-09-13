/**
 * Position bookkeeping. The math lives in a pure function so it can be unit-tested;
 * `applyFill` is the thin drizzle wrapper the run loop calls after a fill.
 *
 * Beyond size and cost basis, a row carries the four fields the exit engine reads:
 * `openedAt`, `peakPriceUsd`, `entryScore` and `entryLiquidityUsd`. They are maintained
 * here, in one place, because every one of them is a function of the fills:
 *
 *  - a buy **from flat** opens the position: `openedAt = now`, `peak = fill price`, and
 *    the entry score / pooled liquidity are frozen from the score the buyer passed in;
 *  - a buy **into an existing** position is an add, not a new trade: `openedAt` is kept
 *    (a max-hold rule measures the thesis, not the last top-up) and the peak only ever
 *    ratchets up;
 *  - a **full close** resets all four to null, so the next entry starts clean and a
 *    stale peak cannot arm a trailing stop on a position that no longer exists.
 *
 * {@link updatePeaks} is the other half: between fills, the guardian raises the peak as
 * marks come in, which is what makes a trailing stop mean anything.
 */
import { and, eq, gt } from "drizzle-orm";
import { getDb, positions } from "@/db";
import { toNumeric } from "@/lib/money";

export interface PositionState {
  amountToken: number;
  avgCostUsd: number;
  realizedPnlUsd: number;
}

export interface FillDelta {
  side: "buy" | "sell";
  amountToken: number;
  /** Gross USD notional of the fill, before fees. */
  amountUsd: number;
  feeUsd: number;
}

/**
 * Everything the exit engine needs that the fill itself does not carry. Optional in
 * full: a caller that passes nothing still gets correct `openedAt` and `peakPriceUsd`
 * (the fill price is derived from `amountUsd / amountToken`), just no entry score.
 */
export interface FillMeta {
  /** Execution price per token. Defaults to `amountUsd / amountToken`. */
  priceUsd?: number | null;
  /**
   * The token's score at the moment of the fill — `TokenScore` and `TradeScore` both
   * fit structurally. Only read on the buy that opens a position.
   */
  score?: { total: number; liquidityUsd: number | null } | null;
  /** Injectable clock for tests. */
  now?: Date;
}

/** The exit-engine columns as they exist on a row. */
export interface PositionMeta {
  openedAt: Date | null;
  peakPriceUsd: number | null;
  entryScore: number | null;
  entryLiquidityUsd: number | null;
}

export const EMPTY_POSITION: PositionState = { amountToken: 0, avgCostUsd: 0, realizedPnlUsd: 0 };
const EMPTY_META: PositionMeta = { openedAt: null, peakPriceUsd: null, entryScore: null, entryLiquidityUsd: null };

/**
 * Average-cost accounting.
 * - buy: weighted-average cost basis grows, fees are capitalised into the basis.
 * - sell: realized PnL = proceeds − basis of the sold amount − fees; basis per unit is unchanged.
 * Selling more than we hold is clamped to the held amount (the risk guard rejects it first).
 */
export function applyFillToPosition(prev: PositionState, fill: FillDelta): PositionState {
  if (fill.side === "buy") {
    const newAmount = prev.amountToken + fill.amountToken;
    if (newAmount <= 0) return { ...prev };
    const prevBasis = prev.amountToken * prev.avgCostUsd;
    const addedBasis = fill.amountUsd + fill.feeUsd;
    return {
      amountToken: newAmount,
      avgCostUsd: (prevBasis + addedBasis) / newAmount,
      realizedPnlUsd: prev.realizedPnlUsd,
    };
  }

  const sold = Math.min(fill.amountToken, prev.amountToken);
  const remaining = Math.max(0, prev.amountToken - sold);
  const basisSold = sold * prev.avgCostUsd;
  const proceeds = fill.amountUsd - fill.feeUsd;
  return {
    amountToken: remaining,
    avgCostUsd: remaining === 0 ? 0 : prev.avgCostUsd,
    realizedPnlUsd: prev.realizedPnlUsd + (proceeds - basisSold),
  };
}

function finite(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * The exit-engine columns after a fill. Pure, so the three transitions (open, add,
 * close) are testable without a database.
 */
export function applyFillToMeta(
  prev: PositionState,
  prevMeta: PositionMeta,
  fill: FillDelta,
  next: PositionState,
  meta: FillMeta = {},
): PositionMeta {
  // Fully closed: forget everything. A stale peak on a flat row would arm a trailing
  // stop the moment the agent bought back in.
  if (next.amountToken <= 0) return { ...EMPTY_META };

  const now = meta.now ?? new Date();
  const price =
    finite(meta.priceUsd) ?? (fill.amountToken > 0 ? finite(fill.amountUsd / fill.amountToken) : null);
  const peak = Math.max(prevMeta.peakPriceUsd ?? 0, price ?? 0);

  // Opening from flat — this is where entry facts are frozen.
  if (fill.side === "buy" && prev.amountToken <= 0) {
    return {
      openedAt: now,
      peakPriceUsd: price,
      entryScore: meta.score?.total ?? null,
      entryLiquidityUsd: meta.score?.liquidityUsd ?? null,
    };
  }

  return {
    // A position that predates this bookkeeping has no openedAt; adopt the first fill we see.
    openedAt: prevMeta.openedAt ?? now,
    peakPriceUsd: peak > 0 ? peak : null,
    // Backfill entry facts if they were never recorded, but never overwrite them.
    entryScore: prevMeta.entryScore ?? meta.score?.total ?? null,
    entryLiquidityUsd: prevMeta.entryLiquidityUsd ?? meta.score?.liquidityUsd ?? null,
  };
}

/**
 * Reads the current position, applies the fill and writes it back — size, cost basis
 * and the exit-engine columns in one update.
 *
 * `meta` is optional and additive: existing callers keep working, and a caller that
 * knows the fill price and the token's score should pass both so the trailing stop and
 * the collapse rules have something to measure against.
 */
export async function applyFill(
  agentId: string,
  tokenId: string,
  fill: FillDelta,
  meta: FillMeta = {},
): Promise<PositionState> {
  const db = await getDb();
  const existing = await db
    .select()
    .from(positions)
    .where(and(eq(positions.agentId, agentId), eq(positions.tokenId, tokenId)))
    .limit(1);

  const row = existing[0];
  const prev: PositionState = row
    ? {
        amountToken: Number(row.amountToken),
        avgCostUsd: Number(row.avgCostUsd),
        realizedPnlUsd: Number(row.realizedPnlUsd),
      }
    : EMPTY_POSITION;
  const prevMeta: PositionMeta = row
    ? {
        openedAt: row.openedAt,
        peakPriceUsd: row.peakPriceUsd === null ? null : Number(row.peakPriceUsd),
        entryScore: row.entryScore === null ? null : Number(row.entryScore),
        entryLiquidityUsd: row.entryLiquidityUsd === null ? null : Number(row.entryLiquidityUsd),
      }
    : EMPTY_META;

  const next = applyFillToPosition(prev, fill);
  const nextMeta = applyFillToMeta(prev, prevMeta, fill, next, meta);

  const values = {
    agentId,
    tokenId,
    amountToken: toNumeric(next.amountToken, 12),
    avgCostUsd: toNumeric(next.avgCostUsd, 12),
    realizedPnlUsd: toNumeric(next.realizedPnlUsd, 6),
    openedAt: nextMeta.openedAt,
    peakPriceUsd: nextMeta.peakPriceUsd === null ? null : toNumeric(nextMeta.peakPriceUsd, 12),
    entryScore: nextMeta.entryScore === null ? null : toNumeric(nextMeta.entryScore, 2),
    entryLiquidityUsd: nextMeta.entryLiquidityUsd === null ? null : toNumeric(nextMeta.entryLiquidityUsd, 2),
    updatedAt: meta.now ?? new Date(),
  };

  if (row) {
    await db
      .update(positions)
      .set(values)
      .where(and(eq(positions.agentId, agentId), eq(positions.tokenId, tokenId)));
  } else {
    await db.insert(positions).values(values);
  }
  return next;
}

/**
 * Ratchets `peakPriceUsd` up to the fresh mark wherever the mark is higher (or the peak
 * was never set). Only ever raises: the trailing stop measures the best price the
 * position has seen, so a dip must not reset the reference.
 *
 * Returns the peak for every held token after the update, so the caller can feed the
 * exit engine without re-reading the table.
 */
export async function updatePeaks(
  agentId: string,
  marks: ReadonlyMap<string, number | null>,
): Promise<Map<string, number>> {
  const db = await getDb();
  const out = new Map<string, number>();
  if (marks.size === 0) return out;

  const held = await db
    .select()
    .from(positions)
    .where(and(eq(positions.agentId, agentId), gt(positions.amountToken, "0")));

  for (const row of held) {
    const peak = row.peakPriceUsd === null ? null : Number(row.peakPriceUsd);
    const mark = marks.get(row.tokenId) ?? null;
    const usableMark = finite(mark);
    const usablePeak = finite(peak);
    const next = Math.max(usableMark ?? 0, usablePeak ?? 0);
    if (next > 0) out.set(row.tokenId, next);
    // Write only when the mark actually set a new high; the common case is a no-op.
    if (usableMark === null || (usablePeak !== null && usableMark <= usablePeak)) continue;
    await db
      .update(positions)
      .set({ peakPriceUsd: toNumeric(usableMark, 12) })
      .where(and(eq(positions.agentId, agentId), eq(positions.tokenId, row.tokenId)));
  }

  return out;
}
