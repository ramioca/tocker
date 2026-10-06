/**
 * Run detail for polling while a run is in flight. Returns the `RunDetail` shape from
 * `src/server/types.ts`.
 *
 * This is a second code path onto the same data as the run page, so it enforces the same
 * two rules itself rather than trusting anything upstream:
 *  - a private agent is readable only by its owner (404/403), and
 *  - the transcript (`steps`) is owner-only even on a public agent, because it shows which
 *    data sources were bought, with what arguments, and in what order, and
 *  - a failure's `error` string is owner-only, because it is whatever the provider said
 *    and that has included API keys and RPC URLs (`visibleError`).
 * Status, summary, duration, spend and trades stay public — that is the track record. A
 * failed run reads as failed to everyone; only the reason is held back.
 */
import { NextResponse } from "next/server";
import { and, asc, desc, eq, ne } from "drizzle-orm";
import { agentRuns, agentRunSteps, agents, getDb, tokens, trades } from "@/db";
import { getSession } from "@/lib/auth";
import { tradeRefusals } from "@/lib/agent/narrate";
import { toTokenRef } from "@/lib/trading/tokens";
import { toTradeRow } from "@/server/queries/_shared";
import { isAgentOwner, visibleError, visibleRationale, visibleSteps } from "@/server/queries/visibility";
import type { RunDetail, RunStep, TradeRow } from "@/server/types";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; runId: string }> },
): Promise<NextResponse> {
  const { id, runId } = await params;
  const db = await getDb();

  const agentRows = await db.select().from(agents).where(eq(agents.id, id)).limit(1);
  const agent = agentRows[0];
  if (!agent) return NextResponse.json({ error: "not found" }, { status: 404 });

  let viewerId: string | null = null;
  try {
    viewerId = (await getSession())?.userId ?? null;
  } catch {
    viewerId = null;
  }
  const isOwner = isAgentOwner(agent.ownerId, viewerId);
  if (!agent.isPublic && !isOwner) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const runRows = await db
    .select()
    .from(agentRuns)
    .where(and(eq(agentRuns.id, runId), eq(agentRuns.agentId, id)))
    .limit(1);
  const run = runRows[0];
  if (!run) return NextResponse.json({ error: "not found" }, { status: 404 });

  // Only read the transcript when the viewer owns the agent — a row never fetched
  // cannot be serialised into the response by mistake.
  const stepRows = isOwner
    ? await db.select().from(agentRunSteps).where(eq(agentRunSteps.runId, runId)).orderBy(asc(agentRunSteps.seq))
    : [];

  // A proposal still awaiting approval is owner-only, as on the run page (`getRun`): it
  // is the agent's next trade, and showing it opens a front-running window.
  const tradeRows = await db
    .select({ trade: trades, token: tokens })
    .from(trades)
    .innerJoin(tokens, eq(trades.tokenId, tokens.id))
    .where(isOwner ? eq(trades.runId, runId) : and(eq(trades.runId, runId), ne(trades.status, "proposed")))
    .orderBy(desc(trades.createdAt));

  const steps: RunStep[] = visibleSteps(
    stepRows.map((s) => ({
      id: s.id,
      seq: s.seq,
      kind: s.kind,
      toolName: s.toolName,
      payload: s.payload,
      durationMs: s.durationMs,
      createdAt: s.createdAt.toISOString(),
    })),
    isOwner,
  );

  // Public on purpose: the one-line rationale and the score are the record, after the fact.
  // The per-trade `error` and the strategy-shaped parts of the score are not — `toTradeRow`
  // applies the same owner rule as the run's.
  const tradeList: TradeRow[] = tradeRows.map((r) => toTradeRow(r.trade, toTokenRef(r.token), { isOwner }));

  const detail: RunDetail = {
    id: run.id,
    agentId: run.agentId,
    trigger: run.trigger,
    status: run.status,
    startedAt: run.startedAt?.toISOString() ?? null,
    finishedAt: run.finishedAt?.toISOString() ?? null,
    summary: visibleRationale(run.summary, { isOwner }),
    error: visibleError(run.error, isOwner),
    dataSpendUsd: Number(run.dataSpendUsd),
    inputTokens: run.inputTokens,
    outputTokens: run.outputTokens,
    // Filled only, as `summarizeRuns` counts: a rejected or expired order is not a trade.
    tradeCount: tradeList.filter((t) => t.status === "filled").length,
    // Owner-only, like the transcript it is read from: the reasons quote the owner's caps.
    refusedCount: isOwner
      ? tradeRefusals(
          stepRows.map((s) => ({ kind: s.kind, toolName: s.toolName, payload: s.payload })),
        ).reduce((sum, entry) => sum + entry.count, 0)
      : null,
    stepCount: steps.length,
    createdAt: run.createdAt.toISOString(),
    steps,
    transcriptVisible: isOwner,
    trades: tradeList,
  };

  return NextResponse.json(detail);
}
