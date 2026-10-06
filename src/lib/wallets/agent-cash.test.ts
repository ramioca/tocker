/**
 * What the user's agents hold of their money, as the top bar counts it.
 *
 * The bug this pins: only live agents were counted. Funding an agent is a real transfer
 * whatever its mode, so a user who moved all 25 USDC into a paper agent watched the top
 * bar go from $25.00 to $0.00, and no page said where the money was.
 *
 * Real queries against in-memory PGlite. The two things that leave the process are
 * stubbed: a live agent's book (`getPortfolio`) and a wallet's balances.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { nanoid } from "nanoid";
import type { Db } from "@/db";
import * as schema from "@/db/schema";
import { seedAgent, setupTestDb } from "@/lib/agent/test-support";
import { toNumeric } from "@/lib/money";
import type { WalletBalance } from "@/server/types";
import { unifiedCash } from "./funding";

const edges = vi.hoisted(() => ({
  portfolios: new Map<string, { cashUsd: number; equityUsd: number; cashReadFailed?: boolean }>(),
  balances: new Map<string, unknown[]>(),
  walletReads: [] as string[],
}));

vi.mock("@/lib/agent/portfolio", () => ({
  getPortfolio: async (agentId: string) => {
    const book = edges.portfolios.get(agentId);
    if (!book) throw new Error("offline in tests");
    return { agentId, mode: "live", positions: [], cashReadFailed: false, ...book };
  },
}));
vi.mock("./index", () => ({
  getAgentWalletBalances: async (agentId: string) => {
    edges.walletReads.push(agentId);
    return edges.balances.get(agentId) ?? [];
  },
  isPaperWallet: (walletId: string) => walletId.startsWith("paper_"),
}));

const { readAgentCash } = await import("./agent-cash");

let db: Db;

beforeAll(async () => {
  db = await setupTestDb();
}, 120_000);

beforeEach(() => {
  edges.portfolios.clear();
  edges.balances.clear();
  edges.walletReads.length = 0;
});

function wallet(chain: "base" | "solana", usdc: number, extra: Partial<WalletBalance> = {}): WalletBalance {
  return {
    chain,
    address: chain === "base" ? "0xagent" : "AgentSol",
    walletId: `privy_${chain}`,
    balances: [
      { asset: "usdc", amount: usdc, usd: usdc },
      { asset: chain === "base" ? "eth" : "sol", amount: 0, usd: null },
    ],
    ...extra,
  };
}

async function fundingIntent(
  agent: { agentId: string; userId: string },
  status: "pending" | "sent" | "failed" | "cancelled",
  amount = 25,
) {
  await db.insert(schema.agentFundingIntents).values({
    id: nanoid(),
    agentId: agent.agentId,
    userId: agent.userId,
    chain: "solana",
    asset: "usdc",
    amount: String(amount),
    status,
    toAddress: "AgentSol",
    settledAt: status === "pending" ? null : new Date(),
  });
}

describe("readAgentCash", () => {
  it("costs a paper-only user no wallet read", async () => {
    const agent = await seedAgent(db);
    expect(await readAgentCash(agent.userId)).toEqual({ agents: [], unread: false });
    expect(edges.walletReads).toEqual([]);
  });

  it("counts USDC moved into an agent that is not live yet, so it never just vanishes", async () => {
    const agent = await seedAgent(db);
    await fundingIntent(agent, "sent");
    edges.balances.set(agent.agentId, [wallet("solana", 25), wallet("base", 0)]);

    const read = await readAgentCash(agent.userId);

    expect(read.unread).toBe(false);
    expect(read.agents).toEqual([
      { id: agent.agentId, slug: agent.slug, name: "Test Agent", equityUsd: 25, cashUsd: 25, positionsUsd: 0, parked: true },
    ]);
    // The user's own wallets are empty now: the $25 is in the agent, and still counted.
    const cash = unifiedCash([], read.agents, { agentsUnread: read.unread });
    expect(cash.totalUsd).toBe(0);
    expect(cash.allUsd).toBe(25);
    expect(cash.partial).toBeUndefined();
  });

  it("reads a transfer still waiting on the browser from the wallet, which knows whether it landed", async () => {
    const landed = await seedAgent(db);
    await fundingIntent(landed, "pending");
    edges.balances.set(landed.agentId, [wallet("solana", 25)]);
    expect((await readAgentCash(landed.userId)).agents.map((a) => a.equityUsd)).toEqual([25]);

    const notYet = await seedAgent(db);
    await fundingIntent(notYet, "pending");
    edges.balances.set(notYet.agentId, [wallet("solana", 0)]);
    // Read, and empty: no row at $0.00, and nothing is missing.
    expect(await readAgentCash(notYet.userId)).toEqual({ agents: [], unread: false });
  });

  it("does not read an agent whose only transfers failed or were cancelled", async () => {
    const agent = await seedAgent(db);
    await fundingIntent(agent, "failed");
    await fundingIntent(agent, "cancelled");
    expect(await readAgentCash(agent.userId)).toEqual({ agents: [], unread: false });
    expect(edges.walletReads).toEqual([]);
  });

  it("leaves out an agent whose wallet cannot be read, and says something is missing", async () => {
    const agent = await seedAgent(db);
    await fundingIntent(agent, "sent");
    edges.balances.set(agent.agentId, [wallet("solana", 25), wallet("base", 0, { readFailed: true })]);

    const read = await readAgentCash(agent.userId);

    // Never listed at the $25 that was read, and never at $0: the Base side is unknown.
    expect(read).toEqual({ agents: [], unread: true });
    expect(unifiedCash([], read.agents, { agentsUnread: read.unread }).partial).toBe(true);
  });

  it("holds back the Tocker fees a parked agent still owes from its live fills", async () => {
    const agent = await seedAgent(db);
    await fundingIntent(agent, "sent");
    edges.balances.set(agent.agentId, [wallet("base", 10)]);
    await db.insert(schema.tokens).values({ id: "base:FEE", chain: "base", address: "FEE", symbol: "FEE", decimals: 6 }).onConflictDoNothing();
    const tradeId = nanoid();
    await db.insert(schema.trades).values({
      id: tradeId,
      agentId: agent.agentId,
      ownerId: agent.userId,
      chain: "base",
      side: "buy",
      tokenId: "base:FEE",
      quoteTokenId: "base:FEE",
      amountToken: toNumeric(1, 12),
      amountUsd: toNumeric(1, 6),
      priceUsd: toNumeric(1, 12),
      status: "filled",
      isPaper: false,
    });
    await db.insert(schema.platformFees).values({ id: nanoid(), agentId: agent.agentId, tradeId, chain: "base", amountUsd: toNumeric(0.3, 6) });

    const [parked] = (await readAgentCash(agent.userId)).agents;
    expect(parked.cashUsd).toBeCloseTo(9.7, 9);
    expect(parked.equityUsd).toBeCloseTo(9.7, 9);
  });

  it("counts a live agent's cash and positions as before, and never as parked", async () => {
    const agent = await seedAgent(db, { mode: "live" });
    edges.portfolios.set(agent.agentId, { cashUsd: 15, equityUsd: 50 });

    const read = await readAgentCash(agent.userId);

    expect(read).toEqual({
      agents: [{ id: agent.agentId, slug: agent.slug, name: "Test Agent", equityUsd: 50, cashUsd: 15, positionsUsd: 35 }],
      unread: false,
    });
    // Its wallet is read through its book, once: no second, parked reading of the same money.
    expect(edges.walletReads).toEqual([]);
  });

  it("leaves out a live agent whose balance could not be read", async () => {
    const outage = await seedAgent(db, { mode: "live" });
    expect(await readAgentCash(outage.userId)).toEqual({ agents: [], unread: true });

    const partial = await seedAgent(db, { mode: "live" });
    edges.portfolios.set(partial.agentId, { cashUsd: 0, equityUsd: 35, cashReadFailed: true });
    expect(await readAgentCash(partial.userId)).toEqual({ agents: [], unread: true });
  });

  it("reads only the asking user's agents", async () => {
    const mine = await seedAgent(db);
    const theirs = await seedAgent(db);
    await fundingIntent(theirs, "sent");
    edges.balances.set(theirs.agentId, [wallet("solana", 99)]);

    expect(await readAgentCash(mine.userId)).toEqual({ agents: [], unread: false });
    expect(edges.walletReads).toEqual([]);
  });
});
