import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { Db } from "@/db";
import * as schema from "@/db/schema";
import { resetPriceCache } from "@/lib/trading/prices";
import { seedKnownTokens, tokenId } from "@/lib/trading/tokens";
import { findGuardableAgents, tickMarks } from "./scheduler";
import { seedAgent, setupTestDb } from "./test-support";

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
