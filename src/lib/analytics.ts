/**
 * Performance analytics — pure math, no db, no io.
 *
 * The one number here that does not exist anywhere else in the product is
 * **calibration**: realized return grouped by the score the token had when the
 * agent bought it. It is the only feedback loop an operator has on
 * `universe.minScore`. If the 40-59 band loses money and the 80+ band makes it,
 * the floor is too low; if every band is flat, the score is not the thing
 * deciding the outcome and the strategy prompt is.
 *
 * ## How a "closed trade" is defined
 *
 * Fills are replayed per token into a FIFO queue of buy lots. A sell consumes
 * lots oldest-first, and each consumed slice is one closed round trip carrying:
 * its own entry price, entry score, and hold duration. Fees are split pro-rata
 * across the quantity they were paid on, so a partial exit books a partial fee.
 *
 * FIFO rather than the weighted-average basis used by {@link module:lib/pnl}:
 * average cost cannot tell you *which* buy a sell closed, and calibration needs
 * exactly that — the score at the entry being closed, not the position's mean.
 *
 * ## …and why the headline numbers are not FIFO
 *
 * The two bases only agree once a position is fully closed. While any of it is
 * still open they split the same total differently between realized and
 * unrealized, and a sell can be a FIFO loss and an average-cost win. The rest of
 * the product — the positions ledger, the agent's stat cards, `/money`, `/home` —
 * is average cost, and the unrealized number handed in here is too. So realized
 * PnL, win rate, best/worst and the chain/origin/exit splits are per *sell* on the
 * average-cost ledger ({@link closedSells}); FIFO slices are used only where the
 * entry itself matters: calibration and hold time.
 *
 * Everything is windowed by the **sell**: a position opened 40 days ago and sold
 * yesterday is a closed trade in the 7-day window. Lots are always replayed from
 * the beginning of history so the FIFO queue is correct at the window edge.
 */
import type {
  AgentAnalytics,
  Chain,
  ExitReason,
  LeaderboardWindow,
  ScoreBandStat,
  TradeOrigin,
} from "@/server/types";
import { applyFill, WINDOW_DAYS, type PositionState } from "@/lib/pnl";

/** The shape analytics needs from a `trades` row. Deliberately not `TradeRow`. */
export interface AnalyticsFill {
  id: string;
  tokenId: string;
  chain: Chain;
  side: "buy" | "sell";
  /** Token quantity, human units. */
  amountToken: number;
  amountUsd: number;
  priceUsd: number;
  feeUsd: number;
  status: string;
  origin: TradeOrigin;
  exitReason: ExitReason | null;
  /** `scoreSnapshot.total` at the moment of the fill; null on legacy rows. */
  entryScore: number | null;
  createdAt: Date | string | number;
}

/** One FIFO round trip: a slice of a buy lot closed by a later sell. */
export interface ClosedTrade {
  tokenId: string;
  chain: Chain;
  /** The sell that closed it — several closures can share one sell id. */
  sellId: string;
  amountToken: number;
  entryPriceUsd: number;
  exitPriceUsd: number;
  realizedPnlUsd: number;
  /** Return on the capital that was actually at risk in this slice. */
  returnPct: number | null;
  holdHours: number;
  entryScore: number | null;
  origin: TradeOrigin;
  exitReason: ExitReason | null;
  openedAt: string;
  closedAt: string;
}

/** One exit on the average-cost ledger — the same number `positions.realized_pnl_usd` books. */
export interface ClosedSell {
  sellId: string;
  tokenId: string;
  chain: Chain;
  realizedPnlUsd: number;
  origin: TradeOrigin;
  exitReason: ExitReason | null;
  closedAt: string;
}

interface Lot {
  amountToken: number;
  priceUsd: number;
  /** Entry fee attributable to one token of this lot. */
  feePerToken: number;
  at: number;
  entryScore: number | null;
}

const BANDS: Array<{ band: ScoreBandStat["band"]; min: number; max: number }> = [
  { band: "0-39", min: 0, max: 40 },
  { band: "40-59", min: 40, max: 60 },
  { band: "60-79", min: 60, max: 80 },
  { band: "80-100", min: 80, max: Infinity },
];

export function bandFor(total: number): ScoreBandStat["band"] {
  for (const b of BANDS) {
    if (total >= b.min && total < b.max) return b.band;
  }
  return "0-39";
}

function ms(value: Date | string | number): number {
  const t = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(t) ? t : 0;
}

