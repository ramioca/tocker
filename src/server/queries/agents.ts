import "server-only";
import { and, asc, desc, eq, gte, inArray, lt, or, sql } from "drizzle-orm";
import {
  agentRunSteps,
  agentRuns,
  agents,
  equitySnapshots,
  getDb,
  llmKeys,
  positions,
  tokens,
  trades,
  users,
  wallets,
  x402Payments,
} from "@/db";
import { DATA_SOURCES, toDataSourceInfo } from "@/lib/data-sources/registry";
import { toNum } from "@/lib/money";
import { computeEquity, pnlOverWindow, unrealized, winRate, WINDOW_DAYS } from "@/lib/pnl";
import type {
  AgentCard,
  AgentDetail,
  Chain,
  DataSourceInfo,
  EquityPoint,
  LeaderboardWindow,
  Page,
  Position,
  RunDetail,
  RunSummary,
  TradeRow,
} from "@/server/types";
import {
  buildAgentCards,
  decodeCursor,
  encodeCursor,
  iso,
  isFollowing,
  loadAgentAggregates,
  loadTokens,
  pageSize,
  toTokenRef,
  toTradeRow,
  toUserCard,
  type AgentRow,
} from "./_shared";

async function detailFor(agent: AgentRow | undefined, viewerId?: string | null): Promise<AgentDetail | null> {
  if (!agent) return null;
  const db = await getDb();
  const isOwner = Boolean(viewerId && viewerId === agent.ownerId);
  if (!agent.isPublic && !isOwner) return null;

  const since = new Date(Date.now() - 30 * 86_400_000);

  const [aggregates, positionRows, equityRows, walletRows, tradeRows, spendRow, runCountRow, followed, forkedFrom, keyRow] =
    await Promise.all([
      loadAgentAggregates(db, [agent.id]),
      db
        .select({ position: positions, token: tokens })
        .from(positions)
        .innerJoin(tokens, eq(tokens.id, positions.tokenId))
        .where(eq(positions.agentId, agent.id)),
      db
        .select({ at: equitySnapshots.at, equityUsd: equitySnapshots.equityUsd, cashUsd: equitySnapshots.cashUsd })
        .from(equitySnapshots)
        .where(and(eq(equitySnapshots.agentId, agent.id), gte(equitySnapshots.at, since)))
        .orderBy(asc(equitySnapshots.at)),
      db
        .select({ id: wallets.id, chain: wallets.chain, address: wallets.address })
        .from(wallets)
        .where(and(eq(wallets.agentId, agent.id), eq(wallets.kind, "agent_server"))),
      db
        .select({
          tokenId: trades.tokenId,
          side: trades.side,
          amountToken: trades.amountToken,
          priceUsd: trades.priceUsd,
          feeUsd: trades.feeUsd,
          status: trades.status,
          createdAt: trades.createdAt,
        })
        .from(trades)
        .where(and(eq(trades.agentId, agent.id), eq(trades.status, "filled")))
        .orderBy(asc(trades.createdAt)),
      db
        .select({ total: sql<string>`coalesce(sum(${x402Payments.amountUsd}), 0)` })
        .from(x402Payments)
        .where(eq(x402Payments.agentId, agent.id)),
      db.select({ n: sql<number>`count(*)::int` }).from(agentRuns).where(eq(agentRuns.agentId, agent.id)),
      isFollowing(db, viewerId, "agent", agent.id),
      agent.forkedFromId
        ? db
            .select({ agent: agents, owner: users })
            .from(agents)
            .innerJoin(users, eq(users.id, agents.ownerId))
            .where(eq(agents.id, agent.forkedFromId))
            .limit(1)
        : Promise.resolve([]),
      agent.llmKeyId
        ? db
            .select({ label: llmKeys.label, provider: llmKeys.provider, last4: llmKeys.last4 })
            .from(llmKeys)
            .where(eq(llmKeys.id, agent.llmKeyId))
            .limit(1)
        : Promise.resolve([]),
    ]);

  const agg = aggregates.get(agent.id);
  const card: AgentCard = (await buildAgentCards(db, [agent]))[0];

  const livePositions: Position[] = positionRows
    .filter((r) => toNum(r.position.amountToken) !== 0)
    .map((r) => {
      const token = toTokenRef(r.token);
      const amountToken = toNum(r.position.amountToken);
      const avgCostUsd = toNum(r.position.avgCostUsd);
      const u = unrealized(amountToken, avgCostUsd, token.lastPriceUsd);
      return {
        token,
        amountToken,
        avgCostUsd,
        markPriceUsd: token.lastPriceUsd,
        valueUsd: u.valueUsd,
        unrealizedPnlUsd: u.pnlUsd,
        unrealizedPnlPct: u.pnlPct,
        realizedPnlUsd: toNum(r.position.realizedPnlUsd),
      };
    })
    .sort((a, b) => (b.valueUsd ?? 0) - (a.valueUsd ?? 0));

  const equity: EquityPoint[] = equityRows.map((r) => ({
    at: r.at.toISOString(),
    equityUsd: toNum(r.equityUsd),
    cashUsd: toNum(r.cashUsd),
  }));

  const wr = winRate(
    tradeRows.map((t) => ({
      tokenId: t.tokenId,
      side: t.side,
      amountToken: toNum(t.amountToken),
      priceUsd: toNum(t.priceUsd),
      feeUsd: toNum(t.feeUsd),
      status: t.status,
      createdAt: t.createdAt,
    })),
  );

  const marks = Object.fromEntries(livePositions.map((p) => [p.token.id, p.markPriceUsd]));
  const cashUsd = agg?.cashUsd ?? (agent.mode === "paper" ? toNum(agent.paperStartingUsd) : null);
  const equitySnapshot = computeEquity({
    cash: cashUsd ?? 0,
    positions: livePositions.map((p) => ({
      tokenId: p.token.id,
      amountToken: p.amountToken,
      avgCostUsd: p.avgCostUsd,
      realizedPnlUsd: p.realizedPnlUsd,
    })),
    marks,
  });

  const forked = forkedFrom[0];
  const key = keyRow[0];

  return {
    ...card,
    equityUsd: equity.at(-1)?.equityUsd ?? equitySnapshot.equityUsd,
    config: agent.config,
    forkedFrom: forked
      ? { id: forked.agent.id, slug: forked.agent.slug, name: forked.agent.name, owner: toUserCard(forked.owner) }
      : null,
    isOwner,
    isFollowedByViewer: followed,
    paperStartingUsd: toNum(agent.paperStartingUsd),
    cashUsd,
    positions: livePositions,
    equity,
    wallets: walletRows.map((w) => ({ chain: w.chain as Chain, address: w.address, walletId: w.id })),
    nextRunAt: iso(agent.nextRunAt),
    llmKeyLabel: isOwner && key ? (key.label ?? `${key.provider} ····${key.last4}`) : null,
    stats: {
      winRate: wr.rate,
      realizedPnlUsd: wr.realizedPnlUsd,
      unrealizedPnlUsd: equitySnapshot.unrealizedPnlUsd,
      dataSpendUsd: toNum(spendRow[0]?.total ?? "0"),
      runCount: Number(runCountRow[0]?.n ?? 0),
    },
  };
}

