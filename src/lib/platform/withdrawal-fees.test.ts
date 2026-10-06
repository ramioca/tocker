/**
 * On Base, the Tocker fee could be skipped: trade, withdraw the whole balance before the
 * next sweep, delete the agent. The withdrawal sent whatever was asked for with no fee
 * step, the batch threshold meant a few fills' worth was never swept at all, and the fee
 * rows were deleted with the agent.
 *
 * What is pinned here: a Base USDC withdrawal may not take the fees owed with it, the
 * sweep runs straight after it and again at deletion whatever the threshold, and
 * deletion is never refused for fees it could not collect.
 *
 * The ledger, the audit log, ownership and the rate limiter are the real code against
 * in-memory PGlite. What leaves the process is stubbed: the wallet read, the transfer,
 * and the platform wallet's address.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { Db } from "@/db";
import * as schema from "@/db/schema";
import { seedAgent, setupTestDb } from "@/lib/agent/test-support";
import { toNumeric } from "@/lib/money";
import type { Session, WalletBalance } from "@/server/types";

const PLATFORM_BASE = "0x00000000000000000000000000000000000000f1";
/** Checksummed, as the action normalises a Base address before anything is signed. */
const DESTINATION = "0x8F3C2a9b41D7e6f05a12c3D4E5f60718293A4B5c";

const chain = vi.hoisted(() => ({
  /** USDC in each agent's Base wallet. No entry: the read fails. */
  usdc: new Map<string, number>(),
  reads: [] as string[],
  sent: [] as Array<{ agentId: string; chain: string; asset: string; amount: number; toAddress: string }>,
  failTransfers: false,
  /** Transfers after this many have gone through are refused. */
  failAfter: Number.POSITIVE_INFINITY,
}));

let session: Session | null = null;

vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));
vi.mock("@/lib/auth", () => ({
  getSession: async () => session,
  requireSession: async () => session,
}));
vi.mock("@/lib/security/mfa", () => ({
  secondFactorBlock: async () => null,
  getMfaStatus: async () => ({ available: false, appMethods: [], userMethods: [], enrolled: false }),
  rememberMfaStatus: async () => undefined,
  lastKnownMfaMethods: async () => [],
}));
vi.mock("@/lib/wallets", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/wallets")>();
  /** The agent a wallet row belongs to: the stubs are keyed by agent, as the test thinks. */
  const agentOf = (walletId: string) => walletId.replace(/^privy_base_/, "");
  return {
    ...actual,
    readWalletBalances: async (w: { id: string; chain: "base" | "solana"; address: string }): Promise<WalletBalance> => {
      const empty = [
        { asset: "usdc", amount: 0, usd: null },
        { asset: w.chain === "base" ? "eth" : "sol", amount: 0, usd: null },
      ];
      if (actual.isPaperWallet(w.id)) return { chain: w.chain, address: w.address, walletId: w.id, balances: empty };
      chain.reads.push(agentOf(w.id));
      const usdc = chain.usdc.get(agentOf(w.id));
      if (usdc === undefined) return { chain: w.chain, address: w.address, walletId: w.id, balances: empty, readFailed: true };
      return {
        chain: w.chain,
        address: w.address,
        walletId: w.id,
        balances: [{ asset: "usdc", amount: usdc, usd: usdc }, empty[1]],
      };
    },
    withdrawFromAgent: async (input: { agentId: string; chain: string; asset: string; amount: number; toAddress: string }) => {
      if (chain.failTransfers || chain.sent.length >= chain.failAfter) {
        throw new Error("The withdrawal was rejected: policy");
      }
      chain.sent.push({ ...input });
      // The money leaves, so the next balance read sees it gone.
      if (input.asset === "usdc") {
        chain.usdc.set(input.agentId, Math.round(((chain.usdc.get(input.agentId) ?? 0) - input.amount) * 1e6) / 1e6);
      }
      return { txHash: `0xhash${chain.sent.length}`, actionId: `action_${chain.sent.length}`, status: "succeeded" as const };
    },
  };
});
vi.mock("./wallets", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./wallets")>()),
  ensurePlatformWallet: async (c: "base" | "solana") => ({ walletId: `platform_${c}`, chain: c, address: PLATFORM_BASE }),
}));

const { accruedFeesUsd } = await import("./fees");
const { settlePlatformFees } = await import("./settlement");
const { BALANCE_UNREAD_FOR_WITHDRAWAL, collectFeesOwed, holdBaseFees } = await import("./withdrawal-fees");
const { secureWithdrawAction } = await import("@/server/actions/security");
const { deleteAgent } = await import("@/server/actions/agents");

