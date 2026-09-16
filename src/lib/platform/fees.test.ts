/**
 * The fee ledger and the sweep, against a real (in-memory) database.
 *
 * What is worth proving here is not the arithmetic — `./fee.test.ts` owns that — but the
 * three promises the ledger makes: one row per fill whatever happens, a paper agent's
 * fee is settled the moment it is charged, and a settlement that cannot happen leaves
 * every cent still owed rather than quietly marking it collected.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { Db } from "@/db";
import * as schema from "@/db/schema";
import { seedAgent, setupTestDb } from "@/lib/agent/test-support";
import { toNumeric } from "@/lib/money";
import { platformFeeUsd } from "./fee";
import { accruedFees, accruedFeesUsd, chargePlatformFee, chargedFeesUsd, markFeesSettled } from "./fees";
import { settlePlatformFees } from "./settlement";

let db: Db;
const FEE = platformFeeUsd();

beforeAll(async () => {
  db = await setupTestDb();
}, 120_000);

/** A filled trade to hang a fee on. The fee's FK is to `trades`, so one has to exist. */
async function seedTrade(agentId: string, ownerId: string, id: string): Promise<string> {
  await db.insert(schema.tokens).values({
    id: "solana:FEE",
    chain: "solana",
    address: "FEE",
    symbol: "FEE",
    decimals: 6,
  }).onConflictDoNothing();
  await db.insert(schema.trades).values({
    id,
    agentId,
    ownerId,
    chain: "solana",
    side: "buy",
    tokenId: "solana:FEE",
    quoteTokenId: "solana:FEE",
    amountToken: toNumeric(1, 12),
    amountUsd: toNumeric(10, 6),
    priceUsd: toNumeric(10, 12),
    feeUsd: toNumeric(0.03, 6),
    status: "filled",
    isPaper: true,
  });
  return id;
}

describe("chargePlatformFee", () => {
  it("writes one accrued row for a live fill", async () => {
    const { agentId, userId } = await seedAgent(db, { mode: "live" });
    const tradeId = await seedTrade(agentId, userId, `t-${agentId.slice(0, 8)}-1`);

    const charged = await chargePlatformFee({ agentId, tradeId, chain: "solana", isPaper: false });
    expect(charged).toBeCloseTo(FEE, 6);

    const [row] = await db.select().from(schema.platformFees).where(eq(schema.platformFees.tradeId, tradeId));
    expect(row?.status).toBe("accrued");
    expect(row?.txHash).toBeNull();
    expect(row?.settledAt).toBeNull();
    expect(Number(row?.amountUsd)).toBeCloseTo(FEE, 6);
  });

  it("settles a paper fill on the spot, simulated — paper feels the same drag as live", async () => {
    const { agentId, userId } = await seedAgent(db);
    const tradeId = await seedTrade(agentId, userId, `t-${agentId.slice(0, 8)}-2`);

    await chargePlatformFee({ agentId, tradeId, chain: "solana", isPaper: true });

    const [row] = await db.select().from(schema.platformFees).where(eq(schema.platformFees.tradeId, tradeId));
    expect(row?.status).toBe("settled");
    expect(row?.txHash).toBe("simulated");
    expect(row?.settledAt).not.toBeNull();
    // Settled, so nothing is owed — but it *was* charged, which is what paper cash reads.
    expect(await accruedFeesUsd(agentId)).toBe(0);
    expect(await chargedFeesUsd(agentId)).toBeCloseTo(FEE, 6);
  });

  it("charges a trade exactly once, however many times it is called", async () => {
    const { agentId, userId } = await seedAgent(db, { mode: "live" });
    const tradeId = await seedTrade(agentId, userId, `t-${agentId.slice(0, 8)}-3`);

    const first = await chargePlatformFee({ agentId, tradeId, chain: "solana", isPaper: false });
    const second = await chargePlatformFee({ agentId, tradeId, chain: "solana", isPaper: false });
    expect(first).toBeCloseTo(FEE, 6);
    // The second call reports the fee on the ledger, not a second charge.
    expect(second).toBeCloseTo(FEE, 6);

    const rows = await db.select().from(schema.platformFees).where(eq(schema.platformFees.tradeId, tradeId));
    expect(rows).toHaveLength(1);
    expect(await accruedFeesUsd(agentId)).toBeCloseTo(FEE, 6);
  });

  it("charges nothing, and writes nothing, when the fee is switched off", async () => {
    const { agentId, userId } = await seedAgent(db, { mode: "live" });
    const tradeId = await seedTrade(agentId, userId, `t-${agentId.slice(0, 8)}-4`);
    const before = process.env.PLATFORM_FEE_USD;
    process.env.PLATFORM_FEE_USD = "0";
    try {
      expect(await chargePlatformFee({ agentId, tradeId, chain: "solana", isPaper: false })).toBe(0);
      const rows = await db.select().from(schema.platformFees).where(eq(schema.platformFees.tradeId, tradeId));
      expect(rows).toHaveLength(0);
    } finally {
      if (before === undefined) delete process.env.PLATFORM_FEE_USD;
      else process.env.PLATFORM_FEE_USD = before;
    }
  });

  it("returns 0 rather than throwing when the fee cannot be recorded", async () => {
    // No such trade, so the foreign key refuses the row. A fill must survive this.
    const { agentId } = await seedAgent(db, { mode: "live" });
    expect(await chargePlatformFee({ agentId, tradeId: "no-such-trade", chain: "base", isPaper: false })).toBe(0);
  });
});

