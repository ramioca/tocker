import { beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import type { Db } from "@/db";
import * as schema from "@/db/schema";
import { seedAgent, setupTestDb } from "@/lib/agent/test-support";
import { toNumeric } from "@/lib/money";
import {
  claimFeesForTransfer,
  feesOwedAfter,
  inflightMarker,
  parseInflightMarker,
  partitionAccrued,
  releaseFeesFromTransfer,
  settleCollectedFees,
  settlementOutcome,
  solanaFeesOwed,
  sweepSender,
} from "./settlement";

describe("sweepSender", () => {
  const sweep = { agentId: "a1", asset: "usdc" as const, amount: 1.2, toAddress: "platform" };
  const calls: string[] = [];
  const send = sweepSender({
    solana: async (s) => {
      calls.push(`solana:${s.agentId}:${s.amount}:${s.toAddress}`);
      return { txHash: "sol", status: "succeeded" };
    },
    base: async (s) => {
      calls.push(`base:${s.chain}:${s.amount}`);
      return { txHash: "0xbase", status: "succeeded" };
    },
  });

  it("sends a Solana sweep through the sponsored path and a Base sweep through Privy's transfer", async () => {
    await expect(send({ ...sweep, chain: "solana" })).resolves.toEqual({ txHash: "sol", status: "succeeded" });
    await expect(send({ ...sweep, chain: "base" })).resolves.toEqual({ txHash: "0xbase", status: "succeeded" });
    expect(calls).toEqual(["solana:a1:1.2:platform", "base:base:1.2"]);
  });

  it("hands the Solana sender the hook that records the signature, and never the Base one", async () => {
    const seen: Array<[string, boolean]> = [];
    const hooked = sweepSender({
      solana: async (s) => {
        seen.push(["solana", typeof s.onSigned === "function"]);
        return { txHash: "sol", status: "succeeded" };
      },
      base: async (s) => {
        seen.push(["base", "onSigned" in s]);
        return { txHash: "0xbase", status: "succeeded" };
      },
    });
    const onSigned = async () => undefined;
    await hooked({ ...sweep, chain: "solana", onSigned });
    await hooked({ ...sweep, chain: "base", onSigned });
    expect(seen).toEqual([
      ["solana", true],
      ["base", false],
    ]);
  });
});

describe("in-flight sweeps", () => {
  const SIG = "5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UjKdiSZkQUW";

  it("round-trips a marker, and reads nothing else as one", () => {
    const marker = inflightMarker(SIG, 312_345_678);
    expect(marker).toBe(`inflight:${SIG}:312345678`);
    expect(parseInflightMarker(marker)).toEqual({ signature: SIG, lastValidBlockHeight: 312_345_678 });
    expect(parseInflightMarker(SIG)).toBeNull();
    expect(parseInflightMarker(null)).toBeNull();
    expect(parseInflightMarker("simulated")).toBeNull();
    expect(parseInflightMarker(`inflight:${SIG}`)).toBeNull();
    expect(parseInflightMarker(`inflight:${SIG}:12:extra`)).toBeNull();
  });

  it("keeps the rows a sweep in flight carries out of the next sweep, grouped by that sweep", () => {
    const marker = inflightMarker(SIG, 99);
    const { free, inflight } = partitionAccrued([
      { id: "f1", chain: "solana", amountUsd: 0.1, txHash: null },
      { id: "f2", chain: "solana", amountUsd: 0.1, txHash: marker },
      { id: "f3", chain: "base", amountUsd: 0.1, txHash: null },
      { id: "f4", chain: "solana", amountUsd: 0.1, txHash: marker },
      { id: "f5", chain: "solana", amountUsd: 0.1, txHash: "inflight:garbage" },
    ]);
    expect(free.map((r) => r.id)).toEqual(["f1", "f3"]);
    expect(inflight).toHaveLength(2);
    expect(inflight[0]).toMatchObject({ marker, signature: SIG, lastValidBlockHeight: 99, chain: "solana" });
    expect(inflight[0]?.rows.map((r) => r.id)).toEqual(["f2", "f4"]);
    // A marker that does not parse is never trusted as a sweep: it has no signature to wait on.
    expect(inflight[1]).toMatchObject({ marker: "inflight:garbage", signature: null });
  });
});

describe("settlementOutcome", () => {
  it("settles a confirmed transfer with a real signature", () => {
    expect(settlementOutcome({ txHash: "5Uc…9kP", status: "succeeded" })).toEqual({
      settle: true,
      txHash: "5Uc…9kP",
      error: null,
    });
  });

  it("refuses to settle a pending transfer — the money has not moved yet", () => {
    // This is the exact shape Privy returns the instant a transfer is created: a wallet
    // action, `pending`, with no hash. The old code marked the fees collected against it.
    const outcome = settlementOutcome({ txHash: null, status: "pending" });
    expect(outcome.settle).toBe(false);
    expect(outcome.error).toMatch(/pending/);
  });

  it("refuses to settle a failed or rejected transfer", () => {
    expect(settlementOutcome({ txHash: null, status: "failed" }).settle).toBe(false);
    expect(settlementOutcome({ txHash: null, status: "rejected" }).settle).toBe(false);
    // A rejection is what a Privy policy with no explicit `transfer` rule produces.
    expect(settlementOutcome({ txHash: null, status: "rejected" }).error).toMatch(/rejected/);
  });

  it("refuses to settle a succeeded transfer that somehow carries no signature", () => {
    const outcome = settlementOutcome({ txHash: null, status: "succeeded" });
    expect(outcome.settle).toBe(false);
    expect(outcome.error).toMatch(/no signature/);
  });

  it("trusts a caller that reports a hash and no status at all", () => {
    expect(settlementOutcome({ txHash: "0xabc" }).settle).toBe(true);
  });
});

describe("feesOwedAfter", () => {
  it("collects free rows and released ones, holds back what a sweep in flight carries, and owes nothing for what landed", () => {
    const owed = feesOwedAfter([{ id: "f1", chain: "solana", amountUsd: 0.1 }], {
      released: [{ id: "f2", chain: "solana", amountUsd: 0.1 }],
      batches: [
        { chain: "solana", amountUsd: 0.2, feeIds: ["f3", "f4"], txHash: "sig-pending", error: "sweep sig-pending is still in flight" },
        { chain: "solana", amountUsd: 0.3, feeIds: ["f5", "f6", "f7"], txHash: "sig-landed", error: null },
      ],
    });
    expect(owed.free.map((r) => r.id)).toEqual(["f1", "f2"]);
    expect(owed.freeUsd).toBeCloseTo(0.2, 6);
    expect(owed.inflightUsd).toBeCloseTo(0.2, 6);
  });
});

describe("fees an owner's withdrawal collects", () => {
  const SIG = "5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UjKdiSZkQUW";
  let db: Db;
  beforeAll(async () => {
    db = await setupTestDb();
  }, 120_000);

  /** A live agent with `n` accrued ten-cent Solana fees (and one Base fee, which a Solana withdrawal never touches). */
  async function agentOwing(n: number) {
    const { agentId, userId } = await seedAgent(db, { mode: "live" });
    await db
      .insert(schema.tokens)
      .values({ id: "solana:FEE", chain: "solana", address: "FEE", symbol: "FEE", decimals: 6 })
      .onConflictDoNothing();
    const ids: string[] = [];
    for (let i = 0; i <= n; i += 1) {
      const tradeId = `t-${agentId}-${i}`;
      await db.insert(schema.trades).values({
        id: tradeId,
        agentId,
        ownerId: userId,
        chain: "solana",
        side: "buy",
        tokenId: "solana:FEE",
        quoteTokenId: "solana:FEE",
        amountToken: toNumeric(1, 12),
        amountUsd: toNumeric(10, 6),
        priceUsd: toNumeric(10, 12),
        feeUsd: toNumeric(0.03, 6),
        status: "filled",
        isPaper: false,
      });
      const id = `fee-${agentId}-${i}`;
      await db.insert(schema.platformFees).values({ id, agentId, tradeId, chain: i === n ? "base" : "solana", amountUsd: toNumeric(0.1, 6) });
      if (i < n) ids.push(id);
    }
    return { agentId, userId, ids };
  }
  const rows = (ids: string[]) => db.select().from(schema.platformFees).where(inArray(schema.platformFees.id, ids));

  it("says what a Solana withdrawal owes: the free Solana rows, nothing on Base", async () => {
    const { agentId, userId, ids } = await agentOwing(3);
    const owed = await solanaFeesOwed({ agentId, ownerId: userId, agentName: "Test Agent" });
    expect(owed.free.map((r) => r.id).sort()).toEqual([...ids].sort());
    expect(owed.freeUsd).toBeCloseTo(0.3, 6);
    expect(owed.inflightUsd).toBe(0);
  });

  it("claims the rows before the broadcast, so a sweep cannot collect them twice", async () => {
    const { ids } = await agentOwing(2);
    const marker = await claimFeesForTransfer(ids, SIG, 99);
    expect(marker).toBe(inflightMarker(SIG, 99));
    expect((await rows(ids)).every((r) => r.status === "accrued" && r.txHash === marker)).toBe(true);
    // A sweep (or a second withdrawal) reaching for the same rows is refused, and undone.
    await expect(claimFeesForTransfer(ids, "otherSig", 100)).rejects.toThrow(/already sweeping/);
    expect((await rows(ids)).every((r) => r.txHash === marker)).toBe(true);
  });

  it("gives the rows back when the transfer is known not to have moved", async () => {
    const { ids } = await agentOwing(2);
    const marker = await claimFeesForTransfer(ids, SIG, 99);
    await releaseFeesFromTransfer(ids, marker);
    expect((await rows(ids)).every((r) => r.status === "accrued" && r.txHash === null)).toBe(true);
  });

  it("settles them against the withdrawal's signature once it confirms", async () => {
    const { agentId, userId, ids } = await agentOwing(2);
    await claimFeesForTransfer(ids, SIG, 99);
    await settleCollectedFees({
      agentId,
      ownerId: userId,
      agentName: "Test Agent",
      chain: "solana",
      feeIds: ids,
      amountUsd: 0.2,
      txHash: SIG,
      toAddress: "8LZj73rMvKMWekH4TLLszDywpr4WxeauhGcJ57qhwyza",
    });
    expect((await rows(ids)).every((r) => r.status === "settled" && r.txHash === SIG)).toBe(true);
    const owed = await solanaFeesOwed({ agentId, ownerId: userId, agentName: "Test Agent" });
    expect(owed.freeUsd).toBe(0);
    const audit = await db.select().from(schema.auditEvents).where(eq(schema.auditEvents.agentId, agentId));
    expect(audit.some((row) => (row.metadata as { reason?: string } | null)?.reason === "platform_fee_settlement")).toBe(true);
  });

  it("releases a marker that never parsed and collects those rows again", async () => {
    const { agentId, userId, ids } = await agentOwing(1);
    await db.update(schema.platformFees).set({ txHash: "inflight:garbage" }).where(inArray(schema.platformFees.id, ids));
    const owed = await solanaFeesOwed({ agentId, ownerId: userId, agentName: "Test Agent" });
    expect(owed.free.map((r) => r.id)).toEqual(ids);
    expect(owed.inflightUsd).toBe(0);
  });
});
