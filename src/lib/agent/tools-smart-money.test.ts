/**
 * Smart money, as a tick uses it: the per-token read `score_token` buys, and the board
 * `discover_tokens` buys when the owner switched its feed on.
 *
 * The owner's question was why an agent that pays for smart money on every token almost
 * never mentions it. It was buying a chain's top-fifty board for five cents per token
 * and finding the token absent. What is pinned here is the replacement: one cent per
 * token for a read about that token, said in a line the model reads, three ways (a
 * reading, nobody tracked traded it, not read); and the board as an opt-in way to find
 * tokens, bought once per chain per tick and never by the model's choice alone.
 *
 * The tools are the real ones on PGlite. Tokens come from the providers' fixtures
 * (`TOKENS_MOCK`) and paid calls run in their mock mode, which writes a payment row for
 * every purchase: counting rows is counting payments, and a row's URL is what was bought.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import type { Db } from "@/db";
import * as schema from "@/db/schema";
import { getDataSource } from "@/lib/data-sources/registry";
import { discoverCandidates, resetTokenCaches, universeKey } from "@/lib/tokens";
import { resetPriceCache } from "@/lib/trading/prices";
import { seedKnownTokens } from "@/lib/trading/tokens";
import { newBudget } from "@/lib/x402/types";
import { DEFAULT_AGENT_CONFIG } from "./config";
import { MIN_SCORED_PER_TICK } from "./limits";
import { RunLogger } from "./logger";
import { describeResult } from "./narrate";
import { buildTools, type RunContext } from "./tools";
import { seedAgent, setupTestDb, type SeedConfigOverrides } from "./test-support";

const SOURCE = "nansen-smart-money";
const TOKEN_URL = "https://api.nansen.ai/api/v1/tgm/flow-intelligence";
const BOARD_URL = "https://api.nansen.ai/api/v1/smart-money/netflow";

// Solana tokens in the providers' fixtures. In the mock, tracked wallets traded BONK and
// KNOTS, the two the board shows them buying, and none of the others.
const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const STONK = "6GmAFSYs4gk3FDao5FzzySQpPZaWsa4rUJHacpMpUNgx";
const PUMP = "pumpCmXqMfrsAkQ5r49WcJnRayYRqmXz6ae8H7H9Dfn";
const EMBER = "5dvXTZ5qwgafnHtwu3Ls3QrWx1U4LQsFeCuJgkk4QEC6";
const MET = "METvsvVRapdj9cFLzq4Tr43xK4tAjQfwX76z3n6mWQL";
const KNOTS = "8RVBk8vxLiUHueLUW1f4izFVqN3nWippLhkohKg6EGkS";

const READING =
  "Smart money, last 24h: 3 smart traders and 1 top-PnL wallet net bought $12.4k. Whales net sold $2.1k; fresh wallets net bought $40.2k; exchange net flow -$18.4k.";
const NOBODY = "Smart money, last 24h: no smart trader or top-PnL wallet tracked by Nansen traded it.";

let db: Db;

beforeAll(async () => {
  process.env.X402_MOCK = "1";
  db = await setupTestDb();
  await seedKnownTokens();
}, 120_000);

beforeEach(async () => {
  // The score cache is one table for every agent in this file: start each test with
  // nothing scored, and with no read remembered from the test before.
  await db.delete(schema.tokenScores);
  await resetTokenCaches();
  resetPriceCache();
  // Marks and quotes stay offline; nothing here should need them to answer.
  globalThis.fetch = (async () => new Response("[]", { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;
});

type ToolExec = (input: unknown, options: unknown) => Promise<Record<string, unknown>>;
type Row = { symbol: string; chain: string; address: string; origin: string; liquidityUsd: number | null; holderCount: number | null; smartMoneyNetflow24hUsd?: number };

const universe = (over: Partial<typeof DEFAULT_AGENT_CONFIG.universe> = {}) => ({ ...DEFAULT_AGENT_CONFIG.universe, ...over });
/** No gate at all, so that what is bought for a token depends on the plan and nothing else. */
const OPEN = universe({
  minScore: 0,
  minLiquidityUsd: 0,
  minHolderCount: 0,
  minAgeMinutes: 0,
  maxAgeHours: null,
  maxTop10HolderPct: 100,
  maxBuyTaxPct: 100,
  requireMintRevoked: false,
  requireFreezeRevoked: false,
});
/** The owner's two switches for the board, both on. */
const BOARD_ON = { dataSources: [SOURCE], universe: universe({ discovery: [...DEFAULT_AGENT_CONFIG.universe.discovery, "smart_money"] }) };

