/**
 * Scheduler: two loops on two clocks.
 *
 *  - {@link tickDueAgents} — the LLM loop. Every active agent whose `nextRunAt` is due
 *    gets a full run. Batches of 5 with `Promise.allSettled` so one slow model cannot
 *    stall the others, capped at 20 agents so a cron invocation stays inside the
 *    serverless timeout. `/api/cron/tick`, every 5 minutes.
 *  - {@link tickMarks} — the marks loop. No model, no tokens, no money: refresh marks,
 *    ratchet peaks, run the exit engine for every agent holding something, and snapshot
 *    equity for every active agent even when flat. `/api/cron/marks`, every 5 minutes.
 *
 * The second loop is what makes a stop loss real. An agent on a 4-hour cadence used to
 * be able to lose everything between two thoughts, and its equity curve was a step
 * function with one point per run.
 */
import { and, asc, eq, gt, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import { agents, getDb, positions, userSecurity } from "@/db";
import { settleFeesForAgent } from "@/lib/platform/settlement";
import { runGuardian, type GuardianResult } from "@/lib/trading/guardian";
import { getPortfolio, snapshotEquity } from "./portfolio";
import { runAgent, type RunAgentResult } from "./run";

export interface TickResult {
  due: number;
  results: Array<RunAgentResult & { agentId: string }>;
}

const BATCH_SIZE = 5;

/** Runs `fn` over `items` in batches, never throwing; rejections become `null`. */
async function inBatches<T, R>(items: readonly T[], fn: (item: T) => Promise<R>): Promise<Array<R | null>> {
  const out: Array<R | null> = [];
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const settled = await Promise.allSettled(items.slice(i, i + BATCH_SIZE).map(fn));
    for (const outcome of settled) out.push(outcome.status === "fulfilled" ? outcome.value : null);
  }
  return out;
}

/**
 * Due agents, minus every agent whose owner has pulled the account-wide kill
 * switch (`user_security.tradingPaused`). The filter lives here rather than in
 * `/api/cron/tick` so that anything reaching the scheduler honours it.
 *
 * `tickMarks` / `findGuardableAgents` is deliberately NOT filtered: exits must
 * keep running while trading is paused.
 */
export async function findDueAgents(limit = 20, now: Date = new Date()): Promise<string[]> {
  const db = await getDb();
  const rows = await db
    .select({ id: agents.id })
    .from(agents)
    .leftJoin(userSecurity, eq(userSecurity.userId, agents.ownerId))
    .where(
      and(
        eq(agents.status, "active"),
        isNotNull(agents.nextRunAt),
        lte(agents.nextRunAt, now),
        // No security row means the switch was never touched, i.e. not paused.
        or(isNull(userSecurity.tradingPaused), eq(userSecurity.tradingPaused, false)),
      ),
    )
    .orderBy(asc(agents.nextRunAt))
    .limit(limit);
  return rows.map((r) => r.id);
}

/** Runs every due agent. Never throws: a failed agent shows up in `results`. */
export async function tickDueAgents(limit = 20, now: Date = new Date()): Promise<TickResult> {
  const due = await findDueAgents(limit, now);
  const results: Array<RunAgentResult & { agentId: string }> = [];

  for (let i = 0; i < due.length; i += BATCH_SIZE) {
    const batch = due.slice(i, i + BATCH_SIZE);
    const settled = await Promise.allSettled(batch.map((agentId) => runAgent({ agentId, trigger: "schedule" })));
    settled.forEach((outcome, idx) => {
      const agentId = batch[idx] as string;
      if (outcome.status === "fulfilled") {
        results.push({ agentId, ...outcome.value });
      } else {
        results.push({
          agentId,
          runId: "",
          status: "failed",
          error: outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason),
        });
      }
    });
  }

  return { due: due.length, results };
}

export interface MarksTickResult {
  /** Active agents considered. */
  active: number;
  /** Agents that hold at least one position, so the exit engine ran for them. */
  guarded: number;
  /** Exits actually filled across every agent. */
  exits: number;
  /** Equity snapshots written (one per active agent). */
  snapshots: number;
  results: GuardianResult[];
}

/** Active agents, split by whether they are holding anything right now. */
export async function findGuardableAgents(limit = 100): Promise<{ holding: string[]; flat: string[] }> {
  const db = await getDb();
  const rows = await db
    .select({ id: agents.id, held: sql<number>`count(${positions.tokenId})::int` })
    .from(agents)
    .leftJoin(positions, and(eq(positions.agentId, agents.id), gt(positions.amountToken, "0")))
    .where(eq(agents.status, "active"))
    .groupBy(agents.id)
    .orderBy(asc(agents.id))
    .limit(limit);
  return {
    holding: rows.filter((r) => Number(r.held) > 0).map((r) => r.id),
    flat: rows.filter((r) => Number(r.held) === 0).map((r) => r.id),
  };
}

/**
 * One pass of the marks loop. Never throws: every agent's outcome is in `results`.
 *
 * Agents holding something get a full guardian pass (which snapshots equity itself and,
 * after its exits, sweeps accrued platform fees); flat agents get the snapshot and the
 * sweep, so a paused-but-active flat agent still has a continuous equity curve to draw
 * and still pays what it owes.
 */
export async function tickMarks(limit = 100, now: Date = new Date()): Promise<MarksTickResult> {
  const { holding, flat } = await findGuardableAgents(limit);

  const guarded = await inBatches(holding, (agentId) => runGuardian({ agentId, trigger: "marks", now }));
  const results = guarded.filter((r): r is GuardianResult => r !== null);

  const flatSnapshots = await inBatches(flat, async (agentId) => {
    const portfolio = await getPortfolio(agentId);
    await snapshotEquity(portfolio);
    // A flat agent still gets the platform-fee sweep. It does not get a guardian pass
    // (there is nothing to guard), and without this a live agent that closed its last
    // position while owing fees would not be collected from until it opened another.
    // Never throws — see `settleFeesForAgent`.
    await settleFeesForAgent(agentId, now);
    return true;
  });

  return {
    active: holding.length + flat.length,
    guarded: results.length,
    exits: results.reduce((n, r) => n + r.exits.filter((e) => e.status === "filled").length, 0),
    snapshots: results.filter((r) => r.equityUsd !== null).length + flatSnapshots.filter(Boolean).length,
    results,
  };
}
