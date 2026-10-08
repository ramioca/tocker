/**
 * `schedule.skipWhenFull` in the run loop: a scheduled run of an agent with no room to buy
 * is not started. No run row, no model step, no data bought, nothing paid, and the agent is
 * due again at its next scheduled time. Off by default, never for a run started by hand,
 * and never on a book that could not be read.
 *
 * The agent, its book, the risk guard and the run loop are the real code on PGlite, with
 * the scripted model and the data providers in their mock mode. `getPortfolio` is the real
 * one too, wrapped only so a test can make one read fail.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { Db } from "@/db";
import * as schema from "@/db/schema";
import { applyFill } from "@/lib/trading/positions";
import { seedKnownTokens, tokenId, USDC_SOLANA } from "@/lib/trading/tokens";
import { DEFAULT_AGENT_CONFIG } from "./config";
import { RUN_SKIPPED_NO_ROOM } from "./run-gate";
import { SCHEDULE_GRACE_MS, nextRunTime } from "./schedule";
import { attachLlmKey, seedAgent, setupTestDb, type SeedConfigOverrides } from "./test-support";

/** How the next reads of a book go wrong, for the tests that need one to. */
const reads = vi.hoisted(() => ({ throwNext: 0, unreadNext: 0, count: 0 }));

vi.mock("./portfolio", async (importOriginal) => {
  const real = await importOriginal<typeof import("./portfolio")>();
  return {
    ...real,
    getPortfolio: async (agentId: string, options?: { forBuy?: boolean }) => {
      reads.count += 1;
      if (reads.throwNext > 0) {
        reads.throwNext -= 1;
        throw new Error("the wallet did not answer");
      }
      const book = await real.getPortfolio(agentId, options);
      if (reads.unreadNext > 0) {
        reads.unreadNext -= 1;
        return { ...book, cashReadFailed: true };
      }
      return book;
    },
  };
});

const { runAgent, startRun } = await import("./run");
const { findDueAgents, tickDueAgents } = await import("./scheduler");

const BONK_MINT = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const BONK = tokenId("solana", BONK_MINT);
const USDC = tokenId("solana", USDC_SOLANA);
const MINUTE = 60_000;

let db: Db;

beforeAll(async () => {
  process.env.X402_MOCK = "1";
  process.env.LLM_MOCK = "1";
  db = await setupTestDb();
  await seedKnownTokens();
}, 120_000);

