/**
 * The live book of an agent that pays for its own thinking.
 *
 * One run's worth of thinking, and the wallet floor, is kept out of its trades, taken
 * from the Solana wallet's USDC because that is the wallet that pays. The two reads that
 * leave the process are stand-ins: the Solana balance (the chain) and the Base balance
 * (Privy). The fee ledger and the rest of `getPortfolio` are the real code on PGlite.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { Keypair, PublicKey } from "@solana/web3.js";
import type { Db } from "@/db";
import * as schema from "@/db/schema";
import { toNumeric } from "@/lib/money";
import { seedKnownTokens, tokenId, USDC_SOLANA } from "@/lib/trading/tokens";
import { WALLET_FLOOR_USD } from "@/lib/x402/inference-types";
import { DEFAULT_AGENT_CONFIG } from "./config";
import { seedAgent, setupTestDb } from "./test-support";

/** What each wallet holds, in USDC: Solana by its token account, Base by its wallet id. */
const chain = vi.hoisted(() => ({ solana: new Map<string, number | null>(), base: new Map<string, number>() }));

vi.mock("@/lib/wallets/solana-rpc", () => ({
  getTokenAccountBalance: async (account: string) => {
    const usdc = chain.solana.get(account);
    return usdc === undefined || usdc === null ? null : BigInt(Math.round(usdc * 1e6));
  },
}));
vi.mock("@/lib/privy", () => ({
  privy: () => ({
    wallets: () => ({
      balance: {
        get: async (walletId: string) => ({
          balances: [{ raw_value: String(Math.round((chain.base.get(walletId) ?? 0) * 1e6)), raw_value_decimals: 6 }],
        }),
      },
    }),
  }),
}));

const { getPortfolio, toRiskPortfolio } = await import("./portfolio");
const { associatedTokenAddress, SOLANA_USDC_MINT } = await import("@/lib/wallets/solana-transfer");

let db: Db;
const BONK_ID = tokenId("solana", "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263");
const USDC_ID = tokenId("solana", USDC_SOLANA);

beforeAll(async () => {
  db = await setupTestDb();
  await seedKnownTokens();
}, 120_000);

beforeEach(() => {
  chain.solana.clear();
  chain.base.clear();
});

const PAYS_PER_USE = { ...DEFAULT_AGENT_CONFIG.llm, source: "usdc" as const, usdc: { model: "google/gemini-2.5-flash", maxUsdPerRun: 0.3, maxUsdPerDay: 3 } };

/** A live agent with real-looking wallets holding the given USDC. */
async function liveAgent(options: { paysPerUse: boolean; solana: number; base?: number }) {
  const seeded = await seedAgent(db, {
    mode: "live",
    config: { chains: options.base === undefined ? ["solana"] : ["solana", "base"], ...(options.paysPerUse ? { llm: PAYS_PER_USE } : {}) },
  });
  await db.delete(schema.wallets).where(eq(schema.wallets.agentId, seeded.agentId));
  const address = Keypair.generate().publicKey.toBase58();
  await db.insert(schema.wallets).values({ id: `wal_${nanoid(10)}`, kind: "agent_server", chain: "solana", address, userId: seeded.userId, agentId: seeded.agentId });
  chain.solana.set(associatedTokenAddress(new PublicKey(address), SOLANA_USDC_MINT).toBase58(), options.solana);
  if (options.base !== undefined) {
    const baseId = `wal_${nanoid(10)}`;
    await db.insert(schema.wallets).values({ id: baseId, kind: "agent_server", chain: "base", address: `0x${nanoid(10)}`, userId: seeded.userId, agentId: seeded.agentId });
    chain.base.set(baseId, options.base);
  }
  return seeded;
}