let db: Db;

beforeAll(async () => {
  db = await setupTestDb();
  for (const c of ["base", "solana"] as const) {
    await db.insert(schema.tokens).values({ id: `${c}:FEE`, chain: c, address: "FEE", symbol: "FEE", decimals: 6 }).onConflictDoNothing();
  }
}, 120_000);

beforeEach(() => {
  chain.usdc.clear();
  chain.reads.length = 0;
  chain.sent.length = 0;
  chain.failTransfers = false;
  chain.failAfter = Number.POSITIVE_INFINITY;
  session = null;
});

/**
 * An agent whose Base wallet is a real one (keyed by the agent's id, so the stubs above
 * can find it) holding `usdc`, owing `fills` ten-cent fees on `feeChain`.
 */
async function agentOwing(input: { fills: number; usdc?: number; feeChain?: "base" | "solana"; mode?: "paper" | "live" }) {
  const seeded = await seedAgent(db, { mode: input.mode ?? "live" });
  await db
    .update(schema.wallets)
    .set({ id: `privy_base_${seeded.agentId}`, address: `0x${nanoid(12)}` })
    .where(eq(schema.wallets.id, `paper_${seeded.agentId}_base`));
  if (input.usdc !== undefined) chain.usdc.set(seeded.agentId, input.usdc);

  const feeChain = input.feeChain ?? "base";
  for (let i = 0; i < input.fills; i += 1) {
    const tradeId = nanoid();
    await db.insert(schema.trades).values({
      id: tradeId,
      agentId: seeded.agentId,
      ownerId: seeded.userId,
      chain: feeChain,
      side: "buy",
      tokenId: `${feeChain}:FEE`,
      quoteTokenId: `${feeChain}:FEE`,
      amountToken: toNumeric(1, 12),
      amountUsd: toNumeric(1, 6),
      priceUsd: toNumeric(1, 12),
      status: "filled",
      isPaper: false,
    });
    await db.insert(schema.platformFees).values({ id: nanoid(), agentId: seeded.agentId, tradeId, chain: feeChain, amountUsd: toNumeric(0.1, 6) });
  }
  session = { userId: seeded.userId, handle: "owner", displayName: null, avatarUrl: null, email: null };
  return seeded;
}

const feeRows = (agentId: string) => db.select().from(schema.platformFees).where(eq(schema.platformFees.agentId, agentId));
const audits = (agentId: string) => db.select().from(schema.auditEvents).where(eq(schema.auditEvents.agentId, agentId));

describe("holdBaseFees", () => {
  it("lets any amount through when nothing is owed, without reading the wallet", async () => {
    const { agentId } = await agentOwing({ fills: 0, usdc: 10 });
    expect(await holdBaseFees({ agentId, amount: 10 })).toEqual({ ok: true, owedUsd: 0 });
    expect(chain.reads).toEqual([]);
  });

  it("holds back what the agent owes: the most that may leave is the balance less the fees", async () => {
    const { agentId } = await agentOwing({ fills: 3, usdc: 10 });

    const atTheLimit = await holdBaseFees({ agentId, amount: 9.7 });
    expect(atTheLimit.ok).toBe(true);
    if (atTheLimit.ok) expect(atTheLimit.owedUsd).toBeCloseTo(0.3, 6);

    expect(await holdBaseFees({ agentId, amount: 9.71 })).toEqual({
      ok: false,
      error: "This agent owes $0.30 in Tocker fees. The most you can withdraw is $9.70.",
    });
    // The whole balance is the case that used to walk away with the fees.
    expect((await holdBaseFees({ agentId, amount: 10 })).ok).toBe(false);
  });

  it("offers nothing when the wallet holds no more than it owes", async () => {
    const { agentId } = await agentOwing({ fills: 3, usdc: 0.25 });
    expect(await holdBaseFees({ agentId, amount: 0.01 })).toEqual({
      ok: false,
      error: "This agent owes $0.30 in Tocker fees. The most you can withdraw is $0.00.",
    });
  });

  it("does not hold Base money back for fees owed on Solana, which that path collects itself", async () => {
    const { agentId } = await agentOwing({ fills: 3, usdc: 10, feeChain: "solana" });
    expect(await holdBaseFees({ agentId, amount: 10 })).toEqual({ ok: true, owedUsd: 0 });
  });

  it("refuses, in its own words, when the balance cannot be read", async () => {
    const { agentId } = await agentOwing({ fills: 3 });
    // Not "the most you can withdraw is $0.00": nobody knows what the wallet holds.
    expect(await holdBaseFees({ agentId, amount: 1 })).toEqual({ ok: false, error: BALANCE_UNREAD_FOR_WITHDRAWAL });
  });
});

