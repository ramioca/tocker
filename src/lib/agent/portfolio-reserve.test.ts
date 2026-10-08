/**
 * The live cash a buy is judged on, for an agent with a cash reserve (`risk.cashReserveUsd`).
 *
 * The reserve is the one cash rule with nothing behind it. A buy that outruns plain cash
 * fails at the venue, because the money is not there. A buy that outruns the reserve
 * succeeds, because it is. So the figure the reserve is measured on may not be one that
 * trails the agent's own fills, and two things are held here: for a buy under a reserve
 * a Base wallet is read from the chain and not from the indexer, and when the chain
 * cannot be read, the buys the indexer may not show yet are taken off what it says.
 *
 * And that none of it is read for an agent without a reserve, or for a book that is not
 * about to judge a buy.
 *
 * The three reads that leave the process are stand-ins: the Solana balance (the chain),
 * the Base balance (the chain) and Privy's indexer. The fee ledger, the trade ledger and
 * the rest of `getPortfolio` are the real code on PGlite.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { Keypair, PublicKey } from "@solana/web3.js";
import type { Db } from "@/db";
import * as schema from "@/db/schema";
import { toNumeric } from "@/lib/money";
import { riskGuard } from "@/lib/trading/risk";
import { seedKnownTokens, tokenId, USDC_BASE, USDC_SOLANA } from "@/lib/trading/tokens";
import type { Chain, ScoreComponents, TokenScore } from "@/server/types";
import { seedAgent, setupTestDb } from "./test-support";

/** What each wallet holds, in USDC. A chain that is `null` did not answer. */
const wallets = vi.hoisted(() => ({
  solanaChain: new Map<string, number | null>(),
  baseChain: new Map<string, number | null>(),
  indexer: new Map<string, number>(),
  asked: { baseChain: 0, indexer: [] as string[] },
}));

vi.mock("@/lib/wallets/solana-rpc", () => ({
  getTokenAccountBalance: async (account: string) => {
    const usdc = wallets.solanaChain.get(account);
    return usdc === undefined || usdc === null ? null : BigInt(Math.round(usdc * 1e6));
  },
}));
vi.mock("@/lib/trading/base", () => ({
  readBaseTokenBalance: async (token: string, owner: string) => {
    wallets.asked.baseChain += 1;
    if (token !== USDC_BASE) throw new Error(`asked for ${token}, not USDC`);
    const usdc = wallets.baseChain.get(owner);
    return usdc === undefined || usdc === null ? null : BigInt(Math.round(usdc * 1e6));
  },
}));
vi.mock("@/lib/privy", () => ({
  privy: () => ({
    wallets: () => ({
      balance: {
        get: async (walletId: string) => {
          wallets.asked.indexer.push(walletId);
          return { balances: [{ raw_value: String(Math.round((wallets.indexer.get(walletId) ?? 0) * 1e6)), raw_value_decimals: 6 }] };
        },
      },
    }),
  }),
}));

const { INDEXER_LAG_MS, getPortfolio, toRiskPortfolio } = await import("./portfolio");
const { associatedTokenAddress, SOLANA_USDC_MINT } = await import("@/lib/wallets/solana-transfer");

/** How the three places that judge a real buy read the book. */
const FOR_BUY = { forBuy: true } as const;

let db: Db;
const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const BONK_ID = tokenId("solana", BONK);

beforeAll(async () => {
  db = await setupTestDb();
  await seedKnownTokens();
}, 120_000);

beforeEach(() => {
  vi.stubEnv("PLATFORM_FEE_BPS", "50");
  wallets.solanaChain.clear();
  wallets.baseChain.clear();
  wallets.indexer.clear();
  wallets.asked.baseChain = 0;
  wallets.asked.indexer = [];
});

/**
 * A live agent with one real-looking wallet on each chain it trades. `chain` is what the
 * chain says the wallet holds (null: it does not answer), `indexer` what Privy says.
 */
async function liveAgent(options: {
  reserveUsd?: number;
  base?: { chain: number | null; indexer: number };
  solana?: { chain: number | null; indexer: number };
}) {
  const chains: Chain[] = [...(options.solana ? (["solana"] as const) : []), ...(options.base ? (["base"] as const) : [])];
  const seeded = await seedAgent(db, {
    mode: "live",
    config: {
      chains,
      risk: { maxTradeUsd: 100, maxPositionPct: 100, ...(options.reserveUsd === undefined ? {} : { cashReserveUsd: options.reserveUsd }) },
    },
  });
  await db.delete(schema.wallets).where(eq(schema.wallets.agentId, seeded.agentId));
  const ids: Partial<Record<Chain, string>> = {};
  if (options.solana) {
    const address = Keypair.generate().publicKey.toBase58();
    ids.solana = `wal_${nanoid(10)}`;
    await db.insert(schema.wallets).values({ id: ids.solana, kind: "agent_server", chain: "solana", address, userId: seeded.userId, agentId: seeded.agentId });
    wallets.solanaChain.set(associatedTokenAddress(new PublicKey(address), SOLANA_USDC_MINT).toBase58(), options.solana.chain);
    wallets.indexer.set(ids.solana, options.solana.indexer);
  }
  if (options.base) {
    const address = `0x${nanoid(10)}`;
    ids.base = `wal_${nanoid(10)}`;
    await db.insert(schema.wallets).values({ id: ids.base, kind: "agent_server", chain: "base", address, userId: seeded.userId, agentId: seeded.agentId });
    wallets.baseChain.set(address, options.base.chain);
    wallets.indexer.set(ids.base, options.base.indexer);
  }
  return { ...seeded, walletIds: ids };
}

