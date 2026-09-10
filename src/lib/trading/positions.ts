/**
 * Position bookkeeping. The math lives in a pure function so it can be unit-tested;
 * `applyFill` is the thin drizzle wrapper the run loop calls after a fill.
 */
import { and, eq } from "drizzle-orm";
import { getDb, positions } from "@/db";

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

export const EMPTY_POSITION: PositionState = { amountToken: 0, avgCostUsd: 0, realizedPnlUsd: 0 };

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

/** Reads the current position, applies the fill and writes it back. */
export async function applyFill(agentId: string, tokenId: string, fill: FillDelta): Promise<PositionState> {
  const db = await getDb();
  const existing = await db
    .select()
    .from(positions)
    .where(and(eq(positions.agentId, agentId), eq(positions.tokenId, tokenId)))
    .limit(1);

  const prev: PositionState = existing[0]
    ? {
        amountToken: Number(existing[0].amountToken),
        avgCostUsd: Number(existing[0].avgCostUsd),
        realizedPnlUsd: Number(existing[0].realizedPnlUsd),
      }
    : EMPTY_POSITION;

  const next = applyFillToPosition(prev, fill);
  const values = {
    agentId,
    tokenId,
    amountToken: next.amountToken.toFixed(12),
    avgCostUsd: next.avgCostUsd.toFixed(12),
    realizedPnlUsd: next.realizedPnlUsd.toFixed(6),
    updatedAt: new Date(),
  };

  if (existing[0]) {
    await db
      .update(positions)
      .set(values)
      .where(and(eq(positions.agentId, agentId), eq(positions.tokenId, tokenId)));
  } else {
    await db.insert(positions).values(values);
  }
  return next;
}