function safe(n: number | null | undefined): number {
  return typeof n === "number" && Number.isFinite(n) ? n : 0;
}

/**
 * Replay every fill into FIFO round trips. Sells with nothing open behind them
 * (a position that predates the history we were handed, or a double sell) are
 * skipped rather than booked at a zero cost basis — a fabricated 100% win is
 * worse than a missing row.
 */
export function closedTrades(fills: readonly AnalyticsFill[]): ClosedTrade[] {
  const ordered = fills
    .filter((f) => f.status === "filled")
    .slice()
    .sort((a, b) => ms(a.createdAt) - ms(b.createdAt));

  const books = new Map<string, Lot[]>();
  const closed: ClosedTrade[] = [];

  for (const fill of ordered) {
    const qty = Math.abs(safe(fill.amountToken));
    if (qty === 0) continue;
    const lots = books.get(fill.tokenId) ?? [];

    if (fill.side === "buy") {
      lots.push({
        amountToken: qty,
        priceUsd: safe(fill.priceUsd),
        feePerToken: qty === 0 ? 0 : safe(fill.feeUsd) / qty,
        at: ms(fill.createdAt),
        entryScore: typeof fill.entryScore === "number" ? fill.entryScore : null,
      });
      books.set(fill.tokenId, lots);
      continue;
    }

    // sell — consume lots oldest first
    let remaining = qty;
    const exitPrice = safe(fill.priceUsd);
    const exitFeePerToken = qty === 0 ? 0 : safe(fill.feeUsd) / qty;
    const closedAt = ms(fill.createdAt);

    while (remaining > 1e-12 && lots.length > 0) {
      const lot = lots[0];
      const take = Math.min(remaining, lot.amountToken);
      const costPerToken = lot.priceUsd + lot.feePerToken;
      const realized = take * (exitPrice - exitFeePerToken - costPerToken);
      const basis = take * costPerToken;
      closed.push({
        tokenId: fill.tokenId,
        chain: fill.chain,
        sellId: fill.id,
        amountToken: take,
        entryPriceUsd: lot.priceUsd,
        exitPriceUsd: exitPrice,
        realizedPnlUsd: realized,
        returnPct: basis === 0 ? null : (realized / Math.abs(basis)) * 100,
        holdHours: Math.max(0, (closedAt - lot.at) / 3_600_000),
        entryScore: lot.entryScore,
        origin: fill.origin,
        exitReason: fill.exitReason,
        openedAt: new Date(lot.at).toISOString(),
        closedAt: new Date(closedAt).toISOString(),
      });
      lot.amountToken -= take;
      remaining -= take;
      if (lot.amountToken <= 1e-12) lots.shift();
    }

    books.set(fill.tokenId, lots);
  }

  return closed;
}

/**
 * Replay every fill on the weighted-average basis (`applyFill`, the ledger the
 * positions table and the stat cards read) and return one row per sell that
 * closed something. A sell with nothing open behind it closes nothing and is
 * left out, as in {@link closedTrades}.
 */
export function closedSells(fills: readonly AnalyticsFill[]): ClosedSell[] {
  const ordered = fills
    .filter((f) => f.status === "filled")
    .slice()
    .sort((a, b) => ms(a.createdAt) - ms(b.createdAt));

  const book = new Map<string, PositionState>();
  const out: ClosedSell[] = [];
  for (const fill of ordered) {
    const res = applyFill(book.get(fill.tokenId), {
      side: fill.side,
      amountToken: safe(fill.amountToken),
      priceUsd: safe(fill.priceUsd),
      feeUsd: safe(fill.feeUsd),
    });
    book.set(fill.tokenId, res.position);
    if (fill.side !== "sell" || res.filledAmountToken <= 0) continue;
    out.push({
      sellId: fill.id,
      tokenId: fill.tokenId,
      chain: fill.chain,
      realizedPnlUsd: res.realizedDeltaUsd,
      origin: fill.origin,
      exitReason: fill.exitReason,
      closedAt: new Date(ms(fill.createdAt)).toISOString(),
    });
  }
  return out;
}

/** Quantity-weighted mean hold time across closed round trips. */
export function avgHoldHours(closed: readonly ClosedTrade[]): number | null {
  let weight = 0;
  let sum = 0;
  for (const c of closed) {
    const w = Math.abs(c.amountToken);
    if (w === 0) continue;
    weight += w;
    sum += c.holdHours * w;
  }
  return weight === 0 ? null : sum / weight;
}

