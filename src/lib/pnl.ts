/**
 * Pure PnL math. No db, no io — every input is plain numbers so this is
 * trivially unit-testable and reusable by the run loop, the leaderboard and
 * the agent page.
 *
 * Conventions:
 *  - `avgCostUsd` is cost *per token* and includes fees paid on the way in.
 *  - Realized PnL is booked on sells: qty * (price - avgCost) - fee.
 *  - Percentages are "12.5 means 12.5%".
 */
import type { LeaderboardWindow } from "@/server/types";

export interface PositionState {
  amountToken: number;
  avgCostUsd: number;
  realizedPnlUsd: number;
}

export interface Fill {
  side: "buy" | "sell";
  /** token quantity in human units */
  amountToken: number;
  /** execution price in USD per token */
  priceUsd: number;
  /** fee in USD (defaults to 0) */
  feeUsd?: number;
}

export interface ApplyFillResult {
  position: PositionState;
  /** realized PnL booked by *this* fill (0 for buys) */
  realizedDeltaUsd: number;
  /** change in the agent's cash balance (negative for buys) */
  cashDeltaUsd: number;
  /** quantity actually applied — sells are capped at the held amount */
  filledAmountToken: number;
}

export const EMPTY_POSITION: PositionState = { amountToken: 0, avgCostUsd: 0, realizedPnlUsd: 0 };

/**
 * Apply one fill to a position, weighted-average cost basis.
 * Returns a new position — never mutates the input.
 */
export function applyFill(position: PositionState | null | undefined, trade: Fill): ApplyFillResult {
  const prev: PositionState = position
    ? { amountToken: position.amountToken, avgCostUsd: position.avgCostUsd, realizedPnlUsd: position.realizedPnlUsd }
    : { ...EMPTY_POSITION };

  const fee = safe(trade.feeUsd ?? 0);
  const price = safe(trade.priceUsd);
  const requested = Math.abs(safe(trade.amountToken));

  if (requested === 0) {
    return { position: prev, realizedDeltaUsd: 0, cashDeltaUsd: 0, filledAmountToken: 0 };
  }

  if (trade.side === "buy") {
    const cost = requested * price + fee;
    const amount = prev.amountToken + requested;
    const avgCostUsd = amount > 0 ? (prev.amountToken * prev.avgCostUsd + cost) / amount : 0;
    return {
      position: { amountToken: amount, avgCostUsd, realizedPnlUsd: prev.realizedPnlUsd },
      realizedDeltaUsd: 0,
      cashDeltaUsd: -cost,
      filledAmountToken: requested,
    };
  }

  // sell — cannot sell more than held
  const qty = Math.min(requested, prev.amountToken);
  if (qty === 0) {
    return { position: prev, realizedDeltaUsd: 0, cashDeltaUsd: 0, filledAmountToken: 0 };
  }
  const proceeds = qty * price;
  const realized = qty * (price - prev.avgCostUsd) - fee;
  const amount = roundDust(prev.amountToken - qty);
  return {
    position: {
      amountToken: amount,
      avgCostUsd: amount > 0 ? prev.avgCostUsd : 0,
      realizedPnlUsd: prev.realizedPnlUsd + realized,
    },
    realizedDeltaUsd: realized,
    cashDeltaUsd: proceeds - fee,
    filledAmountToken: qty,
  };
}

export interface EquityPositionInput {
  tokenId: string;
  amountToken: number;
  avgCostUsd: number;
  realizedPnlUsd?: number;
}

export interface EquityInput {
  /** free USD (paper cash or wallet USDC) */
  cash: number;
  positions: EquityPositionInput[];
  /** tokenId → mark price in USD; missing/null falls back to average cost */
  marks: Record<string, number | null | undefined>;
}

export interface EquityResult {
  equityUsd: number;
  cashUsd: number;
  positionsValueUsd: number;
  costBasisUsd: number;
  unrealizedPnlUsd: number;
  realizedPnlUsd: number;
  /** positions valued at cost because no mark was available */
  unmarkedCount: number;
}

