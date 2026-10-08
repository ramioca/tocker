/**
 * The schedule, through the real scheduler and the real run loop.
 *
 * `schedule.test.ts` plays the rule against a model of the scheduler. This plays an hour
 * of the cron's own minutes (from `vercel.json`) through `tickDueAgents` and `runAgent`
 * themselves, on the scripted model and in-memory PGlite, called the way the cron route
 * calls them. The test owns the clock, and every run takes forty seconds of it: the clock
 * is moved on where a run flushes its transcript, which every run does once, just before
 * it reads the time it finished.
 *
 * The hour is a few hours in the past on purpose. The database stamps a run row with its
 * own clock, which the test does not own, and a row made "now" by the database must not
 * look ten minutes old to a pass whose clock has run ahead of it: the reaper would take it.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import type { Db } from "@/db";
import * as schema from "@/db/schema";
import { resetPriceCache } from "@/lib/trading/prices";
import { seedKnownTokens } from "@/lib/trading/tokens";
import { RunLogger } from "./logger";
import { SCHEDULE_GRACE_MS } from "./schedule";
import { tickDueAgents, type TickResult } from "./scheduler";
import { seedAgent, setupTestDb } from "./test-support";

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const RUN_TAKES_MS = 40 * SECOND;
/** The start of the hour the passes are played in: on the hour, and behind the real clock. */
const HOUR0 = Math.floor(Date.now() / HOUR) * HOUR - 3 * HOUR;

const vercel = JSON.parse(readFileSync(path.join(process.cwd(), "vercel.json"), "utf8")) as {
  crons: Array<{ path: string; schedule: string }>;
};
/** The minutes of the hour the tick cron fires on: "2-59/5 * * * *" is 2, 7, … 57. */
const CRON_MINUTES = (() => {
  const field = vercel.crons.find((cron) => cron.path === "/api/cron/tick")?.schedule.split(/\s+/)[0] ?? "";
  const match = /^(\d+)-(\d+)\/(\d+)$/.exec(field);
  if (!match) throw new Error(`the tick cron's minutes are not a stepped range: ${field}`);
  const minutes: number[] = [];
  for (let minute = Number(match[1]); minute <= Number(match[2]); minute += Number(match[3])) minutes.push(minute);
  return minutes;
})();
const FIRST = CRON_MINUTES[0] as number;

let db: Db;
/** When the pass being played began, and how the clock moves as its runs end. */
let passStartedAt = HOUR0;
let clockAtRunEnd: () => number = () => passStartedAt + RUN_TAKES_MS;

beforeAll(async () => {
  process.env.X402_MOCK = "1";
  process.env.LLM_MOCK = "1";
  db = await setupTestDb();
  await seedKnownTokens();
});