describe("markFeesSettled", () => {
  it("moves only rows that are still accrued", async () => {
    const { agentId, userId } = await seedAgent(db, { mode: "live" });
    const a = await seedTrade(agentId, userId, `t-${agentId.slice(0, 8)}-5`);
    const b = await seedTrade(agentId, userId, `t-${agentId.slice(0, 8)}-6`);
    await chargePlatformFee({ agentId, tradeId: a, chain: "solana", isPaper: false });
    await chargePlatformFee({ agentId, tradeId: b, chain: "base", isPaper: false });

    const owed = await accruedFees(agentId);
    expect(owed).toHaveLength(2);

    expect(await markFeesSettled(owed.map((r) => r.id), "0xdeadbeef")).toBe(2);
    // Idempotent: a second pass over the same ids moves nothing.
    expect(await markFeesSettled(owed.map((r) => r.id), "0xother")).toBe(0);
    expect(await accruedFeesUsd(agentId)).toBe(0);

    const rows = await db.select().from(schema.platformFees).where(eq(schema.platformFees.agentId, agentId));
    expect(rows.every((r) => r.status === "settled" && r.txHash === "0xdeadbeef")).toBe(true);
    expect(await markFeesSettled([], "0xnothing")).toBe(0);
  });
});

describe("settlePlatformFees", () => {
  it("does nothing for a paper agent — there is no chain to move anything on", async () => {
    const { agentId, userId } = await seedAgent(db);
    const tradeId = await seedTrade(agentId, userId, `t-${agentId.slice(0, 8)}-7`);
    await chargePlatformFee({ agentId, tradeId, chain: "solana", isPaper: true });

    const result = await settlePlatformFees({ agentId, ownerId: userId, agentName: "Test", mode: "paper" });
    expect(result.attempted).toBe(false);
    expect(result.note).toContain("paper");
    expect(result.settledUsd).toBe(0);
  });

  it("waits under the threshold, and says how much is waiting", async () => {
    const { agentId, userId } = await seedAgent(db, { mode: "live" });
    const tradeId = await seedTrade(agentId, userId, `t-${agentId.slice(0, 8)}-8`);
    await chargePlatformFee({ agentId, tradeId, chain: "solana", isPaper: false });

    const result = await settlePlatformFees({ agentId, ownerId: userId, agentName: "Test", mode: "live" });
    expect(result.attempted).toBe(false);
    expect(result.accruedUsd).toBeCloseTo(FEE, 6);
    expect(result.note).toContain("threshold");
    expect(await accruedFeesUsd(agentId)).toBeCloseTo(FEE, 6);
  });

  it("leaves every cent owed when the transfer cannot happen, and never throws", async () => {
    // Privy is not configured in tests and the seeded wallets are `paper_` placeholders,
    // so the transfer refuses. The point: the rows stay `accrued` and the next pass
    // retries the same money.
    const { agentId, userId } = await seedAgent(db, { mode: "live" });
    for (let i = 0; i < 12; i += 1) {
      const tradeId = await seedTrade(agentId, userId, `t-${agentId.slice(0, 8)}-x${i}`);
      await chargePlatformFee({ agentId, tradeId, chain: "solana", isPaper: false });
    }
    expect(await accruedFeesUsd(agentId)).toBeCloseTo(FEE * 12, 6);

    const result = await settlePlatformFees({ agentId, ownerId: userId, agentName: "Test", mode: "live" });
    expect(result.attempted).toBe(true);
    expect(result.settledUsd).toBe(0);
    expect(result.batches).toHaveLength(1);
    expect(result.batches[0]?.txHash).toBeNull();
    expect(result.batches[0]?.error).not.toBeNull();
    expect(await accruedFeesUsd(agentId)).toBeCloseTo(FEE * 12, 6);
  });

  it("has nothing to do for an agent that never traded", async () => {
    const { agentId, userId } = await seedAgent(db, { mode: "live" });
    const result = await settlePlatformFees({ agentId, ownerId: userId, agentName: "Test", mode: "live" });
    expect(result.attempted).toBe(false);
    expect(result.note).toBe("nothing accrued");
  });
});
