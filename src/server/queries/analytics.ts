import "server-only";
import { and, asc, eq, gte, sql } from "drizzle-orm";
import { agents, equitySnapshots, getDb, platformFees, positions, tokens, trades, x402Payments, type Db } from "@/db";
import { computeAnalytics, type AnalyticsFill } from "@/lib/analytics";
import { toNum } from "@/lib/money";
import { unrealized } from "@/lib/pnl";
import type { AgentAnalytics, Chain, ExitReason, LeaderboardWindow, TradeRow } from "@/server/types";
import { fillFeeUsd, loadTokens, snapshotInCurrentMode, toTradeRow } from "./_shared";
import { isAgentOwner } from "./visibility";

type TradeRecord = typeof trades.$inferSelect;
/** A filled trade with the Tocker fee charged on it (null when none was). */
interface FilledTrade {
  trade: TradeRecord;
  tockerFeeUsd: string | null;
}

interface AnalyticsRows {
  trades: FilledTrade[];
  /** Max drawdown per window, worked out in the database: see {@link loadMaxDrawdownPct}. */
  maxDrawdownPct: Record<LeaderboardWindow, number | null>;
  unrealizedPnlUsd: number;
  payments: Array<{ amountUsd: number; at: Date }>;
}

const WINDOW_MS: Record<LeaderboardWindow, number | null> = {
  "7d": 7 * 86_400_000,
  "30d": 30 * 86_400_000,
  all: null,
};

/**
 * Deepest peak-to-trough fall of the agent's equity since `since` (all of it when
 * null), as a positive percent. Null with fewer than two marks or no peak above zero.
 *
 * This is `maxDrawdownPct` from `src/lib/analytics.ts`, run where the rows are. The
 * Performance tab used to fetch every snapshot the agent had ever written (one every
 * five minutes) on every page view to produce this one number per window; the database
 * can walk them and send back the answer. Same arithmetic in the same order, in the
 * same IEEE doubles, so it is the same number: a running peak over the marks oldest
 * first, and the largest `(peak − equity) / peak × 100` seen while the peak is above
 * zero. `analytics.test.ts` here holds it to the pure function on seeded marks.
 *
 * Current mode only — `snapshotInCurrentMode` explains why. A paper→live flip is a
 * −99.9% step that would otherwise be reported as the agent's max drawdown forever.
 */
async function loadMaxDrawdownPct(db: Db, agentId: string, since: Date | null): Promise<number | null> {
  const marks = db
    .select({
      equity: sql<number>`${equitySnapshots.equityUsd}::float8`.as("equity"),
      peak: sql<number>`max(${equitySnapshots.equityUsd}::float8) over (order by ${equitySnapshots.at} asc, ${equitySnapshots.id} asc rows between unbounded preceding and current row)`.as(
        "peak",
      ),
    })
    .from(equitySnapshots)
    .innerJoin(agents, eq(agents.id, equitySnapshots.agentId))
    .where(
      and(eq(equitySnapshots.agentId, agentId), snapshotInCurrentMode(), since ? gte(equitySnapshots.at, since) : undefined),
    )
    .as("marks");
  const [row] = await db
    .select({
      points: sql<number>`count(*)::int`,
      worst: sql<number | string | null>`max(case when ${marks.peak} > 0 then ((${marks.peak} - ${marks.equity}) / ${marks.peak}) * 100 end)`,
    })
    .from(marks);
  if (!row || Number(row.points ?? 0) < 2 || row.worst === null || row.worst === undefined) return null;
  const worst = Number(row.worst);
  return Number.isFinite(worst) ? worst : null;
}

/**
 * Every row the Performance tab needs, loaded once.
 *
 * The fills are not filtered by window here: FIFO attribution needs the buys that
 * opened a position a windowed sell is closing. Windowing them happens in
 * `src/lib/analytics.ts`, where it is pure and tested. The equity series is not loaded
 * at all: the one thing read off it is the drawdown, one number per window.
 */
async function loadRows(db: Db, agentId: string, now: number): Promise<AnalyticsRows> {
  // One extra day of equity so the peak that precedes the window still counts.
  const drawdownSince = (window: LeaderboardWindow) => {
    const span = WINDOW_MS[window];
    return span === null ? null : new Date(now - span - 86_400_000);
  };
  const [tradeRows, sevenDay, thirtyDay, allTime, positionRows, paymentRows] = await Promise.all([
    db
      .select({ trade: trades, tockerFeeUsd: platformFees.amountUsd })
      .from(trades)
      // One fee row per trade (`platform_fees.trade_id` is unique), so no fill repeats.
      .leftJoin(platformFees, eq(platformFees.tradeId, trades.id))
      .where(and(eq(trades.agentId, agentId), eq(trades.status, "filled")))
      .orderBy(asc(trades.createdAt)),
    loadMaxDrawdownPct(db, agentId, drawdownSince("7d")),
    loadMaxDrawdownPct(db, agentId, drawdownSince("30d")),
    loadMaxDrawdownPct(db, agentId, drawdownSince("all")),
    db
      .select({ position: positions, token: tokens })
      .from(positions)
      .innerJoin(tokens, eq(tokens.id, positions.tokenId))
      .where(eq(positions.agentId, agentId)),
    db
      .select({ amountUsd: x402Payments.amountUsd, at: x402Payments.createdAt })
      .from(x402Payments)
      .where(eq(x402Payments.agentId, agentId)),
  ]);

  const unrealizedPnlUsd = positionRows.reduce((sum, row) => {
    const amount = toNum(row.position.amountToken);
    if (amount <= 1e-12) return sum;
    const mark = row.token.lastPriceUsd === null ? null : toNum(row.token.lastPriceUsd);
    return sum + (unrealized(amount, toNum(row.position.avgCostUsd), mark).pnlUsd ?? 0);
  }, 0);

  return {
    trades: tradeRows,
    maxDrawdownPct: { "7d": sevenDay, "30d": thirtyDay, all: allTime },
    unrealizedPnlUsd,
    payments: paymentRows.map((r) => ({ amountUsd: toNum(r.amountUsd), at: r.at })),
  };
}

