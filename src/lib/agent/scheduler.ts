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
import { sweepSubmittedTrades } from "@/lib/trading/settle";
import { getPortfolio, snapshotEquity } from "./portfolio";
import { reapStaleRuns, runAgent, type RunAgentResult } from "./run";

export interface TickResult {
  due: number;
  results: Array<RunAgentResult & { agentId: string }>;
  /** `agent_runs` rows presumed dead and marked `failed` before this pass (W7 B3). */
  reaped: number;
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

/**
 * Runs every due agent. Never throws: a failed agent shows up in `results`.
 *
 * Reaps abandoned runs first. A frozen serverless invocation leaves its row `running`,
 * and `claimRun` refuses to start anything while one exists — so without a sweep on the
 * loop that actually runs every five minutes, one timeout would be the last tick that
 * agent ever took.
 */
export async function tickDueAgents(limit = 20, now: Date = new Date()): Promise<TickResult> {
  const reaped = await reapStaleRuns(undefined, now);
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

  return { due: due.length, results, reaped };
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
  /** `agent_runs` rows presumed dead and marked `failed` before this pass (W7 B3). */
  reaped: number;
  /** `trades` rows stuck on `submitted` and settled against the chain (W7 H2). */
  settled: number;
  /** Empty token accounts closed this pass, their rent back in the platform wallet (W8). */
  recycled: number;
  results: GuardianResult[];
}

/** Wall-clock budget for rent recycling in one marks pass; agents past it wait for the next. */
const RENT_RECYCLE_BUDGET_MS = 45_000;

/**
 * Maintenance: close agents' empty token accounts so the rent the platform fronted for
 * them comes back (see `src/lib/wallets/rent-recycle.ts`). A few accounts per agent, in
 * the same batches of five as everything else, inside {@link RENT_RECYCLE_BUDGET_MS}.
 * Never throws — and it runs after every mark, exit and snapshot is written, so it
 * cannot delay one.
 */
async function recycleRent(agentIds: readonly string[], now: Date): Promise<number> {
  if (agentIds.length === 0) return 0;
  try {
    const { recycleAgentRent } = await import("@/lib/wallets/rent-recycle");
    const deadline = Date.now() + RENT_RECYCLE_BUDGET_MS;
    const outcomes = await inBatches(agentIds, (agentId) =>
      Date.now() > deadline ? Promise.resolve(null) : recycleAgentRent(agentId, { now }),
    );
    return outcomes.reduce((n, outcome) => n + (outcome?.closed ?? 0), 0);
  } catch {
    return 0;
  }
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
  // The marks loop runs on the same five-minute clock as the tick loop and is the one
  // that keeps running when the tick loop is wedged, so it reaps too.
  const reaped = await reapStaleRuns(undefined, now);
  // Platform maintenance on the same clock: the Solana wallet that pays every network
  // fee tops itself up from its own USDC when it runs short, so a funding transfer or
  // a gas drip never finds it dry. Never throws; throttled to once a minute.
  try {
    const { ensurePlatformSol } = await import("@/lib/platform/sol");
    await ensurePlatformSol("the marks tick");
  } catch {
    // Maintenance must never take the marks loop down with it.
  }
  // And trades left on `submitted` by the same frozen invocations. `submitted` lasts
  // milliseconds in the happy case; two minutes later it means nobody is coming back to
  // finish the row, and a book that says nothing happened when money may have moved is
  // the worst state this system can be in. Never throws.
  const settled = await sweepSubmittedTrades(now);
  const { holding, flat } = await findGuardableAgents(limit);

  const guarded = await inBatches(holding, (agentId) => runGuardian({ agentId, trigger: "marks", now }));
  const results = guarded.filter((r): r is GuardianResult => r !== null);

  const flatSnapshots = await inBatches(flat, async (agentId) => {
    const portfolio = await getPortfolio(agentId);
    // `false` when a live balance read failed: a gap in the curve, not a zero (W7 H8).
    const written = await snapshotEquity(portfolio);
    // A flat agent still gets the platform-fee sweep. It does not get a guardian pass
    // (there is nothing to guard), and without this a live agent that closed its last
    // position while owing fees would not be collected from until it opened another.
    // Never throws — see `settleFeesForAgent`.
    await settleFeesForAgent(agentId, now);
    return written;
  });

  // Last, and bounded: return the rent on emptied token accounts to the platform.
  const recycled = await recycleRent([...holding, ...flat], now);

  return {
    active: holding.length + flat.length,
    guarded: results.length,
    exits: results.reduce((n, r) => n + r.exits.filter((e) => e.status === "filled").length, 0),
    snapshots: results.filter((r) => r.equityUsd !== null).length + flatSnapshots.filter(Boolean).length,
    reaped,
    settled,
    recycled,
    results,
  };
}
