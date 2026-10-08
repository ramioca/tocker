/**
 * The schedule means what it says: an agent set to every 15 minutes runs four times an
 * hour, on the minutes the cron really fires.
 *
 * `nextRunTime` is the whole rule, so most of this is that function played against the
 * cron's minutes (read from `vercel.json`, the file the platform reads) by a model of the
 * three things the scheduler does with it: an agent is run by a pass when its next run
 * has come, one run of an agent at a time, and the next run is written when the run ends.
 * `schedule-grid.test.ts` plays the same hour through the real scheduler and run loop.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MIN_SCHEDULE_MINUTES } from "./config";
import { PASS_EVERY_MINUTES, SCHEDULE_GRACE_MS, nextRunTime, passIsDue, runAnchor, scheduledMinutes } from "./schedule";

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
/** Some hour, on the hour. */
const T0 = Date.UTC(2026, 9, 5, 14, 0, 0);

const vercel = JSON.parse(readFileSync(path.join(process.cwd(), "vercel.json"), "utf8")) as {
  crons: Array<{ path: string; schedule: string }>;
};
const TICK_CRON = vercel.crons.find((cron) => cron.path === "/api/cron/tick")?.schedule ?? "";

/** The minutes of the hour a cron line fires on, for one that fires every hour of every day. */
function cronMinutes(schedule: string): { minutes: number[]; step: number } {
  const [minute, ...rest] = schedule.trim().split(/\s+/);
  if (rest.join(" ") !== "* * * *") throw new Error(`not an every-hour cron: ${schedule}`);
  const match = /^(?:(\d+)-(\d+)|\*)\/(\d+)$/.exec(minute ?? "");
  if (!match) throw new Error(`not a stepped minute field: ${schedule}`);
  const from = Number(match[1] ?? 0);
  const to = Number(match[2] ?? 59);
  const step = Number(match[3]);
  const minutes: number[] = [];
  for (let m = from; m <= to; m += step) minutes.push(m);
  return { minutes, step };
}

const CRON = cronMinutes(TICK_CRON);

/** When each pass of `hours` hours began: the cron's minutes, each `jitter(index)` ms into its minute. */
function passes(hours: number, jitter: (index: number) => number = () => 0): number[] {
  const starts: number[] = [];
  for (let hour = 0; hour < hours; hour += 1) {
    for (const minute of CRON.minutes) starts.push(T0 + hour * HOUR + minute * MINUTE + jitter(starts.length));
  }
  return starts;
}

type Rule = (intervalMinutes: number, passStartedAt: number, finishedAt: number) => Date | null;
/** The rule as shipped: nothing about the run but the pass that started it. */
const SHIPPED: Rule = (intervalMinutes, passStartedAt) => nextRunTime(intervalMinutes, passStartedAt);
/** The rule it replaced: a whole interval from when the run finished. */
const FROM_THE_FINISH: Rule = (intervalMinutes, _passStartedAt, finishedAt) => new Date(finishedAt + intervalMinutes * MINUTE);

/**
 * One agent, pass by pass, as the scheduler treats it.
 *
 *  - `findDue`: a pass picks the agent when its next run is not after the pass's clock.
 *  - `claimRun`: a picked agent with a run still in flight is refused, not started twice.
 *  - `executeRun`: the next run is written when the run ends, so until then the agent
 *    still shows as due.
 *
 * The agent is due from the first pass. Returns when each of its runs' passes began.
 */
function simulate(options: { intervalMinutes: number; passStarts: number[]; runMs?: number; rule?: Rule }): { ranAt: number[]; refused: number } {
  const runMs = options.runMs ?? 40 * SECOND;
  const rule = options.rule ?? SHIPPED;
  let due: number | null = options.passStarts[0] ?? null;
  let inFlight: { until: number; next: number | null } | null = null;
  const ranAt: number[] = [];
  let refused = 0;
  for (const startedAt of options.passStarts) {
    if (inFlight && inFlight.until <= startedAt) {
      due = inFlight.next;
      inFlight = null;
    }
    if (due === null || due > startedAt) continue;
    if (inFlight) {
      refused += 1;
      continue;
    }
    ranAt.push(startedAt);
    inFlight = { until: startedAt + runMs, next: rule(options.intervalMinutes, startedAt, startedAt + runMs)?.getTime() ?? null };
  }
  return { ranAt, refused };
}

