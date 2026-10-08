/**
 * `getTokenScore`'s paid smart money read, from the purchase to the scorer.
 *
 * The real path on PGlite, with the paid call in its mock mode: `paidFetch` returns the
 * source's fixture and writes a payment row for every purchase, so counting rows is
 * counting payments and a row's URL is the endpoint that was bought. The fixture answers
 * for BONK, KNOTS and BRETT and gives every other token the documented empty answer.
 *
 * What is pinned: the read is the per-token one at a cent, never the five-cent board;
 * the scorer is handed smart traders plus top-PnL wallets; an empty answer is no reading
 * and is still not bought twice; and a read that fails, for any reason, costs the score
 * that one component and nothing else.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import type { Db } from "@/db";
import * as schema from "@/db/schema";
import { DEFAULT_AGENT_CONFIG } from "@/lib/agent/config";
import { seedAgent, setupTestDb } from "@/lib/agent/test-support";
import { getDataSource } from "@/lib/data-sources/registry";
import { newBudget, X402BudgetError, type X402Context } from "@/lib/x402/types";
import { getTokenScore, getTokenScoreDetail, resetTokenCaches, universeKey, type GetTokenScoreInput } from "./index";
import { renderScore, scoreToken } from "./score";
import { smartMoneyLineFromScore, smartMoneyReading } from "./smart-money";

// The real scorer, watched: what it is handed is the thing under test.
vi.mock("./score", async (importOriginal) => {
  const real = await importOriginal<typeof import("./score")>();
  return { ...real, scoreToken: vi.fn(real.scoreToken) };
});

const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const STONK = "6GmAFSYs4gk3FDao5FzzySQpPZaWsa4rUJHacpMpUNgx";
const BRETT = "0x532f27101965dd16442E59d40670FaF5eBB142E4";
const SOURCE = "nansen-smart-money";
const TOKEN_URL = "https://api.nansen.ai/api/v1/tgm/flow-intelligence";
const universe = DEFAULT_AGENT_CONFIG.universe;

let db: Db;
let agentId: string;

beforeAll(async () => {
  process.env.X402_MOCK = "1";
  db = await setupTestDb();
});

beforeEach(async () => {
  agentId = (await seedAgent(db)).agentId;
  // One cache for the whole file: every test starts with nothing scored and nothing remembered.
  await db.delete(schema.tokenScores);
  await resetTokenCaches();
  vi.mocked(scoreToken).mockClear();
});

function ctx(maxUsd = 1): X402Context {
  return { agentId, runId: null, mode: "paper", wallets: [], budget: newBudget(maxUsd) };
}

const payments = () => db.select().from(schema.x402Payments).where(eq(schema.x402Payments.agentId, agentId));

function paid(address: string, x402: X402Context, over: Partial<GetTokenScoreInput> = {}): GetTokenScoreInput {
  return {
    chain: "solana",
    address,
    universe,
    maxTradeUsd: 100,
    paid: { smartMoney: true },
    x402,
    dataSources: [SOURCE],
    ...over,
  };
}

/** What the scorer was last handed as its smart money input. */
const scorerSaw = () => vi.mocked(scoreToken).mock.calls.at(-1)?.[0].smartMoney;

