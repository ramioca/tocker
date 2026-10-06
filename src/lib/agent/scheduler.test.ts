import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import type { Db } from "@/db";
import * as schema from "@/db/schema";
import { countPausedDueAgents } from "@/lib/security/kill-switch";
import { resetPriceCache } from "@/lib/trading/prices";
import { seedKnownTokens, tokenId } from "@/lib/trading/tokens";
import { findDueAgents, findGuardableAgents, spreadAcrossOwners, tickMarks } from "./scheduler";
import { attachLlmKey, seedAgent, setupTestDb } from "./test-support";

const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const BONK_ID = tokenId("solana", BONK);

let db: Db;

beforeAll(async () => {
  process.env.X402_MOCK = "1";
  db = await setupTestDb();
  await seedKnownTokens();
});

beforeEach(() => {
  resetPriceCache();
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("api.jup.ag/price/v3")) {
      return new Response(JSON.stringify({ [BONK]: { usdPrice: 0.0000027 } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response("{}", { status: 404, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
});

describe("tickMarks — the loop between thoughts", () => {
  it("guards every holder, paused ones included, and snapshots every active agent", async () => {
    const holder = await seedAgent(db, {
      config: { chains: ["solana"], risk: { stopLossPct: 15, exitScoreBelow: null, exitOnLiquidityDropPct: null } },
    });
    await db.insert(schema.positions).values({
      agentId: holder.agentId,
      tokenId: BONK_ID,
      amountToken: "10000000.000000000000",
      avgCostUsd: "0.000003600000", // −25% at the stubbed mark → through a 15% stop
      openedAt: new Date(Date.now() - 3_600_000),
      peakPriceUsd: "0.000003600000",
      entryScore: "74.00",
      entryLiquidityUsd: "310000.00",
    });

    const flat = await seedAgent(db, { config: { chains: ["solana"] } });

    // Pausing stops an agent waking up. It must not switch its stop loss off.
    const paused = await seedAgent(db, {
      config: { chains: ["solana"], risk: { stopLossPct: 15, exitScoreBelow: null, exitOnLiquidityDropPct: null } },
    });
    await db.update(schema.agents).set({ status: "paused" }).where(eq(schema.agents.id, paused.agentId));
    await db.insert(schema.positions).values({
      agentId: paused.agentId,
      tokenId: BONK_ID,
      amountToken: "10000000.000000000000",
      avgCostUsd: "0.000003600000",
      openedAt: new Date(Date.now() - 3_600_000),
    });

    // A paused agent with nothing to guard is left alone.
    const pausedFlat = await seedAgent(db, { config: { chains: ["solana"] } });
    await db.update(schema.agents).set({ status: "paused" }).where(eq(schema.agents.id, pausedFlat.agentId));

    const guardable = await findGuardableAgents();
    expect(guardable.holding).toContain(holder.agentId);
    expect(guardable.holding).toContain(paused.agentId);
    expect(guardable.flat).toContain(flat.agentId);
    expect(guardable.flat).not.toContain(pausedFlat.agentId);
    expect(guardable.holding).not.toContain(pausedFlat.agentId);

    // The cap trims flat agents and never a book, wherever the ids happen to sort.
    const capped = await findGuardableAgents(2);
    expect(capped.holding.sort()).toEqual([holder.agentId, paused.agentId].sort());
    expect(capped.flat).toEqual([]);

    const result = await tickMarks();
    expect(result.active).toBe(3);
    expect(result.guarded).toBe(2);
    expect(result.exits).toBe(2);
    expect(result.snapshots).toBe(3);

    // Both holders were exited through their stop, the paused one included.
    for (const agentId of [holder.agentId, paused.agentId]) {
      const trades = await db.select().from(schema.trades).where(eq(schema.trades.agentId, agentId));
      expect(trades).toHaveLength(1);
      expect(trades[0]?.origin).toBe("guardian");
      expect(trades[0]?.exitReason).toBe("stop_loss");
    }

    // Every agent the pass looked after has an equity point; the paused flat one has none.
    for (const agentId of [holder.agentId, flat.agentId, paused.agentId]) {
      const snaps = await db
        .select()
        .from(schema.equitySnapshots)
        .where(eq(schema.equitySnapshots.agentId, agentId));
      expect(snaps).toHaveLength(1);
    }
    expect(
      await db.select().from(schema.equitySnapshots).where(eq(schema.equitySnapshots.agentId, pausedFlat.agentId)),
    ).toHaveLength(0);
  });

  /**
   * An exit that fires while no provider can read the token still fills (a scoring
   * outage never traps a position), and its record says the token was not scored. It
   * used to freeze the outage's zero onto the fill, published as "0 · Avoid at exit".
   */
  it("fills an exit during a scoring outage and freezes no score onto it", async () => {
    // A mint no provider fixture knows: every source comes back empty, as in an outage.
    const UNREAD = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
    const unreadId = tokenId("solana", UNREAD);
    await db
      .insert(schema.tokens)
      .values({ id: unreadId, chain: "solana", address: UNREAD, symbol: "UNREAD", name: "Unread", decimals: 6 })
      .onConflictDoNothing();
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      if (String(input).includes("api.jup.ag/price/v3")) {
        return new Response(JSON.stringify({ [UNREAD]: { usdPrice: 0.75 } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("{}", { status: 404, headers: { "content-type": "application/json" } });
    }) as typeof fetch;

    // `exitScoreBelow` is on, so the pass rescores the holding; the stop is what fires.
    const holder = await seedAgent(db, {
      config: { chains: ["solana"], risk: { stopLossPct: 15, exitScoreBelow: 40, exitOnLiquidityDropPct: null } },
    });
    await db.insert(schema.positions).values({
      agentId: holder.agentId,
      tokenId: unreadId,
      amountToken: "100.000000000000",
      avgCostUsd: "1.000000000000", // −25% at the stubbed mark → through a 15% stop
      openedAt: new Date(Date.now() - 3_600_000),
      peakPriceUsd: "1.000000000000",
      entryScore: "74.00",
      entryLiquidityUsd: "310000.00",
    });

    const result = await tickMarks();
    const mine = result.results.find((r) => r.agentId === holder.agentId);
    expect(mine?.rescored).toBe(1);
    expect(mine?.exits.map((e) => [e.reason, e.status])).toEqual([["stop_loss", "filled"]]);

    const [trade] = await db.select().from(schema.trades).where(eq(schema.trades.agentId, holder.agentId));
    expect(trade?.status).toBe("filled");
    expect(trade?.exitReason).toBe("stop_loss");
    expect(trade?.scoreSnapshot).toBeNull();

    // Leave nothing behind for the cases below.
    await db.update(schema.agents).set({ status: "paused" }).where(eq(schema.agents.id, holder.agentId));
  });

  it("takes live books before paper ones when the cap bites", async () => {
    const position = (agentId: string) => ({
      agentId,
      tokenId: BONK_ID,
      amountToken: "1000.000000000000",
      avgCostUsd: "0.000002700000",
      openedAt: new Date(Date.now() - 3_600_000),
    });
    const paper = [await seedAgent(db, { config: { chains: ["solana"] } }), await seedAgent(db, { config: { chains: ["solana"] } })];
    const live = await seedAgent(db, { config: { chains: ["solana"] } });
    await db.update(schema.agents).set({ mode: "live" }).where(eq(schema.agents.id, live.agentId));
    await db.insert(schema.positions).values([...paper.map((a) => position(a.agentId)), position(live.agentId)]);

    expect((await findGuardableAgents(1)).holding).toEqual([live.agentId]);

    // Leave nothing behind for the cases below.
    await db.delete(schema.positions);
    await db.update(schema.agents).set({ mode: "paper" }).where(eq(schema.agents.id, live.agentId));
  });

  it("is a no-op when nothing is active", async () => {
    await db.update(schema.agents).set({ status: "paused" });
    const result = await tickMarks();
    expect(result).toMatchObject({ active: 0, guarded: 0, exits: 0, snapshots: 0 });
    expect(result.results).toHaveLength(0);
  });
});

/**
 * A tick has a handful of slots and every agent on the platform shares them. These are
 * the two rules that decide who gets one: an agent that cannot think gets none, and one
 * account's many agents wait behind each other rather than in front of everybody else.
 */
describe("findDueAgents — who gets a slot in the tick", () => {
  beforeEach(async () => {
    // One database for the whole file: start every case with nothing due.
    await db.update(schema.agents).set({ status: "paused", nextRunAt: null });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  /** An active agent that became due `minutesAgo`, with a key unless told otherwise. */
  async function dueAgent(minutesAgo: number, options: { ownerId?: string; key?: boolean } = {}) {
    const seeded = await seedAgent(db);
    const ownerId = options.ownerId ?? seeded.userId;
    await db
      .update(schema.agents)
      .set({ ownerId, status: "active", nextRunAt: new Date(Date.now() - minutesAgo * 60_000) })
      .where(eq(schema.agents.id, seeded.agentId));
    if (options.key !== false) await attachLlmKey(db, { userId: ownerId, agentId: seeded.agentId });
    return { ...seeded, userId: ownerId };
  }

  it("gives no slot to an agent without an LLM key, however long it has been due", async () => {
    vi.stubEnv("LLM_MOCK", "");
    await dueAgent(120, { key: false });
    await dueAgent(90, { key: false });
    const keyed = await dueAgent(1);

    // Oldest first alone would hand both slots to runs that fail in a millisecond.
    expect(await findDueAgents(2)).toEqual([keyed.agentId]);

    // An agent whose key was deleted is the same case: the column goes back to null.
    await db.delete(schema.llmKeys).where(eq(schema.llmKeys.userId, keyed.userId));
    expect(await findDueAgents(2)).toEqual([]);
  });

  it("still wakes a keyless agent under the scripted model, which needs no key", async () => {
    vi.stubEnv("LLM_MOCK", "1");
    const older = await dueAgent(10, { key: false });
    const newer = await dueAgent(5, { key: false });

    expect(await findDueAgents(5)).toEqual([older.agentId, newer.agentId]);
  });

  it("gives every owner one slot before any owner gets a second", async () => {
    vi.stubEnv("LLM_MOCK", "");
    // One account with six agents, all due longer than anyone else's.
    const first = await dueAgent(60);
    const crowd = [first];
    for (let i = 1; i < 6; i += 1) crowd.push(await dueAgent(60 - i, { ownerId: first.userId }));
    const others = [await dueAgent(3), await dueAgent(2), await dueAgent(1)];

    // Oldest first alone: all four slots to the one account, and the other three wait.
    expect(await findDueAgents(4)).toEqual([crowd[0]?.agentId, ...others.map((a) => a.agentId)]);

    // A slot left over goes back to the oldest agent still waiting.
    expect(await findDueAgents(5)).toEqual([crowd[0]?.agentId, ...others.map((a) => a.agentId), crowd[1]?.agentId]);

    // And with room for everyone, everyone runs.
    expect((await findDueAgents(20)).sort()).toEqual([...crowd, ...others].map((a) => a.agentId).sort());
  });

  it("does not count a keyless agent as skipped by the kill switch either", async () => {
    vi.stubEnv("LLM_MOCK", "");
    const keyed = await dueAgent(5);
    const keyless = await dueAgent(5, { key: false });
    for (const userId of [keyed.userId, keyless.userId]) {
      await db.insert(schema.userSecurity).values({ userId, tradingPaused: true, tradingPausedAt: new Date() });
    }

    expect(await findDueAgents(5)).toEqual([]);
    // The cron log reports what the switch held back: the one agent that would have run.
    expect(await countPausedDueAgents()).toBe(1);
  });
});

describe("spreadAcrossOwners", () => {
  const rows = [
    { id: "a1", ownerId: "A" },
    { id: "a2", ownerId: "A" },
    { id: "b1", ownerId: "B" },
    { id: "a3", ownerId: "A" },
    { id: "c1", ownerId: "C" },
  ];

  it("takes each owner's oldest first, then fills in the order given", () => {
    expect(spreadAcrossOwners(rows, 2)).toEqual(["a1", "b1"]);
    expect(spreadAcrossOwners(rows, 3)).toEqual(["a1", "b1", "c1"]);
    expect(spreadAcrossOwners(rows, 4)).toEqual(["a1", "b1", "c1", "a2"]);
    expect(spreadAcrossOwners(rows, 99)).toEqual(["a1", "b1", "c1", "a2", "a3"]);
  });

  /** Whoever has waited longest is never passed over, whatever else is due. */
  it("always takes the first row, and never more than the limit or anything twice", () => {
    expect(spreadAcrossOwners(rows, 1)).toEqual(["a1"]);
    expect(spreadAcrossOwners(rows, 0)).toEqual([]);
    expect(spreadAcrossOwners([], 5)).toEqual([]);
    const all = spreadAcrossOwners(rows, 99);
    expect(new Set(all).size).toBe(all.length);
  });
});
