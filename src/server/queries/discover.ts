import "server-only";
import { cache } from "react";
import { and, asc, desc, eq, gte, inArray, lt, or, sql } from "drizzle-orm";
import { agents, equitySnapshots, getDb, trades, x402Payments, type Db } from "@/db";
import { DATA_SOURCES } from "@/lib/data-sources/registry";
import { toNum } from "@/lib/money";
import { pnlOverWindow, windowSparkline, WINDOW_DAYS } from "@/lib/pnl";
import type { AgentCard, DataSourceInfo, LeaderboardRow, LeaderboardWindow, TokenScore } from "@/server/types";
import { DEFAULT_AGENT_CONFIG } from "@/lib/agent/config";
import { discoverCandidates, getTokenScore } from "@/lib/tokens";
import {
  buildAgentCards,
  followedAgentIds,
  loadAgentAggregates,
  loadMoneyFlows,
  snapshotInCurrentMode,
} from "./_shared";

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

const DAY_MS = 86_400_000;
const LEADERBOARD_WINDOWS: readonly LeaderboardWindow[] = ["7d", "30d", "all"];

/** A snapshot reduced to what a window's PnL is measured between. */
interface Mark {
  id: string;
  at: Date;
  equityUsd: number;
}

/**
 * The two marks a window's PnL can start from, per agent, without reading the series:
 * the last snapshot in the baseline days before the window opens (`before`), and the
 * first one inside it (`first`). Where a window ends is the agent's latest mark, which
 * the card aggregates already hold. `pnlOverWindow` reads these three rows and no
 * others, so handing it just them gives the number the whole series would.
 */
async function loadWindowStarts(
  db: Db,
  ids: string[],
  since: Date,
  cutoff: Date,
): Promise<{ before: Map<string, Mark>; first: Map<string, Mark> }> {
  const pick = (side: "before" | "first") =>
    db
      .selectDistinctOn([equitySnapshots.agentId], {
        agentId: equitySnapshots.agentId,
        id: equitySnapshots.id,
        at: equitySnapshots.at,
        equityUsd: equitySnapshots.equityUsd,
      })
      .from(equitySnapshots)
      .innerJoin(agents, eq(agents.id, equitySnapshots.agentId))
      // Current mode only. Without this an agent that went live yesterday shows up on the
      // public leaderboard at roughly −99.9%, which is a change of units, not a loss.
      .where(
        and(
          inArray(equitySnapshots.agentId, ids),
          snapshotInCurrentMode(),
          side === "before"
            ? and(gte(equitySnapshots.at, since), lt(equitySnapshots.at, cutoff))
            : gte(equitySnapshots.at, cutoff),
        ),
      )
      .orderBy(
        equitySnapshots.agentId,
        side === "before" ? desc(equitySnapshots.at) : asc(equitySnapshots.at),
        side === "before" ? desc(equitySnapshots.id) : asc(equitySnapshots.id),
      );
  const [beforeRows, firstRows] = await Promise.all([pick("before"), pick("first")]);
  const toMap = (rows: typeof beforeRows) =>
    new Map(rows.map((r) => [r.agentId, { id: r.id, at: r.at, equityUsd: toNum(r.equityUsd) }]));
  return { before: toMap(beforeRows), first: toMap(firstRows) };
}

/**
 * Leaderboard per SPEC: PnL% = (latest − snapshot at window start) / snapshot at
 * window start, over public + active agents, ties broken by trade count. All three
 * windows from one load.
 *
 * A live book's PnL is net of the deposits and withdrawals on record between its two
 * marks, and its percent is taken on the starting mark plus what was deposited: money
 * moved is not a track record. What Tocker has no record of cannot be netted (USDC sent
 * to an agent's address from outside), and still reads as a gain.
 *
 * What it reads is bounded by the rows it shows, not by how many agents are public. The
 * ranking needs three marks per agent and window (see {@link loadWindowStarts}); only
 * the rows that made the cut have their series read, for the line drawn beside them.
 * The cards are built once for the three windows.
 */