export async function getAgentBySlug(slug: string, viewerId?: string | null): Promise<AgentDetail | null> {
  const db = await getDb();
  const [agent] = await db.select().from(agents).where(eq(agents.slug, slug)).limit(1);
  return detailFor(agent, viewerId);
}

export async function getAgentById(id: string, viewerId?: string | null): Promise<AgentDetail | null> {
  const db = await getDb();
  const [agent] = await db.select().from(agents).where(eq(agents.id, id)).limit(1);
  return detailFor(agent, viewerId);
}

export async function listMyAgents(userId: string): Promise<AgentCard[]> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(agents)
    .where(eq(agents.ownerId, userId))
    .orderBy(desc(agents.createdAt));
  return buildAgentCards(db, rows);
}

export async function listPublicAgents(opts?: {
  cursor?: string | null;
  limit?: number;
  sort?: "new" | "pnl" | "followers";
}): Promise<Page<AgentCard>> {
  const db = await getDb();
  const limit = pageSize(opts?.limit);
  const sort = opts?.sort ?? "new";
  const publicFilter = and(eq(agents.isPublic, true), inArray(agents.status, ["active", "paused"]));

  if (sort === "new") {
    const cursor = decodeCursor(opts?.cursor);
    const rows = await db
      .select()
      .from(agents)
      .where(
        cursor
          ? and(
              publicFilter,
              or(lt(agents.createdAt, cursor.at), and(eq(agents.createdAt, cursor.at), lt(agents.id, cursor.id))),
            )
          : publicFilter,
      )
      .orderBy(desc(agents.createdAt), desc(agents.id))
      .limit(limit + 1);
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      items: await buildAgentCards(db, page),
      nextCursor: rows.length > limit && last ? encodeCursor(last.createdAt, last.id) : null,
    };
  }

  // pnl / followers need the aggregates, so sort in memory over a bounded set
  const rows = await db.select().from(agents).where(publicFilter).orderBy(desc(agents.createdAt)).limit(200);
  const cards = await buildAgentCards(db, rows);
  cards.sort((a, b) =>
    sort === "pnl" ? (b.pnlPct ?? -Infinity) - (a.pnlPct ?? -Infinity) : b.followerCount - a.followerCount,
  );
  const offset = Number(opts?.cursor ?? 0) || 0;
  const items = cards.slice(offset, offset + limit);
  const nextOffset = offset + limit;
  return { items, nextCursor: nextOffset < cards.length ? String(nextOffset) : null };
}