describe("the smart money read a score buys", () => {
  it("buys the per-token read, and hands the scorer smart traders plus top-PnL wallets", async () => {
    const c = ctx();
    const detail = await getTokenScoreDetail(paid(BONK, c));

    // Fixture: smart_trader 9260.1 in 3 wallets, top_pnl 3150.4 in 1.
    expect(scorerSaw()?.netflowUsd).toBeCloseTo(12_410.5, 6);
    expect(scorerSaw()).toMatchObject({ traderCount: 4, source: SOURCE });

    // $12.4k into a $996k pool: a little above neutral, as the unchanged scorer has it.
    expect(detail.score.components.smartMoney).toBeGreaterThan(50);
    expect(detail.score.components.smartMoney).toBeLessThan(60);
    expect(detail.score.sources).toContain(SOURCE);
    expect(detail.smartMoney?.whales).toEqual({ netFlowUsd: -2104.75, wallets: 2 });
    expect(detail.smartMoneyNotRead).toBeNull();

    const rows = await payments();
    expect(rows.map((row) => [row.sourceId, row.url, row.amountUsd])).toEqual([[SOURCE, TOKEN_URL, "0.010000"]]);
    expect(c.budget.spentUsd).toBeCloseTo(0.01, 9);
  });

  it("does the same for a Base token", async () => {
    const c = ctx();
    const detail = await getTokenScoreDetail(paid(BRETT, c, { chain: "base" }));
    expect(scorerSaw()?.netflowUsd).toBeCloseTo(12_410.5, 6);
    expect(scorerSaw()?.traderCount).toBe(4);
    expect(detail.score.components.smartMoney).not.toBeNull();
    expect((await payments()).map((row) => [row.url, row.amountUsd])).toEqual([[TOKEN_URL, "0.010000"]]);
  });

  it("scores no reading for a token no tracked wallet traded, and does not buy that answer twice", async () => {
    const c = ctx();
    const first = await getTokenScoreDetail(paid(STONK, c));

    // The source answered, with nothing: a number-less input, so the component is null
    // and never a neutral 50, and the source is on record as bought.
    expect(scorerSaw()).toEqual({ netflowUsd: null, traderCount: null, source: SOURCE });
    expect(first.score.components.smartMoney).toBeNull();
    expect(first.score.sources).toContain(SOURCE);
    expect(first.smartMoney && smartMoneyReading(first.smartMoney)).toBeNull();
    expect(first.smartMoneyNotRead).toBeNull();
    expect(await payments()).toHaveLength(1);

    // The same score wanted again: served from the cache, with the read it was made with.
    const again = await getTokenScoreDetail(paid(STONK, c));
    expect(again.score.scoredAt).toBe(first.score.scoredAt);
    expect(again.smartMoney).toEqual(first.smartMoney);
    expect(await payments()).toHaveLength(1);
    expect(c.budget.spentUsd).toBeCloseTo(0.01, 9);
  });

  it("is not folded in when the read fails, and the score is still a score", async () => {
    // A budget that cannot cover a cent: refused before anything is paid.
    const broke = ctx(0.005);
    const unaffordable = await getTokenScoreDetail(paid(BONK, broke));
    expect(unaffordable.score.total).toBeGreaterThan(0);
    expect(unaffordable.score.components.smartMoney).toBeNull();
    expect(unaffordable.score.sources).not.toContain(SOURCE);
    expect(unaffordable.smartMoney).toBeNull();
    expect(unaffordable.smartMoneyNotRead).toBe("it costs $0.01 and $0.005 of this run's data budget is left");
    expect(await payments()).toHaveLength(0);
    expect(broke.budget.spentUsd).toBe(0);

    const source = getDataSource(SOURCE);
    if (!source) throw new Error("the registry lost the source");
    const query = vi.spyOn(source, "query");
    try {
      // The source is down.
      query.mockRejectedValueOnce(new Error("nansen-smart-money responded 503"));
      const down = await getTokenScoreDetail(paid(BONK, ctx(), { force: true }));
      expect(down.score.components.smartMoney).toBeNull();
      expect(down.score.sources).not.toContain(SOURCE);
      expect(down.smartMoneyNotRead).toBe("the source did not answer: nansen-smart-money responded 503");

      // The run's budget ran out between the plan and the payment.
      query.mockRejectedValueOnce(new X402BudgetError(0.01, 0));
      const late = await getTokenScoreDetail(paid(BONK, ctx(), { force: true }));
      expect(late.smartMoneyNotRead).toBe("it costs $0.01 and $0.00 of this run's data budget is left");

      // It answered, in a shape nobody documented. That is not "nobody traded it".
      for (const data of [{ result: "ok" }, { text: "<html>" }, null, { data: [{ unrelated: 1 }] }]) {
        query.mockResolvedValueOnce({ summary: "?", data });
        const odd = await getTokenScoreDetail(paid(BONK, ctx(), { force: true }));
        expect(odd.score.components.smartMoney, JSON.stringify(data)).toBeNull();
        expect(odd.score.sources, JSON.stringify(data)).not.toContain(SOURCE);
        expect(odd.smartMoney, JSON.stringify(data)).toBeNull();
        expect(odd.smartMoneyNotRead, JSON.stringify(data)).toBe("the source answered in a shape this app does not know");
      }
    } finally {
      query.mockRestore();
    }
  });

  it("buys nothing unless it is asked to, and nothing from a source the agent did not enable", async () => {
    const c = ctx();
    await getTokenScore({ chain: "solana", address: BONK, universe, maxTradeUsd: 100, x402: c, dataSources: [SOURCE] });
    expect(scorerSaw()).toBeUndefined();

    const notEnabled = await getTokenScoreDetail(paid(BONK, c, { dataSources: ["x-search"], force: true }));
    expect(notEnabled.smartMoneyNotRead).toBe("the smart money source is not enabled for this agent");
    const none = await getTokenScoreDetail(paid(BONK, c, { dataSources: [], force: true }));
    expect(none.smartMoneyNotRead).toBe("the smart money source is not enabled for this agent");

    expect(await payments()).toHaveLength(0);
    expect(c.budget.spentUsd).toBe(0);
  });
});

