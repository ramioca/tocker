import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/db";
import * as schema from "@/db/schema";
import { DEFAULT_AGENT_CONFIG } from "@/lib/agent/config";
import { seedAgent, setupTestDb } from "@/lib/agent/test-support";
import { universeKey } from "@/lib/tokens";
import { recordScore } from "@/lib/tokens/history";
import type { TokenScore } from "@/server/types";
import { getTokenPage, getTokenTrade, myAgentsForBlocklist, searchTokens } from "./tokens";

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
  const publicKey = universeKey(DEFAULT_AGENT_CONFIG.universe);
  await recordScore(score({ total: 61, scoredAt: new Date(NOW - 3 * DAY).toISOString() }), publicKey);
  await recordScore(score({ total: 70, scoredAt: new Date(NOW - 2 * DAY).toISOString() }), publicKey);
  await recordScore(score({ total: 74, scoredAt: new Date(NOW - 60_000).toISOString() }), publicKey);
  // An agent's reading under its own rules, and a legacy one with no universe on record:
  // neither may chart as the public score.
  const strictKey = universeKey({ ...DEFAULT_AGENT_CONFIG.universe, minLiquidityUsd: 5_000_000 });
  await recordScore(score({ total: 88, verdict: "avoid", scoredAt: new Date(NOW - 1 * DAY).toISOString() }), strictKey);
  await recordScore(score({ total: 55, scoredAt: new Date(NOW - 1.5 * DAY).toISOString() }));

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

  it("keeps the public score when an agent rescores the token under its own rules", async () => {
    const address = "Pk".repeat(20);
    const id = `solana:${address}`;
    const pub = score({ tokenId: id, address, symbol: "KEEP", total: 70, verdict: "candidate" });
    await db.insert(schema.publicTokenScores).values({
      id,
      chain: pub.chain,
      address,
      symbol: pub.symbol,
      total: "70.00",
      verdict: pub.verdict,
      components: { ...pub.components } as Record<string, number | null>,
      blockers: [],
      warnings: [],
      priceUsd: "0.000040000000",
      liquidityUsd: "1250000.00",
      volume24hUsd: null,
      marketCapUsd: null,
      holderCount: 812_000,
      ageHours: null,
      priceChange24hPct: null,
      sources: pub.sources,
      scoredAt: new Date(NOW - 10 * 60_000),
    });
    // Later, an agent with a stricter floor scores it and overwrites the shared cache row.
    await writeScoreRow(
      score({ tokenId: id, address, symbol: "KEEP", total: 40, verdict: "avoid", blockers: ["liquidity_below_floor"], liquidityUsd: 2_000_000 }),
      universeKey({ ...DEFAULT_AGENT_CONFIG.universe, minLiquidityUsd: 5_000_000 }),
    );

    const page = await getTokenPage("solana", address);
    expect(page!.score?.total).toBeCloseTo(70, 2);
    expect(page!.score?.verdict).toBe("candidate");
    expect(page!.score?.blockers).toEqual([]);
    // Market facts follow the newest reading, whoever took it.
    expect(page!.marketFacts?.liquidityUsd).toBe(2_000_000);
  });

  it("never publishes a reading no provider answered as the token's verdict", async () => {
    const address = "Nd".repeat(20);
    await writeScoreRow(
      score({
        tokenId: `solana:${address}`,
        address,
        symbol: "OUTAGE",
        total: 0,
        verdict: "avoid",
        blockers: ["mint_authority_unknown", "liquidity_unknown"],
        sources: [],
        priceUsd: null,
        liquidityUsd: null,
        holderCount: null,
      }),
      universeKey(DEFAULT_AGENT_CONFIG.universe),
    );
    const page = await getTokenPage("solana", address);
    expect(page!.score).toBeNull();
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

/**
 * One Base contract, one page. Every row about a token is keyed by `chain:address` as
 * its writer spelled the address: discovery lowercases, the known-token list and a
 * trade from a block explorer's link use the checksum. An EVM address means the same in
 * any case, so the page reads all of them, and says the same thing whatever the URL.
 *
 * Last in the file on purpose: these rows would otherwise show up in `searchTokens`.
 */
describe("getTokenPage for a Base contract, in any letter-case", () => {
  const CHECKSUM = "0x940181a94A35A4569E4529A3CDfB74e38FD98631";
  const LOWER = CHECKSUM.toLowerCase();
  const UPPER = `0x${CHECKSUM.slice(2).toUpperCase()}`;
  const SPELLINGS = [CHECKSUM, LOWER, UPPER];
  const publicKey = universeKey(DEFAULT_AGENT_CONFIG.universe);

  // A second contract whose rows are split across two stored spellings.
  const SPLIT = "0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed";
  const SPLIT_LOWER = SPLIT.toLowerCase();

  async function insertBaseToken(address: string, symbol: string, price: string | null) {
    await db.insert(schema.tokens).values({
      id: `base:${address}`,
      chain: "base",
      address,
      symbol,
      name: symbol,
      decimals: 18,
      lastPriceUsd: price,
      priceUpdatedAt: price === null ? null : new Date(NOW),
    });
  }

  async function insertBaseTrade(over: {
    id: string;
    tokenId: string;
    agentId: string;
    ownerId: string;
    side: "buy" | "sell";
    amountUsd: string;
    createdAt: Date;
  }) {
    await db.insert(schema.trades).values({
      id: over.id,
      agentId: over.agentId,
      ownerId: over.ownerId,
      chain: "base",
      side: over.side,
      tokenId: over.tokenId,
      quoteTokenId: USDC_ID,
      amountToken: "100.000000000000",
      amountUsd: over.amountUsd,
      priceUsd: "0.500000000000",
      feeUsd: "0.000000",
      status: "filled",
      isPaper: true,
      rationale: "because the score held up",
      scoreSnapshot: null,
      createdAt: over.createdAt,
      filledAt: over.createdAt,
    });
  }

  beforeAll(async () => {
    // The book knows AERO by its checksum spelling: one holder, one fill.
    await insertBaseToken(CHECKSUM, "AERO", "1.000000");
    await db.insert(schema.positions).values({
      agentId: publicAgent.agentId,
      tokenId: `base:${CHECKSUM}`,
      amountToken: "100.000000000000",
      avgCostUsd: "0.500000000000",
      realizedPnlUsd: "0.000000",
      openedAt: new Date(NOW - 2 * DAY),
    });
    await insertBaseTrade({
      id: "trade_aero_buy",
      tokenId: `base:${CHECKSUM}`,
      agentId: publicAgent.agentId,
      ownerId: publicAgent.userId,
      side: "buy",
      amountUsd: "50.000000",
      createdAt: new Date(NOW - 2 * DAY),
    });
    // Discovery scored it under the lowercase spelling, as it does for every Base token.
    const discovered = score({
      tokenId: `base:${LOWER}`,
      chain: "base",
      address: LOWER,
      symbol: "AERO",
      total: 79,
      scoredAt: new Date(NOW - 5 * 60_000).toISOString(),
    });
    await writeScoreRow(discovered, publicKey);
    await recordScore({ ...discovered, total: 72, scoredAt: new Date(NOW - 1 * DAY).toISOString() }, publicKey);
    await recordScore(discovered, publicKey);

    // DEGEN: a row under each spelling, the same agent holding and trading under both.
    await insertBaseToken(SPLIT, "DEGEN", null);
    await insertBaseToken(SPLIT_LOWER, "DEGEN", "2.000000");
    await db.insert(schema.positions).values([
      {
        agentId: publicAgent.agentId,
        tokenId: `base:${SPLIT}`,
        amountToken: "10.000000000000",
        avgCostUsd: "1.000000000000",
        realizedPnlUsd: "0.000000",
        openedAt: new Date(NOW - 3 * DAY),
      },
      {
        agentId: publicAgent.agentId,
        tokenId: `base:${SPLIT_LOWER}`,
        amountToken: "30.000000000000",
        avgCostUsd: "2.000000000000",
        realizedPnlUsd: "0.000000",
        openedAt: new Date(NOW - 1 * DAY),
      },
    ]);
    await insertBaseTrade({
      id: "trade_degen_checksum",
      tokenId: `base:${SPLIT}`,
      agentId: publicAgent.agentId,
      ownerId: publicAgent.userId,
      side: "buy",
      amountUsd: "10.000000",
      createdAt: new Date(NOW - 3 * DAY),
    });
    await insertBaseTrade({
      id: "trade_degen_lower",
      tokenId: `base:${SPLIT_LOWER}`,
      agentId: publicAgent.agentId,
      ownerId: publicAgent.userId,
      side: "buy",
      amountUsd: "60.000000",
      createdAt: new Date(NOW - 1 * DAY),
    });
    // Two public readings, one per spelling: the newer one is the token's score.
    await writeScoreRow(
      score({ tokenId: `base:${SPLIT}`, chain: "base", address: SPLIT, symbol: "DEGEN", total: 70, scoredAt: new Date(NOW - 2 * DAY).toISOString() }),
      publicKey,
    );
    await writeScoreRow(
      score({ tokenId: `base:${SPLIT_LOWER}`, chain: "base", address: SPLIT_LOWER, symbol: "DEGEN", total: 64, scoredAt: new Date(NOW - 60_000).toISOString() }),
      publicKey,
    );
  });

  it("is the same page for the checksum, lowercase and uppercase spellings", async () => {
    for (const spelling of SPELLINGS) {
      const page = await getTokenPage("base", spelling);
      // The stored row, not a placeholder built from the URL.
      expect(page!.token).toMatchObject({ id: `base:${CHECKSUM}`, address: CHECKSUM, symbol: "AERO" });
      expect(page!.holders.map((h) => h.agent.id)).toEqual([publicAgent.agentId]);
      // 100 tokens at cost 0.50, marked at 1.00.
      expect(page!.holders[0].valueUsd).toBeCloseTo(100, 6);
      expect(page!.holders[0].unrealizedPnlPct).toBeCloseTo(100, 6);
      expect(page!.recentTrades.map((t) => t.id)).toEqual(["trade_aero_buy"]);
      expect(page!.stats).toEqual({ agentBuys30d: 1, agentSells30d: 0, netFlowUsd30d: 50 });
    }
  });

  it("shows the score discovery wrote under lowercase on the checksummed page too", async () => {
    // The page that read "Not scored yet" for a token agents held.
    for (const spelling of SPELLINGS) {
      const page = await getTokenPage("base", spelling);
      expect(page!.score?.total).toBeCloseTo(79, 2);
      expect(page!.history.map((p) => p.total)).toEqual([72, 79]);
      expect(page!.marketFacts?.liquidityUsd).toBe(1_250_000);
    }
  });

  it("reads a contract stored under two spellings as one token", async () => {
    for (const spelling of [SPLIT, SPLIT_LOWER]) {
      const page = await getTokenPage("base", spelling);
      // The checksum row names the token, whichever spelling asked.
      expect(page!.token.id).toBe(`base:${SPLIT}`);
      // One line for the agent: 10 at $1 and 30 at $2 is 40 tokens costing $70, and the
      // only mark on record ($2, on the lowercase row) values them at $80.
      expect(page!.holders).toHaveLength(1);
      expect(page!.holders[0].valueUsd).toBeCloseTo(80, 6);
      expect(page!.holders[0].unrealizedPnlPct).toBeCloseTo((10 / 70) * 100, 6);
      expect(page!.recentTrades.map((t) => t.id)).toEqual(["trade_degen_lower", "trade_degen_checksum"]);
      expect(page!.stats).toEqual({ agentBuys30d: 2, agentSells30d: 0, netFlowUsd30d: 70 });
      // The newer of the two public readings, not whichever the URL happened to match.
      expect(page!.score?.total).toBeCloseTo(64, 2);
    }
  });

  it("finds a fill linked by id under either spelling of its token", async () => {
    const page = await getTokenPage("base", SPLIT);
    const found = await getTokenTrade("trade_degen_lower", page!.token, null);
    expect(found?.id).toBe("trade_degen_lower");
    // Still only this token's fills.
    expect(await getTokenTrade("trade_aero_buy", page!.token, null)).toBeNull();
  });

  it("keeps a Solana mint exact: base58 is case-sensitive", async () => {
    const page = await getTokenPage("solana", ADDRESS.toLowerCase());
    expect(page!.token.id).toBe(`solana:${ADDRESS.toLowerCase()}`);
    expect(page!.holders).toEqual([]);
    expect(page!.recentTrades).toEqual([]);
    expect(page!.score).toBeNull();
  });

  it("still builds a page for a Base contract nobody has seen", async () => {
    const unseen = "0x1111111111111111111111111111111111111111";
    const page = await getTokenPage("base", unseen);
    expect(page!.token).toMatchObject({ id: `base:${unseen}`, chain: "base" });
    expect(page!.score).toBeNull();
    expect(page!.holders).toEqual([]);
  });
});