async function oweFee(agent: { agentId: string; userId: string }, usd: number) {
  const tradeId = nanoid();
  await db.insert(schema.trades).values({
    id: tradeId,
    agentId: agent.agentId,
    ownerId: agent.userId,
    chain: "solana",
    side: "buy",
    tokenId: BONK_ID,
    quoteTokenId: USDC_ID,
    amountToken: toNumeric(1, 12),
    amountUsd: toNumeric(1, 6),
    priceUsd: toNumeric(1, 12),
    feeUsd: toNumeric(0, 6),
    // Only something for the fee row to hang on: a rejected order is not a fill and adds nothing to the book.
    status: "rejected",
    isPaper: false,
    origin: "manual",
  });
  await db.insert(schema.platformFees).values({ id: nanoid(), agentId: agent.agentId, tradeId, chain: "solana", amountUsd: toNumeric(usd, 6) });
}

describe("a live agent that pays per use", () => {
  it("keeps its run limit and the wallet floor out of what a buy may spend, and in its cash and equity", async () => {
    const agent = await liveAgent({ paysPerUse: true, solana: 5 });
    const portfolio = await getPortfolio(agent.agentId);

    expect(portfolio.thinkingReserveUsd).toBeCloseTo(0.3 + WALLET_FLOOR_USD, 6);
    // Still its money: the public record and the equity curve do not move.
    expect(portfolio.cashUsd).toBeCloseTo(5, 6);
    expect(portfolio.equityUsd).toBeCloseTo(5, 6);
    // What the risk guard sizes a buy against.
    expect(toRiskPortfolio(portfolio).cashUsd).toBeCloseTo(4.45, 6);
    expect(toRiskPortfolio(portfolio).equityUsd).toBeCloseTo(5, 6);
  });

  it("holds back no more than the Solana wallet has: USDC on Base cannot pay for thinking", async () => {
    const agent = await liveAgent({ paysPerUse: true, solana: 0.2, base: 100 });
    const portfolio = await getPortfolio(agent.agentId);

    expect(portfolio.cashUsd).toBeCloseTo(100.2, 6);
    expect(portfolio.thinkingReserveUsd).toBeCloseTo(0.2, 6);
    expect(toRiskPortfolio(portfolio).cashUsd).toBeCloseTo(100, 6);
  });

  it("holds back what is left after the fees it owes, never more than its cash", async () => {
    const agent = await liveAgent({ paysPerUse: true, solana: 0.4 });
    await oweFee(agent, 0.3);
    const portfolio = await getPortfolio(agent.agentId);

    expect(portfolio.cashUsd).toBeCloseTo(0.1, 6);
    expect(portfolio.thinkingReserveUsd).toBeCloseTo(0.1, 6);
    expect(toRiskPortfolio(portfolio).cashUsd).toBe(0);
  });

  it("holds back nothing from an empty wallet, and reports no reserve", async () => {
    const agent = await liveAgent({ paysPerUse: true, solana: 0 });
    const portfolio = await getPortfolio(agent.agentId);
    expect(portfolio.thinkingReserveUsd).toBeUndefined();
    expect(toRiskPortfolio(portfolio).cashUsd).toBe(0);
  });
});

describe("a live agent on its owner's key", () => {
  it("has nothing held back: its book is exactly what it was", async () => {
    const agent = await liveAgent({ paysPerUse: false, solana: 5, base: 2 });
    const portfolio = await getPortfolio(agent.agentId);

    expect(portfolio.thinkingReserveUsd).toBeUndefined();
    expect("thinkingReserveUsd" in portfolio).toBe(false);
    expect(portfolio.cashUsd).toBeCloseTo(7, 6);
    expect(toRiskPortfolio(portfolio).cashUsd).toBeCloseTo(7, 6);
  });

  it("is not affected by old pay-per-use limits still in its config", async () => {
    const agent = await liveAgent({ paysPerUse: true, solana: 5 });
    const [row] = await db.select().from(schema.agents).where(and(eq(schema.agents.id, agent.agentId)));
    const config = row?.config as schema.AgentConfig;
    await db.update(schema.agents).set({ config: { ...config, llm: { ...config.llm, source: "key" } } }).where(eq(schema.agents.id, agent.agentId));

    const portfolio = await getPortfolio(agent.agentId);
    expect(portfolio.thinkingReserveUsd).toBeUndefined();
    expect(toRiskPortfolio(portfolio).cashUsd).toBeCloseTo(5, 6);
  });
});