/** Total account value = cash + Σ(position size × mark). */
export function computeEquity(input: EquityInput): EquityResult {
  const cashUsd = safe(input.cash);
  let positionsValueUsd = 0;
  let costBasisUsd = 0;
  let realizedPnlUsd = 0;
  let unmarkedCount = 0;

  for (const p of input.positions ?? []) {
    const amount = safe(p.amountToken);
    const cost = amount * safe(p.avgCostUsd);
    const rawMark = input.marks?.[p.tokenId];
    const mark = typeof rawMark === "number" && Number.isFinite(rawMark) ? rawMark : null;
    if (mark === null && amount !== 0) unmarkedCount += 1;
    positionsValueUsd += amount * (mark ?? safe(p.avgCostUsd));
    costBasisUsd += cost;
    realizedPnlUsd += safe(p.realizedPnlUsd ?? 0);
  }

  return {
    equityUsd: cashUsd + positionsValueUsd,
    cashUsd,
    positionsValueUsd,
    costBasisUsd,
    unrealizedPnlUsd: positionsValueUsd - costBasisUsd,
    realizedPnlUsd,
    unmarkedCount,
  };
}

/** Unrealized PnL for a single position against a mark. */
export function unrealized(
  amountToken: number,
  avgCostUsd: number,
  markPriceUsd: number | null | undefined,
): { valueUsd: number | null; pnlUsd: number | null; pnlPct: number | null } {
  if (markPriceUsd === null || markPriceUsd === undefined || !Number.isFinite(markPriceUsd)) {
    return { valueUsd: null, pnlUsd: null, pnlPct: null };
  }
  const amount = safe(amountToken);
  const cost = amount * safe(avgCostUsd);
  const valueUsd = amount * markPriceUsd;
  const pnlUsd = valueUsd - cost;
  return { valueUsd, pnlUsd, pnlPct: cost === 0 ? null : (pnlUsd / Math.abs(cost)) * 100 };
}

export interface SnapshotPoint {
  at: Date | string | number;
  equityUsd: number;
  cashUsd?: number;
}

export interface WindowPnl {
  window: LeaderboardWindow;
  startEquityUsd: number;
  endEquityUsd: number;
  pnlUsd: number;
  pnlPct: number;
  startAt: string;
  endAt: string;
  points: number;
}

export const WINDOW_DAYS: Record<LeaderboardWindow, number | null> = { "7d": 7, "30d": 30, all: null };

/**
 * PnL over a window from equity snapshots.
 * Baseline = the last snapshot at or before the window start (so a mid-window
 * gap doesn't inflate returns); falls back to the earliest snapshot in range.
 * Returns null when there aren't two comparable points.
 */
export function pnlOverWindow(
  snapshots: SnapshotPoint[],
  window: LeaderboardWindow,
  now: Date = new Date(),
): WindowPnl | null {
  const points = (snapshots ?? [])
    .map((s) => ({ at: toDate(s.at), equityUsd: safe(s.equityUsd) }))
    .filter((s) => !Number.isNaN(s.at.getTime()))
    .sort((a, b) => a.at.getTime() - b.at.getTime());
  if (points.length === 0) return null;

  const days = WINDOW_DAYS[window];
  const cutoff = days === null ? null : new Date(now.getTime() - days * 86_400_000);

  const inWindow = cutoff ? points.filter((p) => p.at.getTime() >= cutoff.getTime()) : points;
  const before = cutoff ? points.filter((p) => p.at.getTime() < cutoff.getTime()).at(-1) : undefined;

  const end = (inWindow.at(-1) ?? points.at(-1))!;
  const start = before ?? inWindow[0] ?? points[0];
  if (!start || !end || start === end) return null;

  const pnlUsd = end.equityUsd - start.equityUsd;
  const pnlPct = start.equityUsd === 0 ? 0 : (pnlUsd / Math.abs(start.equityUsd)) * 100;
  return {
    window,
    startEquityUsd: start.equityUsd,
    endEquityUsd: end.equityUsd,
    pnlUsd,
    pnlPct,
    startAt: start.at.toISOString(),
    endAt: end.at.toISOString(),
    points: inWindow.length,
  };
}

