import "server-only";
import type { Portfolio } from "@/lib/agent/portfolio";
import { and, asc, desc, eq, gte, ilike, inArray, lt, ne, or, sql } from "drizzle-orm";
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
import { readStoredConfig } from "@/lib/agent/config";
import { DATA_SOURCES, toDataSourceInfo } from "@/lib/data-sources/registry";
import { splitPnl, toNum } from "@/lib/money";
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
  loadDailyCloses,
  loadTokens,
  pageSize,
  snapshotInCurrentMode,
  toTokenRef,
  toTradeRow,
  type AgentRow,
} from "./_shared";
import { loadDisplayScores } from "@/lib/trading/score-cache";
import { universeKey } from "@/lib/tokens";
import { PUBLIC_UNIVERSE_KEY } from "./tokens";
import { tradeRefusals, type NarratableStep } from "@/lib/agent/narrate";
import {
  isAgentOwner,
  toPublicProfile,
  visibleConfig,
  visibleError,
  visibleExitDistances,
  visibleRationale,
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

/** A paper agent's cash from its ledger, or null when it cannot be read. */
async function paperLedgerCash(agentId: string): Promise<number | null> {
  try {
    const { getPaperCash } = await import("@/lib/trading/paper");
    return await getPaperCash(agentId);
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
      // Daily closes, current mode only — a paper book and a live book are different
      // units, and the stat cards read one point per day ("day 30 of 31").
      loadDailyCloses(db, [agent.id], since),
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

  // Latest score per holding, so the positions table can show "74 at entry → 41 now".
  // Display only — a buy still scores through getTokenScore (see score-cache.ts). The
  // cache keeps one row per token, overwritten by whoever scored it last, so only a
  // reading under a universe this viewer may see counts: the agent's own for its
  // owner, the public default's for everyone else, as on the token page.
  const displayScores = await loadDisplayScores(
    positionRows.map((r) => r.token.id),
    isOwner ? universeKey(agent.config.universe) : PUBLIC_UNIVERSE_KEY,
  );
  const withDisplayScore = (position: Position): Position => {
    const shown = displayScores.get(position.token.id);
    return {
      ...position,
      currentScore: shown?.total ?? null,
      ...(isOwner ? { currentBlockers: shown?.blockers ?? null } : {}),
    };
  };

  // Live and readable: the book from the wallet, positions at live marks — the same
  // numbers the positions table prints, so the header can never disagree with it.
  // Otherwise the stored rows at their last mark.
  const live = agent.mode === "live" ? await livePortfolio(agent.id) : null;
  const livePositions: Position[] = (live
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
        currentScore: null,
        ...exitDistances({
          unrealizedPct: u.pnlPct,
          stopLossPct: agent.config.risk.stopLossPct,
          takeProfitPct: agent.config.risk.takeProfitPct,
        }),
      };
    })
    .sort((a, b) => (b.valueUsd ?? 0) - (a.valueUsd ?? 0))
  ).map(withDisplayScore);
  // Both branches above attach stop/target distances computed from the owner's risk
  // rules; a non-owner could subtract `unrealizedPnlPct` and read the thresholds back.
  const visiblePositions = livePositions.map((p) => visibleExitDistances(p, isOwner));

  const equity: EquityPoint[] = equityRows.get(agent.id) ?? [];

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
  // Paper cash is read from the ledger for the same reason: a manual buy between runs
  // leaves the last snapshot's cash stale while the positions below already hold the
  // fill, and the Equity card, the Cash row and the open PnL stop adding up.
  const liveCash = live?.cashUsd ?? null;
  const paperCash = agent.mode === "paper" ? await paperLedgerCash(agent.id) : null;
  const cashUsd =
    liveCash ?? paperCash ?? agg?.cashUsd ?? (agent.mode === "paper" ? toNum(agent.paperStartingUsd) : null);
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

  // Live and readable: cash now plus positions at their marks. Paper: the ledger's cash
  // plus the same positions the table prints, so every number on the page comes from
  // one book. The series only when neither can be read.
  const equityUsd = live
    ? live.equityUsd
    : paperCash !== null
      ? equitySnapshot.equityUsd
      : (equity.at(-1)?.equityUsd ?? equitySnapshot.equityUsd);
  // All-time PnL is this equity against what the book started with — the subtraction
  // the chart readout and the Equity card make — so the header and the PnL card print
  // the same number as the chart instead of a last-snapshot-minus-first-snapshot one.
  const basisUsd = agg?.startEquityUsd ?? (agent.mode === "paper" ? toNum(agent.paperStartingUsd) : null);
  const pnlUsd = basisUsd === null ? card.pnlUsd : equityUsd - basisUsd;
  const pnlPct =
    basisUsd === null || pnlUsd === null ? card.pnlPct : basisUsd === 0 ? 0 : (pnlUsd / Math.abs(basisUsd)) * 100;
  // Realised + open must add up to that headline, and to the same split `/home` and
  // `/money` print. Without a basis there is no headline to split; keep the ledger's.
  const split =
    basisUsd === null
      ? null
      : splitPnl({ equityUsd, cashUsd, basisUsd, costBasisUsd: equitySnapshot.costBasisUsd });

  // What a save would store, so a row written before a schema rewrite reads the same
  // to the settings form as the row its next save produces.
  const storedConfig = readStoredConfig(agent.config);

  return {
    ...card,
    equityUsd,
    pnlUsd,
    pnlPct,
    // THE GATE. The strategy prompt, universe rules, thresholds and data-source list
    // never leave the server for anyone but the owner. Everyone else gets the shape of
    // the agent (chains, model, cadence, how many sources it buys) and nothing more.
    config: visibleConfig(storedConfig, isOwner),
    publicProfile: toPublicProfile(storedConfig),
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
      realizedPnlUsd: split?.realizedPnlUsd ?? wr.realizedPnlUsd,
      unrealizedPnlUsd: split?.unrealizedPnlUsd ?? equitySnapshot.unrealizedPnlUsd,
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

/**
 * Public agents whose name, slug or tagline contains `query`, for ⌘K. The same
 * visibility rule as `listPublicAgents`, and only the four fields the palette shows:
 * never config or runs. The caller strips LIKE wildcards from `query`.
 */
export async function searchPublicAgents(
  query: string,
  limit = 8,
): Promise<Array<{ slug: string; name: string; tagline: string | null; mode: "paper" | "live" }>> {
  const q = query.trim();
  if (q.length === 0) return [];
  const db = await getDb();
  const like = `%${q}%`;
  return db
    .select({ slug: agents.slug, name: agents.name, tagline: agents.tagline, mode: agents.mode })
    .from(agents)
    .where(
      and(
        eq(agents.isPublic, true),
        inArray(agents.status, ["active", "paused"]),
        or(ilike(agents.name, like), ilike(agents.slug, like), ilike(agents.tagline, like)),
      ),
    )
    // Shortest name first, as token search does: "Mike" should beat "Mike's Big Fund".
    .orderBy(asc(sql`length(${agents.name})`), asc(agents.name))
    .limit(Math.min(50, Math.max(1, limit)));
}

export async function listPublicAgents(opts?: {
  cursor?: string | null;
  limit?: number;
  sort?: "new" | "pnl" | "followers";
  /** Matches name, slug, tagline or the owner's handle, as Discover's search box does. */
  query?: string;
}): Promise<Page<AgentCard>> {
  const db = await getDb();
  const limit = pageSize(opts?.limit);
  const sort = opts?.sort ?? "new";
  // `%` and `_` are ilike wildcards; a search for "50%" means the characters.
  const q = (opts?.query ?? "").replace(/[%_\\]/g, "").trim();
  const like = `%${q}%`;
  const publicFilter = and(
    eq(agents.isPublic, true),
    inArray(agents.status, ["active", "paused"]),
    q.length > 0
      ? or(
          ilike(agents.name, like),
          ilike(agents.slug, like),
          ilike(agents.tagline, like),
          inArray(agents.ownerId, db.select({ id: users.id }).from(users).where(ilike(users.handle, like))),
        )
      : undefined,
  );

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
  const summaries = await summarizeRuns(page, isOwner);
  const last = page.at(-1);
  return {
    items: summaries.map((run) => ({ ...run, error: visibleError(run.error, isOwner) })),
    nextCursor: rows.length > limit && last ? encodeCursor(last.createdAt, last.id) : null,
  };
}

const DEFAULT_RUN_PAGE = 20;

/**
 * The row the runs list and the run header print. `tradeCount` is fills only: a proposal
 * that expired or was declined wrote a `trades` row with this run's id, and counting it
 * printed "1 trade" for a tick that traded nothing. Refusals are counted from the
 * transcript for the owner alone.
 */
async function summarizeRuns(rows: Array<typeof agentRuns.$inferSelect>, isOwner: boolean): Promise<RunSummary[]> {
  if (rows.length === 0) return [];
  const db = await getDb();
  const ids = rows.map((r) => r.id);
  const [tradeCounts, stepCounts, refusalSteps] = await Promise.all([
    db
      .select({ runId: trades.runId, n: sql<number>`count(*)::int` })
      .from(trades)
      .where(and(inArray(trades.runId, ids), eq(trades.status, "filled")))
      .groupBy(trades.runId),
    // Steps are what the transcript shows: one row per tool call, plus the guardian's
    // standalone exit row and a run-level failure. Thoughts, results and messages are
    // stored rows too, and counting them printed "22 steps" over an 8-row transcript.
    db
      .select({
        runId: agentRunSteps.runId,
        n: sql<number>`(count(*) filter (where ${agentRunSteps.kind} = 'tool_call'
          or (${agentRunSteps.kind} = 'tool_result' and ${agentRunSteps.toolName} = 'guardian')
          or (${agentRunSteps.kind} = 'error' and ${agentRunSteps.toolName} is null)))::int`,
      })
      .from(agentRunSteps)
      .where(inArray(agentRunSteps.runId, ids))
      .groupBy(agentRunSteps.runId),
    isOwner
      ? db
          .select({
            runId: agentRunSteps.runId,
            kind: agentRunSteps.kind,
            toolName: agentRunSteps.toolName,
            payload: agentRunSteps.payload,
          })
          .from(agentRunSteps)
          .where(
            and(
              inArray(agentRunSteps.runId, ids),
              eq(agentRunSteps.toolName, "place_trade"),
              inArray(agentRunSteps.kind, ["tool_result", "error"]),
            ),
          )
      : Promise.resolve([]),
  ]);
  const tradeByRun = new Map(tradeCounts.map((r) => [r.runId ?? "", Number(r.n ?? 0)]));
  const stepByRun = new Map(stepCounts.map((r) => [r.runId, Number(r.n ?? 0)]));
  const tradeStepsByRun = new Map<string, NarratableStep[]>();
  for (const step of refusalSteps) {
    const list = tradeStepsByRun.get(step.runId) ?? [];
    list.push({ kind: step.kind, toolName: step.toolName, payload: step.payload });
    tradeStepsByRun.set(step.runId, list);
  }

  return rows.map((r) => ({
    id: r.id,
    agentId: r.agentId,
    trigger: r.trigger,
    status: r.status,
    startedAt: iso(r.startedAt),
    finishedAt: iso(r.finishedAt),
    // Public, like a rationale, and model-written like one: a summary can name the
    // sources it bought from or the thresholds it holds. Same redaction for a visitor.
    summary: visibleRationale(r.summary, { isOwner }),
    error: r.error,
    dataSpendUsd: toNum(r.dataSpendUsd),
    inputTokens: r.inputTokens,
    outputTokens: r.outputTokens,
    tradeCount: tradeByRun.get(r.id) ?? 0,
    refusedCount: isOwner
      ? tradeRefusals(tradeStepsByRun.get(r.id) ?? []).reduce((sum, entry) => sum + entry.count, 0)
      : null,
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

  const [summary] = await summarizeRuns([row.run], isOwner);
  // A proposal still awaiting approval is owner-only, as in `getAgentTrades`: it is the
  // agent's next trade, and showing it opens a front-running window and reveals
  // approval mode. Decided rows (rejected, expired, filled) are track record.
  const tradeScope = isOwner
    ? eq(trades.runId, runId)
    : and(eq(trades.runId, runId), ne(trades.status, "proposed"));
  // Non-owners never need the step rows, so don't read them at all — the cheapest way
  // to be sure they cannot be serialised into the payload by accident.
  const [steps, tradeRows] = await Promise.all([
    isOwner
      ? db.select().from(agentRunSteps).where(eq(agentRunSteps.runId, runId)).orderBy(asc(agentRunSteps.seq))
      : Promise.resolve([] as Array<typeof agentRunSteps.$inferSelect>),
    db.select().from(trades).where(tradeScope).orderBy(asc(trades.createdAt)),
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

/** The last week of an equity series is drawn hour by hour; everything older, by day. */
const HOURLY_DAYS = 7;
/** Roughly the most points an equity chart needs, whatever the history's length. */
const MAX_SERIES_POINTS = 400;

/**
 * An agent's equity curve for a chart, bucketed in SQL: hourly closes for the last
 * {@link HOURLY_DAYS} days, daily closes before that (or wider buckets, once a long
 * history would pass {@link MAX_SERIES_POINTS}). Each point is the bucket's last
 * snapshot, at its own time.
 *
 * Snapshots land every five minutes. Unbucketed, "all" was every one of them — a month
 * is ~8,600 points, each rendered into the chart's table — and the chart's 7D and 30D
 * ranges only ever needed hourly and daily detail.
 */
export async function getEquitySeries(agentId: string, window: LeaderboardWindow): Promise<EquityPoint[]> {
  const db = await getDb();
  const now = Date.now();
  const days = WINDOW_DAYS[window];
  const since = days === null ? null : new Date(now - days * 86_400_000);
  const scope = and(
    eq(equitySnapshots.agentId, agentId),
    since ? gte(equitySnapshots.at, since) : undefined,
    snapshotInCurrentMode(),
  );

  const [first] = await db
    .select({ at: equitySnapshots.at })
    .from(equitySnapshots)
    .innerJoin(agents, eq(agents.id, equitySnapshots.agentId))
    .where(scope)
    .orderBy(asc(equitySnapshots.at))
    .limit(1);
  if (!first) return [];

  const hourlyFrom = new Date(now - HOURLY_DAYS * 86_400_000);
  const olderDays = Math.max(0, (hourlyFrom.getTime() - first.at.getTime()) / 86_400_000);
  const stepDays = Math.max(1, Math.ceil(olderDays / (MAX_SERIES_POINTS - HOURLY_DAYS * 24)));
  // Two numbering spaces so an hour bucket can never collide with a day bucket. Only in
  // GROUP BY, so its bound parameters appear once and Postgres sees one expression.
  const bucket = sql`case when ${equitySnapshots.at} >= ${hourlyFrom.toISOString()}::timestamptz
    then floor(extract(epoch from ${equitySnapshots.at}) / 3600)
    else -1 - floor(extract(epoch from ${equitySnapshots.at}) / ${stepDays * 86_400}) end`;
  const lastAt = sql`max(${equitySnapshots.at})`;
  const rows = await db
    .select({
      at: sql<number | string>`extract(epoch from ${lastAt})::float8`,
      equityUsd: sql<string>`(array_agg(${equitySnapshots.equityUsd}::text order by ${equitySnapshots.at} desc, ${equitySnapshots.id} desc))[1]`,
      cashUsd: sql<string>`(array_agg(${equitySnapshots.cashUsd}::text order by ${equitySnapshots.at} desc, ${equitySnapshots.id} desc))[1]`,
    })
    .from(equitySnapshots)
    .innerJoin(agents, eq(agents.id, equitySnapshots.agentId))
    .where(scope)
    .groupBy(bucket)
    .orderBy(lastAt);
  return rows.flatMap((r) => {
    const seconds = typeof r.at === "number" ? r.at : Number(r.at);
    if (!Number.isFinite(seconds)) return [];
    return [{ at: new Date(seconds * 1000).toISOString(), equityUsd: toNum(r.equityUsd), cashUsd: toNum(r.cashUsd) }];
  });
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