/** One tick's tools for a freshly seeded Solana paper agent, called the way the AI SDK would. */
async function tick(config: SeedConfigOverrides = {}) {
  const { agentId } = await seedAgent(db, { config: { chains: ["solana"], dataSources: [SOURCE], ...config } });
  const [agent] = await db.select().from(schema.agents).where(eq(schema.agents.id, agentId)).limit(1);
  if (!agent) throw new Error("agent missing");
  const runId = `run-${agentId.slice(0, 8)}`;
  await db.insert(schema.agentRuns).values({ id: runId, agentId, trigger: "manual", status: "running", startedAt: new Date() });
  const budget = newBudget(agent.config.risk.maxDataSpendUsdPerRun);
  const ctx: RunContext = {
    runId,
    agent: { id: agent.id, ownerId: agent.ownerId, slug: agent.slug, name: agent.name, mode: agent.mode, config: agent.config },
    x402: { agentId: agent.id, runId, mode: agent.mode, wallets: [], budget },
    budget,
    logger: new RunLogger(runId),
    finished: { summary: null },
    tradeIds: [],
    postIds: [],
  };
  const tools = buildTools(ctx);
  const call = (name: string) => {
    const execute = tools[name]?.execute as unknown as ToolExec | undefined;
    if (!execute) throw new Error(`${name} is not registered`);
    return (input: unknown = {}) => execute(input, { toolCallId: `call_${name}`, messages: [] });
  };
  const payments = async () => db.select().from(schema.x402Payments).where(eq(schema.x402Payments.agentId, agentId));
  return {
    agentId,
    ctx,
    budget,
    tools,
    discover: call("discover_tokens"),
    trade: call("place_trade"),
    /** query_data_source on the Nansen source, with the parameters a model would send. */
    ask: (params: Record<string, unknown>) => call("query_data_source")({ sourceId: SOURCE, params }),
    score: (address: string, flags: Record<string, unknown> = {}) => call("score_token")({ chain: "solana", address, ...flags }),
    payments,
    /** What this agent paid Nansen for, as `[url, amount]`. */
    nansen: async () => (await payments()).filter((row) => row.sourceId === SOURCE).map((row) => [row.url, row.amountUsd]),
  };
}

const rows = (result: Record<string, unknown>) => result.candidates as Row[];
const lines = (result: Record<string, unknown>) => String(result.rendered).split("\n");

