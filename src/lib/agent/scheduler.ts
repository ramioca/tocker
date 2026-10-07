/**
 * Scheduler: two loops on two clocks.
 *
 *  - {@link tickDueAgents} — the LLM loop. Every active agent whose `nextRunAt` is due
 *    gets a full run. Batches of 5 with `Promise.allSettled` so one slow model cannot
 *    stall the others, capped at 20 agents so a cron invocation stays inside the
 *    serverless timeout. `/api/cron/tick`, every 5 minutes. When more are due than
 *    fit, {@link findDueAgents} decides who goes: no slot for an agent that cannot
 *    think or is waiting out a hold, and one per owner before anyone's second.
 *  - {@link tickMarks} — the marks loop. No model, no tokens, no money: refresh marks,
 *    ratchet peaks, run the exit engine for every agent holding something (whatever its
 *    status: a paused agent's stop loss still has to fire), and snapshot equity for
 *    every active agent even when flat. `/api/cron/marks`, every 5 minutes.
 *
 * The second loop is what makes a stop loss real. An agent on a 4-hour cadence used to
 * be able to lose everything between two thoughts, and its equity curve was a step
 * function with one point per run.
 */
import { and, asc, desc, eq, gt, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import { agents, getDb, positions, userSecurity } from "@/db";
import { settleFeesForAgent } from "@/lib/platform/settlement";
import { dbErrorForLog } from "@/lib/security/redact";
import { runGuardian, type GuardianResult } from "@/lib/trading/guardian";
import { sweepSubmittedTrades } from "@/lib/trading/settle";
import { canThinkSql, paysPerUseSql, recheckInferenceHolds } from "./inference-gate";
import { getPortfolio, snapshotEquity } from "./portfolio";
import { reapStaleRuns, runAgent, type RunAgentResult } from "./run";

export interface TickResult {
  due: number;
  results: Array<RunAgentResult & { agentId: string }>;
  /** `agent_runs` rows presumed dead and marked `failed` before this pass (W7 B3). */
  reaped: number;
  /** Held pay-per-use agents whose hold was lifted at the start of this pass. */
  holdsCleared: number;
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

/** How many due agents the pass looks at for each one it will run, so it can spread them across owners. */
const DUE_WINDOW_FACTOR = 5;

/**
 * Due agents, minus every agent whose owner has pulled the account-wide kill
 * switch (`user_security.tradingPaused`). The filter lives here rather than in
 * `/api/cron/tick` so that anything reaching the scheduler honours it.
 *
 * `tickMarks` / `findGuardableAgents` is deliberately NOT filtered: exits must
 * keep running while trading is paused.
 *
 * Two more rules, because a pass has only `limit` slots and every agent on the
 * platform shares them:
 *
 *  - An agent with nothing to think on is not due (`canThinkSql`): a key agent with no
 *    key, whose run can only fail, and a pay-per-use agent waiting out a hold, whose run
 *    would not be started. A run that fails in a millisecond still took a slot from an
 *    agent that would have traded.
 *  - Within the oldest `limit × DUE_WINDOW_FACTOR` due agents, each owner gets one slot
 *    before anyone gets a second. Oldest first decides who is first; what is left over
 *    is filled in the same order. One account's many agents then wait behind each
 *    other, not in front of everybody else's. The overall oldest is always taken, so
 *    nothing waits forever.
 *
 * Deliberately not live-before-paper: five due live agents would then starve every
 * paper agent, and paper is where a new account starts.
 */
export async function findDueAgents(limit = 20, now: Date = new Date()): Promise<string[]> {
  return (await findDue(limit, now)).map((agent) => agent.id);
}

/** {@link findDueAgents}, with whether each agent pays per use: the pass runs those first. */
async function findDue(limit: number, now: Date): Promise<Array<{ id: string; paysPerUse: boolean }>> {
  const db = await getDb();
  const rows = await db
    .select({ id: agents.id, ownerId: agents.ownerId, paysPerUse: paysPerUseSql() })
    .from(agents)
    .leftJoin(userSecurity, eq(userSecurity.userId, agents.ownerId))
    .where(
      and(
        eq(agents.status, "active"),
        isNotNull(agents.nextRunAt),
        lte(agents.nextRunAt, now),
        // A key agent needs a key (the scripted model, `LLM_MOCK=1`, thinks without one);
        // a pay-per-use agent needs none, and is skipped while a hold has time to run.
        canThinkSql(now),
        // No security row means the switch was never touched, i.e. not paused.
        or(isNull(userSecurity.tradingPaused), eq(userSecurity.tradingPaused, false)),
      ),
    )
    // The id breaks ties, so two agents due at the same instant sort the same way every pass.
    .orderBy(asc(agents.nextRunAt), asc(agents.id))
    .limit(limit * DUE_WINDOW_FACTOR);
  const flags = new Map(rows.map((row) => [row.id, row.paysPerUse === true]));
  return spreadAcrossOwners(rows, limit).map((id) => ({ id, paysPerUse: flags.get(id) === true }));
}

/**
 * PURE. Picks up to `limit` agents from `rows` (already oldest-due first): one per owner
 * in that order, then whatever is left in that order. See {@link findDueAgents}.
 */
export function spreadAcrossOwners(rows: ReadonlyArray<{ id: string; ownerId: string }>, limit: number): string[] {
  const picked = new Set<string>();
  const owners = new Set<string>();
  for (const row of rows) {
    if (picked.size >= limit) break;
    if (owners.has(row.ownerId)) continue;
    owners.add(row.ownerId);
    picked.add(row.id);
  }
  for (const row of rows) {
    if (picked.size >= limit) break;
    picked.add(row.id);
  }
  // A Set keeps insertion order: every owner's first, then the fill.
  return [...picked];
}

/** How many holds one tick pass looks at before it picks agents. The rest wait for the next pass. */
const HOLDS_PER_TICK = 10;
/**
 * And for how long. Each look may ask the chain for a balance, and the runs of this pass
 * are waiting behind it: a pay-per-use run is only started in the first fifty seconds of
 * its invocation, so a slow node must not be allowed to use them up.
 */
const HOLDS_BUDGET_MS = 8_000;

/**
 * Held pay-per-use agents whose time has come are looked at again before the pass picks
 * who runs, so one whose wallet was funded runs in this pass and not the next. It takes
 * no run slot and never throws. With no held agent it is one query that finds nothing.
 */
async function liftDueHolds(now: Date): Promise<number> {
  try {
    return (await recheckInferenceHolds(HOLDS_PER_TICK, now, { budgetMs: HOLDS_BUDGET_MS })).cleared;
  } catch (err) {
    console.error(`[tick] holds could not be re-checked: ${dbErrorForLog(err)}`);
    return 0;
  }
}

/**
 * Runs every due agent. Never throws: a failed agent shows up in `results`.
 *
 * Reaps abandoned runs first. A frozen serverless invocation leaves its row `running`,
 * and `claimRun` refuses to start anything while one exists — so without a sweep on the
 * loop that actually runs every five minutes, one timeout would be the last tick that
 * agent ever took.
 *
 * `invocationStartedAt` is when the serverless invocation doing this pass began (the cron
 * route passes it). Batches run one after another inside that one invocation, so a
 * pay-per-use agent in a late batch may not have the time a paid run needs: such a run is
 * not started and the agent stays due. That is also why pay-per-use agents go first.
 *
 * A KNOWN LIMIT, left as it is on purpose. In practice only the first batch of a pass
 * runs pay-per-use agents. A paid run is started only in the first fifty seconds of its
 * invocation (`fitsInvocation`), and the second batch starts when the slowest run of the
 * first has ended, which is nearly always later than that. So:
 *
 *  - at most `BATCH_SIZE` pay-per-use runs start in a pass: five every five minutes for
 *    the whole platform;
 *  - every pay-per-use agent picked beyond those is put off (`RUN_DEFERRED`). It keeps
 *    its place as due and is picked first again next pass, but it has used one of this
 *    pass's `limit` slots, so a backlog of twenty of them, from different owners, leaves
 *    no slot for a key agent until it drains. (The cron's own default `limit` is one
 *    batch, `CRON_MAX_AGENTS` 5, where nobody is put off: this bites once that is raised.)
 *
 * Nothing is lost or paid twice by this, and it cannot be reached while pay-per-use is
 * open to its owner alone. It is a ceiling to lift before it is open to everyone
 * (DEPLOY.md, stage 4, where lifting it is step 1, before the switch): either take no
 * more than `BATCH_SIZE` pay-per-use agents into a pass, so the other slots go to key
 * agents, or run the pay-per-use batch alongside the first key batch. Neither is done
 * here: the pass is the scheduler every key agent runs on, and reshaping it belongs with
 * the stage that needs it. `inference-runbook.test.ts` holds that page to this comment.
 */
export async function tickDueAgents(
  limit = 20,
  now: Date = new Date(),
  options: { invocationStartedAt?: number } = {},
): Promise<TickResult> {
  const invocationStartedAt = options.invocationStartedAt ?? Date.now();
  const reaped = await reapStaleRuns(undefined, now);
  const holdsCleared = await liftDueHolds(now);
  const picked = await findDue(limit, now);
  // Who runs was decided above, oldest first and one per owner. This only decides the
  // order inside the pass, and keeps it otherwise as it was.
  const due = [...picked.filter((agent) => agent.paysPerUse), ...picked.filter((agent) => !agent.paysPerUse)].map((agent) => agent.id);
  const results: Array<RunAgentResult & { agentId: string }> = [];

  for (let i = 0; i < due.length; i += BATCH_SIZE) {
    const batch = due.slice(i, i + BATCH_SIZE);
    const settled = await Promise.allSettled(batch.map((agentId) => runAgent({ agentId, trigger: "schedule", invocationStartedAt })));
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

  return { due: due.length, results, reaped, holdsCleared };
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

/** The most agents one marks pass takes on. See {@link findGuardableAgents} for who is cut first. */
export const MARKS_MAX_AGENTS = 200;

/** How long the flat agents' snapshots may take before the pass moves on. */
const FLAT_PASS_BUDGET_MS = 200_000;

/**
 * Who the marks loop looks after, split by whether they are holding anything right now.
 *
 * Every agent with a book is guarded whatever its status: pausing an agent stops it
 * waking up, it does not switch its stop loss off. Flat agents are included only while
 * active (they get an equity point and the fee sweep).
 *
 * The order is what the cap cuts by, so it is books first, real money before paper, and
 * only then id. A crowd of flat or paper agents can never push a live book out of the
 * pass; ordering by id alone did exactly that once there were more agents than the cap.
 */
export async function findGuardableAgents(limit = MARKS_MAX_AGENTS): Promise<{ holding: string[]; flat: string[] }> {
  const db = await getDb();
  const held = sql<number>`count(${positions.tokenId})`;
  const rows = await db
    .select({ id: agents.id, held: sql<number>`count(${positions.tokenId})::int` })
    .from(agents)
    .leftJoin(positions, and(eq(positions.agentId, agents.id), gt(positions.amountToken, "0")))
    .groupBy(agents.id)
    .having(sql`${agents.status} = 'active' or ${held} > 0`)
    .orderBy(desc(sql`${held} > 0`), desc(sql`${agents.mode} = 'live'`), asc(agents.id))
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
export async function tickMarks(limit = MARKS_MAX_AGENTS, now: Date = new Date()): Promise<MarksTickResult> {
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
  if (holding.length >= limit) {
    // Loud on purpose: past this point a book is going unguarded.
    console.warn(`[marks] ${holding.length} books fill the cap of ${limit}: some exits were not checked this pass`);
  }

  const guarded = await inBatches(holding, (agentId) => runGuardian({ agentId, trigger: "marks", now }));
  const results = guarded.filter((r): r is GuardianResult => r !== null);

  // Flat agents come second and inside a budget: an equity point for an empty book is
  // never worth the function's time limit, which the next pass's exits also need.
  const flatDeadline = Date.now() + FLAT_PASS_BUDGET_MS;
  const flatSnapshots = await inBatches(flat, async (agentId) => {
    if (Date.now() > flatDeadline) return false;
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