/**
 * Fills as the replay wants them. `feeUsd` is everything the fill cost: the venue's fee
 * and the Tocker fee, as the position ledger booked it. So realised PnL, win rate,
 * best and worst here are after fees, the figure the Sold dialog and the stat cards
 * give for the same sale.
 */
function toFills(rows: readonly FilledTrade[]): AnalyticsFill[] {
  return rows.map(({ trade: row, tockerFeeUsd }) => ({
    id: row.id,
    tokenId: row.tokenId,
    chain: row.chain as Chain,
    side: row.side,
    amountToken: toNum(row.amountToken),
    amountUsd: toNum(row.amountUsd),
    priceUsd: toNum(row.priceUsd),
    feeUsd: fillFeeUsd(row.feeUsd, tockerFeeUsd),
    status: row.status,
    origin: row.origin,
    exitReason: (row.exitReason as ExitReason | null) ?? null,
    entryScore: typeof row.scoreSnapshot?.total === "number" ? row.scoreSnapshot.total : null,
    createdAt: row.createdAt,
  }));
}

async function build(
  db: Db,
  agentId: string,
  window: LeaderboardWindow,
  rows: AnalyticsRows,
  fills: AnalyticsFill[],
  now: number,
  isOwner: boolean,
): Promise<AgentAnalytics> {
  const span = WINDOW_MS[window];
  const cutoff = span === null ? null : now - span;

  const computed = computeAnalytics({
    agentId,
    window,
    fills,
    // Not handed the series: the drawdown for this window was read with the rows.
    equity: [],
    unrealizedPnlUsd: rows.unrealizedPnlUsd,
    dataSpendUsd: rows.payments
      .filter((p) => cutoff === null || p.at.getTime() >= cutoff)
      .reduce((sum, p) => sum + p.amountUsd, 0),
    now,
  });

  const { bestTradeId, worstTradeId, closed: _closed, ...computedAnalytics } = computed;
  void _closed;
  const analytics = { ...computedAnalytics, maxDrawdownPct: rows.maxDrawdownPct[window] };

  const wanted = [bestTradeId, worstTradeId].filter((id): id is string => id !== null);
  if (wanted.length === 0) return { ...analytics, bestTrade: null, worstTrade: null };

  const picked = rows.trades.map((row) => row.trade).filter((row) => wanted.includes(row.id));
  const tokenMap = await loadTokens(db, picked.map((r) => r.tokenId));
  const byId = new Map(
    picked.flatMap((row) => {
      const token = tokenMap.get(row.tokenId);
      return token ? ([[row.id, toTradeRow(row, token, { isOwner })]] as Array<[string, TradeRow]>) : [];
    }),
  );

  return {
    ...analytics,
    bestTrade: bestTradeId ? (byId.get(bestTradeId) ?? null) : null,
    worstTrade: worstTradeId ? (byId.get(worstTradeId) ?? null) : null,
  };
}

/**
 * Performance analytics for one agent over one window.
 *
 * Public for everyone, like the rest of an agent's record: realized and
 * unrealized PnL, hold times, exits, and how the score at entry actually
 * predicted the outcome. None of it reveals the strategy that produced it — the
 * numbers are outcomes, not rules.
 */
export async function getAgentAnalytics(
  agentId: string,
  window: LeaderboardWindow = "30d",
  viewerId?: string | null,
): Promise<AgentAnalytics | null> {
  const db = await getDb();
  const viewer = await viewerOf(db, agentId, viewerId);
  if (!viewer) return null;
  const now = Date.now();
  const rows = await loadRows(db, agentId, now);
  return build(db, agentId, window, rows, toFills(rows.trades), now, viewer.isOwner);
}

/**
 * Who is asking. A private agent's record is owner-only — every caller today runs
 * behind the page's own `agentBySlug` gate, and this is the second lock. The owner flag
 * also decides how much of the best/worst trade's score snapshot is shown.
 */
async function viewerOf(db: Db, agentId: string, viewerId?: string | null): Promise<{ isOwner: boolean } | null> {
  const [agent] = await db
    .select({ ownerId: agents.ownerId, isPublic: agents.isPublic })
    .from(agents)
    .where(eq(agents.id, agentId))
    .limit(1);
  if (!agent) return null;
  const isOwner = isAgentOwner(agent.ownerId, viewerId);
  if (!agent.isPublic && !isOwner) return null;
  return { isOwner };
}

/**
 * All three windows from one load. The tab switch is a hot path and must not
 * wait on a request, so the page fetches every window up front.
 */
export async function getAgentAnalyticsWindows(
  agentId: string,
  viewerId?: string | null,
): Promise<Record<LeaderboardWindow, AgentAnalytics> | null> {
  const db = await getDb();
  const viewer = await viewerOf(db, agentId, viewerId);
  if (!viewer) return null;

  const now = Date.now();
  const rows = await loadRows(db, agentId, now);
  const fills = toFills(rows.trades);
  const [sevenDay, thirtyDay, allTime] = await Promise.all([
    build(db, agentId, "7d", rows, fills, now, viewer.isOwner),
    build(db, agentId, "30d", rows, fills, now, viewer.isOwner),
    build(db, agentId, "all", rows, fills, now, viewer.isOwner),
  ]);
  return { "7d": sevenDay, "30d": thirtyDay, all: allTime };
}