const gaps = (times: number[]) => times.slice(1).map((time, i) => time - (times[i] as number));
const inHour = (times: number[], hour: number) => times.filter((time) => time >= T0 + hour * HOUR && time < T0 + (hour + 1) * HOUR).length;

/** A repeatable stand-in for chance: the same jitter every time the suite runs. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 2 ** 32;
  };
}

/** The intervals the builder offers under a day, and how many runs an hour each one says. */
const OFFERED = [
  { minutes: 15, anHour: 4 },
  { minutes: 5, anHour: 12 },
  { minutes: 30, anHour: 2 },
  { minutes: 60, anHour: 1 },
] as const;

describe("nextRunTime", () => {
  it("is the start of the invocation that ran the agent, plus its interval, less the grace", () => {
    expect(SCHEDULE_GRACE_MS).toBe(MINUTE);
    expect(nextRunTime(15, T0)).toEqual(new Date(T0 + 14 * MINUTE));
    expect(nextRunTime(5, T0)).toEqual(new Date(T0 + 4 * MINUTE));
    expect(nextRunTime(60, T0)).toEqual(new Date(T0 + 59 * MINUTE));
    expect(nextRunTime(1_440, T0)).toEqual(new Date(T0 + 1_439 * MINUTE));
  });

  it("has no next run for an agent that only runs by hand, or an interval that is not one", () => {
    for (const interval of [0, -15, Number.NaN, Number.POSITIVE_INFINITY, undefined as unknown as number]) {
      expect(nextRunTime(interval, T0)).toBeNull();
      expect(scheduledMinutes(interval)).toBe(0);
    }
  });
});

describe("the cron this is written for", () => {
  it("fires every PASS_EVERY_MINUTES, on the minutes in vercel.json", () => {
    expect(CRON.step).toBe(PASS_EVERY_MINUTES);
    expect(CRON.minutes).toHaveLength(60 / PASS_EVERY_MINUTES);
    // The last pass of an hour and the first of the next are one step apart too.
    expect(60 - (CRON.minutes.at(-1) as number) + (CRON.minutes[0] as number)).toBe(PASS_EVERY_MINUTES);
  });

  it("is the shortest schedule the config allows", () => {
    expect(MIN_SCHEDULE_MINUTES).toBe(PASS_EVERY_MINUTES);
  });
});