describe("score_token: the smart money read", () => {
  it("makes five one-cent payments for five scored tokens, and never buys the board", async () => {
    const t = await tick({ universe: OPEN });
    const results = [];
    for (const mint of [BONK, STONK, PUMP, EMBER, MET]) results.push(await t.score(mint));

    for (const result of results) {
      expect(result.ok, String(result.reason)).toBe(true);
      expect(result.notBought, String(result.symbol)).toEqual([]);
      expect(result.paidSignals).toMatchObject({ smartMoney: true });
    }
    expect(await t.nansen()).toEqual(Array.from({ length: 5 }, () => [TOKEN_URL, "0.010000"]));
    expect((await t.payments()).some((row) => row.url === BOARD_URL)).toBe(false);
    expect(t.budget.spentUsd).toBeCloseTo(0.05, 9);
    expect(results.at(-1)?.dataSpentThisRunUsd).toBe(0.05);
  });

  it("says a reading in words, in the rendered score and beside it", async () => {
    const t = await tick({ universe: OPEN });
    const bonk = await t.score(BONK);

    expect(lines(bonk)[1]).toMatch(/ · smart money 5\d(\.\d)?$/);
    expect(lines(bonk)[2]).toBe(READING);
    expect(bonk.smartMoney).toEqual({ status: "reading", netFlowUsd: 9260.1 + 3150.4, wallets: 4, said: READING });
    expect(bonk.paidSignals).toMatchObject({ smartMoney: true });
    expect((bonk.components as { smartMoney: number | null }).smartMoney).toBeGreaterThan(50);
    expect(describeResult("score_token", bonk)).toContain("smart money net bought $12.4K by 4 wallets");
  });

  it("says that no tracked wallet traded a token, and leaves the component out", async () => {
    const t = await tick({ universe: OPEN });
    const stonk = await t.score(STONK);

    expect(lines(stonk)[1]).not.toContain("smart money");
    expect(lines(stonk)[2]).toBe(NOBODY);
    expect(stonk.smartMoney).toEqual({ status: "none", said: NOBODY });
    expect((stonk.components as { smartMoney: number | null }).smartMoney).toBeNull();
    // It was bought and it answered: the owner's transcript says what it found.
    expect(stonk.paidSignals).toMatchObject({ smartMoney: true });
    expect(stonk.notBought).toEqual([]);
    expect(describeResult("score_token", stonk)).toContain("smart money: no tracked wallet traded it");
    expect(await t.nansen()).toEqual([[TOKEN_URL, "0.010000"]]);
  });

  it("pays nothing for a token already enriched this tick, and still says its line", async () => {
    const t = await tick({ universe: OPEN });
    const first = await t.score(BONK);
    const again = await t.score(BONK);

    expect(again.notBought).toEqual(["already enriched this tick"]);
    expect(lines(again)[2]).toBe(READING);
    expect(again.smartMoney).toEqual(first.smartMoney);
    expect(again.total).toBe(first.total);
    expect(await t.nansen()).toEqual([[TOKEN_URL, "0.010000"]]);
    expect(t.budget.spentUsd).toBeCloseTo(0.01, 9);

    // The same for a token whose read found nobody.
    await t.score(STONK);
    expect(lines(await t.score(STONK))[2]).toBe(NOBODY);
    expect(await t.nansen()).toHaveLength(2);
  });

  it("skips a read the budget cannot cover, and says so", async () => {
    const t = await tick({ universe: OPEN, risk: { maxDataSpendUsdPerRun: 0 } });
    const bonk = await t.score(BONK);

    expect(bonk.ok).toBe(true);
    expect(Number(bonk.total)).toBeGreaterThan(0);
    expect(bonk.notBought).toEqual(["smartMoney: $0.01 exceeds the $0.00 left in this run's data budget"]);
    expect(lines(bonk)[2]).toBe("Smart money: not read ($0.01 exceeds the $0.00 left in this run's data budget).");
    expect(bonk.smartMoney).toEqual({
      status: "not_read",
      said: "Smart money: not read ($0.01 exceeds the $0.00 left in this run's data budget).",
    });
    expect(bonk.paidSignals).toMatchObject({ smartMoney: false });
    expect((bonk.components as { smartMoney: number | null }).smartMoney).toBeNull();
    expect(await t.payments()).toHaveLength(0);
    expect(describeResult("score_token", bonk)).toContain("notBought: smartMoney (budget)");
  });

  it("says so when the read was planned and then failed, and scores without it", async () => {
    const source = getDataSource(SOURCE);
    if (!source) throw new Error("the registry lost the source");
    const query = vi.spyOn(source, "query").mockRejectedValue(new Error("nansen-smart-money responded 503"));
    try {
      const t = await tick({ universe: OPEN });
      const bonk = await t.score(BONK);

      expect(bonk.ok).toBe(true);
      expect(Number(bonk.total)).toBeGreaterThan(0);
      expect(bonk.notBought).toEqual(["smartMoney: the source did not answer: nansen-smart-money responded 503"]);
      expect(lines(bonk)[2]).toBe("Smart money: not read (the source did not answer: nansen-smart-money responded 503).");
      expect(bonk.paidSignals).toMatchObject({ smartMoney: false });
      expect(String(bonk.rendered)).not.toContain("no smart trader");
      // Not tried a second time in the tick.
      await t.score(BONK);
      expect(query).toHaveBeenCalledTimes(1);
    } finally {
      query.mockRestore();
    }
  });

  it("buys nothing and says nothing for an agent whose owner did not enable the source", async () => {
    const owner = await tick({ universe: OPEN });
    await owner.score(BONK);

    // Same universe, so the same cached score, component and all. The read behind it is
    // the other owner's: this agent is told nothing about it and pays for nothing.
    const other = await tick({ universe: OPEN, dataSources: [] });
    const bonk = await other.score(BONK);
    expect(bonk.ok).toBe(true);
    expect(bonk.smartMoney).toBeNull();
    expect(String(bonk.rendered)).not.toContain("Smart money");
    expect(await other.payments()).toHaveLength(0);

    // Asked for by name with the source off: said, not bought.
    const asked = await (await tick({ universe: OPEN, dataSources: [] })).score(STONK, { smartMoney: true });
    expect(asked.notBought).toEqual(["smartMoney: the smart money source is not enabled for this agent"]);
    expect(asked.smartMoney).toBeNull();
  });

  /**
   * A row another process cached under the old read: the board's netflow as a number, the
   * source in `sources`, no detail anywhere. It scores, renders and is narrated, and it is
   * not bought again for being old.
   */
  it("still renders a score cached under the old read", async () => {
    await db.insert(schema.tokenScores).values({
      id: `solana:${KNOTS}`,
      chain: "solana",
      address: KNOTS,
      symbol: "KNOTS",
      total: "74.20",
      verdict: "candidate",
      components: { safety: 82, liquidity: 71, organic: 66, distribution: 61, momentum: 58, gecko: null, sentiment: null, smartMoney: 91.2 },
      blockers: [],
      warnings: [],
      liquidityUsd: "1620780.68",
      holderCount: 11_310,
      sources: ["jupiter", "rugcheck", SOURCE],
      universeKey: universeKey(OPEN),
      scoredAt: new Date(Date.now() - 60_000),
    });

    const t = await tick({ universe: OPEN });
    const knots = await t.score(KNOTS);

    expect(knots).toMatchObject({ ok: true, total: 74.2, verdict: "candidate" });
    expect(lines(knots)).toEqual([
      "KNOTS [solana] score 74.2/100 — candidate",
      "safety 82 · liquidity 71 · organic 66 · distribution 61 · momentum 58 · smart money 91.2",
      "Smart money, last 24h: tracked wallets net bought it. The amounts were not kept with this cached score.",
    ]);
    expect(knots.smartMoney).toMatchObject({ status: "cached" });
    expect(await t.payments()).toHaveLength(0);
    expect(describeResult("score_token", knots)).toContain("smart money bought");
  });
});

