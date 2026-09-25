import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/db";
import * as schema from "@/db/schema";
import { DEFAULT_AGENT_CONFIG } from "@/lib/agent/config";
import { seedAgent, setupTestDb } from "@/lib/agent/test-support";
import { universeKey } from "@/lib/tokens";
import { recordScore } from "@/lib/tokens/history";
import type { TokenScore } from "@/server/types";
import { getTokenPage, myAgentsForBlocklist, searchTokens } from "./tokens";

const ADDRESS = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const TOKEN_ID = `solana:${ADDRESS}`;
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const USDC_ID = `solana:${USDC}`;

const DAY = 86_400_000;
const NOW = Date.now();

let db: Db;
let publicAgent: { agentId: string; userId: string; slug: string };
let privateAgent: { agentId: string; userId: string; slug: string };

function score(over: Partial<TokenScore> = {}): TokenScore {
  return {
    tokenId: TOKEN_ID,
    chain: "solana",
    address: ADDRESS,
    symbol: "BONK",
    name: "Bonk",
    total: 74,
    verdict: "candidate",
    components: { safety: 82, liquidity: 71, organic: 66, distribution: 61, momentum: 58, gecko: null, sentiment: null, smartMoney: null },
    blockers: [],
    warnings: ["top10_holders_concentrated"],
    priceUsd: 0.00004,
    liquidityUsd: 1_250_000,
    volume24hUsd: 9_000_000,
    marketCapUsd: 2_100_000_000,
    holderCount: 812_000,
    ageHours: 9_000,
    priceChange24hPct: 4.2,
    sources: ["jupiter", "rugcheck"],
    scoredAt: new Date(NOW - 4 * 60_000).toISOString(),
    ...over,
  };
}

async function insertToken(id: string, address: string, symbol: string, price: string) {
  await db.insert(schema.tokens).values({
    id,
    chain: "solana",
    address,
    symbol,
    name: symbol,
    decimals: 5,
    lastPriceUsd: price,
    priceUpdatedAt: new Date(NOW),
  });
}

/** Writes the score cache row the way `getTokenScore` would, under a given universe. */
async function writeScoreRow(s: TokenScore, key: string) {
  await db.insert(schema.tokenScores).values({
    id: s.tokenId,
    chain: s.chain,
    address: s.address,
    symbol: s.symbol,
    total: s.total.toFixed(2),
    verdict: s.verdict,
    components: { ...s.components } as Record<string, number | null>,
    blockers: s.blockers,
    warnings: s.warnings,
    priceUsd: s.priceUsd === null ? null : s.priceUsd.toFixed(12),
    liquidityUsd: s.liquidityUsd === null ? null : s.liquidityUsd.toFixed(2),
    volume24hUsd: s.volume24hUsd === null ? null : s.volume24hUsd.toFixed(2),
    marketCapUsd: s.marketCapUsd === null ? null : s.marketCapUsd.toFixed(2),
    holderCount: s.holderCount,
    ageHours: s.ageHours === null ? null : s.ageHours.toFixed(2),
    priceChange24hPct: s.priceChange24hPct === null ? null : s.priceChange24hPct.toFixed(4),
    sources: s.sources,
    universeKey: key,
    scoredAt: new Date(s.scoredAt),
  });
}

async function insertTrade(over: {
  id: string;
  agentId: string;
  ownerId: string;
  side: "buy" | "sell";
  amountToken: string;
  amountUsd: string;
  priceUsd: string;
  createdAt: Date;
  status?: "filled" | "failed";
  entryScore?: number;
}) {
  await db.insert(schema.trades).values({
    id: over.id,
    agentId: over.agentId,
    ownerId: over.ownerId,
    chain: "solana",
    side: over.side,
    tokenId: TOKEN_ID,
    quoteTokenId: USDC_ID,
    amountToken: over.amountToken,
    amountUsd: over.amountUsd,
    priceUsd: over.priceUsd,
    feeUsd: "0.000000",
    status: over.status ?? "filled",
    isPaper: true,
    rationale: "because the score held up",
    scoreSnapshot:
      over.entryScore === undefined
        ? null
        : {
            total: over.entryScore,
            verdict: "candidate",
            components: {},
            blockers: [],
            warnings: [],
            liquidityUsd: 1_000_000,
            ageHours: 9_000,
            scoredAt: over.createdAt.toISOString(),
          },
    createdAt: over.createdAt,
    filledAt: over.createdAt,
  });
}