/** A real-money buy of the agent's that filled `agoMs` ago. */
async function filledBuy(agent: { agentId: string; userId: string }, chain: Chain, usd: number, agoMs: number) {
  await db.insert(schema.trades).values({
    id: nanoid(),
    agentId: agent.agentId,
    ownerId: agent.userId,
    chain,
    side: "buy",
    tokenId: BONK_ID,
    quoteTokenId: tokenId("solana", USDC_SOLANA),
    amountToken: toNumeric(1, 12),
    amountUsd: toNumeric(usd, 6),
    priceUsd: toNumeric(1, 12),
    feeUsd: toNumeric(0, 6),
    status: "filled",
    isPaper: false,
    origin: "agent",
    filledAt: new Date(Date.now() - agoMs),
  });
}

function strongScore(): TokenScore {
  const components: ScoreComponents = {
    safety: 90,
    liquidity: 95,
    organic: 80,
    distribution: 85,
    momentum: 60,
    gecko: null,
    sentiment: null,
    smartMoney: null,
  };
  return {
    tokenId: "base:0xnew",
    chain: "base",
    address: "0xnew",
    symbol: "NEW",
    name: "New",
    total: 84,
    verdict: "strong",
    blockers: [],
    warnings: [],
    priceUsd: 1,
    components,
  } as unknown as TokenScore;
}

describe("a live agent with a cash reserve, on Base", () => {
  it("reads its Base USDC from the chain, not from the indexer that trails its own fills", async () => {
    // One $5 buy has filled: the chain says $14.975 and the indexer still says $20.
    const agent = await liveAgent({ reserveUsd: 10, base: { chain: 14.975, indexer: 20 } });
    const portfolio = await getPortfolio(agent.agentId, FOR_BUY);

    expect(portfolio.cashUsd).toBeCloseTo(14.975, 6);
    expect(wallets.asked.indexer).toEqual([]);
    expect(portfolio.cashReadFailed).toBe(false);
    // Read from the chain, nothing has to be allowed for.
    expect(portfolio).not.toHaveProperty("cashUnseenUsd");

    // The second $5 buy would leave $9.95 under a $10 reserve, and is refused. On the
    // indexer's $20 it passed, and so did the third.
    const order = { chain: "base" as const, side: "buy" as const, tokenId: "base:0xnew", tokenAddress: "0xnew", symbol: "NEW", amountUsd: 5 };
    const [row] = await db.select().from(schema.agents).where(eq(schema.agents.id, agent.agentId));
    const verdict = riskGuard({ id: agent.agentId, mode: "live", config: row!.config }, toRiskPortfolio(portfolio), order, strongScore());
    expect(verdict).toMatchObject({ ok: false, code: "cash_reserve", params: { leftUsd: 9.95, reserveUsd: 10 } });
  });

  it("falls back to the indexer when the chain does not answer, and takes its recent buys off that figure", async () => {
    const agent = await liveAgent({ reserveUsd: 10, base: { chain: null, indexer: 20 } });
    // A $5 buy a minute ago, which the indexer's $20 does not show yet. One from before
    // the lag it is allowed, and one on another chain, are in the figure already.
    await filledBuy(agent, "base", 5, 60_000);
    await filledBuy(agent, "base", 3, INDEXER_LAG_MS + 60_000);
    await filledBuy(agent, "solana", 7, 60_000);
    const portfolio = await getPortfolio(agent.agentId, FOR_BUY);

    expect(wallets.asked.indexer).toEqual([agent.walletIds.base]);
    // The cash shown is still what the wallet was read as: only the reserve is stricter.
    expect(portfolio.cashUsd).toBeCloseTo(20, 6);
    expect(portfolio.cashUnseenUsd).toBeCloseTo(5, 6);
    const book = toRiskPortfolio(portfolio);
    expect(book.cashUsd).toBeCloseTo(20, 6);
    expect(book.cashSpokenForUsd).toBeCloseTo(5, 6);

    // $20 read, $5 of it already spent, $10 kept: $5 to spend, which a $5 buy and its
    // fee do not fit in.
    const [row] = await db.select().from(schema.agents).where(eq(schema.agents.id, agent.agentId));
    const guard = (amountUsd: number) =>
      riskGuard(
        { id: agent.agentId, mode: "live", config: row!.config },
        book,
        { chain: "base", side: "buy", tokenId: "base:0xnew", tokenAddress: "0xnew", symbol: "NEW", amountUsd },
        strongScore(),
      );
    expect(guard(5)).toMatchObject({ ok: false, code: "cash_reserve", params: { settlingUsd: 5 } });
    expect(guard(4.97)).toEqual({ ok: true });
  });

  it("is read from the indexer, with nothing allowed for, by anything that is not judging a buy", async () => {
    // A sell, an exit, a prompt, a page: the book they read is the one it always was.
    const agent = await liveAgent({ reserveUsd: 10, base: { chain: 14.975, indexer: 20 } });
    await filledBuy(agent, "base", 5, 60_000);
    const portfolio = await getPortfolio(agent.agentId);
    expect(wallets.asked.baseChain).toBe(0);
    expect(wallets.asked.indexer).toEqual([agent.walletIds.base]);
    expect(portfolio.cashUsd).toBeCloseTo(20, 6);
    expect(portfolio).not.toHaveProperty("cashUnseenUsd");
    expect(portfolio).not.toHaveProperty("buysInFlight");
  });

  it("allows for nothing when no buy is recent", async () => {
    const agent = await liveAgent({ reserveUsd: 10, base: { chain: null, indexer: 20 } });
    await filledBuy(agent, "base", 3, INDEXER_LAG_MS + 60_000);
    const portfolio = await getPortfolio(agent.agentId, FOR_BUY);
    expect(portfolio).not.toHaveProperty("cashUnseenUsd");
    expect(toRiskPortfolio(portfolio)).not.toHaveProperty("cashSpokenForUsd");
  });
});

