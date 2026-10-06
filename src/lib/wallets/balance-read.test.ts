/**
 * A balance that could not be read is not a balance of zero.
 *
 * `readWalletBalances` answers a failed lookup with zeros so the cards that call it
 * still render. Until the answer said which kind of zero it was, the top bar and Home
 * printed "$0.00" over a wallet holding $500, and the stranded-funds check let an agent
 * be deleted with USDC in a Base wallet nobody had managed to read.
 *
 * Privy is stubbed (it is the only thing a Base read talks to); the stranded check runs
 * against in-memory PGlite.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { Db } from "@/db";
import * as schema from "@/db/schema";
import { seedAgent, setupTestDb } from "@/lib/agent/test-support";

const privyEdge = vi.hoisted(() => ({
  /** What `balance.get` answers per asset, or an error to throw. */
  answer: null as null | Error | Record<string, { raw_value: string; raw_value_decimals: number }>,
}));

vi.mock("@/lib/privy", () => ({
  isPrivyConfigured: () => true,
  authorizationContext: () => ({ authorization_private_keys: [] }),
  authorizationPublicKey: () => "test",
  privy: () => ({
    wallets: () => ({
      balance: {
        get: async (_walletId: string, query: { asset: string }) => {
          if (privyEdge.answer instanceof Error) throw privyEdge.answer;
          const held = privyEdge.answer?.[query.asset];
          return { balances: held ? [{ asset: query.asset, ...held, display_values: {} }] : [] };
        },
      },
    }),
  }),
}));

const { readWalletBalances } = await import("./index");
const { readStrandedHoldings, STRANDED_READ_FAILED } = await import("./stranded");

const BASE_WALLET = { id: "privy_base_1", chain: "base" as const, address: "0x00000000000000000000000000000000000000aa" };

let db: Db;

beforeAll(async () => {
  db = await setupTestDb();
}, 120_000);

beforeEach(() => {
  privyEdge.answer = null;
});

describe("readWalletBalances", () => {
  it("flags a read that failed, with zeros that mean unknown", async () => {
    privyEdge.answer = new Error("429 Too Many Requests");

    const read = await readWalletBalances(BASE_WALLET);

    expect(read.readFailed).toBe(true);
    expect(read.balances.map((b) => b.amount)).toEqual([0, 0]);
  });

  it("does not flag a wallet that answered and holds nothing", async () => {
    privyEdge.answer = {};
    const read = await readWalletBalances(BASE_WALLET);
    expect(read.readFailed).toBeUndefined();
    expect(read.balances.map((b) => b.amount)).toEqual([0, 0]);
  });

  it("does not flag a wallet that answered with a balance", async () => {
    privyEdge.answer = { usdc: { raw_value: "500000000", raw_value_decimals: 6 } };
    const read = await readWalletBalances(BASE_WALLET);
    expect(read.readFailed).toBeUndefined();
    expect(read.balances.find((b) => b.asset === "usdc")?.amount).toBe(500);
  });
});

describe("readStrandedHoldings on Base", () => {
  /** A live agent whose Base wallet is a real one; its Solana wallet stays a paper placeholder. */
  async function agentWithBaseWallet() {
    const seeded = await seedAgent(db, { mode: "live" });
    await db
      .update(schema.wallets)
      .set({ id: `privy_base_${nanoid(8)}`, address: `0x${nanoid(12)}` })
      .where(eq(schema.wallets.id, `paper_${seeded.agentId}_base`));
    return seeded;
  }

  it("refuses when the wallet cannot be read, instead of finding nothing to strand", async () => {
    const { agentId } = await agentWithBaseWallet();
    privyEdge.answer = new Error("upstream down");
    // Before, the zeros of a failed read passed for an empty wallet and the delete went ahead.
    expect(await readStrandedHoldings(agentId)).toEqual({ ok: false, error: STRANDED_READ_FAILED });
  });

  it("names the USDC a readable wallet holds", async () => {
    const { agentId } = await agentWithBaseWallet();
    privyEdge.answer = { usdc: { raw_value: "12300000", raw_value_decimals: 6 } };
    expect(await readStrandedHoldings(agentId)).toEqual({
      ok: true,
      holdings: [{ kind: "usdc", chain: "base", amount: 12.3 }],
    });
  });

  it("lets a wallet that answered empty through", async () => {
    const { agentId } = await agentWithBaseWallet();
    privyEdge.answer = {};
    expect(await readStrandedHoldings(agentId)).toEqual({ ok: true, holdings: [] });
  });
});