export async function getAgentRuns(agentId: string, cursor?: string | null): Promise<Page<RunSummary>> {
  const db = await getDb();
  const limit = DEFAULT_RUN_PAGE;
  const c = decodeCursor(cursor);
  const rows = await db
    .select()
    .from(agentRuns)
    .where(
      c
        ? and(
            eq(agentRuns.agentId, agentId),
            or(lt(agentRuns.createdAt, c.at), and(eq(agentRuns.createdAt, c.at), lt(agentRuns.id, c.id))),
          )
        : eq(agentRuns.agentId, agentId),
    )
    .orderBy(desc(agentRuns.createdAt), desc(agentRuns.id))
    .limit(limit + 1);

  const page = rows.slice(0, limit);
  const summaries = await summarizeRuns(page);
  const last = page.at(-1);
  return {
    items: summaries,
    nextCursor: rows.length > limit && last ? encodeCursor(last.createdAt, last.id) : null,
  };
}

const DEFAULT_RUN_PAGE = 20;

async function summarizeRuns(rows: Array<typeof agentRuns.$inferSelect>): Promise<RunSummary[]> {
  if (rows.length === 0) return [];
  const db = await getDb();
  const ids = rows.map((r) => r.id);
  const [tradeCounts, stepCounts] = await Promise.all([
    db
      .select({ runId: trades.runId, n: sql<number>`count(*)::int` })
      .from(trades)
      .where(inArray(trades.runId, ids))
      .groupBy(trades.runId),
    db
      .select({ runId: agentRunSteps.runId, n: sql<number>`count(*)::int` })
      .from(agentRunSteps)
      .where(inArray(agentRunSteps.runId, ids))
      .groupBy(agentRunSteps.runId),
  ]);
  const tradeByRun = new Map(tradeCounts.map((r) => [r.runId ?? "", Number(r.n ?? 0)]));
  const stepByRun = new Map(stepCounts.map((r) => [r.runId, Number(r.n ?? 0)]));

  return rows.map((r) => ({
    id: r.id,
    agentId: r.agentId,
    trigger: r.trigger,
    status: r.status,
    startedAt: iso(r.startedAt),
    finishedAt: iso(r.finishedAt),
    summary: r.summary,
    error: r.error,
    dataSpendUsd: toNum(r.dataSpendUsd),
    inputTokens: r.inputTokens,
    outputTokens: r.outputTokens,
    tradeCount: tradeByRun.get(r.id) ?? 0,
    stepCount: stepByRun.get(r.id) ?? 0,
    createdAt: r.createdAt.toISOString(),
  }));
}