beforeAll(async () => {
  db = await setupTestDb();
  await insertToken(TOKEN_ID, ADDRESS, "BONK", "0.000050");
  await insertToken(USDC_ID, USDC, "USDC", "1.000000");

  publicAgent = await seedAgent(db);
  privateAgent = await seedAgent(db);
  await db.update(schema.agents).set({ isPublic: false }).where(eq(schema.agents.id, privateAgent.agentId));

  await writeScoreRow(score(), universeKey(DEFAULT_AGENT_CONFIG.universe));

  // 3 points of history
  await recordScore(score({ total: 61, scoredAt: new Date(NOW - 3 * DAY).toISOString() }));
  await recordScore(score({ total: 70, scoredAt: new Date(NOW - 2 * DAY).toISOString() }));
  await recordScore(score({ total: 74, scoredAt: new Date(NOW - 60_000).toISOString() }));

  // public agent: bought 1,000,000 at 0.00004 → mark 0.00005 is +25%
  await insertTrade({
    id: "trade_public_buy",
    agentId: publicAgent.agentId,
    ownerId: publicAgent.userId,
    side: "buy",
    amountToken: "1000000.000000000000",
    amountUsd: "40.000000",
    priceUsd: "0.000040000000",
    createdAt: new Date(NOW - 5 * DAY),
    entryScore: 81,
  });
  await insertTrade({
    id: "trade_public_sell",
    agentId: publicAgent.agentId,
    ownerId: publicAgent.userId,
    side: "sell",
    amountToken: "200000.000000000000",
    amountUsd: "10.000000",
    priceUsd: "0.000050000000",
    createdAt: new Date(NOW - 1 * DAY),
  });
  // outside the 30d flow window
  await insertTrade({
    id: "trade_public_old",
    agentId: publicAgent.agentId,
    ownerId: publicAgent.userId,
    side: "buy",
    amountToken: "10000.000000000000",
    amountUsd: "1000.000000",
    priceUsd: "0.100000000000",
    createdAt: new Date(NOW - 45 * DAY),
  });
  // never filled — must not appear anywhere
  await insertTrade({
    id: "trade_public_failed",
    agentId: publicAgent.agentId,
    ownerId: publicAgent.userId,
    side: "buy",
    amountToken: "5.000000000000",
    amountUsd: "5.000000",
    priceUsd: "1.000000000000",
    createdAt: new Date(NOW - 2 * DAY),
    status: "failed",
  });
  // private agent's fill
  await insertTrade({
    id: "trade_private_buy",
    agentId: privateAgent.agentId,
    ownerId: privateAgent.userId,
    side: "buy",
    amountToken: "500000.000000000000",
    amountUsd: "20.000000",
    priceUsd: "0.000040000000",
    createdAt: new Date(NOW - 4 * DAY),
  });

  await db.insert(schema.positions).values([
    {
      agentId: publicAgent.agentId,
      tokenId: TOKEN_ID,
      amountToken: "800000.000000000000",
      avgCostUsd: "0.000040000000",
      realizedPnlUsd: "2.000000",
      openedAt: new Date(NOW - 5 * DAY),
      entryScore: "81.00",
    },
    {
      agentId: privateAgent.agentId,
      tokenId: TOKEN_ID,
      amountToken: "500000.000000000000",
      avgCostUsd: "0.000040000000",
      realizedPnlUsd: "0.000000",
      openedAt: new Date(NOW - 4 * DAY),
    },
  ]);
});

