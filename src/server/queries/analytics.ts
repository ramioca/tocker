import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { agents, equitySnapshots, getDb, positions, tokens, trades, x402Payments, type Db } from "@/db";
import { computeAnalytics, type AnalyticsFill } from "@/lib/analytics";
import { toNum } from "@/lib/money";
import { unrealized } from "@/lib/pnl";
import type { AgentAnalytics, Chain, ExitReason, LeaderboardWindow, TradeRow } from "@/server/types";
import { loadTokens, snapshotInCurrentMode, toTradeRow } from "./_shared";

type TradeRecord = typeof trades.$inferSelect;

interface AnalyticsRows {
  trades: TradeRecord[];
  equity: Array<{ at: Date; equityUsd: number }>;
  unrealizedPnlUsd: number;
  payments: Array<{ amountUsd: number; at: Date }>;
}

/**
 * Every row the Performance tab needs, loaded once.
 *
 * Nothing is filtered by window here: FIFO attribution needs the buys that
 * opened a position a windowed sell is closing, and the drawdown needs the peak
 * that preceded the window. Windowing happens in `src/lib/analytics.ts`, where it
 * is pure and tested.
 */
async function loadRows(db: Db, agentId: string): Promise<AnalyticsRows> {
  const [tradeRows, equityRows, positionRows, paymentRows] = await Promise.all([
    db
      .select()
      .from(trades)
      .where(and(eq(trades.agentId, agentId), eq(trades.status, "filled")))
      .orderBy(asc(trades.createdAt)),
    db
      .select({ at: equitySnapshots.at, equityUsd: equitySnapshots.equityUsd })
      .from(equitySnapshots)
      .innerJoin(agents, eq(agents.id, equitySnapshots.agentId))
      // Current mode only — `snapshotInCurrentMode` explains why. The Performance tab
      // reads drawdown off this series, and a paper→live flip is a −99.9% step that
      // would otherwise be reported as the agent's max drawdown forever.
      .where(and(eq(equitySnapshots.agentId, agentId), snapshotInCurrentMode()))
      .orderBy(asc(equitySnapshots.at)),
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
    equity: equityRows.map((r) => ({ at: r.at, equityUsd: toNum(r.equityUsd) })),
    unrealizedPnlUsd,
    payments: paymentRows.map((r) => ({ amountUsd: toNum(r.amountUsd), at: r.at })),
  };
}

function toFills(rows: readonly TradeRecord[]): AnalyticsFill[] {
  return rows.map((row) => ({
    id: row.id,
    tokenId: row.tokenId,
    chain: row.chain as Chain,
    side: row.side,
    amountToken: toNum(row.amountToken),
    amountUsd: toNum(row.amountUsd),
    priceUsd: toNum(row.priceUsd),
    feeUsd: toNum(row.feeUsd),
    status: row.status,
    origin: row.origin,
    exitReason: (row.exitReason as ExitReason | null) ?? null,
    entryScore: typeof row.scoreSnapshot?.total === "number" ? row.scoreSnapshot.total : null,
    createdAt: row.createdAt,
  }));
}

const WINDOW_MS: Record<LeaderboardWindow, number | null> = {
  "7d": 7 * 86_400_000,
  "30d": 30 * 86_400_000,
  all: null,
};

async function build(
  db: Db,
  agentId: string,
  window: LeaderboardWindow,
  rows: AnalyticsRows,
  fills: AnalyticsFill[],
  now: number,
): Promise<AgentAnalytics> {
  const span = WINDOW_MS[window];
  const cutoff = span === null ? null : now - span;

  const computed = computeAnalytics({
    agentId,
    window,
    fills,
    // One extra day of equity so the peak that precedes the window still counts.
    equity: cutoff === null ? rows.equity : rows.equity.filter((p) => p.at.getTime() >= cutoff - 86_400_000),
    unrealizedPnlUsd: rows.unrealizedPnlUsd,
    dataSpendUsd: rows.payments
      .filter((p) => cutoff === null || p.at.getTime() >= cutoff)
      .reduce((sum, p) => sum + p.amountUsd, 0),
    now,
  });

  const { bestTradeId, worstTradeId, closed: _closed, ...analytics } = computed;
  void _closed;

  const wanted = [bestTradeId, worstTradeId].filter((id): id is string => id !== null);
  if (wanted.length === 0) return { ...analytics, bestTrade: null, worstTrade: null };

  const picked = rows.trades.filter((row) => wanted.includes(row.id));
  const tokenMap = await loadTokens(db, picked.map((r) => r.tokenId));
  const byId = new Map(
    picked.flatMap((row) => {
      const token = tokenMap.get(row.tokenId);
      return token ? ([[row.id, toTradeRow(row, token)]] as Array<[string, TradeRow]>) : [];
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
): Promise<AgentAnalytics | null> {
  const db = await getDb();
  const [agent] = await db.select({ id: agents.id }).from(agents).where(eq(agents.id, agentId)).limit(1);
  if (!agent) return null;
  const rows = await loadRows(db, agentId);
  return build(db, agentId, window, rows, toFills(rows.trades), Date.now());
}

/**
 * All three windows from one load. The tab switch is a hot path and must not
 * wait on a request, so the page fetches every window up front.
 */
export async function getAgentAnalyticsWindows(
  agentId: string,
): Promise<Record<LeaderboardWindow, AgentAnalytics> | null> {
  const db = await getDb();
  const [agent] = await db.select({ id: agents.id }).from(agents).where(eq(agents.id, agentId)).limit(1);
  if (!agent) return null;

  const rows = await loadRows(db, agentId);
  const fills = toFills(rows.trades);
  const now = Date.now();
  const [sevenDay, thirtyDay, allTime] = await Promise.all([
    build(db, agentId, "7d", rows, fills, now),
    build(db, agentId, "30d", rows, fills, now),
    build(db, agentId, "all", rows, fills, now),
  ]);
  return { "7d": sevenDay, "30d": thirtyDay, all: allTime };
}