export interface WinRateTrade {
  tokenId: string;
  side: "buy" | "sell";
  amountToken: number;
  priceUsd: number;
  feeUsd?: number;
  status?: string;
  createdAt?: Date | string | number;
}

export interface WinRateResult {
  /** 0..1, or null when the agent has never closed anything */
  rate: number | null;
  wins: number;
  losses: number;
  closed: number;
  realizedPnlUsd: number;
}

/**
 * Win rate over *closed* exposure: replays fills per token and scores each sell
 * by its realized PnL. Only `filled` trades count.
 */
export function winRate(trades: WinRateTrade[]): WinRateResult {
  const ordered = (trades ?? [])
    .filter((t) => (t.status ?? "filled") === "filled")
    .slice()
    .sort((a, b) => toDate(a.createdAt ?? 0).getTime() - toDate(b.createdAt ?? 0).getTime());

  const book = new Map<string, PositionState>();
  let wins = 0;
  let losses = 0;
  let closed = 0;
  let realizedPnlUsd = 0;

  for (const t of ordered) {
    const prev = book.get(t.tokenId) ?? { ...EMPTY_POSITION };
    const res = applyFill(prev, {
      side: t.side,
      amountToken: safe(t.amountToken),
      priceUsd: safe(t.priceUsd),
      feeUsd: safe(t.feeUsd ?? 0),
    });
    book.set(t.tokenId, res.position);
    if (t.side === "sell" && res.filledAmountToken > 0) {
      closed += 1;
      realizedPnlUsd += res.realizedDeltaUsd;
      if (res.realizedDeltaUsd > 0) wins += 1;
      else if (res.realizedDeltaUsd < 0) losses += 1;
    }
  }

  return { rate: closed === 0 ? null : wins / closed, wins, losses, closed, realizedPnlUsd };
}

/** Replay a whole trade history into positions + cash (used by the seed and paper mode). */
export function replayTrades(
  trades: WinRateTrade[],
  startingCashUsd: number,
): { cashUsd: number; positions: Map<string, PositionState> } {
  let cashUsd = safe(startingCashUsd);
  const positions = new Map<string, PositionState>();
  const ordered = (trades ?? [])
    .filter((t) => (t.status ?? "filled") === "filled")
    .slice()
    .sort((a, b) => toDate(a.createdAt ?? 0).getTime() - toDate(b.createdAt ?? 0).getTime());
  for (const t of ordered) {
    const res = applyFill(positions.get(t.tokenId), {
      side: t.side,
      amountToken: safe(t.amountToken),
      priceUsd: safe(t.priceUsd),
      feeUsd: safe(t.feeUsd ?? 0),
    });
    positions.set(t.tokenId, res.position);
    cashUsd += res.cashDeltaUsd;
  }
  return { cashUsd, positions };
}

function safe(n: number): number {
  return typeof n === "number" && Number.isFinite(n) ? n : 0;
}

/** kill float dust so a full exit lands exactly flat */
function roundDust(n: number): number {
  return Math.abs(n) < 1e-12 ? 0 : n;
}

function toDate(v: Date | string | number): Date {
  return v instanceof Date ? v : new Date(v);
}

/**
 * How far a position sits from its configured exits, in percentage points.
 * `stopDistancePct`: headroom above the stop (negative = the stop is already breached).
 * `takeProfitDistancePct`: room left below the take-profit (negative = already past it).
 * Null when the rule is off or the position cannot be marked.
 */
export function exitDistances(input: {
  unrealizedPct: number | null;
  stopLossPct: number | null;
  takeProfitPct: number | null;
}): { stopDistancePct: number | null; takeProfitDistancePct: number | null } {
  const u = input.unrealizedPct;
  if (u === null || !Number.isFinite(u)) return { stopDistancePct: null, takeProfitDistancePct: null };
  return {
    stopDistancePct: input.stopLossPct === null ? null : u + input.stopLossPct,
    takeProfitDistancePct: input.takeProfitPct === null ? null : input.takeProfitPct - u,
  };
}
