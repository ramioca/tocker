import "server-only";
import type { Portfolio } from "@/lib/agent/portfolio";
import { and, asc, desc, eq, gte, inArray, lt, ne, or, sql } from "drizzle-orm";
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
  wallets,
  x402Payments,
} from "@/db";
import { DATA_SOURCES, toDataSourceInfo } from "@/lib/data-sources/registry";
import { toNum } from "@/lib/money";
import { computeEquity, exitDistances, pnlOverWindow, unrealized, winRate, WINDOW_DAYS } from "@/lib/pnl";
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
  snapshotInCurrentMode,
  toTokenRef,
  toTradeRow,
  type AgentRow,
} from "./_shared";
import { loadCachedScores } from "@/lib/trading/score-cache";
import {
  isAgentOwner,
  toPublicProfile,
  visibleConfig,
  visibleError,
  visibleExitDistances,
  visibleSteps,
} from "./visibility";

/**
 * A live agent's book as it stands now — wallet cash and positions at live marks — or
 * null when it cannot be read. No real wallet yet (placeholders only) is "cannot read",
 * not "$0": the snapshot series is the better answer for such an agent, and $0 would
 * read as a wipe-out.
 */
async function livePortfolio(agentId: string): Promise<Portfolio | null> {
  try {
    const { getAgentWallets, getPortfolio } = await import("@/lib/agent/portfolio");
    const walletRows = await getAgentWallets(agentId);
    if (!walletRows.some((w) => !w.walletId.startsWith("paper_"))) return null;
    const portfolio = await getPortfolio(agentId);
    return portfolio.cashReadFailed ? null : portfolio;
  } catch {
    return null;
  }
}