beforeEach(() => {
  reads.throwNext = 0;
  reads.unreadNext = 0;
  reads.count = 0;
  vi.stubEnv("PLATFORM_FEE_BPS", "50");
  // Prices and quotes, offline and the same every time.
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/ultra/v1/order")) {
      const amount = Number(new URL(url).searchParams.get("amount"));
      const out = (amount / 1e6 / 0.0000027) * 10 ** 5;
      return new Response(JSON.stringify({ requestId: "req", transaction: null, inAmount: String(amount), outAmount: String(Math.round(out)) }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (url.includes("api.jup.ag/price/v3")) {
      return new Response(JSON.stringify({ [BONK_MINT]: { usdPrice: 0.0000027 } }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const SKIP_ON = { intervalMinutes: 15, skipWhenFull: true };

/** A paper agent that already holds `heldUsd` of BONK, bought earlier today or before. */
async function agentHolding(config: SeedConfigOverrides, options: { heldUsd?: number; boughtToday?: boolean; paperStartingUsd?: string } = {}) {
  const seeded = await seedAgent(db, {
    config: { chains: ["solana"], dataSources: [], ...config },
    ...(options.paperStartingUsd ? { paperStartingUsd: options.paperStartingUsd } : {}),
  });
  const heldUsd = options.heldUsd ?? 0;
  if (heldUsd > 0) {
    const amountToken = heldUsd / 0.0000027;
    const at = options.boughtToday === false ? new Date(Date.now() - 3 * 24 * 60 * MINUTE) : new Date();
    await db.insert(schema.trades).values({
      id: nanoid(),
      agentId: seeded.agentId,
      ownerId: seeded.userId,
      chain: "solana",
      side: "buy",
      tokenId: BONK,
      quoteTokenId: USDC,
      amountToken: String(amountToken),
      amountUsd: heldUsd.toFixed(6),
      priceUsd: "0.0000027",
      feeUsd: "0",
      status: "filled",
      isPaper: true,
      createdAt: at,
      filledAt: at,
    });
    await applyFill(seeded.agentId, BONK, { side: "buy", amountToken, amountUsd: heldUsd, feeUsd: 0, decimals: 5 });
  }
  return seeded;
}

const agentRow = async (agentId: string) => (await db.select().from(schema.agents).where(eq(schema.agents.id, agentId)))[0];
const runsOf = (agentId: string) => db.select().from(schema.agentRuns).where(eq(schema.agentRuns.agentId, agentId));

/** Everything a started run leaves behind, counted. A skipped one leaves none of it. */
async function tracesOf(agentId: string) {
  const runs = await runsOf(agentId);
  const steps = runs.length === 0 ? [] : await db.select().from(schema.agentRunSteps).where(eq(schema.agentRunSteps.runId, runs[0].id));
  return {
    runs: runs.length,
    steps: steps.length,
    dataPayments: (await db.select().from(schema.x402Payments).where(eq(schema.x402Payments.agentId, agentId))).length,
    thinkingPayments: (await db.select().from(schema.inferencePayments).where(eq(schema.inferencePayments.agentId, agentId))).length,
    trades: (await db.select().from(schema.trades).where(eq(schema.trades.agentId, agentId))).length,
    posts: (await db.select().from(schema.posts).where(eq(schema.posts.agentId, agentId))).length,
    snapshots: (await db.select().from(schema.equitySnapshots).where(eq(schema.equitySnapshots.agentId, agentId))).length,
  };
}

describe("a scheduled run of an agent with no room to buy", () => {
  it("is not started when the switch is on: no run row, no step, no data bought, nothing paid", async () => {
    // One position allowed, one held.
    const { agentId } = await agentHolding({ schedule: SKIP_ON, risk: { maxOpenPositions: 1 } }, { heldUsd: 50, boughtToday: false });
    const before = await tracesOf(agentId);
    expect(before).toMatchObject({ runs: 0, trades: 1 });

    const began = Date.now() - 20_000;
    const result = await runAgent({ agentId, trigger: "schedule", invocationStartedAt: began });
    expect(result).toEqual({ runId: "", status: "skipped", error: RUN_SKIPPED_NO_ROOM, noRoom: "position_limit" });

    // Nothing was written for it anywhere.
    expect(await tracesOf(agentId)).toEqual(before);
    // The book was read once, to ask the question, and no run read it after.
    expect(reads.count).toBe(1);
  });

  it("is due again at its next scheduled time, by the rule every run ends on, and has not run", async () => {
    const { agentId } = await agentHolding({ schedule: SKIP_ON, risk: { maxOpenPositions: 1 } }, { heldUsd: 50, boughtToday: false });
    const due = new Date(Date.now() - MINUTE);
    await db.update(schema.agents).set({ nextRunAt: due }).where(eq(schema.agents.id, agentId));

    const began = Date.now() - 20_000;
    expect((await runAgent({ agentId, trigger: "schedule", invocationStartedAt: began })).status).toBe("skipped");

    const row = await agentRow(agentId);
    expect(row?.nextRunAt).toEqual(nextRunTime(15, began));
    expect(row?.nextRunAt).toEqual(new Date(began + 15 * MINUTE - SCHEDULE_GRACE_MS));
    // No run happened, so nothing says one did.
    expect(row?.lastRunAt).toBeNull();
    expect(row?.status).toBe("active");
  });

  it("is off by default: the same agent without the switch runs as it always did", async () => {
    for (const schedule of [{ intervalMinutes: 15 }, { intervalMinutes: 15, skipWhenFull: false }]) {
      const { agentId } = await agentHolding({ schedule, risk: { maxOpenPositions: 1 } }, { heldUsd: 50, boughtToday: false });
      reads.count = 0;
      const result = await runAgent({ agentId, trigger: "schedule" });
      expect(result.status).toBe("succeeded");
      expect(result.noRoom).toBeUndefined();
      expect(await runsOf(agentId)).toHaveLength(1);
      expect((await agentRow(agentId))?.lastRunAt).not.toBeNull();
    }
  });

  it("only ever skips a scheduled run: Run now starts one, by either door", async () => {
    const { agentId } = await agentHolding({ schedule: SKIP_ON, risk: { maxOpenPositions: 1 } }, { heldUsd: 50, boughtToday: false });
    const byHand = await runAgent({ agentId, trigger: "manual" });
    expect(byHand.status).toBe("succeeded");
    expect(byHand.runId).not.toBe("");
    expect(await runsOf(agentId)).toHaveLength(1);

    const other = await agentHolding({ schedule: SKIP_ON, risk: { maxOpenPositions: 1 } }, { heldUsd: 50, boughtToday: false });
    const { runId } = await startRun({ agentId: other.agentId, trigger: "manual" });
    expect(runId).not.toBe("");
    // A webhook is somebody asking for a run, like a press of Run now.
    const hooked = await agentHolding({ schedule: SKIP_ON, risk: { maxOpenPositions: 1 } }, { heldUsd: 50, boughtToday: false });
    expect((await runAgent({ agentId: hooked.agentId, trigger: "webhook" })).status).toBe("succeeded");
  });

  /**
   * The switch's promise is that the automatic exits still fire. With every exit rule
   * off there is none to fire: a run is the only thing that sells, and a full agent whose
   * runs were skipped would stay full, and so stay skipped, with nobody watching the book.
   */
  it("is started all the same when every exit rule is off and it holds a position", async () => {
    const noExits = {
      stopLossPct: null,
      takeProfitPct: null,
      trailingStopPct: null,
      maxHoldHours: null,
      exitScoreBelow: null,
      exitOnLiquidityDropPct: null,
    };
    const { agentId } = await agentHolding({ schedule: SKIP_ON, risk: { maxOpenPositions: 1, ...noExits } }, { heldUsd: 50, boughtToday: false });
    const result = await runAgent({ agentId, trigger: "schedule" });
    expect(result.status).toBe("succeeded");
    expect(result.noRoom).toBeUndefined();
    expect(await runsOf(agentId)).toHaveLength(1);
    expect((await agentRow(agentId))?.lastRunAt).not.toBeNull();

    // Holding nothing, the same settings leave nothing for a run to sell: it is skipped.
    const flat = await agentHolding({ schedule: SKIP_ON, risk: { cashReserveUsd: 5, ...noExits } }, { paperStartingUsd: "5" });
    expect(await runAgent({ agentId: flat.agentId, trigger: "schedule" })).toMatchObject({ status: "skipped", noRoom: "ticket" });
    expect(await runsOf(flat.agentId)).toHaveLength(0);
  });

  it("skips for want of cash after the reserve", async () => {
    // $5 of paper cash, all of it reserved: nothing to buy with.
    const { agentId } = await agentHolding({ schedule: SKIP_ON, risk: { cashReserveUsd: 5 } }, { paperStartingUsd: "5" });
    const result = await runAgent({ agentId, trigger: "schedule" });
    expect(result).toMatchObject({ runId: "", status: "skipped", noRoom: "ticket" });
    expect(await runsOf(agentId)).toHaveLength(0);
    // With cash above the reserve it runs.
    const funded = await agentHolding({ schedule: SKIP_ON, risk: { cashReserveUsd: 5 } }, { paperStartingUsd: "500" });
    expect((await runAgent({ agentId: funded.agentId, trigger: "schedule" })).status).toBe("succeeded");
  });

  it("skips once the day's buys are spent", async () => {
    const { agentId } = await agentHolding({ schedule: SKIP_ON, risk: { maxDailyTrades: 1 } }, { heldUsd: 50, boughtToday: true });
    const result = await runAgent({ agentId, trigger: "schedule" });
    expect(result).toMatchObject({ runId: "", status: "skipped", noRoom: "daily_limit" });
    expect(await runsOf(agentId)).toHaveLength(0);
    // The same holding bought on an earlier day leaves today's buys unspent.
    const rested = await agentHolding({ schedule: SKIP_ON, risk: { maxDailyTrades: 1 } }, { heldUsd: 50, boughtToday: false });
    expect((await runAgent({ agentId: rested.agentId, trigger: "schedule" })).status).toBe("succeeded");
  });

  it("does not skip an agent that has room", async () => {
    const { agentId } = await agentHolding({ schedule: SKIP_ON, risk: { maxOpenPositions: 3, cashReserveUsd: 5 } }, { heldUsd: 50, boughtToday: false });
    const result = await runAgent({ agentId, trigger: "schedule" });
    expect(result.status).toBe("succeeded");
    expect(await runsOf(agentId)).toHaveLength(1);
  });

  it("goes ahead as normal when the book cannot be read", async () => {
    const full = { schedule: SKIP_ON, risk: { maxOpenPositions: 1 } };
    // The read throws: the database or a wallet did not answer.
    const thrown = await agentHolding(full, { heldUsd: 50, boughtToday: false });
    reads.throwNext = 1;
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect((await runAgent({ agentId: thrown.agentId, trigger: "schedule" })).status).toBe("succeeded");
    expect(errors.mock.calls.some(([line]) => String(line).includes("room to buy could not be checked"))).toBe(true);
    errors.mockRestore();
    expect(await runsOf(thrown.agentId)).toHaveLength(1);

    // The read comes back, but a wallet in it did not: the cash is known to be too low.
    const unread = await agentHolding(full, { heldUsd: 50, boughtToday: false });
    reads.unreadNext = 1;
    expect((await runAgent({ agentId: unread.agentId, trigger: "schedule" })).status).toBe("succeeded");
    expect(await runsOf(unread.agentId)).toHaveLength(1);

    // And read properly, the same agent is skipped.
    const read = await agentHolding(full, { heldUsd: 50, boughtToday: false });
    expect((await runAgent({ agentId: read.agentId, trigger: "schedule" })).status).toBe("skipped");
  });

  it("keeps a schedule saved a moment before the skip", async () => {
    const { agentId } = await agentHolding({ schedule: SKIP_ON, risk: { maxOpenPositions: 1 } }, { heldUsd: 50, boughtToday: false });
    const began = Date.now();
    expect((await runAgent({ agentId, trigger: "schedule", invocationStartedAt: began })).status).toBe("skipped");
    expect((await agentRow(agentId))?.nextRunAt).toEqual(nextRunTime(15, began));
    // Set to manual, the agent has no next run to be given.
    const row = await agentRow(agentId);
    await db
      .update(schema.agents)
      .set({ config: { ...row!.config, schedule: { intervalMinutes: 0, skipWhenFull: true } } })
      .where(eq(schema.agents.id, agentId));
    expect((await runAgent({ agentId, trigger: "schedule" })).status).toBe("skipped");
    expect((await agentRow(agentId))?.nextRunAt).toBeNull();
  });
});

describe("the scheduler's pass over an agent with no room to buy", () => {
  it("picks it when it is due, starts nothing, and does not pick it again until its next time", async () => {
    const seeded = await agentHolding({ schedule: SKIP_ON, risk: { maxOpenPositions: 1 } }, { heldUsd: 50, boughtToday: false });
    await attachLlmKey(db, seeded);
    const now = new Date();
    await db.update(schema.agents).set({ nextRunAt: new Date(now.getTime() - MINUTE) }).where(eq(schema.agents.id, seeded.agentId));

    const began = now.getTime();
    const pass = await tickDueAgents(5, now, { invocationStartedAt: began });
    const mine = pass.results.find((result) => result.agentId === seeded.agentId);
    expect(mine).toEqual({ agentId: seeded.agentId, runId: "", status: "skipped", error: RUN_SKIPPED_NO_ROOM, noRoom: "position_limit" });
    expect(await runsOf(seeded.agentId)).toHaveLength(0);
    expect((await agentRow(seeded.agentId))?.nextRunAt).toEqual(nextRunTime(15, began));

    // Five and ten minutes on it is not due, so no pass looks at it. (Asked of the
    // scheduler's own query, with room for every agent this file has made.)
    expect(await findDueAgents(50, new Date(began + 5 * MINUTE))).not.toContain(seeded.agentId);
    expect(await findDueAgents(50, new Date(began + 10 * MINUTE))).not.toContain(seeded.agentId);
    // One interval on it is due again, and is skipped again while nothing has changed.
    const later = began + 15 * MINUTE;
    expect(await findDueAgents(50, new Date(later))).toContain(seeded.agentId);
    expect(await runAgent({ agentId: seeded.agentId, trigger: "schedule" })).toMatchObject({
      status: "skipped",
      noRoom: "position_limit",
    });
    expect(await runsOf(seeded.agentId)).toHaveLength(0);
  });

  it("leaves the default config with the switch off", () => {
    expect(DEFAULT_AGENT_CONFIG.schedule.skipWhenFull).toBe(false);
  });
});
