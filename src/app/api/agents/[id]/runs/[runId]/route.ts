/**
 * Run detail for polling while a run is in flight. Returns the `RunDetail` shape from
 * `src/server/types.ts`.
 *
 * This is a second code path onto the same data as the run page, so it enforces the same
 * two rules itself rather than trusting anything upstream:
 *  - a private agent is readable only by its owner (404/403), and
 *  - the transcript (`steps`) is owner-only even on a public agent, because it shows which
 *    data sources were bought, with what arguments, and in what order.
 * Status, summary, duration, spend and trades stay public — that is the track record.
 */
import { NextResponse } from "next/server";
import { and, asc, desc, eq } from "drizzle-orm";
import { agentRuns, agentRunSteps, agents, getDb, tokens, trades } from "@/db";
import { getSession } from "@/lib/auth";
import { toTokenRef } from "@/lib/trading/tokens";
import { toTradeScore } from "@/server/queries/_shared";
import { isAgentOwner, visibleSteps } from "@/server/queries/visibility";
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

  const tradeRows = await db
    .select({ trade: trades, token: tokens })
    .from(trades)
    .innerJoin(tokens, eq(trades.tokenId, tokens.id))
    .where(eq(trades.runId, runId))
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

  const tradeList: TradeRow[] = tradeRows.map((r) => ({
    id: r.trade.id,
    agentId: r.trade.agentId,
    chain: r.trade.chain,
    side: r.trade.side,
    token: toTokenRef(r.token),
    amountToken: Number(r.trade.amountToken),
    amountUsd: Number(r.trade.amountUsd),
    priceUsd: Number(r.trade.priceUsd),
    feeUsd: Number(r.trade.feeUsd),
    status: r.trade.status,
    isPaper: r.trade.isPaper,
    txHash: r.trade.txHash,
    // Public on purpose: the one-line rationale and the score are the record, after the fact.
    rationale: r.trade.rationale,
    score: toTradeScore(r.trade.scoreSnapshot),
    error: r.trade.error,
    createdAt: r.trade.createdAt.toISOString(),
    filledAt: r.trade.filledAt?.toISOString() ?? null,
  }));

  const detail: RunDetail = {
    id: run.id,
    agentId: run.agentId,
    trigger: run.trigger,
    status: run.status,
    startedAt: run.startedAt?.toISOString() ?? null,
    finishedAt: run.finishedAt?.toISOString() ?? null,
    summary: run.summary,
    error: run.error,
    dataSpendUsd: Number(run.dataSpendUsd),
    inputTokens: run.inputTokens,
    outputTokens: run.outputTokens,
    tradeCount: tradeList.length,
    stepCount: steps.length,
    createdAt: run.createdAt.toISOString(),
    steps,
    transcriptVisible: isOwner,
    trades: tradeList,
  };

  return NextResponse.json(detail);
}
