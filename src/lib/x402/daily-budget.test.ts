import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { Db } from "@/db";
import * as schema from "@/db/schema";
import { seedAgent, setupTestDb } from "@/lib/agent/test-support";
import {
  DATA_SPEND_CARRYOVER,
  DEFAULT_OWNER_DAILY_DATA_USD,
  DEFAULT_PLATFORM_DAILY_DATA_USD,
  agentRealDataSpend24h,
  dailyCapCrossed,
  dailyDataCaps,
  realDataSpend24h,
} from "./daily-budget";

describe("dailyDataCaps", () => {
  it("uses the defaults when nothing is set", () => {
    expect(dailyDataCaps({})).toEqual({ ownerUsd: DEFAULT_OWNER_DAILY_DATA_USD, platformUsd: DEFAULT_PLATFORM_DAILY_DATA_USD });
    expect(dailyDataCaps({ X402_OWNER_DAILY_USD: "", X402_PLATFORM_DAILY_USD: "  " })).toEqual({
      ownerUsd: DEFAULT_OWNER_DAILY_DATA_USD,
      platformUsd: DEFAULT_PLATFORM_DAILY_DATA_USD,
    });
  });

  it("takes a number from the environment, zero included", () => {
    expect(dailyDataCaps({ X402_OWNER_DAILY_USD: "2.5", X402_PLATFORM_DAILY_USD: "40" })).toEqual({ ownerUsd: 2.5, platformUsd: 40 });
    expect(dailyDataCaps({ X402_OWNER_DAILY_USD: "0" }).ownerUsd).toBe(0);
  });

  /** A typo must never read as "no limit". */
  it("falls back to the default on anything that is not a non-negative number", () => {
    for (const raw of ["abc", "-1", "NaN", "Infinity", "1e999", "5 dollars"]) {
      expect(dailyDataCaps({ X402_OWNER_DAILY_USD: raw }).ownerUsd, raw).toBe(DEFAULT_OWNER_DAILY_DATA_USD);
      expect(dailyDataCaps({ X402_PLATFORM_DAILY_USD: raw }).platformUsd, raw).toBe(DEFAULT_PLATFORM_DAILY_DATA_USD);
    }
  });
});

describe("dailyCapCrossed", () => {
  const caps = { ownerUsd: 5, platformUsd: 100 };

  it("lets a payment through that lands on or under both ceilings", () => {
    expect(dailyCapCrossed({ ownerUsd: 0, platformUsd: 0 }, 0.25, caps)).toBeNull();
    expect(dailyCapCrossed({ ownerUsd: 4.75, platformUsd: 99.75 }, 0.25, caps)).toBeNull();
  });

  it("names the owner's ceiling first, then the platform's", () => {
    expect(dailyCapCrossed({ ownerUsd: 4.9, platformUsd: 10 }, 0.25, caps)).toBe("owner");
    expect(dailyCapCrossed({ ownerUsd: 1, platformUsd: 99.9 }, 0.25, caps)).toBe("platform");
    expect(dailyCapCrossed({ ownerUsd: 5, platformUsd: 100 }, 0.25, caps)).toBe("owner");
  });

  it("refuses everything when a ceiling is zero", () => {
    expect(dailyCapCrossed({ ownerUsd: 0, platformUsd: 0 }, 0.001, { ownerUsd: 0, platformUsd: 100 })).toBe("owner");
    expect(dailyCapCrossed({ ownerUsd: 0, platformUsd: 0 }, 0.001, { ownerUsd: 5, platformUsd: 0 })).toBe("platform");
  });
});

describe("realDataSpend24h", () => {
  let db: Db;

  beforeAll(async () => {
    db = await setupTestDb();
  });

  const payment = (agentId: string, amountUsd: string, over: Partial<typeof schema.x402Payments.$inferInsert> = {}) => ({
    id: nanoid(),
    agentId,
    sourceId: "x-search",
    url: "https://twitter.use.x402atlas.com/search",
    network: "eip155:8453",
    amountUsd,
    ...over,
  });

  it("adds up an owner's real spend across their agents, and everyone's, over the last day only", async () => {
    const before = await realDataSpend24h("nobody");

    const first = await seedAgent(db);
    const second = await seedAgent(db);
    // Both agents belong to the first owner.
    await db.update(schema.agents).set({ ownerId: first.userId }).where(eq(schema.agents.id, second.agentId));
    const stranger = await seedAgent(db);

    await db.insert(schema.x402Payments).values([
      payment(first.agentId, "1.000000"),
      payment(second.agentId, "0.500000"),
      // Not counted: a fixture, and one from before the window.
      payment(first.agentId, "9.000000", { simulated: true }),
      payment(first.agentId, "3.000000", { createdAt: new Date(Date.now() - 25 * 3_600_000) }),
      payment(stranger.agentId, "2.000000"),
    ]);

    const mine = await realDataSpend24h(first.agentId);
    expect(mine.ownerUsd).toBeCloseTo(1.5, 6);
    expect(mine.platformUsd - before.platformUsd).toBeCloseTo(3.5, 6);
    // Asked through the owner's other agent, the answer is the same.
    expect((await realDataSpend24h(second.agentId)).ownerUsd).toBeCloseTo(1.5, 6);
    expect((await realDataSpend24h(stranger.agentId)).ownerUsd).toBeCloseTo(2, 6);

    expect(await agentRealDataSpend24h(first.agentId)).toBeCloseTo(1, 6);
  });

  /** Payment rows go with the agent; what it spent today must not. */
  it("still counts what a deleted agent spent, through the carry-over audit row", async () => {
    const owner = await seedAgent(db);
    const doomed = await seedAgent(db);
    await db.update(schema.agents).set({ ownerId: owner.userId }).where(eq(schema.agents.id, doomed.agentId));
    await db.insert(schema.x402Payments).values(payment(doomed.agentId, "4.000000"));
    const platformBefore = (await realDataSpend24h(owner.agentId)).platformUsd;
    expect((await realDataSpend24h(owner.agentId)).ownerUsd).toBeCloseTo(4, 6);

    // What `deleteAgent` does: write the carry-over, then delete.
    await db.insert(schema.auditEvents).values({
      id: nanoid(),
      userId: owner.userId,
      kind: "budget_change",
      agentId: doomed.agentId,
      agentName: "Test Agent",
      summary: "Deleted Test Agent.",
      metadata: { reason: DATA_SPEND_CARRYOVER, dataSpendUsd: 4 },
    });
    await db.delete(schema.agents).where(eq(schema.agents.id, doomed.agentId));
    expect(await db.select().from(schema.x402Payments).where(eq(schema.x402Payments.agentId, doomed.agentId))).toHaveLength(0);

    const after = await realDataSpend24h(owner.agentId);
    expect(after.ownerUsd).toBeCloseTo(4, 6);
    expect(after.platformUsd).toBeCloseTo(platformBefore, 6);

    // An unrelated budget note is not a carry-over.
    await db.insert(schema.auditEvents).values({
      id: nanoid(),
      userId: owner.userId,
      kind: "budget_change",
      summary: "Raised a cap.",
      metadata: { dataSpendUsd: 50 },
    });
    expect((await realDataSpend24h(owner.agentId)).ownerUsd).toBeCloseTo(4, 6);
  });
});