describe("an agent on the real cron minutes, with a run that takes 40 seconds", () => {
  it("runs exactly as often as its schedule says: 4, 12, 2 and 1 times an hour", () => {
    for (const { minutes, anHour } of OFFERED) {
      const { ranAt, refused } = simulate({ intervalMinutes: minutes, passStarts: passes(24) });
      for (let hour = 0; hour < 24; hour += 1) expect(inHour(ranAt, hour), `every ${minutes} min, hour ${hour}`).toBe(anHour);
      expect(new Set(gaps(ranAt)), `every ${minutes} min`).toEqual(new Set([minutes * MINUTE]));
      expect(refused).toBe(0);
    }
  });

  /** The owner's report: "feels like here only doing 2/4 runs". */
  it("got one pass fewer under the rule this replaced: every 20 minutes for 15, every 10 for 5", () => {
    const old = (minutes: number) => simulate({ intervalMinutes: minutes, passStarts: passes(24), rule: FROM_THE_FINISH }).ranAt;
    expect(new Set(gaps(old(15)))).toEqual(new Set([20 * MINUTE]));
    expect(inHour(old(15), 1)).toBe(3);
    expect(new Set(gaps(old(5)))).toEqual(new Set([10 * MINUTE]));
    expect(inHour(old(5), 1)).toBe(6);
    expect(new Set(gaps(old(60)))).toEqual(new Set([65 * MINUTE]));
  });

  it("does not depend on how long the run took, up to the time one invocation has", () => {
    for (const runMs of [0, SECOND, 40 * SECOND, 240 * SECOND, 299 * SECOND]) {
      for (const { minutes, anHour } of OFFERED) {
        const { ranAt } = simulate({ intervalMinutes: minutes, passStarts: passes(6), runMs });
        expect(inHour(ranAt, 3), `every ${minutes} min, a ${runMs / SECOND}s run`).toBe(anHour);
      }
    }
  });

  it("is counted from when the pass began for an agent that waited behind an earlier batch", () => {
    const passStartedAt = T0 + 2 * MINUTE;
    // Second batch: its run began 200 seconds into the invocation.
    const anchor = runAnchor(passStartedAt, passStartedAt + 200 * SECOND, 300 * SECOND);
    expect(anchor).toBe(passStartedAt);
    expect(nextRunTime(15, anchor)).toEqual(new Date(T0 + 16 * MINUTE));
  });

  /**
   * What that costs, and only where a pass has more than one batch (`CRON_MAX_AGENTS`
   * above 5). The agent keeps its pass, so its next run can start well under its interval
   * after the late one did: here 55 seconds, for "every 5 min". It is still one run for
   * each pass. Counted from its own late start it would be due after the next pass had
   * looked, and run every other one: the fault this file is about.
   */
  it("lets a run that started late in its pass be followed sooner than its interval, and never by more than one run a pass", () => {
    const starts = passes(1);
    const [first, second, third] = starts as [number, number, number];
    // Behind a first batch that ran to the model's time limit.
    const startedAt = first + 245 * SECOND;
    const due = nextRunTime(5, runAnchor(first, startedAt, 300 * SECOND))?.getTime() ?? 0;
    expect(due).toBeLessThanOrEqual(second);
    expect(second - startedAt).toBe(55 * SECOND);
    // And once it has run in the second pass, nothing is due before the third.
    expect(nextRunTime(5, second)?.getTime()).toBeGreaterThan(second);
    expect(nextRunTime(5, second)?.getTime()).toBeLessThanOrEqual(third);
    expect(simulate({ intervalMinutes: 5, passStarts: starts, runMs: 285 * SECOND }).ranAt).toEqual(starts);
  });
});

describe("a cron that fires anywhere inside its minute", () => {
  /** Runs on every `every`-th pass and no other: none dropped, none extra. */
  function onItsPasses(minutes: number, jitter: (index: number) => number): void {
    const every = minutes / PASS_EVERY_MINUTES;
    const starts = passes(12, jitter);
    const { ranAt } = simulate({ intervalMinutes: minutes, passStarts: starts });
    expect(ranAt, `every ${minutes} min`).toEqual(starts.filter((_, index) => index % every === 0));
  }

  it("does not drop a pass at the worst case either way: 59 seconds late, then on the second, and back", () => {
    for (const { minutes } of OFFERED) {
      const every = minutes / PASS_EVERY_MINUTES;
      // The pass that runs the agent is as late as it can be and the one an interval on
      // as early as it can be, then the other way round, for the whole half day.
      onItsPasses(minutes, (index) => (Math.floor(index / every) % 2 === 0 ? 59 * SECOND : 0));
      onItsPasses(minutes, (index) => (Math.floor(index / every) % 2 === 0 ? 0 : 59 * SECOND));
    }
  });

  it("does not drop a pass whatever second each one begins on", () => {
    for (let seed = 1; seed <= 50; seed += 1) {
      const random = seeded(seed);
      const jitter = Array.from({ length: 12 * CRON.minutes.length }, () => Math.floor(random() * (59 * SECOND + 1)));
      for (const { minutes } of OFFERED) onItsPasses(minutes, (index) => jitter[index] as number);
    }
  });

  it("never runs an agent sooner than its interval less the grace", () => {
    for (let seed = 1; seed <= 50; seed += 1) {
      const random = seeded(seed);
      for (const { minutes } of OFFERED) {
        const { ranAt } = simulate({ intervalMinutes: minutes, passStarts: passes(12, () => Math.floor(random() * (59 * SECOND + 1))) });
        expect(Math.min(...gaps(ranAt))).toBeGreaterThanOrEqual(minutes * MINUTE - SCHEDULE_GRACE_MS);
      }
    }
  });
});