export async function getLeaderboards(limit = 25): Promise<Record<LeaderboardWindow, LeaderboardRow[]>> {
  const empty: Record<LeaderboardWindow, LeaderboardRow[]> = { "7d": [], "30d": [], all: [] };
  const db = await getDb();
  const agentRows = await db
    .select()
    .from(agents)
    .where(and(eq(agents.isPublic, true), eq(agents.status, "active")));
  if (agentRows.length === 0) return empty;

  const ids = agentRows.map((a) => a.id);
  const now = Date.now();
  const cutoffOf = (days: number) => new Date(now - days * DAY_MS);
  // Two extra days of history so the "snapshot at window start" baseline exists.
  const sinceOf = (days: number) => new Date(now - (days + 2) * DAY_MS);

  const flowsLoading = loadMoneyFlows(db, ids);
  const [aggregates, flows, starts7, starts30, windowTrades] = await Promise.all([
    loadAgentAggregates(db, ids, flowsLoading),
    flowsLoading,
    loadWindowStarts(db, ids, sinceOf(7), cutoffOf(7)),
    loadWindowStarts(db, ids, sinceOf(30), cutoffOf(30)),
    // Trades inside the window itself — not `since`, which carries the extra baseline
    // days. The card's count is lifetime, and printing it under "7 days" made every
    // window show the same number.
    db
      .select({
        agentId: trades.agentId,
        d7: sql<number>`(count(*) filter (where coalesce(${trades.filledAt}, ${trades.createdAt}) >= ${cutoffOf(7).toISOString()}))::int`,
        d30: sql<number>`count(*)::int`,
      })
      .from(trades)
      .where(
        and(
          inArray(trades.agentId, ids),
          eq(trades.status, "filled"),
          sql`coalesce(${trades.filledAt}, ${trades.createdAt}) >= ${cutoffOf(30).toISOString()}`,
        ),
      )
      .groupBy(trades.agentId),
  ]);
  const cards = await buildAgentCards(db, agentRows, aggregates);
  const cardById = new Map(cards.map((c) => [c.id, c]));
  const windowCount = {
    "7d": new Map(windowTrades.map((r) => [r.agentId, Number(r.d7 ?? 0)])),
    "30d": new Map(windowTrades.map((r) => [r.agentId, Number(r.d30 ?? 0)])),
  };
  const starts = { "7d": starts7, "30d": starts30 };

  type Scored = { card: AgentCard; pnlPct: number; pnlUsd: number; tradeCount: number };
  const rank = (window: LeaderboardWindow): Scored[] => {
    const scored = agentRows.flatMap((a): Scored[] => {
      const card = cardById.get(a.id);
      const agg = aggregates.get(a.id);
      if (!card || !agg) return [];
      if (window === "all") {
        // All time is the number the agent's card prints further down the same page (a
        // paper book measured from its notional, not its first mark), so take it from
        // there. A book with a single mark has no window to rank.
        if (!agg.hasWindow || card.pnlPct === null || card.pnlUsd === null) return [];
        return [{ card, pnlPct: card.pnlPct, pnlUsd: card.pnlUsd, tradeCount: card.tradeCount }];
      }
      const days = WINDOW_DAYS[window] ?? 0;
      const cutoff = cutoffOf(days).getTime();
      // Nothing marked inside the window is nothing to rank.
      if (!agg.markId || !agg.markedAt || agg.equityUsd === null || agg.markedAt.getTime() < cutoff) return [];
      const before = starts[window].before.get(a.id);
      const first = starts[window].first.get(a.id);
      const points: Mark[] = [];
      if (before) points.push(before);
      if (first) points.push(first);
      if (!first || first.id !== agg.markId) points.push({ id: agg.markId, at: agg.markedAt, equityUsd: agg.equityUsd });
      const pnl = pnlOverWindow(points, window, new Date(now), flows.get(a.id) ?? []);
      if (!pnl) return [];
      return [{ card, pnlPct: pnl.pnlPct, pnlUsd: pnl.pnlUsd, tradeCount: windowCount[window].get(a.id) ?? 0 }];
    });
    scored.sort((a, b) => b.pnlPct - a.pnlPct || b.tradeCount - a.tradeCount);
    return scored.slice(0, limit);
  };
  const ranked = { "7d": rank("7d"), "30d": rank("30d"), all: rank("all") };

  // The line beside each row: the same series the whole table used to read, for the
  // rows on it only. All time needs a row's full history; the two windows need their
  // days plus the baseline's.
  const allIds = ranked.all.map((r) => r.card.id);
  const windowIds = [...new Set([...ranked["7d"], ...ranked["30d"]].map((r) => r.card.id))].filter(
    (id) => !allIds.includes(id),
  );
  const shown = [...allIds, ...windowIds];
  const snapshots = shown.length
    ? await db
        .select({ agentId: equitySnapshots.agentId, at: equitySnapshots.at, equityUsd: equitySnapshots.equityUsd })
        .from(equitySnapshots)
        .innerJoin(agents, eq(agents.id, equitySnapshots.agentId))
        .where(
          and(
            snapshotInCurrentMode(),
            or(
              allIds.length ? inArray(equitySnapshots.agentId, allIds) : undefined,
              windowIds.length
                ? and(inArray(equitySnapshots.agentId, windowIds), gte(equitySnapshots.at, sinceOf(30)))
                : undefined,
            ),
          ),
        )
        .orderBy(asc(equitySnapshots.at))
    : [];
  const series = new Map<string, Array<{ at: Date; equityUsd: number }>>();
  for (const s of snapshots) {
    const list = series.get(s.agentId) ?? [];
    list.push({ at: s.at, equityUsd: toNum(s.equityUsd) });
    series.set(s.agentId, list);
  }

  const out = { ...empty };
  for (const window of LEADERBOARD_WINDOWS) {
    const days = WINDOW_DAYS[window];
    const since = days === null ? null : sinceOf(days).getTime();
    out[window] = ranked[window].map((row, i) => {
      const all = series.get(row.card.id) ?? [];
      const points = since === null ? all : all.filter((p) => p.at.getTime() >= since);
      return {
        rank: i + 1,
        agent: row.card,
        pnlPct: row.pnlPct,
        pnlUsd: row.pnlUsd,
        tradeCount: row.tradeCount,
        // The card's sparkline is its last month; this one is the window the row is ranked
        // on, so the line and the PnL beside it (and the colour it takes) agree.
        sparkline: windowSparkline(points, window, new Date(now)),
      };
    });
  }
  return out;
}