beforeEach(async () => {
  resetPriceCache();
  // The scripted model buys a token, and the paper executor needs a quote and a price.
  const price = 0.0000027;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    if (url.includes("/ultra/v1/order")) {
      const amount = Number(new URL(url).searchParams.get("amount"));
      return json({ requestId: "req", transaction: null, inAmount: String(amount), outAmount: String(Math.round((amount / 1e6 / price) * 10 ** 5)) });
    }
    if (url.includes("api.jup.ag/price/v3")) return json({ DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263: { usdPrice: price } });
    return json([]);
  }) as typeof fetch;

  // One database for the file: every case starts with nothing due.
  await db.update(schema.agents).set({ status: "paused", nextRunAt: null });

  vi.useFakeTimers({ now: HOUR0, toFake: ["Date"] });
  clockAtRunEnd = () => passStartedAt + RUN_TAKES_MS;
  const flush = RunLogger.prototype.flush;
  vi.spyOn(RunLogger.prototype, "flush").mockImplementation(function (this: RunLogger) {
    // Never backwards: runs of one batch end side by side.
    vi.setSystemTime(Math.max(Date.now(), clockAtRunEnd()));
    return flush.call(this);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

/** An active agent on `intervalMinutes`, due since before the hour began. */
async function dueAgent(intervalMinutes: number): Promise<string> {
  const { agentId } = await seedAgent(db, { config: { dataSources: [], chains: ["solana"], schedule: { intervalMinutes } } });
  await db.update(schema.agents).set({ nextRunAt: new Date(HOUR0 - MINUTE) }).where(eq(schema.agents.id, agentId));
  return agentId;
}

/** One cron pass that began at `startedAt`, called as `/api/cron/tick` calls the scheduler. */
async function pass(startedAt: number, limit = 5): Promise<TickResult> {
  passStartedAt = startedAt;
  vi.setSystemTime(startedAt);
  const invocationStartedAt = Date.now();
  return tickDueAgents(limit, new Date(), { invocationStartedAt });
}

const agentRow = async (agentId: string) => (await db.select().from(schema.agents).where(eq(schema.agents.id, agentId)))[0];
const runsOf = (agentId: string) => db.select().from(schema.agentRuns).where(eq(schema.agentRuns.agentId, agentId));

describe("an hour of the tick cron", () => {
  it("runs 15, 5, 30 and 60 minute agents exactly 4, 12, 2 and 1 times, each run taking 40 seconds", async () => {
    const intervals = [15, 5, 30, 60];
    const agents = new Map<number, string>();
    for (const minutes of intervals) agents.set(minutes, await dueAgent(minutes));
    const ranOn = new Map<number, number[]>(intervals.map((minutes) => [minutes, []]));

    // Every pass of the hour, and the first of the next.
    for (const minute of [...CRON_MINUTES, 60 + FIRST]) {
      const startedAt = HOUR0 + minute * MINUTE;
      const result = await pass(startedAt);
      for (const [minutes, agentId] of agents) {
        const mine = result.results.find((run) => run.agentId === agentId);
        if (!mine) continue;
        expect(mine.status, `every ${minutes} min at :${minute}`).toBe("succeeded");
        ranOn.get(minutes)?.push(minute);
        const row = await agentRow(agentId);
        // It finished forty seconds into the pass, and that moved nothing.
        expect(row?.lastRunAt).toEqual(new Date(startedAt + RUN_TAKES_MS));
        expect(row?.nextRunAt).toEqual(new Date(startedAt + minutes * MINUTE - SCHEDULE_GRACE_MS));
      }
    }

    const every = (minutes: number) => [...CRON_MINUTES, 60 + FIRST].filter((minute) => (minute - FIRST) % minutes === 0);
    for (const minutes of intervals) expect(ranOn.get(minutes), `every ${minutes} min`).toEqual(every(minutes));
    // In the hour itself: what the schedule says, no more and no fewer.
    const inTheHour = (minutes: number) => (ranOn.get(minutes) ?? []).filter((minute) => minute < 60).length;
    expect(intervals.map(inTheHour)).toEqual([4, 12, 2, 1]);

    // One run row for each, all of them finished, none refused or left behind.
    for (const [minutes, agentId] of agents) {
      const rows = await runsOf(agentId);
      expect(rows.map((row) => row.status), `every ${minutes} min`).toEqual(every(minutes).map(() => "succeeded"));
    }
  }, 120_000);

  it("drops no pass when the cron fires 59 seconds into one minute and on the second in the next", async () => {
    const quarter = await dueAgent(15);
    const five = await dueAgent(5);
    const ranOn = { quarter: [] as number[], five: [] as number[] };

    // Late, on time, late, … so every pass that runs an agent is followed, one interval
    // on, by a pass that began as much earlier in its minute as it can; and the reverse.
    const passesPlayed = [...CRON_MINUTES, 60 + FIRST];
    for (const [index, minute] of passesPlayed.entries()) {
      const result = await pass(HOUR0 + minute * MINUTE + (index % 2 === 0 ? 59 * SECOND : 0));
      for (const run of result.results) {
        expect(run.status).toBe("succeeded");
        if (run.agentId === quarter) ranOn.quarter.push(index);
        if (run.agentId === five) ranOn.five.push(index);
      }
    }

    expect(ranOn.five).toEqual(passesPlayed.map((_, index) => index));
    expect(ranOn.quarter).toEqual([0, 3, 6, 9, 12]);
  }, 120_000);

  it("counts an agent that waited for the second batch from when the pass began, not from its own late start", async () => {
    // Seven agents and room for ten: five run at once, two wait for those to end. Here
    // each run that ends moves the clock on forty seconds, so the first batch is over 200
    // seconds into the pass and the last two start then.
    const agents: string[] = [];
    for (let i = 0; i < 7; i += 1) agents.push(await dueAgent(15));
    let ended = 0;
    clockAtRunEnd = () => passStartedAt + (ended += 1) * RUN_TAKES_MS;

    const startedAt = HOUR0 + FIRST * MINUTE;
    const first = await pass(startedAt, 10);
    expect(first.results.map((run) => run.status)).toEqual(agents.map(() => "succeeded"));

    const rows = await Promise.all(agents.map(agentRow));
    const startedLate = (await Promise.all(agents.map(runsOf))).map((runs) => (runs[0]?.startedAt?.getTime() ?? 0) - startedAt);
    expect(startedLate.filter((late) => late >= 5 * RUN_TAKES_MS)).toHaveLength(2);
    expect(Math.max(...rows.map((row) => (row?.lastRunAt?.getTime() ?? 0) - startedAt))).toBe(7 * RUN_TAKES_MS);
    // All seven are due for the same pass, fifteen minutes on.
    for (const row of rows) expect(row?.nextRunAt).toEqual(new Date(startedAt + 15 * MINUTE - SCHEDULE_GRACE_MS));

    ended = 0;
    expect((await pass(startedAt + 10 * MINUTE, 10)).due).toBe(0);
    const again = await pass(startedAt + 15 * MINUTE, 10);
    expect(again.results.map((run) => run.agentId).sort()).toEqual([...agents].sort());
    expect(again.results.every((run) => run.status === "succeeded")).toBe(true);
  }, 120_000);

  it("leaves an agent the pass had no slot for due, and counts it from the pass that runs it", async () => {
    const agents: string[] = [];
    for (let i = 0; i < 3; i += 1) agents.push(await dueAgent(15));

    // Room for two.
    const startedAt = HOUR0 + FIRST * MINUTE;
    const first = await pass(startedAt, 2);
    const ran = first.results.map((run) => run.agentId);
    expect(ran).toHaveLength(2);
    const [waiting] = agents.filter((agentId) => !ran.includes(agentId));
    expect((await agentRow(waiting as string))?.nextRunAt).toEqual(new Date(HOUR0 - MINUTE));
    expect(await runsOf(waiting as string)).toHaveLength(0);

    // The next pass runs it, alone: the other two are not due again yet.
    const second = await pass(startedAt + 5 * MINUTE, 2);
    expect(second.results.map((run) => run.agentId)).toEqual([waiting]);
    expect((await agentRow(waiting as string))?.nextRunAt).toEqual(new Date(startedAt + 20 * MINUTE - SCHEDULE_GRACE_MS));
  }, 120_000);

  /**
   * Every agent run by one pass is due again at the same instant, so with more agents due
   * than a pass has slots the scheduler chooses among equals. Chosen by id, the three
   * lowest ids ran on every pass and the other four on every other one, for good: half
   * their schedule, which is what the grid was built to end.
   */
  it("does not make the same agents wait every time when more are due than a pass can run", async () => {
    // Seven owners, one five-minute agent each, and room for five.
    const agents: string[] = [];
    for (let i = 0; i < 7; i += 1) agents.push(await dueAgent(5));
    const ranOn = new Map<string, number[]>(agents.map((agentId) => [agentId, []]));
    const waited = new Set<string>();

    // Two hours of passes.
    const played = [0, 1].flatMap((hour) => CRON_MINUTES.map((minute) => hour * 60 + minute));
    for (const [index, minute] of played.entries()) {
      const result = await pass(HOUR0 + minute * MINUTE);
      expect(result.results.map((run) => run.status)).toEqual(Array.from({ length: 5 }, () => "succeeded"));
      const ran = new Set(result.results.map((run) => run.agentId));
      for (const agentId of agents) {
        if (ran.has(agentId)) ranOn.get(agentId)?.push(index);
        else waited.add(agentId);
      }
    }

    // Whoever waits goes first in the next pass: nobody waits twice running.
    for (const agentId of agents) {
      const passesRan = ranOn.get(agentId) ?? [];
      expect(passesRan[0]).toBeLessThanOrEqual(1);
      for (const [i, index] of passesRan.entries()) if (i > 0) expect(index - (passesRan[i - 1] as number)).toBeLessThanOrEqual(2);
    }
    // And the wait moves around. By id it fell on the same four agents every time; here
    // each agent is passed over with two chances in five whenever it is among the equals,
    // so three of the seven never once waiting in two hours does not happen.
    expect(waited.size).toBeGreaterThan(4);
  }, 240_000);
});