export async function getRun(runId: string, viewerId?: string | null): Promise<RunDetail | null> {
  const db = await getDb();
  const [row] = await db
    .select({ run: agentRuns, agent: agents })
    .from(agentRuns)
    .innerJoin(agents, eq(agents.id, agentRuns.agentId))
    .where(eq(agentRuns.id, runId))
    .limit(1);
  if (!row) return null;
  if (!row.agent.isPublic && row.agent.ownerId !== viewerId) return null;

  const [summary] = await summarizeRuns([row.run]);
  const [steps, tradeRows] = await Promise.all([
    db.select().from(agentRunSteps).where(eq(agentRunSteps.runId, runId)).orderBy(asc(agentRunSteps.seq)),
    db.select().from(trades).where(eq(trades.runId, runId)).orderBy(asc(trades.createdAt)),
  ]);
  const tokenMap = await loadTokens(db, tradeRows.map((t) => t.tokenId));

  return {
    ...summary,
    steps: steps.map((s) => ({
      id: s.id,
      seq: s.seq,
      kind: s.kind,
      toolName: s.toolName,
      payload: s.payload,
      durationMs: s.durationMs,
      createdAt: s.createdAt.toISOString(),
    })),
    trades: tradeRows.flatMap((t) => {
      const token = tokenMap.get(t.tokenId);
      return token ? [toTradeRow(t, token)] : [];
    }),
  };
}

export async function getAgentTrades(agentId: string, cursor?: string | null): Promise<Page<TradeRow>> {
  const db = await getDb();
  const limit = 25;
  const c = decodeCursor(cursor);
  const rows = await db
    .select()
    .from(trades)
    .where(
      c
        ? and(
            eq(trades.agentId, agentId),
            or(lt(trades.createdAt, c.at), and(eq(trades.createdAt, c.at), lt(trades.id, c.id))),
          )
        : eq(trades.agentId, agentId),
    )
    .orderBy(desc(trades.createdAt), desc(trades.id))
    .limit(limit + 1);

  const page = rows.slice(0, limit);
  const tokenMap = await loadTokens(db, page.map((t) => t.tokenId));
  const last = page.at(-1);
  return {
    items: page.flatMap((t) => {
      const token = tokenMap.get(t.tokenId);
      return token ? [toTradeRow(t, token)] : [];
    }),
    nextCursor: rows.length > limit && last ? encodeCursor(last.createdAt, last.id) : null,
  };
}

export async function getEquitySeries(agentId: string, window: LeaderboardWindow): Promise<EquityPoint[]> {
  const db = await getDb();
  const days = WINDOW_DAYS[window];
  const since = days === null ? null : new Date(Date.now() - days * 86_400_000);
  const rows = await db
    .select({ at: equitySnapshots.at, equityUsd: equitySnapshots.equityUsd, cashUsd: equitySnapshots.cashUsd })
    .from(equitySnapshots)
    .where(since ? and(eq(equitySnapshots.agentId, agentId), gte(equitySnapshots.at, since)) : eq(equitySnapshots.agentId, agentId))
    .orderBy(asc(equitySnapshots.at));
  return rows.map((r) => ({ at: r.at.toISOString(), equityUsd: toNum(r.equityUsd), cashUsd: toNum(r.cashUsd) }));
}

/**
 * Data source picker. The registry itself is owned by the RUNTIME workstream
 * (`src/lib/data-sources/registry.ts`); this only filters it.
 */
export async function listDataSources(query?: string): Promise<DataSourceInfo[]> {
  const q = query?.trim().toLowerCase();
  // Strip zod schemas / query functions: only the plain info shape may cross to the client.
  const infos = DATA_SOURCES.map(toDataSourceInfo);
  if (!q) return infos;
  return infos.filter((s) =>
    [s.id, s.name, s.description, s.category].some((field) => field.toLowerCase().includes(q)),
  );
}

/** Window PnL for one agent — used by the leaderboard and the agent header. */
export async function getAgentWindowPnl(agentId: string, window: LeaderboardWindow) {
  const db = await getDb();
  const rows = await db
    .select({ at: equitySnapshots.at, equityUsd: equitySnapshots.equityUsd })
    .from(equitySnapshots)
    .where(eq(equitySnapshots.agentId, agentId))
    .orderBy(asc(equitySnapshots.at));
  return pnlOverWindow(
    rows.map((r) => ({ at: r.at, equityUsd: toNum(r.equityUsd) })),
    window,
  );
}