async function detailFor(agent: AgentRow | undefined, viewerId?: string | null): Promise<AgentDetail | null> {
  if (!agent) return null;
  const db = await getDb();
  const isOwner = isAgentOwner(agent.ownerId, viewerId);
  if (!agent.isPublic && !isOwner) return null;

  const since = new Date(Date.now() - 30 * 86_400_000);

  const [aggregates, positionRows, equityRows, walletRows, tradeRows, spendRow, runCountRow, followed, keyRow] =
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
        .innerJoin(agents, eq(agents.id, equitySnapshots.agentId))
        // Current mode only — a paper book and a live book are different units.
        .where(and(eq(equitySnapshots.agentId, agent.id), gte(equitySnapshots.at, since), snapshotInCurrentMode()))
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

  // Latest cached score per holding, so the positions table can show "74 at entry → 41
  // now". Display only — a buy still scores through getTokenScore (see score-cache.ts).
  const cachedScores = await loadCachedScores(positionRows.map((r) => r.token.id));

  // Live and readable: the book from the wallet, positions at live marks — the same
  // numbers the positions table prints, so the header can never disagree with it.
  // Otherwise the stored rows at their last mark.
  const live = agent.mode === "live" ? await livePortfolio(agent.id) : null;
  const livePositions: Position[] = live
    ? live.positions
    : positionRows
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
        openedAt: r.position.openedAt?.toISOString() ?? null,
        peakPriceUsd: r.position.peakPriceUsd === null ? null : toNum(r.position.peakPriceUsd),
        entryScore: r.position.entryScore === null ? null : toNum(r.position.entryScore),
        entryLiquidityUsd: r.position.entryLiquidityUsd === null ? null : toNum(r.position.entryLiquidityUsd),
        currentScore: cachedScores.get(r.token.id)?.total ?? null,
        ...exitDistances({
          unrealizedPct: u.pnlPct,
          stopLossPct: agent.config.risk.stopLossPct,
          takeProfitPct: agent.config.risk.takeProfitPct,
        }),
      };
    })
    .sort((a, b) => (b.valueUsd ?? 0) - (a.valueUsd ?? 0));
  // Both branches above attach stop/target distances computed from the owner's risk
  // rules; a non-owner could subtract `unrealizedPnlPct` and read the thresholds back.
  const visiblePositions = livePositions.map((p) => visibleExitDistances(p, isOwner));

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
  // A live agent is worth what its wallet holds *now*: a fill that landed a minute ago
  // has moved cash into a position, and the last snapshot (marks run every five
  // minutes) still shows the pre-fill book — "$15 cash, $4.77 position, $15 equity".
  // Read the wallet, and fall back to the snapshot only when the read fails.
  const liveCash = live?.cashUsd ?? null;
  const cashUsd = liveCash ?? agg?.cashUsd ?? (agent.mode === "paper" ? toNum(agent.paperStartingUsd) : null);
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

  const key = keyRow[0];

  // Live and readable: cash now plus positions at their marks. Otherwise the series.
  const equityUsd = live ? live.equityUsd : (equity.at(-1)?.equityUsd ?? equitySnapshot.equityUsd);
  // All-time PnL is this equity against what the book started with — the subtraction
  // the chart readout and the Equity card make — so the header and the PnL card print
  // the same number as the chart instead of a last-snapshot-minus-first-snapshot one.
  const basisUsd = agg?.startEquityUsd ?? (agent.mode === "paper" ? toNum(agent.paperStartingUsd) : null);
  const pnlUsd = basisUsd === null ? card.pnlUsd : equityUsd - basisUsd;
  const pnlPct =
    basisUsd === null || pnlUsd === null ? card.pnlPct : basisUsd === 0 ? 0 : (pnlUsd / Math.abs(basisUsd)) * 100;

  return {
    ...card,
    equityUsd,
    pnlUsd,
    pnlPct,
    // THE GATE. The strategy prompt, universe rules, thresholds and data-source list
    // never leave the server for anyone but the owner. Everyone else gets the shape of
    // the agent (chains, model, cadence, how many sources it buys) and nothing more.
    config: visibleConfig(agent.config, isOwner),
    publicProfile: toPublicProfile(agent.config),
    isOwner,
    isFollowedByViewer: followed,
    paperStartingUsd: toNum(agent.paperStartingUsd),
    cashUsd,
    positions: visiblePositions,
    equity,
    // Owner-only: every consumer is a funding/withdraw surface, and `walletId` is the
    // Privy wallet id, which no other viewer has a use for.
    wallets: isOwner ? walletRows.map((w) => ({ chain: w.chain as Chain, address: w.address, walletId: w.id })) : [],
    nextRunAt: iso(agent.nextRunAt),
    llmKeyLabel: isOwner && key ? (key.label ?? `${key.provider} ····${key.last4}`) : null,
    llmKeyId: isOwner ? agent.llmKeyId : null,
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

/**
 * An agent's run history.
 *
 * Takes a `viewerId` for two reasons, both of which used to be missing:
 *  - a **private** agent's runs are its owner's alone. Without the check any id that
 *    leaked while the agent was public keeps working after it is made private.
 *  - a failure's *reason* is owner-only (`visibleError`). The failure itself is not —
 *    the run still shows as failed to everybody.
 */
export async function getAgentRuns(
  agentId: string,
  cursor?: string | null,
  viewerId?: string | null,
): Promise<Page<RunSummary>> {
  const db = await getDb();
  const [agent] = await db
    .select({ ownerId: agents.ownerId, isPublic: agents.isPublic })
    .from(agents)
    .where(eq(agents.id, agentId))
    .limit(1);
  if (!agent) return { items: [], nextCursor: null };
  const isOwner = isAgentOwner(agent.ownerId, viewerId);
  if (!agent.isPublic && !isOwner) return { items: [], nextCursor: null };
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
    items: summaries.map((run) => ({ ...run, error: visibleError(run.error, isOwner) })),
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
  const isOwner = isAgentOwner(row.agent.ownerId, viewerId);
  if (!row.agent.isPublic && !isOwner) return null;

  const [summary] = await summarizeRuns([row.run]);
  // Non-owners never need the step rows, so don't read them at all — the cheapest way
  // to be sure they cannot be serialised into the payload by accident.
  const [steps, tradeRows] = await Promise.all([
    isOwner
      ? db.select().from(agentRunSteps).where(eq(agentRunSteps.runId, runId)).orderBy(asc(agentRunSteps.seq))
      : Promise.resolve([] as Array<typeof agentRunSteps.$inferSelect>),
    db.select().from(trades).where(eq(trades.runId, runId)).orderBy(asc(trades.createdAt)),
  ]);
  const tokenMap = await loadTokens(db, tradeRows.map((t) => t.tokenId));

  return {
    ...summary,
    // The failure is public, the sentence that explains it is not — see `visibleError`.
    error: visibleError(summary.error, isOwner),
    // Status, summary, duration, spend and trades stay public; the transcript does not.
    // It shows which sources were queried, with what arguments, in what order — the system.
    steps: visibleSteps(
      steps.map((s) => ({
        id: s.id,
        seq: s.seq,
        kind: s.kind,
        toolName: s.toolName,
        payload: s.payload,
        durationMs: s.durationMs,
        createdAt: s.createdAt.toISOString(),
      })),
      isOwner,
    ),
    transcriptVisible: isOwner,
    trades: tradeRows.flatMap((t) => {
      const token = tokenMap.get(t.tokenId);
      return token ? [toTradeRow(t, token, { isOwner })] : [];
    }),
  };
}

/**
 * An agent's fills. `viewerId` gates the same two things `getAgentRuns` does: a private
 * agent's book is owner-only, and a failed trade's provider error is owner-only while
 * the failed status itself is public.
 */
export async function getAgentTrades(
  agentId: string,
  cursor?: string | null,
  viewerId?: string | null,
): Promise<Page<TradeRow>> {
  const db = await getDb();
  const [agent] = await db
    .select({ ownerId: agents.ownerId, isPublic: agents.isPublic })
    .from(agents)
    .where(eq(agents.id, agentId))
    .limit(1);
  if (!agent) return { items: [], nextCursor: null };
  const isOwner = isAgentOwner(agent.ownerId, viewerId);
  if (!agent.isPublic && !isOwner) return { items: [], nextCursor: null };
  const limit = 25;
  const c = decodeCursor(cursor);
  // A proposal awaiting the owner's approval is the agent's *next* trade: showing it to
  // everyone opens a front-running window and reveals approval mode. Owner-only until it
  // is decided; once filled or rejected it is track record like any other row.
  const scope = isOwner ? eq(trades.agentId, agentId) : and(eq(trades.agentId, agentId), ne(trades.status, "proposed"));
  const rows = await db
    .select()
    .from(trades)
    .where(
      c
        ? and(scope, or(lt(trades.createdAt, c.at), and(eq(trades.createdAt, c.at), lt(trades.id, c.id))))
        : scope,
    )
    .orderBy(desc(trades.createdAt), desc(trades.id))
    .limit(limit + 1);

  const page = rows.slice(0, limit);
  const tokenMap = await loadTokens(db, page.map((t) => t.tokenId));
  const last = page.at(-1);
  return {
    items: page.flatMap((t) => {
      const token = tokenMap.get(t.tokenId);
      return token ? [toTradeRow(t, token, { isOwner })] : [];
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
    .innerJoin(agents, eq(agents.id, equitySnapshots.agentId))
    .where(
      and(
        eq(equitySnapshots.agentId, agentId),
        since ? gte(equitySnapshots.at, since) : undefined,
        snapshotInCurrentMode(),
      ),
    )
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
    .innerJoin(agents, eq(agents.id, equitySnapshots.agentId))
    .where(and(eq(equitySnapshots.agentId, agentId), snapshotInCurrentMode()))
    .orderBy(asc(equitySnapshots.at));
  return pnlOverWindow(
    rows.map((r) => ({ at: r.at, equityUsd: toNum(r.equityUsd) })),
    window,
  );
}