describe("collecting what is owed, whatever the batch threshold", () => {
  it("the ordinary pass leaves a single fee under the threshold, and `minUsd` sweeps it on Base", async () => {
    const { agentId, userId } = await agentOwing({ fills: 1, usdc: 5 });

    const ordinary = await settlePlatformFees({ agentId, ownerId: userId, agentName: "Test Agent", mode: "live" });
    expect(ordinary.attempted).toBe(false);
    expect(ordinary.note).toContain("threshold");
    expect(chain.sent).toEqual([]);

    const now = await settlePlatformFees({ agentId, ownerId: userId, agentName: "Test Agent", mode: "live", minUsd: 0.01 });
    expect(now.attempted).toBe(true);
    expect(now.settledUsd).toBeCloseTo(0.1, 6);
    expect(chain.sent).toEqual([{ agentId, chain: "base", asset: "usdc", amount: 0.1, toAddress: PLATFORM_BASE }]);
    const rows = await feeRows(agentId);
    expect(rows.map((r) => [r.status, r.txHash])).toEqual([["settled", "0xhash1"]]);
    expect(await accruedFeesUsd(agentId)).toBe(0);
  });

  it("writes the sweep's own audit line, which no P&L reads as the owner taking money out", async () => {
    const agent = await agentOwing({ fills: 2, usdc: 5 });
    await collectFeesOwed({ id: agent.agentId, ownerId: agent.userId, name: "Test Agent" });

    const log = await audits(agent.agentId);
    expect(log).toHaveLength(1);
    expect(log[0].metadata).toMatchObject({ reason: "platform_fee_settlement", chain: "base", amountUsd: 0.2, fills: 2 });
  });

  it("still collects from an agent that traded live and went back to paper", async () => {
    // Its mode says paper; its accrued rows say it owes real money. Skipping it here
    // would leave it holding USDC it may not withdraw, and so cannot be deleted with.
    const agent = await agentOwing({ fills: 2, usdc: 5, mode: "paper" });

    const result = await collectFeesOwed({ id: agent.agentId, ownerId: agent.userId, name: "Test Agent" });

    expect(result.settledUsd).toBeCloseTo(0.2, 6);
    expect(chain.sent.map((s) => [s.amount, s.toAddress])).toEqual([[0.2, PLATFORM_BASE]]);
    expect(await accruedFeesUsd(agent.agentId)).toBe(0);
  });

  it("never throws, and leaves every cent owed, when the transfer cannot happen", async () => {
    const agent = await agentOwing({ fills: 2, usdc: 5 });
    chain.failTransfers = true;

    const result = await collectFeesOwed({ id: agent.agentId, ownerId: agent.userId, name: "Test Agent" });

    expect(result.settledUsd).toBe(0);
    expect(result.batches[0]?.error).toMatch(/rejected/);
    expect(await accruedFeesUsd(agent.agentId)).toBeCloseTo(0.2, 6);
  });

  it("has nothing to do, and reads nothing, for an agent that owes nothing", async () => {
    const agent = await agentOwing({ fills: 0, usdc: 5 });
    const result = await collectFeesOwed({ id: agent.agentId, ownerId: agent.userId, name: "Test Agent" });
    expect(result).toMatchObject({ attempted: false, note: "nothing accrued" });
    expect(chain.sent).toEqual([]);
  });
});