/**
 * Share of *sells* that booked a profit: one exit is one outcome, however many lots
 * it closed. Takes FIFO slices or {@link closedSells} rows; `computeAnalytics` passes
 * the latter so it agrees with the win rate on the agent overview.
 */
export function winRateOf(
  closed: ReadonlyArray<Pick<ClosedTrade, "sellId" | "realizedPnlUsd">>,
): { rate: number | null; wins: number; losses: number; closed: number } {
  const bySell = new Map<string, number>();
  for (const c of closed) bySell.set(c.sellId, (bySell.get(c.sellId) ?? 0) + c.realizedPnlUsd);
  let wins = 0;
  let losses = 0;
  for (const pnl of bySell.values()) {
    if (pnl > 0) wins += 1;
    else if (pnl < 0) losses += 1;
  }
  const n = bySell.size;
  return { rate: n === 0 ? null : wins / n, wins, losses, closed: n };
}

/**
 * Realized return by entry-score band. Round trips whose entry score is unknown
 * are left out entirely rather than dumped into `0-39`: a legacy row with no
 * snapshot is not evidence that a low score loses money.
 */
export function calibration(closed: readonly ClosedTrade[]): ScoreBandStat[] {
  const buckets = new Map<ScoreBandStat["band"], ClosedTrade[]>(BANDS.map((b) => [b.band, []]));
  for (const c of closed) {
    if (c.entryScore === null || !Number.isFinite(c.entryScore)) continue;
    buckets.get(bandFor(c.entryScore))!.push(c);
  }

  return BANDS.map(({ band }) => {
    const rows = buckets.get(band) ?? [];
    const returns = rows.flatMap((r) => (r.returnPct === null ? [] : [r.returnPct]));
    const wins = rows.filter((r) => r.realizedPnlUsd > 0).length;
    const decided = rows.filter((r) => r.realizedPnlUsd !== 0).length;
    return {
      band,
      trades: rows.length,
      winRate: decided === 0 ? null : wins / decided,
      avgReturnPct: returns.length === 0 ? null : returns.reduce((a, b) => a + b, 0) / returns.length,
      totalPnlUsd: rows.reduce((sum, r) => sum + r.realizedPnlUsd, 0),
    };
  });
}

/**
 * The sentence under the calibration chart. Reads the two bands that matter —
 * the best-populated high band and the worst-performing one — because "your 80+
 * picks averaged +12.4% over 9 trades" is the whole point of the chart.
 *
 * `owner: false` is for a visitor reading someone else's agent: the subject becomes
 * "This agent's", since the picks are not theirs.
 */
export function calibrationSentence(
  bands: readonly ScoreBandStat[],
  { owner = true }: { owner?: boolean } = {},
): string | null {
  const populated = bands.filter((b) => b.trades > 0 && b.avgReturnPct !== null);
  if (populated.length === 0) return null;

  // "lost 12.2%", never "lost −12.2%": the verb already carries the sign.
  const phrase = (b: ScoreBandStat, noun = "") =>
    `${b.band}${noun} ${
      b.avgReturnPct! >= 0 ? `averaged ${signedPct(b.avgReturnPct!)}` : `lost ${Math.abs(b.avgReturnPct!).toFixed(1)}%`
    } over ${b.trades} trade${b.trades === 1 ? "" : "s"}`;

  const best = populated.reduce((a, b) => (b.avgReturnPct! > a.avgReturnPct! ? b : a));
  const worst = populated.reduce((a, b) => (b.avgReturnPct! < a.avgReturnPct! ? b : a));

  const subject = owner ? "Your" : "This agent's";
  if (best.band === worst.band) return `${subject} ${phrase(best, " picks")}.`;
  return `${subject} ${phrase(best, " picks")}; ${phrase(worst)}.`;
}