/**
 * `pnpm tick`, the local loop, wakes every minute. The grace is for a cron that passes
 * every five: a caller that passed on every wake-up found each agent due a minute short
 * of its interval, every time.
 */
describe("a caller that wakes more often than the cron", () => {
  /** When a loop that wakes every `everyMs` made its passes over `hours`: on every wake-up, or only where `passIsDue` lets it. */
  function loop(everyMs: number, hours: number, gated: boolean): number[] {
    const starts: number[] = [];
    let last: number | null = null;
    for (let now = T0; now < T0 + hours * HOUR; now += everyMs) {
      if (gated && !passIsDue(last, now)) continue;
      last = now;
      starts.push(now);
    }
    return starts;
  }

  it("may pass at once, and then not until a whole pass's time has gone by", () => {
    expect(passIsDue(null, T0)).toBe(true);
    expect(passIsDue(T0, T0 + PASS_EVERY_MINUTES * MINUTE - 1)).toBe(false);
    expect(passIsDue(T0, T0 + PASS_EVERY_MINUTES * MINUTE)).toBe(true);
  });

  /** What it is for: a pass every 62 seconds runs "every 5 min" fifteen times an hour. */
  it("would run an agent sooner than its interval if every wake-up were a pass", () => {
    const { ranAt } = simulate({ intervalMinutes: 5, passStarts: loop(62 * SECOND, 2, false), runMs: SECOND });
    expect(new Set(gaps(ranAt))).toEqual(new Set([248 * SECOND]));
    expect(inHour(ranAt, 0)).toBe(15);
  });

  it("keeps its passes a whole pass apart however often it wakes, so \"every 5 min\" is never sooner than five", () => {
    for (const everyMs of [SECOND, 30 * SECOND, 60 * SECOND, 62 * SECOND, 101 * SECOND, 5 * MINUTE, 7 * MINUTE]) {
      const starts = loop(everyMs, 6, true);
      const said = `waking every ${everyMs / SECOND}s`;
      expect(Math.min(...gaps(starts)), said).toBeGreaterThanOrEqual(PASS_EVERY_MINUTES * MINUTE);
      const { ranAt } = simulate({ intervalMinutes: 5, passStarts: starts, runMs: SECOND });
      expect(Math.min(...gaps(ranAt)), said).toBeGreaterThanOrEqual(5 * MINUTE);
      for (let hour = 0; hour < 6; hour += 1) expect(inHour(ranAt, hour), said).toBeLessThanOrEqual(12);
      // A longer interval is held to what the cron itself is: never sooner than the grace allows.
      for (const { minutes } of OFFERED) {
        const longer = simulate({ intervalMinutes: minutes, passStarts: starts, runMs: SECOND }).ranAt;
        expect(Math.min(...gaps(longer)), `every ${minutes} min, ${said}`).toBeGreaterThanOrEqual(minutes * MINUTE - SCHEDULE_GRACE_MS);
      }
    }
  });

  /**
   * The loop as it is: a wake-up about every minute, a little over with the calls it
   * makes, so a pass every five to six minutes. The two fastest schedules are then never
   * short at all, and none waits more than a pass beyond its interval.
   */
  it("runs 5 and 15 minute agents at their interval or a little over when it wakes about every minute", () => {
    for (const everyMs of [60 * SECOND, 61 * SECOND, 62 * SECOND, 65 * SECOND, 71 * SECOND]) {
      const starts = loop(everyMs, 12, true);
      for (const { minutes, anHour } of OFFERED) {
        const { ranAt } = simulate({ intervalMinutes: minutes, passStarts: starts, runMs: SECOND });
        const said = `every ${minutes} min, waking every ${everyMs / SECOND}s`;
        expect(Math.max(...gaps(ranAt)), said).toBeLessThan((minutes + 2 * PASS_EVERY_MINUTES) * MINUTE);
        if (minutes > 15) continue;
        expect(Math.min(...gaps(ranAt)), said).toBeGreaterThanOrEqual(minutes * MINUTE);
        for (let hour = 0; hour < 12; hour += 1) expect(inHour(ranAt, hour), said).toBeLessThanOrEqual(anHour);
      }
    }
  });
});