/**
 * One load per request, however many windows a page asks for: Discover renders all
 * three at once. Outside a server render this is a plain call.
 */
const leaderboardsForRequest = cache((limit: number) => getLeaderboards(limit));

/** One window of {@link getLeaderboards}. */
export async function getLeaderboard(window: LeaderboardWindow, limit = 25): Promise<LeaderboardRow[]> {
  return (await leaderboardsForRequest(limit))[window];
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
/** How long an empty sweep is served: an outage costs one slow sweep a minute, not one a request. */
const FRESH_EMPTY_TTL_MS = 60_000;
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
  if (freshCache.at > 0 && freshCache.limit >= limit && now - freshCache.at < FRESH_TTL_MS) {
    return freshCache.rows.slice(0, limit);
  }
  if (!freshInFlight) {
    freshInFlight = sweepFreshLaunches(Math.max(limit, 12))
      .then((rows) => {
        const at = Date.now();
        if (rows.length > 0) {
          Object.assign(freshCache, { at, limit: Math.max(limit, 12), rows });
        } else if (!(freshCache.rows.length > 0 && at - freshCache.at < FRESH_TTL_MS)) {
          // Negative cache: every provider down (or nothing new) is remembered for a
          // minute, dated so it expires then. A still-fresh good sweep is never replaced.
          Object.assign(freshCache, { at: at - FRESH_TTL_MS + FRESH_EMPTY_TTL_MS, limit: Math.max(limit, 12), rows: [] });
        }
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
