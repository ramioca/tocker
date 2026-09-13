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
  it("guards every holder, snapshots every active agent, and leaves paused ones alone", async () => {
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

    const guardable = await findGuardableAgents();
    expect(guardable.holding).toContain(holder.agentId);
    expect(guardable.flat).toContain(flat.agentId);
    expect(guardable.holding).not.toContain(paused.agentId);
    expect(guardable.flat).not.toContain(paused.agentId);

    const result = await tickMarks();
    expect(result.active).toBe(2);
    expect(result.guarded).toBe(1);
    expect(result.exits).toBe(1);
    expect(result.snapshots).toBe(2);

    // The holder was exited.
    const trades = await db.select().from(schema.trades).where(eq(schema.trades.agentId, holder.agentId));
    expect(trades).toHaveLength(1);
    expect(trades[0]?.origin).toBe("guardian");
    expect(trades[0]?.exitReason).toBe("stop_loss");

    // Both active agents have an equity point; the paused one has neither trade nor point.
    for (const agentId of [holder.agentId, flat.agentId]) {
      const snaps = await db
        .select()
        .from(schema.equitySnapshots)
        .where(eq(schema.equitySnapshots.agentId, agentId));
      expect(snaps).toHaveLength(1);
    }
    expect(await db.select().from(schema.trades).where(eq(schema.trades.agentId, paused.agentId))).toHaveLength(0);
    expect(
      await db.select().from(schema.equitySnapshots).where(eq(schema.equitySnapshots.agentId, paused.agentId)),
    ).toHaveLength(0);
  });

  it("is a no-op when nothing is active", async () => {
    await db.update(schema.agents).set({ status: "paused" });
    const result = await tickMarks();
    expect(result).toMatchObject({ active: 0, guarded: 0, exits: 0, snapshots: 0 });
    expect(result.results).toHaveLength(0);
  });
});