describe("a pass that is skipped or late", () => {
  it("delays the agent by one pass, once, when the pass it was due on never ran", () => {
    for (const { minutes } of OFFERED) {
      const every = minutes / PASS_EVERY_MINUTES;
      const all = passes(6);
      for (let skipped = 0; skipped < 2 * CRON.minutes.length; skipped += 1) {
        const { ranAt } = simulate({ intervalMinutes: minutes, passStarts: all.filter((_, index) => index !== skipped) });
        const between = gaps(ranAt);
        const said = `every ${minutes} min, pass ${skipped} skipped`;
        expect(Math.min(...between), said).toBeGreaterThanOrEqual(minutes * MINUTE - SCHEDULE_GRACE_MS);
        // The first pass is where the agent starts, so skipping it delays nothing that had begun.
        const late = between.filter((gap) => gap !== minutes * MINUTE);
        expect(late, said).toEqual(skipped > 0 && skipped % every === 0 ? [(minutes + PASS_EVERY_MINUTES) * MINUTE] : []);
      }
    }
  });

  it("moves the agent one pass later, and no run closer, when its pass began minutes late", () => {
    for (const lateBy of [90 * SECOND, 3 * MINUTE, 4 * MINUTE + 30 * SECOND]) {
      for (const { minutes } of OFFERED) {
        const every = minutes / PASS_EVERY_MINUTES;
        const onTime = passes(6);
        // The agent's second pass, late.
        const starts = onTime.map((start, index) => (index === every ? start + lateBy : start));
        const { ranAt } = simulate({ intervalMinutes: minutes, passStarts: starts });
        const said = `every ${minutes} min, ${lateBy / SECOND}s late`;
        expect(ranAt.slice(0, 2), said).toEqual([onTime[0], (onTime[every] as number) + lateBy]);
        // Counted from the late start, the pass one interval on the grid is too soon:
        // the agent takes the one after, and keeps that place.
        expect(ranAt.slice(2), said).toEqual(onTime.filter((_, index) => index > every + 1 && (index - 1) % every === 0));
        expect(Math.min(...gaps(ranAt)), said).toBeGreaterThanOrEqual(minutes * MINUTE - SCHEDULE_GRACE_MS);
      }
    }
  });

  it("runs once after an outage, not once for every run it missed", () => {
    for (const { minutes, anHour } of OFFERED) {
      // Three hours with no pass at all, after the first hour.
      const starts = passes(6).filter((start) => start < T0 + HOUR || start >= T0 + 4 * HOUR);
      const { ranAt } = simulate({ intervalMinutes: minutes, passStarts: starts });
      expect(inHour(ranAt, 4), `every ${minutes} min, the hour the cron came back`).toBe(anHour);
      expect(inHour(ranAt, 5), `every ${minutes} min`).toBe(anHour);
      expect(Math.min(...gaps(ranAt))).toBeGreaterThanOrEqual(minutes * MINUTE - SCHEDULE_GRACE_MS);
    }
  });
});