describe("secureWithdrawAction on Base, with fees owed", () => {
  const withdraw = (agentId: string, amount: number, asset: "usdc" | "native" = "usdc") =>
    secureWithdrawAction({ agentId, chain: "base", asset, amount, toAddress: DESTINATION });

  it("refuses to send the whole balance, and sends nothing", async () => {
    const { agentId } = await agentOwing({ fills: 3, usdc: 10 });

    const result = await withdraw(agentId, 10);

    expect(result).toEqual({ ok: false, error: "This agent owes $0.30 in Tocker fees. The most you can withdraw is $9.70." });
    expect(chain.sent).toEqual([]);
    expect(await audits(agentId)).toEqual([]);
    expect(await accruedFeesUsd(agentId)).toBeCloseTo(0.3, 6);
  });

  it("sends what may leave, then sweeps the fees to Tocker", async () => {
    const { agentId } = await agentOwing({ fills: 3, usdc: 10 });

    const result = await withdraw(agentId, 9.7);

    expect(result.ok).toBe(true);
    // The owner's withdrawal first, exactly as asked, and then the sweep.
    expect(chain.sent.map((s) => [s.amount, s.toAddress])).toEqual([
      [9.7, DESTINATION],
      [0.3, PLATFORM_BASE],
    ]);
    expect(await accruedFeesUsd(agentId)).toBe(0);
    expect((await feeRows(agentId)).every((r) => r.status === "settled")).toBe(true);
    expect(chain.usdc.get(agentId)).toBe(0);
    // Two lines on the log: the withdrawal, and the fees.
    const reasons = (await audits(agentId)).map((row) => (row.metadata as { reason?: string }).reason ?? "withdrawal");
    expect(reasons.sort()).toEqual(["platform_fee_settlement", "withdrawal"]);
  });

  it("is told the withdrawal went through even when the sweep after it could not", async () => {
    const { agentId } = await agentOwing({ fills: 3, usdc: 10 });
    // The owner's transfer goes; the sweep that follows is refused.
    chain.failAfter = 1;

    const result = await withdraw(agentId, 5);

    expect(result).toMatchObject({ ok: true, data: { status: "succeeded" } });
    expect(chain.sent.map((s) => [s.amount, s.toAddress])).toEqual([[5, DESTINATION]]);
    // Nothing was marked collected that was not: the fees are still owed for the next pass.
    expect(await accruedFeesUsd(agentId)).toBeCloseTo(0.3, 6);
    expect((await feeRows(agentId)).every((r) => r.status === "accrued")).toBe(true);
  });

  it("does not hold back leftover ETH, which no fee is paid in", async () => {
    const { agentId } = await agentOwing({ fills: 3, usdc: 10 });

    const result = await withdraw(agentId, 0.001, "native");

    expect(result.ok).toBe(true);
    expect(chain.sent).toEqual([{ agentId, chain: "base", asset: "native", amount: 0.001, toAddress: DESTINATION }]);
    expect(await accruedFeesUsd(agentId)).toBeCloseTo(0.3, 6);
  });

  it("changes nothing for an agent that owes nothing", async () => {
    const { agentId } = await agentOwing({ fills: 0, usdc: 10 });

    expect((await withdraw(agentId, 10)).ok).toBe(true);

    expect(chain.sent).toEqual([{ agentId, chain: "base", asset: "usdc", amount: 10, toAddress: DESTINATION }]);
    expect(chain.reads).toEqual([]);
  });
});

describe("deleteAgent, with fees owed", () => {
  it("collects them before the agent and its fee rows are gone", async () => {
    // What is left after the owner withdrew everything they could: exactly the fees.
    const { agentId } = await agentOwing({ fills: 3, usdc: 0.3 });

    const result = await deleteAgent(agentId);

    expect(result).toEqual({ ok: true, data: undefined });
    expect(chain.sent).toEqual([{ agentId, chain: "base", asset: "usdc", amount: 0.3, toAddress: PLATFORM_BASE }]);
    expect(await db.select().from(schema.agents).where(eq(schema.agents.id, agentId))).toEqual([]);
    // The audit log outlives the agent, and says the fees were settled.
    const log = await audits(agentId);
    expect(log.some((row) => (row.metadata as { reason?: string } | null)?.reason === "platform_fee_settlement")).toBe(true);
  });

  it("is not refused for fees the sweep could not collect", async () => {
    const { agentId } = await agentOwing({ fills: 3, usdc: 0 });
    chain.failTransfers = true;

    expect(await deleteAgent(agentId)).toEqual({ ok: true, data: undefined });
    expect(await db.select().from(schema.agents).where(eq(schema.agents.id, agentId))).toEqual([]);
  });

  it("still refuses while the owner's own USDC is in the wallet", async () => {
    const { agentId } = await agentOwing({ fills: 3, usdc: 10.55 });

    const result = await deleteAgent(agentId);

    // The fees were swept; the $10.25 that is the owner's still has to be withdrawn first.
    expect(chain.sent.map((s) => s.amount)).toEqual([0.3]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/10\.25 USDC\. Withdraw it first/);
    expect(await db.select().from(schema.agents).where(eq(schema.agents.id, agentId))).toHaveLength(1);
  });
});
