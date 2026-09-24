import "server-only";
import { and, asc, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { agents, equitySnapshots, getDb, x402Payments } from "@/db";
import { DATA_SOURCES } from "@/lib/data-sources/registry";
import { toNum } from "@/lib/money";
import { pnlOverWindow, WINDOW_DAYS } from "@/lib/pnl";
import type { DataSourceInfo, LeaderboardRow, LeaderboardWindow, TokenScore } from "@/server/types";
import { DEFAULT_AGENT_CONFIG } from "@/lib/agent/config";
import { discoverCandidates, getTokenScore } from "@/lib/tokens";
import { buildAgentCards, followedAgentIds, snapshotInCurrentMode } from "./_shared";

/**
 * Agent ids the viewer follows directly, so the leaderboard can say "Following" where
 * it is true. One read for the whole page rather than a join in each of the three
 * `getLeaderboard` windows. Empty for an anonymous viewer.
 */
export async function viewerFollowedAgentIds(viewerId: string | null): Promise<string[]> {
  if (!viewerId) return [];
  const db = await getDb();
  const { agentIds } = await followedAgentIds(db, viewerId);
  return agentIds;
}

/**
 * Leaderboard per SPEC: PnL% = (latest − snapshot at window start) / snapshot at
 * window start, over public + active agents, ties broken by trade count.
 */
export async function getLeaderboard(window: LeaderboardWindow, limit = 25): Promise<LeaderboardRow[]> {
  const db = await getDb();
  const agentRows = await db
    .select()
    .from(agents)
    .where(and(eq(agents.isPublic, true), eq(agents.status, "active")));
  if (agentRows.length === 0) return [];

  const ids = agentRows.map((a) => a.id);
  const days = WINDOW_DAYS[window];
  // one extra day of history so the "snapshot at window start" baseline exists
  const since = days === null ? null : new Date(Date.now() - (days + 2) * 86_400_000);
  const snapshots = await db
    .select({ agentId: equitySnapshots.agentId, at: equitySnapshots.at, equityUsd: equitySnapshots.equityUsd })
    .from(equitySnapshots)
    .innerJoin(agents, eq(agents.id, equitySnapshots.agentId))
    // Current mode only. Without this an agent that went live yesterday shows up on the
    // public leaderboard at roughly −99.9%, which is a change of units, not a loss.
    .where(and(inArray(equitySnapshots.agentId, ids), snapshotInCurrentMode(), since ? gte(equitySnapshots.at, since) : undefined))
    .orderBy(asc(equitySnapshots.at));

  const series = new Map<string, Array<{ at: Date; equityUsd: number }>>();
  for (const s of snapshots) {
    const list = series.get(s.agentId) ?? [];
    list.push({ at: s.at, equityUsd: toNum(s.equityUsd) });
    series.set(s.agentId, list);
  }

  const cards = await buildAgentCards(db, agentRows);
  const cardById = new Map(cards.map((c) => [c.id, c]));

  const scored = agentRows.flatMap((a) => {
    const pnl = pnlOverWindow(series.get(a.id) ?? [], window);
    const card = cardById.get(a.id);
    if (!pnl || !card) return [];
    return [{ card, pnlPct: pnl.pnlPct, pnlUsd: pnl.pnlUsd, tradeCount: card.tradeCount }];
  });

  scored.sort((a, b) => b.pnlPct - a.pnlPct || b.tradeCount - a.tradeCount);

  return scored.slice(0, limit).map((row, i) => ({
    rank: i + 1,
    agent: row.card,
    pnlPct: row.pnlPct,
    pnlUsd: row.pnlUsd,
    tradeCount: row.tradeCount,
  }));
}

/**
 * How many distinct public agents an x402 aggregate needs before it may be published.
 *
 * Which sources an operator pays for is part of their strategy — `toPublicProfile`
 * deliberately publishes a *count* of data sources and not the list. A public
 * "3 agents paid SentimentAlpha $0.31" says nothing about any one of them; the same row
 * built from a single agent is that agent's source list, spend and cadence, attributable
 * to whoever is visibly holding the only public position. Three is the smallest k that
 * keeps a row from being read back to one operator even when two of the three are known.
 */
export const MIN_AGGREGATE_AGENTS = 3;

/** x402 spend leaderboard for data sources. Public agents only, k-anonymous. */
export async function getTopDataSources(
  limit = 8,
): Promise<Array<DataSourceInfo & { agentCount: number; spendUsd: number }>> {
  const db = await getDb();
  const rows = await db
    .select({
      sourceId: x402Payments.sourceId,
      agentCount: sql<number>`count(distinct ${x402Payments.agentId})::int`,
      spendUsd: sql<string>`sum(${x402Payments.amountUsd})`,
      url: sql<string>`min(${x402Payments.url})`,
      network: sql<string>`min(${x402Payments.network})`,
    })
    .from(x402Payments)
    // A private agent contributes nothing at all — not its spend, not its head count.
    // Joining rather than filtering in JS keeps the rule in the one place a careless
    // caller cannot skip.
    .innerJoin(agents, and(eq(agents.id, x402Payments.agentId), eq(agents.isPublic, true)))
    .groupBy(x402Payments.sourceId)
    .having(sql`count(distinct ${x402Payments.agentId}) >= ${MIN_AGGREGATE_AGENTS}`)
    .orderBy(desc(sql`sum(${x402Payments.amountUsd})`))
    .limit(limit);

  const registry = new Map(DATA_SOURCES.map((s) => [s.id, s]));
  const used = rows.map((r) => {
    const known = registry.get(r.sourceId);
    const info: DataSourceInfo = known ?? {
      id: r.sourceId,
      name: r.sourceId,
      chains: [],
      description: "Used by agents on Tocker",
      category: "other",
      network: r.network ?? "",
      priceUsd: null,
      url: r.url ?? "",
      experimental: true,
    };
    return { ...info, agentCount: Number(r.agentCount ?? 0), spendUsd: toNum(r.spendUsd) };
  });

  if (used.length >= limit) return used;
  // pad with registry entries nobody has paid for yet
  const seen = new Set(used.map((u) => u.id));
  const rest = DATA_SOURCES.filter((s) => !seen.has(s.id)).map((s) => ({ ...s, agentCount: 0, spendUsd: 0 }));
  return [...used, ...rest].slice(0, limit);
}

// ---------------------------------------------------------------------------
// Fresh launches — the public scoreboard on /discover
// ---------------------------------------------------------------------------

const FRESH_TTL_MS = 5 * 60_000;
const FRESH_SWEEP_SIZE = 24;
const freshCache: { at: number; limit: number; rows: TokenScore[] } = { at: 0, limit: 0, rows: [] };
let freshInFlight: Promise<TokenScore[]> | null = null;

/**
 * What the discovery feeds turned up recently, fully scored.
 *
 * Scored under the platform's **default** universe, never an agent's. An agent's
 * gates are part of its private strategy, and a public verdict such as
 * "liquidity below floor" computed under someone's thresholds would leak them.
 *
 * Only free, keyless providers are used, so this never spends money. The result is
 * cached in-process for five minutes and concurrent requests share one sweep.
 */
export async function getFreshLaunches(limit = 12): Promise<TokenScore[]> {
  const now = Date.now();
  if (freshCache.rows.length > 0 && freshCache.limit >= limit && now - freshCache.at < FRESH_TTL_MS) {
    return freshCache.rows.slice(0, limit);
  }
  if (!freshInFlight) {
    freshInFlight = sweepFreshLaunches(Math.max(limit, 12))
      .then((rows) => {
        if (rows.length > 0) Object.assign(freshCache, { at: Date.now(), limit: Math.max(limit, 12), rows });
        return rows;
      })
      .finally(() => {
        freshInFlight = null;
      });
  }
  const rows = await freshInFlight;
  return rows.slice(0, limit);
}

async function sweepFreshLaunches(limit: number): Promise<TokenScore[]> {
  const universe = DEFAULT_AGENT_CONFIG.universe;
  const candidates = await discoverCandidates({
    chains: ["solana", "base"],
    feeds: ["new_launches", "trending", "top_organic"],
    universe,
    limit: FRESH_SWEEP_SIZE,
  });

  // Score the most promising slice fully; the rest of the sweep is only pre-ranked.
  const shortlist = [...candidates]
    .sort((a, b) => (b.quickScore ?? -1) - (a.quickScore ?? -1))
    .slice(0, limit);

  const scored = await Promise.allSettled(
    shortlist.map((c) =>
      getTokenScore({
        chain: c.token.chain,
        address: c.token.address,
        universe,
        maxTradeUsd: DEFAULT_AGENT_CONFIG.risk.maxTradeUsd,
        symbolHint: c.token.symbol,
      }),
    ),
  );

  return scored
    .flatMap((r) => (r.status === "fulfilled" ? [r.value] : []))
    .sort((a, b) => b.total - a.total);
}