describe("a live agent with a cash reserve, on Solana", () => {
  it("is read from the chain as it always was, and allows for its recent buys only when the chain does not answer", async () => {
    const onChain = await liveAgent({ reserveUsd: 5, solana: { chain: 14.975, indexer: 20 } });
    await filledBuy(onChain, "solana", 5, 60_000);
    const fresh = await getPortfolio(onChain.agentId, FOR_BUY);
    expect(fresh.cashUsd).toBeCloseTo(14.975, 6);
    expect(fresh).not.toHaveProperty("cashUnseenUsd");

    const silent = await liveAgent({ reserveUsd: 5, solana: { chain: null, indexer: 20 } });
    await filledBuy(silent, "solana", 5, 60_000);
    const stale = await getPortfolio(silent.agentId, FOR_BUY);
    expect(stale.cashUsd).toBeCloseTo(20, 6);
    expect(stale.cashUnseenUsd).toBeCloseTo(5, 6);
  });
});

describe("a live agent with no cash reserve", () => {
  it("has its Base wallet read from the indexer, exactly as before, and nothing allowed for", async () => {
    for (const reserveUsd of [undefined, 0]) {
      wallets.asked.baseChain = 0;
      wallets.asked.indexer = [];
      const agent = await liveAgent({ ...(reserveUsd === undefined ? {} : { reserveUsd }), base: { chain: 14.975, indexer: 20 } });
      await filledBuy(agent, "base", 5, 60_000);
      const portfolio = await getPortfolio(agent.agentId, FOR_BUY);

      expect(portfolio.cashUsd).toBeCloseTo(20, 6);
      expect(wallets.asked.baseChain).toBe(0);
      expect(wallets.asked.indexer).toEqual([agent.walletIds.base]);
      expect(portfolio).not.toHaveProperty("cashUnseenUsd");
      expect(portfolio).not.toHaveProperty("buysInFlight");
      // The book the guard is handed has the four fields it always had and no other.
      expect(toRiskPortfolio(portfolio)).toEqual({ cashUsd: 20, equityUsd: 20, tradesToday: 1, positions: [] });
    }
  });

  it("with a position limit alone is read the same way: the chain read is the reserve's", async () => {
    const agent = await liveAgent({ base: { chain: 14.975, indexer: 20 } });
    const [row] = await db.select().from(schema.agents).where(eq(schema.agents.id, agent.agentId));
    await db
      .update(schema.agents)
      .set({ config: { ...row!.config, risk: { ...row!.config.risk, maxOpenPositions: 3 } } })
      .where(eq(schema.agents.id, agent.agentId));
    await filledBuy(agent, "base", 5, 60_000);
    const portfolio = await getPortfolio(agent.agentId, FOR_BUY);
    expect(portfolio.cashUsd).toBeCloseTo(20, 6);
    expect(wallets.asked.baseChain).toBe(0);
    expect(portfolio).not.toHaveProperty("cashUnseenUsd");
  });
});