describe("getTokenPage", () => {
  it("returns the token, the cached score and its history", async () => {
    const page = await getTokenPage("solana", ADDRESS);
    expect(page).not.toBeNull();
    expect(page!.token).toMatchObject({ id: TOKEN_ID, symbol: "BONK", chain: "solana" });
    expect(page!.score?.total).toBeCloseTo(74, 2);
    expect(page!.score?.verdict).toBe("candidate");
    expect(page!.score?.warnings).toEqual(["top10_holders_concentrated"]);
    expect(page!.history.map((p) => p.total)).toEqual([61, 70, 74]);
  });

  it("shows public holders with their unrealized PnL, and hides private ones", async () => {
    const page = await getTokenPage("solana", ADDRESS);
    expect(page!.holders).toHaveLength(1);
    expect(page!.holders[0].agent.id).toBe(publicAgent.agentId);
    // 800,000 at cost 0.00004 marked at 0.00005 → +25%
    expect(page!.holders[0].unrealizedPnlPct).toBeCloseTo(25, 6);
    expect(page!.holders[0].valueUsd).toBeCloseTo(40, 6);
  });

  it("lets the owner of a private agent see their own position", async () => {
    const page = await getTokenPage("solana", ADDRESS, privateAgent.userId);
    const ids = page!.holders.map((h) => h.agent.id);
    expect(ids).toContain(privateAgent.agentId);
    expect(ids).toContain(publicAgent.agentId);
  });

  it("lists only filled trades from visible agents, newest first", async () => {
    const page = await getTokenPage("solana", ADDRESS);
    const ids = page!.recentTrades.map((t) => t.id);
    expect(ids).toEqual(["trade_public_sell", "trade_public_buy", "trade_public_old"]);
    expect(ids).not.toContain("trade_private_buy");
    expect(ids).not.toContain("trade_public_failed");
    // the frozen entry score travels with the row
    expect(page!.recentTrades.find((t) => t.id === "trade_public_buy")!.entryScore).toBeCloseTo(81, 6);
  });

  it("counts 30-day flow and nets buys against sells", async () => {
    const page = await getTokenPage("solana", ADDRESS);
    expect(page!.stats.agentBuys30d).toBe(1);
    expect(page!.stats.agentSells30d).toBe(1);
    // +40 bought, −10 sold; the 45-day-old $1000 buy is outside the window
    expect(page!.stats.netFlowUsd30d).toBeCloseTo(30, 6);
  });

  it("renders a token nobody ever scored, with a score of null", async () => {
    const page = await getTokenPage("base", "0x000000000000000000000000000000000000dEaD");
    expect(page).not.toBeNull();
    expect(page!.score).toBeNull();
    expect(page!.marketFacts).toBeNull();
    expect(page!.history).toEqual([]);
    expect(page!.holders).toEqual([]);
    expect(page!.recentTrades).toEqual([]);
    expect(page!.stats).toEqual({ agentBuys30d: 0, agentSells30d: 0, netFlowUsd30d: 0 });
    // a placeholder symbol, never an empty string
    expect(page!.token.symbol.length).toBeGreaterThan(0);
    expect(page!.token.chain).toBe("base");
  });

  it("refuses an address that cannot be one", async () => {
    expect(await getTokenPage("solana", "")).toBeNull();
  });

  it("ignores a cached score produced under a different universe", async () => {
    const other = `solana:${"Fq".repeat(20)}`;
    await writeScoreRow(
      score({ tokenId: other, address: "Fq".repeat(20), symbol: "STRICT", blockers: ["liquidity_below_floor"] }),
      universeKey({ ...DEFAULT_AGENT_CONFIG.universe, minLiquidityUsd: 5_000_000 }),
    );
    const page = await getTokenPage("solana", "Fq".repeat(20));
    // The row exists, but its verdict was computed against someone else's floor.
    expect(page!.score).toBeNull();
    // Its market facts are universe-independent and still shown — and only those.
    expect(page!.marketFacts).toMatchObject({ liquidityUsd: 1_250_000, marketCapUsd: 2_100_000_000, holderCount: 812_000 });
    expect(Object.keys(page!.marketFacts!)).not.toContain("blockers");
    expect(Object.keys(page!.marketFacts!)).not.toContain("verdict");
  });
});

describe("searchTokens", () => {
  it("matches on symbol, case-insensitively", async () => {
    expect((await searchTokens("bon")).map((t) => t.symbol)).toContain("BONK");
    expect((await searchTokens("BONK")).map((t) => t.symbol)).toContain("BONK");
  });

  it("matches on address", async () => {
    expect((await searchTokens(ADDRESS.slice(0, 10))).map((t) => t.id)).toEqual([TOKEN_ID]);
  });

  it("lists the table for a blank query, so the palette has something to filter", async () => {
    const all = await searchTokens("   ", 50);
    expect(all.map((t) => t.symbol).sort()).toEqual(["BONK", "USDC"]);
  });

  it("finds nothing for a query that matches nothing", async () => {
    expect(await searchTokens("zzzznope")).toEqual([]);
  });
});

describe("myAgentsForBlocklist", () => {
  it("lists the viewer's agents and whether each already blocks the token", async () => {
    const before = await myAgentsForBlocklist(publicAgent.userId, "solana", ADDRESS);
    expect(before).toHaveLength(1);
    expect(before[0]).toMatchObject({ id: publicAgent.agentId, blocked: false, onChain: true });
    const onBase = await myAgentsForBlocklist(publicAgent.userId, "base", ADDRESS);
    expect(onBase[0].onChain).toBe(false);

    const [row] = await db
      .select({ config: schema.agents.config })
      .from(schema.agents)
      .where(eq(schema.agents.id, publicAgent.agentId));
    await db
      .update(schema.agents)
      .set({
        config: {
          ...row.config,
          universe: {
            ...row.config.universe,
            blocklist: [{ chain: "solana" as const, address: ADDRESS.toUpperCase(), symbol: "BONK" }],
          },
        },
      })
      .where(eq(schema.agents.id, publicAgent.agentId));

    const after = await myAgentsForBlocklist(publicAgent.userId, "solana", ADDRESS);
    // address comparison is case-insensitive — EVM checksums differ, Solana does not
    expect(after[0].blocked).toBe(true);
  });

  it("never returns someone else's agents", async () => {
    const rows = await myAgentsForBlocklist(privateAgent.userId, "solana", ADDRESS);
    expect(rows.map((r) => r.id)).toEqual([privateAgent.agentId]);
  });
});