function signedPct(value: number): string {
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${Math.abs(value).toFixed(1)}%`;
}

/**
 * Deepest peak-to-trough fall in the equity curve, as a positive percentage.
 * Null when there is no curve to measure or the peak was never above zero.
 */
export function maxDrawdownPct(points: ReadonlyArray<{ at: Date | string | number; equityUsd: number }>): number | null {
  const series = points
    .map((p) => ({ at: ms(p.at), equityUsd: safe(p.equityUsd) }))
    .sort((a, b) => a.at - b.at);
  if (series.length < 2) return null;

  let peak = -Infinity;
  let worst = 0;
  let sawPositivePeak = false;
  for (const point of series) {
    if (point.equityUsd > peak) peak = point.equityUsd;
    if (peak <= 0) continue;
    sawPositivePeak = true;
    const fall = ((peak - point.equityUsd) / peak) * 100;
    if (fall > worst) worst = fall;
  }
  return sawPositivePeak ? worst : null;
}

function sumBy<K>(rows: readonly ClosedSell[], key: (row: ClosedSell) => K): Map<K, { trades: number; pnlUsd: number }> {
  const out = new Map<K, { trades: number; pnlUsd: number }>();
  for (const row of rows) {
    const k = key(row);
    const entry = out.get(k) ?? { trades: 0, pnlUsd: 0 };
    entry.trades += 1;
    entry.pnlUsd += row.realizedPnlUsd;
    out.set(k, entry);
  }
  return out;
}

export interface AnalyticsInput {
  agentId: string;
  window: LeaderboardWindow;
  /** Every filled fill in the agent's history, not only the window. */
  fills: readonly AnalyticsFill[];
  /** Equity snapshots inside the window (plus one before it, ideally). */
  equity: ReadonlyArray<{ at: Date | string | number; equityUsd: number }>;
  /** Mark-to-market on open positions right now. */
  unrealizedPnlUsd: number;
  /** x402 spend inside the window. */
  dataSpendUsd: number;
  now?: number;
}

/**
 * Everything the Performance tab renders, from rows only. The query that feeds
 * this does no arithmetic; this function does no IO.
 */
export function computeAnalytics(input: AnalyticsInput): Omit<AgentAnalytics, "bestTrade" | "worstTrade"> & {
  /** The sell ids behind the best and worst closed trade, for the query to hydrate. */
  bestTradeId: string | null;
  worstTradeId: string | null;
  closed: ClosedTrade[];
} {
  const now = input.now ?? Date.now();
  const days = WINDOW_DAYS[input.window];
  const cutoff = days === null ? null : now - days * 86_400_000;

  const inWindow = (closedAt: string) => cutoff === null || ms(closedAt) >= cutoff;
  // FIFO slices: calibration and hold time only (see the module comment).
  const closed = closedTrades(input.fills).filter((c) => inWindow(c.closedAt));
  // Average-cost exits: every PnL total and the win rate.
  const sells = closedSells(input.fills).filter((c) => inWindow(c.closedAt));

  const realizedPnlUsd = sells.reduce((sum, c) => sum + c.realizedPnlUsd, 0);
  const wr = winRateOf(sells);

  // Best / worst are whole exits, not lot slices — an operator thinks in trades.
  const bySell = new Map<string, number>();
  for (const c of sells) bySell.set(c.sellId, c.realizedPnlUsd);
  let bestTradeId: string | null = null;
  let worstTradeId: string | null = null;
  let best = -Infinity;
  let worst = Infinity;
  for (const [id, pnl] of bySell) {
    if (pnl > best) {
      best = pnl;
      bestTradeId = id;
    }
    if (pnl < worst) {
      worst = pnl;
      worstTradeId = id;
    }
  }
  // With a single closed trade, best and worst are the same row; show it once.
  if (bestTradeId !== null && bestTradeId === worstTradeId) worstTradeId = null;

  const byChain = [...sumBy(sells, (c) => c.chain)]
    .map(([chain, v]) => ({ chain, ...v }))
    .sort((a, b) => b.trades - a.trades);

  const byOrigin = [...sumBy(sells, (c) => c.origin)]
    .map(([origin, v]) => ({ origin, ...v }))
    .sort((a, b) => b.trades - a.trades);

  const exits = [...sumBy(sells.filter((c) => c.exitReason !== null), (c) => c.exitReason as ExitReason)]
    .map(([reason, v]) => ({ reason, count: v.trades, pnlUsd: v.pnlUsd }))
    .sort((a, b) => b.count - a.count);

  return {
    agentId: input.agentId,
    window: input.window,
    realizedPnlUsd,
    unrealizedPnlUsd: safe(input.unrealizedPnlUsd),
    winRate: wr.rate,
    avgHoldHours: avgHoldHours(closed),
    maxDrawdownPct: maxDrawdownPct(input.equity),
    byChain,
    byOrigin,
    exits,
    calibration: calibration(closed),
    dataSpendUsd: safe(input.dataSpendUsd),
    bestTradeId,
    worstTradeId,
    bestTradePnlUsd: bestTradeId === null ? null : best,
    worstTradePnlUsd: worstTradeId === null ? null : worst,
    closed,
  };
}
