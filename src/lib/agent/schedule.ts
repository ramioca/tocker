/**
 * When an agent is due its next run. Pure and a leaf (no imports), so the run loop, the
 * settings action and the estimates the builder quotes all read the one rule from here.
 *
 * Agents are woken by a cron pass every {@link PASS_EVERY_MINUTES} minutes
 * (`/api/cron/tick`; the minutes are in `vercel.json`, and `schedule.test.ts` holds this
 * file to them). A pass runs every agent whose `nextRunAt` has come, once. So "every 15
 * minutes" is kept only when the agent is due again by the time the pass three later
 * looks at it, and the rule is written for that:
 *
 *   next run = when the invocation that ran it began + its interval − a minute of grace
 *
 *  - From when the invocation BEGAN, not from when the run finished. Counted from the
 *    finish, a run picked by the 14:02 pass that ended at 14:02:40 was next due at
 *    14:17:40; the 14:17 pass found it forty seconds early and it ran at 14:22. Every
 *    agent ran one pass later than it was set to: three runs an hour for "every 15 min",
 *    six for "every 5 min". Now neither how long the run took nor how long the agent
 *    waited behind an earlier batch of the same pass moves its next run.
 *  - Less a minute ({@link SCHEDULE_GRACE_MS}), because the platform starts a cron
 *    anywhere inside its minute. The pass one interval on may begin up to 59 seconds
 *    earlier in its minute than this one did in its own, and must still find the agent due.
 *  - The interval in whole passes ({@link scheduledMinutes}).
 *
 * What it costs: an agent can be picked up to a minute short of its interval after the
 * pass that last ran it, never sooner. On the cron's five-minute grid that is the pass
 * exactly one interval on, so an hour holds exactly 60 / interval runs and no more. A
 * caller that passed more often than the cron would find the agent in that minute every
 * time, and run "every 5 min" every four. So none does: the local loop, `pnpm tick`,
 * wakes every minute for the marks and keeps its passes a whole pass apart
 * ({@link passIsDue}).
 *
 * The interval is between the passes that ran the agent, not between its runs' own
 * starts. An agent that waited for the second batch of one pass and went first in the
 * next starts sooner after its last run than its interval, by however long it waited.
 * It is still one run for each interval of passes.
 *
 * Nothing here looks back. A pass that was skipped, or an agent that waited for a slot,
 * is run once when its turn comes and counted from there: there is no run to catch up.
 */

/** How often the tick cron wakes agents, in minutes. The step of its schedule in `vercel.json`. */
export const PASS_EVERY_MINUTES = 5;

/** How far short of its interval an agent is already due. One minute: see the file comment. */
export const SCHEDULE_GRACE_MS = 60_000;

/**
 * An interval as the scheduler keeps it, in minutes: whole passes, rounded up. Zero for
 * "only when I press Run", and for anything that is not a positive number.
 *
 * Rounded up because an agent can only be run by a pass. Left as it is, a 6-minute
 * interval is due (less the grace) exactly one pass on, give or take where in their
 * minutes the two passes began: it would run every 5 minutes or every 10 by chance, and
 * every 5 is more often than its owner asked and pays for. Rounded up it is every 10,
 * always. The same rounding is the floor: nothing runs more often than every pass, which
 * also covers a stored config the schema no longer accepts and so did not floor
 * (`MIN_SCHEDULE_MINUTES`; the run loop reads such a row as stored).
 */
export function scheduledMinutes(intervalMinutes: number): number {
  if (!Number.isFinite(intervalMinutes) || intervalMinutes <= 0) return 0;
  return Math.ceil(intervalMinutes / PASS_EVERY_MINUTES) * PASS_EVERY_MINUTES;
}

/**
 * The next run of an agent on `intervalMinutes`, counted from `anchorMs`: the moment the
 * invocation that ran it began (see {@link runAnchor}), or the moment its schedule was
 * changed. Null when the agent has no schedule.
 *
 * The one place this is decided. Every way a run ends writes what this returns.
 */
export function nextRunTime(intervalMinutes: number, anchorMs: number): Date | null {
  const minutes = scheduledMinutes(intervalMinutes);
  if (minutes === 0) return null;
  return new Date(anchorMs + minutes * 60_000 - SCHEDULE_GRACE_MS);
}

/**
 * Whether a caller that wakes more often than the cron may make a pass now: only once a
 * whole pass's time has gone by since its last one began. `lastPassStartedAt` is null
 * before its first.
 *
 * For `pnpm tick`, which wakes every minute. Passing that often, it found every agent due
 * the minute of grace short of its interval, each time: "every 5 min" ran every four
 * minutes, fifteen runs an hour for twelve, each one paid for where the keys are real.
 * Held to this, its passes are five to six minutes apart: "every 5 min" is never sooner
 * than five, and a longer interval is at most the same minute short that the cron allows.
 */
export function passIsDue(lastPassStartedAt: number | null, now: number): boolean {
  return lastPassStartedAt === null || now - lastPassStartedAt >= PASS_EVERY_MINUTES * 60_000;
}

/**
 * The moment a run's interval is counted from: when the invocation that started it began.
 * For a scheduled run that is the cron pass; for one started by hand, the request.
 *
 * The figure is handed down from the route, so it is not taken on trust. A run cannot
 * start before its invocation, and an invocation does not outlive `invocationLimitMs`:
 * a figure outside those two is not this run's invocation. Believing an old one would
 * make the agent due again early, on every pass at worst, each run paid for. The run's
 * own start is used instead, which can only make the next run later.
 */
export function runAnchor(invocationStartedAt: number, runStartedAt: number, invocationLimitMs: number): number {
  const waited = runStartedAt - invocationStartedAt;
  return Number.isFinite(waited) && waited >= 0 && waited <= invocationLimitMs ? invocationStartedAt : runStartedAt;
}