describe("a cached score and its read", () => {
  it("hands back the read only beside the score it was made for", async () => {
    const c = ctx();
    const bought = await getTokenScoreDetail(paid(BONK, c));
    expect(bought.smartMoney).not.toBeNull();

    // A free rescore replaces the cached row: the read was not made for this score.
    const rescored = await getTokenScoreDetail({ chain: "solana", address: BONK, universe, maxTradeUsd: 100, force: true, now: Date.now() + 1_000 });
    expect(rescored.score.scoredAt).not.toBe(bought.score.scoredAt);
    expect(rescored.score.sources).not.toContain(SOURCE);
    expect(rescored.smartMoney).toBeNull();
    expect(await payments()).toHaveLength(1);
  });

  it("serves a read another process bought without its words, and without buying it again", async () => {
    const c = ctx();
    const bought = await getTokenScoreDetail(paid(BONK, c));
    // Another process: the cached row is there, the read behind it is not.
    await resetTokenCaches();

    const served = await getTokenScoreDetail(paid(BONK, ctx()));
    expect(served.score.scoredAt).toBe(bought.score.scoredAt);
    expect(served.score.components.smartMoney).toBe(bought.score.components.smartMoney);
    expect(served.smartMoney).toBeNull();
    expect(served.smartMoneyNotRead).toBeNull();
    expect(await payments()).toHaveLength(1);
    // What can still be said is the direction the component kept.
    expect(smartMoneyLineFromScore(served.score)).toBe(
      "Smart money, last 24h: tracked wallets net bought it. The amounts were not kept with this cached score.",
    );
  });

  /**
   * A row written under the old read: the board's netflow as a component, the source in
   * `sources`, nothing else. It is served as it is, renders as it did, and is not bought
   * again for being old.
   */
  it("still serves and renders a score cached under the old read", async () => {
    await db.insert(schema.tokenScores).values({
      id: `solana:${BONK}`,
      chain: "solana",
      address: BONK,
      symbol: "BONK",
      total: "71.40",
      verdict: "candidate",
      components: { safety: 82, liquidity: 71, organic: 66, distribution: 61, momentum: 58, gecko: 64, sentiment: null, smartMoney: 91.2 },
      blockers: [],
      warnings: [],
      liquidityUsd: "996452.17",
      holderCount: 1_015_277,
      sources: ["jupiter", "rugcheck", "geckoterminal", SOURCE],
      universeKey: universeKey(universe),
      scoredAt: new Date(Date.now() - 60_000),
    });

    const served = await getTokenScoreDetail(paid(BONK, ctx()));
    expect(served.score.total).toBe(71.4);
    expect(served.score.components.smartMoney).toBe(91.2);
    expect(served.smartMoney).toBeNull();
    expect(await payments()).toHaveLength(0);

    expect(renderScore(served.score)).toBe(
      "BONK [solana] score 71.4/100 — candidate\nsafety 82 · liquidity 71 · organic 66 · distribution 61 · momentum 58 · GT Score 64 · smart money 91.2",
    );
    expect(renderScore(served.score, smartMoneyLineFromScore(served.score))).toBe(
      "BONK [solana] score 71.4/100 — candidate\nsafety 82 · liquidity 71 · organic 66 · distribution 61 · momentum 58 · GT Score 64 · smart money 91.2\nSmart money, last 24h: tracked wallets net bought it. The amounts were not kept with this cached score.",
    );
  });
});