describe("a run still in flight when its agent is due again", () => {
  it("is not started a second time, and the agent is due at once when it ends", () => {
    // Longer than any run can be on the platform, which ends the function at 300 seconds;
    // a row can still sit `running` this long, and that is what refuses the claim.
    const runMs = 7 * MINUTE;
    const starts = passes(2);
    const { ranAt, refused } = simulate({ intervalMinutes: 5, passStarts: starts, runMs });
    // Every other pass: the one in between found the run in flight.
    expect(ranAt).toEqual(starts.filter((_, index) => index % 2 === 0));
    expect(refused).toBe(ranAt.length);
    for (const gap of gaps(ranAt)) expect(gap).toBeGreaterThanOrEqual(runMs);
  });
});

describe("an interval that is not a whole number of passes", () => {
  it("is kept as the next whole pass up, and never less than one", () => {
    const kept = (minutes: number) => scheduledMinutes(minutes);
    expect([1, 4, 5, 6, 7, 9, 10, 11, 12, 20, 45, 61].map(kept)).toEqual([5, 5, 5, 10, 10, 10, 10, 15, 15, 20, 45, 65]);
    expect(nextRunTime(7, T0)).toEqual(new Date(T0 + 9 * MINUTE));
    expect(nextRunTime(1, T0)).toEqual(new Date(T0 + 4 * MINUTE));
  });

  it("runs on that pass every time, never sooner than the interval asked for, whatever the cron's second", () => {
    for (let seed = 1; seed <= 50; seed += 1) {
      const random = seeded(seed);
      const jitter = Array.from({ length: 6 * CRON.minutes.length }, () => Math.floor(random() * (59 * SECOND + 1)));
      const starts = passes(6, (index) => jitter[index] as number);
      for (const [minutes, every] of [[6, 2], [7, 2], [9, 2], [11, 3], [12, 3]] as const) {
        const { ranAt } = simulate({ intervalMinutes: minutes, passStarts: starts });
        // A 6-minute agent on the bare rule would be due exactly one pass on, and run
        // every 5 minutes or every 10 by which second each cron fired.
        expect(ranAt, `every ${minutes} min`).toEqual(starts.filter((_, index) => index % every === 0));
        expect(Math.min(...gaps(ranAt)), `every ${minutes} min`).toBeGreaterThanOrEqual(minutes * MINUTE);
      }
    }
  });
});

describe("runAnchor", () => {
  const LIMIT = 300 * SECOND;
  const startedAt = T0 + 2 * MINUTE + 30 * SECOND;

  it("is when the invocation began, for a run that began inside it", () => {
    expect(runAnchor(startedAt, startedAt, LIMIT)).toBe(startedAt);
    expect(runAnchor(startedAt - 30 * SECOND, startedAt, LIMIT)).toBe(startedAt - 30 * SECOND);
    expect(runAnchor(startedAt - LIMIT, startedAt, LIMIT)).toBe(startedAt - LIMIT);
  });

  /** An old figure believed would make the agent due early, on every pass at worst, each run paid for. */
  it("counts from the run's own start when the figure is older than an invocation can be, or is not a time", () => {
    for (const told of [startedAt - LIMIT - 1, startedAt - HOUR, 0, Number.NaN, Number.NEGATIVE_INFINITY, undefined as unknown as number]) {
      expect(runAnchor(told, startedAt, LIMIT)).toBe(startedAt);
    }
    // Which can only be later: the agent is never due sooner for a figure that was wrong.
    expect(nextRunTime(15, runAnchor(0, startedAt, LIMIT))).toEqual(new Date(startedAt + 14 * MINUTE));
  });

  it("does not believe a start later than the run's own", () => {
    expect(runAnchor(startedAt + 1, startedAt, LIMIT)).toBe(startedAt);
    expect(runAnchor(startedAt + HOUR, startedAt, LIMIT)).toBe(startedAt);
  });
});