describe("discover_tokens: the smart money feed", () => {
  it("is off by default, and a sweep buys no board", async () => {
    expect(DEFAULT_AGENT_CONFIG.universe.discovery).not.toContain("smart_money");

    const t = await tick();
    const swept = await t.discover({});
    expect(swept.ok).toBe(true);
    expect(swept.feeds).not.toContain("smart_money");
    expect(await t.nansen()).toEqual([]);
    expect(rows(swept).every((row) => row.origin !== "smart_money" && row.smartMoneyNetflow24hUsd === undefined)).toBe(true);
    expect(String(swept.rendered)).not.toContain("SM24H");
    expect(String(swept.note)).not.toContain("SM24H");
  });

  it("buys the board once per chain when the owner switched it on, and its rows become candidates", async () => {
    const t = await tick(BOARD_ON);
    const swept = await t.discover({});

    expect(swept.feeds).toContain("smart_money");
    expect(await t.nansen()).toEqual([[BOARD_URL, "0.050000"]]);

    // KNOTS is on no free feed this agent sweeps: the board is what found it.
    const knots = rows(swept).find((row) => row.symbol === "KNOTS");
    expect(knots).toMatchObject({ address: KNOTS, origin: "smart_money", smartMoneyNetflow24hUsd: 412_650.4 });
    // BONK is trending too. It is listed once, and keeps the flow the board gave it.
    const bonk = rows(swept).filter((row) => row.address === BONK);
    expect(bonk).toHaveLength(1);
    expect(bonk[0]?.smartMoneyNetflow24hUsd).toBe(1_284_310.22);
    // WIF was sold, not bought, and no free provider knows it. BRETT is on another chain.
    expect(rows(swept).map((row) => row.symbol)).not.toContain("WIF");
    expect(rows(swept).map((row) => row.symbol)).not.toContain("BRETT");

    expect(lines(swept)[0]).toMatch(/^ {2}# {2}SYMBOL .* SM24H {2}FEED$/);
    expect(String(swept.rendered)).toMatch(/KNOTS .*\+\$413k {3}smart_money/);
    expect(String(swept.rendered)).toMatch(/BONK .*\+\$1\.3M /);
    // The board counts funds and smart traders; score_token's line counts smart traders
    // and top-PnL wallets. Said, so the two results never read as a contradiction.
    expect(String(swept.note)).toContain(
      "SM24H (smartMoneyNetflow24hUsd) is the net USD Nansen's tracked funds and smart traders moved into the token in the last 24 hours. score_token's smart money line counts smart traders and top-PnL wallets, not funds, so the two can differ.",
    );
  });

  it("does not buy a chain's board twice in a tick, however the model sweeps", async () => {
    const t = await tick({ ...BOARD_ON, chains: ["solana", "base"] });
    await t.discover({});
    expect(await t.nansen()).toEqual([
      [BOARD_URL, "0.050000"],
      [BOARD_URL, "0.050000"],
    ]);

    // Again, narrowed, by chain, with a feed list of its own, and two at once.
    await t.discover({});
    await t.discover({ chain: "base" });
    const again = await t.discover({ feeds: ["trending"], minLiquidityUsd: 100_000 });
    await Promise.all([t.discover({ chain: "solana" }), t.discover({ limit: 5 })]);
    expect(await t.nansen()).toHaveLength(2);
    // A later sweep still reads the board the first one bought.
    expect(rows(again).some((row) => row.smartMoneyNetflow24hUsd !== undefined)).toBe(true);
    expect(again.feeds).toContain("smart_money");
  });

  it("buys one board when two sweeps of the same step start side by side", async () => {
    const t = await tick(BOARD_ON);
    const [a, b] = await Promise.all([t.discover({}), t.discover({ limit: 10 })]);
    expect(a?.ok && b?.ok).toBe(true);
    expect(await t.nansen()).toEqual([[BOARD_URL, "0.050000"]]);
    for (const swept of [a, b]) expect(rows(swept ?? {}).some((row) => row.symbol === "KNOTS")).toBe(true);
  });

  it("buys nothing when the feed is on and the Nansen source is not enabled", async () => {
    for (const dataSources of [[], ["x-search", "deepnets-token-safety"]]) {
      const t = await tick({ ...BOARD_ON, dataSources });
      const swept = await t.discover({});
      expect(swept.ok).toBe(true);
      expect(swept.feeds).not.toContain("smart_money");
      expect(await t.nansen()).toEqual([]);
      expect(rows(swept).map((row) => row.symbol)).not.toContain("KNOTS");
    }
  });

  it("cannot be switched on by the model", async () => {
    // The source is enabled; the feed is the owner's to turn on, and they have not.
    const t = await tick();
    const asked = await t.discover({ feeds: ["smart_money", "trending", "new_launches"] });
    expect(asked.ok).toBe(true);
    expect(asked.feeds).not.toContain("smart_money");
    expect(String(asked.note)).toContain("The smart_money feed was not swept: only your owner can switch it on.");
    expect(await t.nansen()).toEqual([]);
    expect(rows(asked).map((row) => row.symbol)).not.toContain("KNOTS");

    // The feed is on and the source is not: naming the feed buys nothing either.
    const noSource = await tick({ ...BOARD_ON, dataSources: [] });
    const named = await noSource.discover({ feeds: ["smart_money"] });
    expect(named.feeds).not.toContain("smart_money");
    expect(await noSource.nansen()).toEqual([]);

    // With both of the owner's switches on, naming it is allowed and changes nothing.
    const on = await tick(BOARD_ON);
    const allowed = await on.discover({ feeds: ["smart_money"] });
    expect(allowed.feeds).toContain("smart_money");
    expect(String(allowed.note)).not.toContain("was not swept");
    expect(await on.nansen()).toEqual([[BOARD_URL, "0.050000"]]);
  });

  it("holds its candidates to the owner's gates like any other", async () => {
    // Both board tokens are below a $2M floor: KNOTS holds $1.62M and BONK $996K.
    const strict = await tick({ dataSources: [SOURCE], universe: universe({ discovery: ["trending", "smart_money"], minLiquidityUsd: 2_000_000 }) });
    const swept = await strict.discover({});
    expect(await strict.nansen()).toEqual([[BOARD_URL, "0.050000"]]);
    expect(rows(swept).map((row) => row.symbol)).not.toContain("KNOTS");
    expect(rows(swept).map((row) => row.symbol)).not.toContain("BONK");
    for (const row of rows(swept)) if (row.liquidityUsd !== null) expect(row.liquidityUsd, row.symbol).toBeGreaterThanOrEqual(2_000_000);

    // The blocklist subtracts from the board as it does from every feed.
    const blocked = await tick({
      dataSources: [SOURCE],
      universe: universe({ discovery: ["trending", "smart_money"], blocklist: [{ chain: "solana", address: KNOTS, symbol: "KNOTS" }] }),
    });
    const afterBlock = await blocked.discover({});
    expect(rows(afterBlock).map((row) => row.symbol)).not.toContain("KNOTS");
    expect(rows(afterBlock).some((row) => row.address === BONK)).toBe(true);

    // And under the default gates, what the board added clears each of them.
    const plain = await tick(BOARD_ON);
    for (const row of rows(await plain.discover({})).filter((r) => r.smartMoneyNetflow24hUsd !== undefined)) {
      expect(row.liquidityUsd ?? 0, row.symbol).toBeGreaterThanOrEqual(DEFAULT_AGENT_CONFIG.universe.minLiquidityUsd);
      expect(row.holderCount ?? 0, row.symbol).toBeGreaterThanOrEqual(DEFAULT_AGENT_CONFIG.universe.minHolderCount);
    }
  });

  /**
   * Being on the board is a lead and nothing more. A buy of a board token goes through
   * the same score floor and the same hard gates in the risk guard as any other buy.
   */
  it("gives its candidates no way past the score floor or a hard gate", async () => {
    const buy = { chain: "solana", side: "buy", tokenAddress: KNOTS, amountUsd: 10, rationale: "Smart money is buying it and the score is strong." };

    const floor = await tick({ dataSources: [SOURCE], universe: universe({ discovery: ["trending", "smart_money"], minScore: 99 }) });
    expect(rows(await floor.discover({})).find((row) => row.symbol === "KNOTS")?.origin).toBe("smart_money");
    const belowFloor = await floor.trade(buy);
    expect(belowFloor).toMatchObject({ ok: false, rejected: true });
    expect(String(belowFloor.reason)).toMatch(/^Rejected by risk guard: KNOTS scores [\d.]+\/100, below this agent's minScore of 99/);

    // A top-10 share no token can meet: the gate refuses the board's token like any other.
    const gate = await tick({ dataSources: [SOURCE], universe: universe({ discovery: ["trending", "smart_money"], minScore: 0, maxTop10HolderPct: 1 }) });
    expect(rows(await gate.discover({})).some((row) => row.symbol === "KNOTS")).toBe(true);
    const gated = await gate.trade(buy);
    expect(gated).toMatchObject({ ok: false, rejected: true });
    expect(String(gated.reason)).toContain("Rejected by risk guard");
    expect((gated.score as { blockers: string[] }).blockers.join(" ")).toMatch(/top10_holders_/);

    for (const t of [floor, gate]) expect(await db.select().from(schema.trades).where(eq(schema.trades.agentId, t.agentId))).toHaveLength(0);
  });

  it("is read again, not bought again, when a narrowed sweep widens", async () => {
    const t = await tick(BOARD_ON);
    const result = await t.discover({ maxAgeHours: 0.6 });

    expect(result).toMatchObject({ ok: true, widened: true, matchedYourFilters: 0 });
    expect(Number(result.freshCount)).toBeGreaterThanOrEqual(MIN_SCORED_PER_TICK);
    // KNOTS is a month old: the model's "under 36m" refused it, the owner's settings allow it.
    expect(rows(result).find((row) => row.symbol === "KNOTS")).toMatchObject({ origin: "smart_money", smartMoneyNetflow24hUsd: 412_650.4 });
    expect(await t.nansen()).toEqual([[BOARD_URL, "0.050000"]]);
    // The board and the launch radar, each once.
    expect(t.budget.spentUsd).toBeCloseTo(0.05 + 0.012, 6);
  });

  it("is not bought by a widening for a chain the model left out", async () => {
    const t = await tick({ ...BOARD_ON, chains: ["solana", "base"] });
    const result = await t.discover({ chain: "solana", maxAgeHours: 0.6 });

    expect(result).toMatchObject({ ok: true, widened: true, chains: ["solana", "base"] });
    // Solana's board was bought by the narrow sweep. Base's was not, and the widening pays
    // for nothing: no board, and no radar.
    expect(await t.nansen()).toEqual([[BOARD_URL, "0.050000"]]);
    expect(t.budget.spentUsd).toBeCloseTo(0.05 + 0.012, 6);
    // Base's free feeds were swept, so Base tokens are listed; none carries a board flow.
    expect(rows(result).some((row) => row.chain === "base")).toBe(true);
    expect(rows(result).filter((row) => row.chain === "base").every((row) => row.smartMoneyNetflow24hUsd === undefined)).toBe(true);

    // A sweep of Base buys Base's board, once, and finds what is on it.
    const base = await t.discover({ chain: "base" });
    expect(await t.nansen()).toHaveLength(2);
    expect(rows(base).find((row) => row.symbol === "BRETT")?.smartMoneyNetflow24hUsd).toBe(96_410.8);
    await t.discover({});
    expect(await t.nansen()).toHaveLength(2);
  });
});

/**
 * The model's own way to buy from a source. For Nansen it sells the one-cent per-token
 * read. The five-cent boards are the owner's feed to switch on, and the netflow board is
 * discovery's to buy, once: a model must not be able to buy either behind that switch,
 * or a second copy of the board in the same tick.
 */
describe("query_data_source: Nansen's boards", () => {
  const HOLDINGS_URL = "https://api.nansen.ai/api/v1/smart-money/holdings";
  const PER_TOKEN = "To read one token, pass tokenAddress and exactly one chain: that is the $0.01 per-token read.";
  const FEED_OFF = `Not bought: Nansen's boards (netflow, holdings, dex-trades, $0.05 each) are only bought when your owner switches on the smart_money feed. ${PER_TOKEN}`;
  const DISCOVERY_BUYS_IT = `Not bought: discover_tokens buys the netflow board for you, once per chain per tick, and its table shows each row's flow under SM24H. ${PER_TOKEN}`;

  it("buys no board while the owner's feed is off, and still sells the one-cent read", async () => {
    // The source on and the feed off: the state every agent saved before the feed existed is in.
    const t = await tick();
    for (const params of [
      { chains: ["solana"] },
      { chains: ["solana"], symbol: "STONK" },
      { endpoint: "netflow", chains: ["solana"], tokenAddress: BONK },
      { endpoint: "netflow", chains: ["solana", "base"], window: "7d", limit: 100 },
      { endpoint: "holdings", chains: ["solana"] },
      { endpoint: "dex-trades", chains: ["solana"] },
    ]) {
      expect(await t.ask(params), JSON.stringify(params)).toEqual({ ok: false, reason: FEED_OFF });
    }
    // A token address is never answered with a board: where the per-token read cannot
    // answer, the call is refused for that reason and nothing is bought in its place.
    const several = await t.ask({ chains: ["solana", "base"], tokenAddress: BONK });
    expect(several).toMatchObject({ ok: false });
    expect(String(several.reason)).toContain("needs tokenAddress and exactly one chain");
    const month = await t.ask({ chains: ["solana"], tokenAddress: BONK, window: "30d" });
    expect(month).toMatchObject({ ok: false });
    expect(String(month.reason)).toContain("covers window 1h, 24h or 7d, not 30d");
    expect(await t.payments()).toHaveLength(0);
    expect(t.budget.spentUsd).toBe(0);

    const read = await t.ask({ chains: ["solana"], tokenAddress: BONK });
    expect(read).toMatchObject({ ok: true, summary: READING, dataSpentThisRunUsd: 0.01 });
    expect(await t.nansen()).toEqual([[TOKEN_URL, "0.010000"]]);
  });

  it("does not buy the netflow board a second time in a tick when the feed is on", async () => {
    const t = await tick(BOARD_ON);
    // Before any sweep: discovery will buy it this tick, so it is not bought here first.
    expect(await t.ask({ chains: ["solana"] })).toEqual({ ok: false, reason: DISCOVERY_BUYS_IT });
    expect(await t.payments()).toHaveLength(0);

    await t.discover({});
    for (const params of [
      { chains: ["solana"] },
      { endpoint: "netflow", chains: ["solana"], window: "7d" },
      { chains: ["solana"], symbol: "KNOTS" },
      { endpoint: "netflow", chains: ["solana"], tokenAddress: KNOTS },
    ]) {
      expect(await t.ask(params), JSON.stringify(params)).toEqual({ ok: false, reason: DISCOVERY_BUYS_IT });
    }
    expect(await t.nansen()).toEqual([[BOARD_URL, "0.050000"]]);

    // The two boards discovery does not buy are the owner's to have opted into, at their price.
    expect(await t.ask({ endpoint: "holdings", chains: ["solana"] })).toMatchObject({ ok: true });
    const paid = await t.nansen();
    expect(paid).toHaveLength(2);
    expect(paid).toContainEqual([HOLDINGS_URL, "0.050000"]);
  });

  it("leaves a call it cannot read, and every other source, to the checks they already had", async () => {
    const t = await tick({ dataSources: [SOURCE, "x-search"] });
    // Not this source's parameters: refused by the source itself, unpaid.
    expect(await t.ask({ endpoint: "board", chains: ["solana"] })).toMatchObject({ ok: false });
    expect(await t.ask({})).toMatchObject({ ok: false });
    expect(await t.payments()).toHaveLength(0);

    const other = await (t.tools.query_data_source?.execute as unknown as ToolExec)(
      { sourceId: "x-search", params: { query: "BONK" } },
      { toolCallId: "call_query_data_source", messages: [] },
    );
    expect(other.ok, String(other.reason)).toBe(true);
    expect(String(other.reason ?? "")).not.toContain("Nansen");
  });
});

describe("discoverCandidates: the smart money feed without the tool around it", () => {
  const x402 = async () => {
    const t = await tick();
    return { t, ctx: t.ctx.x402 };
  };

  it("needs the source named: no source list is not every source", async () => {
    const { t, ctx } = await x402();
    const base = { chains: ["solana"] as const, universe: universe(), feeds: ["trending", "smart_money"] as const, x402: ctx };

    for (const dataSources of [undefined, [], ["x-search"]]) {
      const found = await discoverCandidates({ ...base, ...(dataSources ? { dataSources } : {}) });
      expect(found.some((c) => c.origin === "smart_money" || c.smartMoneyNetflowUsd !== undefined)).toBe(false);
    }
    expect(await t.nansen()).toEqual([]);

    const found = await discoverCandidates({ ...base, dataSources: [SOURCE] });
    expect(found.find((c) => c.token.symbol === "KNOTS")).toMatchObject({ origin: "smart_money", smartMoneyNetflowUsd: 412_650.4 });
    expect(await t.nansen()).toEqual([[BOARD_URL, "0.050000"]]);
  });

  it("never runs without a payment context, and never when the feed is not in the list", async () => {
    const { t, ctx } = await x402();
    const none = await discoverCandidates({ chains: ["solana"], universe: universe(), feeds: ["trending", "smart_money"], dataSources: [SOURCE] });
    expect(none.some((c) => c.smartMoneyNetflowUsd !== undefined)).toBe(false);
    const off = await discoverCandidates({ chains: ["solana"], universe: universe(), x402: ctx, dataSources: [SOURCE] });
    expect(off.some((c) => c.smartMoneyNetflowUsd !== undefined)).toBe(false);
    expect(await t.nansen()).toEqual([]);
  });

  it("takes a chain's board from the caller's record and pays for none of it", async () => {
    const { t, ctx } = await x402();
    const boards = new Map();
    const first = await discoverCandidates({ chains: ["solana"], universe: universe(), feeds: ["smart_money"], x402: ctx, dataSources: [SOURCE], smartMoneyBoards: boards });
    const second = await discoverCandidates({
      chains: ["solana"],
      universe: universe({ minLiquidityUsd: 1_000_000 }),
      feeds: ["smart_money"],
      x402: ctx,
      dataSources: [SOURCE],
      smartMoneyBoards: boards,
    });
    expect(first.map((c) => c.token.symbol).sort()).toEqual(["BONK", "KNOTS"]);
    // The record holds the board before any gate: the second sweep reads it through its own.
    expect(second.map((c) => c.token.symbol)).toEqual(["KNOTS"]);
    expect(await t.nansen()).toEqual([[BOARD_URL, "0.050000"]]);
  });
});
