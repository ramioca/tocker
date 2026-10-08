/**
 * The position limit and the cash reserve, as the agent's own tools meet them in a run.
 *
 * The risk guard's arithmetic is pinned in `src/lib/trading/risk-limits.test.ts`. This is
 * about the tools around it: `place_trade` refusing the buy and saying why, two buys made
 * in one step not slipping through a limit that has room for one, the purse of a set of
 * proposals, and `finish` not sending an agent that can open nothing back for research.
 *
 * The tools are the real ones on PGlite, with tokens from the providers' fixtures
 * (`TOKENS_MOCK`) and the paper executor.
 */
import { beforeAll, beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { Db } from "@/db";
import * as schema from "@/db/schema";
import { toNumeric } from "@/lib/money";
import { resetPriceCache } from "@/lib/trading/prices";
import { seedKnownTokens, tokenId, USDC_SOLANA } from "@/lib/trading/tokens";
import { newBudget } from "@/lib/x402/types";
import { RunLogger } from "./logger";
import { describeResult, tradeRefusals } from "./narrate";
import { buildTools, type RunContext } from "./tools";
import { seedAgent, setupTestDb, type SeedConfigOverrides } from "./test-support";

const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const BONK_ID = tokenId("solana", BONK);
const WIF = "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm";
const WIF_ID = tokenId("solana", WIF);
const USDC_ID = tokenId("solana", USDC_SOLANA);
const BONK_PRICE = 0.0000027;

let db: Db;

beforeAll(async () => {
  process.env.X402_MOCK = "1";
  db = await setupTestDb();
  await seedKnownTokens();
  await db.insert(schema.tokens).values({ id: WIF_ID, chain: "solana", address: WIF, symbol: "WIF", decimals: 6 }).onConflictDoNothing();
}, 120_000);

beforeEach(() => {
  vi.stubEnv("PLATFORM_FEE_BPS", "50");
  resetPriceCache();
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/ultra/v1/order")) {
      const amount = Number(new URL(url).searchParams.get("amount"));
      const out = (amount / 1e6 / BONK_PRICE) * 10 ** 5;
      return new Response(JSON.stringify({ requestId: "req", transaction: null, inAmount: String(amount), outAmount: String(Math.round(out)) }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (url.includes("api.jup.ag/price/v3")) {
      return new Response(JSON.stringify({ [BONK]: { usdPrice: BONK_PRICE }, [WIF]: { usdPrice: 0.5 } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

type ToolExec = (input: unknown, options: unknown) => Promise<Record<string, unknown>>;

/** One tick's tools for a freshly seeded Solana paper agent, called the way the AI SDK would. */
async function tick(config: SeedConfigOverrides = {}, seed: { paperStartingUsd?: string } = {}) {
  const { agentId } = await seedAgent(db, { config: { chains: ["solana"], dataSources: [], ...config }, ...seed });
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
  const trade = call("place_trade");
  return {
    agentId,
    ownerId: agent.ownerId,
    ctx,
    discover: call("discover_tokens"),
    score: call("score_token"),
    book: call("get_portfolio"),
    buy: (address: string, amountUsd: number) =>
      trade({ chain: "solana", side: "buy", tokenAddress: address, amountUsd, rationale: "Scored 84/100 with organic volume leading; a starter position." }),
    sell: (address: string, amountUsd: number) =>
      trade({ chain: "solana", side: "sell", tokenAddress: address, amountUsd, rationale: "Score fell from 74 to 41 on thinning liquidity; closing it." }),
    finish: () => call("finish")({ summary: "Nothing cleared the bar this tick." }),
    trades: () => db.select().from(schema.trades).where(eq(schema.trades.agentId, agentId)),
    held: async () =>
      (await db.select().from(schema.positions).where(eq(schema.positions.agentId, agentId))).filter((row) => Number(row.amountToken) > 0),
  };
}

/** Gives an agent a position it already holds, worth `usd` at the stubbed price. */
async function hold(agentId: string, token: string, usd: number, price: number): Promise<void> {
  await db.insert(schema.positions).values({
    agentId,
    tokenId: token,
    amountToken: toNumeric(usd / price, 12),
    avgCostUsd: toNumeric(price, 12),
    openedAt: new Date(Date.now() - 5 * 3_600_000),
  });
}

describe("place_trade under a position limit", () => {
  it("refuses a buy that would open one position too many, and says why to the model and the digest", async () => {
    const t = await tick({ risk: { maxOpenPositions: 1 } });
    await hold(t.agentId, WIF_ID, 20, 0.5);

    const refused = await t.buy(BONK, 5);
    expect(refused).toMatchObject({ ok: false, rejected: true });
    expect(refused.reason).toBe(
      "Rejected by risk guard: Position limit reached: this agent may hold at most 1 position and holds 1 (maxOpenPositions). BONK would be a new one. Sell a position first, or add to a token it already holds. Sells and exits are never blocked by this.",
    );
    expect(describeResult("place_trade", refused)).toBe(
      "Refused by the risk guard: Position limit reached: this agent may hold at most 1 position and holds 1 (maxOpenPositions)",
    );
    expect(tradeRefusals([{ kind: "tool_result", toolName: "place_trade", payload: { result: refused } }])).toEqual([
      { label: "position limit", count: 1 },
    ]);
    // No order was written, let alone routed.
    expect(await t.trades()).toHaveLength(0);
    expect((await t.held()).map((row) => row.tokenId)).toEqual([WIF_ID]);
  });

  it("lets it sell what it holds at the limit, and buy again once a slot is free", async () => {
    const t = await tick({ risk: { maxOpenPositions: 1 } });
    await hold(t.agentId, BONK_ID, 27, BONK_PRICE);
    expect(await t.sell(BONK, 27)).toMatchObject({ ok: true, status: "filled", side: "sell" });
    expect(await t.held()).toHaveLength(0);
    expect(await t.buy(BONK, 5)).toMatchObject({ ok: true, status: "filled", side: "buy" });
  });

  it("lets it add to the token it already holds", async () => {
    const t = await tick({ risk: { maxOpenPositions: 1, maxPositionPct: 100 } });
    await hold(t.agentId, BONK_ID, 27, BONK_PRICE);
    expect(await t.buy(BONK, 5)).toMatchObject({ ok: true, status: "filled", side: "buy" });
    expect(await t.held()).toHaveLength(1);
  });

  it("tells the model the count in its book", async () => {
    const t = await tick({ risk: { maxOpenPositions: 1 } });
    await hold(t.agentId, BONK_ID, 27, BONK_PRICE);
    const book = await t.book();
    expect(String(book.rendered)).toContain("Open positions: 1 of 1 allowed. You are at the limit:");
  });
});

describe("place_trade under a cash reserve", () => {
  it("refuses a buy that would go into the reserve, fills one that leaves it, and never holds a sell back", async () => {
    // $10 of paper cash, $5 always kept.
    const t = await tick({ risk: { cashReserveUsd: 5, maxPositionPct: 100 } }, { paperStartingUsd: "10" });

    const refused = await t.buy(BONK, 6);
    expect(refused).toMatchObject({ ok: false, rejected: true });
    expect(refused.reason).toBe(
      "Rejected by risk guard: Cash reserve: this buy and its Tocker fee would leave $3.97 in cash, and this agent keeps $5.00 in reserve (cashReserveUsd). The most it can buy right now is $4.97. Sells and exits are never blocked by this.",
    );
    expect(tradeRefusals([{ kind: "tool_result", toolName: "place_trade", payload: { result: refused } }])).toEqual([
      { label: "cash reserve", count: 1 },
    ]);
    expect(await t.trades()).toHaveLength(0);

    // The figure it was told goes through.
    expect(await t.buy(BONK, 4.97)).toMatchObject({ ok: true, status: "filled" });
    // With the cash now at the reserve, the smallest buy is refused and a sell is not.
    expect(await t.buy(BONK, 0.5)).toMatchObject({ ok: false, rejected: true });
    expect(await t.sell(BONK, 2)).toMatchObject({ ok: true, status: "filled", side: "sell" });
  });

  it("tells the model what the reserve leaves it to trade with", async () => {
    const t = await tick({ risk: { cashReserveUsd: 5, maxPositionPct: 100 } }, { paperStartingUsd: "10" });
    const rendered = String((await t.book()).rendered);
    expect(rendered).toContain(
      "Max ticket right now: $4.97 — the binding limit is the $5.00 of your cash that is above your $5.00 cash reserve less the 0.5% Tocker fee charged on the fill.",
    );
    expect(rendered).toContain("Cash reserve: your owner keeps $5.00 of your cash out of every buy, so $5.00 is available to trade.");
  });
});

/**
 * A step's tool calls run side by side. Each of these pairs fits on its own and not
 * together, and each call used to read the book before the other had landed.
 */
describe("two buys made in the same step", () => {
  it("cannot go through the cash reserve together", async () => {
    // $10, $5 kept: one $4 buy leaves $5.98, two would leave $1.96.
    const t = await tick({ risk: { cashReserveUsd: 5, maxPositionPct: 100 } }, { paperStartingUsd: "10" });
    const results = await Promise.all([t.buy(BONK, 4), t.buy(BONK, 4)]);
    expect(results.filter((result) => result.ok === true)).toHaveLength(1);
    const refused = results.find((result) => result.ok === false);
    expect(String(refused?.reason)).toContain("Cash reserve: this buy and its Tocker fee would leave $1.9");
    expect((await t.trades()).filter((trade) => trade.status === "filled")).toHaveLength(1);
  });

  it("are placed in the order they were made, and a refusal does not hold up the next", async () => {
    const t = await tick({ risk: { cashReserveUsd: 5, maxPositionPct: 100 } }, { paperStartingUsd: "10" });
    const [tooBig, fits, alsoTooBig] = await Promise.all([t.buy(BONK, 6), t.buy(BONK, 4), t.buy(BONK, 4)]);
    expect(tooBig).toMatchObject({ ok: false, rejected: true });
    expect(fits).toMatchObject({ ok: true, status: "filled" });
    expect(alsoTooBig).toMatchObject({ ok: false, rejected: true });
  });
});

/**
 * The agent's own buys take turns inside a run. A buy from outside it does not: the
 * owner's, placed by hand while the run is going. Until that order fills it is neither a
 * position nor spent cash, and the run's buy was judged on a book that showed neither.
 */
describe("a buy of the agent's that is still filling, placed outside this run", () => {
  /** The owner's buy of WIF, a few seconds in: its row is written and the order is out. */
  async function ownersBuyInFlight(t: { agentId: string; ownerId: string }, usd: number): Promise<string> {
    const id = nanoid();
    await db.insert(schema.trades).values({
      id,
      agentId: t.agentId,
      ownerId: t.ownerId,
      chain: "solana",
      side: "buy",
      tokenId: WIF_ID,
      quoteTokenId: USDC_ID,
      amountToken: toNumeric(0, 12),
      amountUsd: toNumeric(usd, 6),
      requestedUsd: toNumeric(usd, 6),
      priceUsd: toNumeric(0, 12),
      feeUsd: toNumeric(0, 6),
      status: "pending",
      origin: "manual",
      isPaper: true,
      decidedAt: new Date(),
      decidedBy: "owner",
    });
    return id;
  }

  it("takes a slot under the position limit, and gives it back if the order fails", async () => {
    const t = await tick({ risk: { maxOpenPositions: 1 } });
    const order = await ownersBuyInFlight(t, 5);
    const refused = await t.buy(BONK, 5);
    expect(refused).toMatchObject({ ok: false, rejected: true });
    expect(refused.reason).toContain(
      "may hold at most 1 position and holds 0 with 1 more being bought right now (maxOpenPositions). BONK would be a new one.",
    );
    await db.update(schema.trades).set({ status: "failed" }).where(eq(schema.trades.id, order));
    expect(await t.buy(BONK, 5)).toMatchObject({ ok: true, status: "filled" });
  });

  it("is taken off the cash the reserve is measured against", async () => {
    const t = await tick({ risk: { cashReserveUsd: 5, maxTradeUsd: 20, maxPositionPct: 100 } }, { paperStartingUsd: "20" });
    // $8 and its fee are on their way out of $20. With $5 kept, $6.96 is left to spend.
    await ownersBuyInFlight(t, 8);
    const refused = await t.buy(BONK, 8);
    expect(refused).toMatchObject({ ok: false, rejected: true });
    expect(refused.reason).toBe(
      "Rejected by risk guard: Cash reserve: this buy and its Tocker fee would leave $3.92 in cash once the $8.04 of buys it has already placed have settled, and this agent keeps $5.00 in reserve (cashReserveUsd). The most it can buy right now is $6.92. Sells and exits are never blocked by this.",
    );
    expect(await t.buy(BONK, 6.92)).toMatchObject({ ok: true, status: "filled" });
  });

  it("never holds back a sell", async () => {
    const t = await tick({ risk: { maxOpenPositions: 1, cashReserveUsd: 1_000_000 } });
    await hold(t.agentId, BONK_ID, 27, BONK_PRICE);
    await ownersBuyInFlight(t, 5);
    expect(await t.sell(BONK, 27)).toMatchObject({ ok: true, status: "filled", side: "sell" });
  });

  it("changes nothing for an agent with neither limit", async () => {
    const t = await tick({ risk: { maxTradeUsd: 20, maxPositionPct: 100 } }, { paperStartingUsd: "20" });
    await ownersBuyInFlight(t, 8);
    // All of its cash but the fee, as it could always buy.
    expect(await t.buy(BONK, 19.9)).toMatchObject({ ok: true, status: "filled" });
  });
});

describe("a sell made in the same step as a buy", () => {
  it("does not wait behind it: the buy is still out when the sell has filled", async () => {
    const t = await tick({ risk: { maxOpenPositions: 2, cashReserveUsd: 5, maxPositionPct: 100 } }, { paperStartingUsd: "100" });
    await hold(t.agentId, BONK_ID, 27, BONK_PRICE);

    // The buy is for $4 and the sell for $27, so the quote for exactly $4 of USDC is the
    // buy's. That quote is held until the test lets it go; everything else answers at once.
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let buyQuoted = false;
    const answer = globalThis.fetch;
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/ultra/v1/order") && new URL(url).searchParams.get("amount") === "4000000") {
        buyQuoted = true;
        await held;
      }
      return answer(input);
    });

    let buyDone = false;
    const buying = t.buy(BONK, 4).then((result) => {
      buyDone = true;
      return result;
    });
    const sold = await t.sell(BONK, 27);
    expect(sold).toMatchObject({ ok: true, status: "filled", side: "sell" });
    // The buy was made first and had not finished: the sell went past it.
    expect(buyDone).toBe(false);

    release();
    expect(await buying).toMatchObject({ ok: true, status: "filled", side: "buy" });
    expect(buyQuoted).toBe(true);
  });
});

describe("place_trade in approval mode: the purse, with a cash reserve", () => {
  async function propose(t: Awaited<ReturnType<typeof tick>>, usd: number): Promise<void> {
    await db.insert(schema.trades).values({
      id: nanoid(),
      agentId: t.agentId,
      ownerId: t.ownerId,
      chain: "solana",
      side: "buy",
      tokenId: WIF_ID,
      quoteTokenId: USDC_ID,
      amountToken: toNumeric(0, 12),
      amountUsd: toNumeric(usd, 6),
      requestedUsd: toNumeric(usd, 6),
      priceUsd: toNumeric(0.5, 12),
      feeUsd: toNumeric(0, 6),
      status: "proposed",
      proposedAt: new Date(),
      isPaper: true,
    });
  }
  const approve = { execution: { mode: "approve" as const, proposalTtlMinutes: 60 } };

  /**
   * $20 of cash, $5 always kept, $12 already proposed. The purse is $15. The waiting $12
   * will pay $0.06 in fees, which leaves $2.94, and the largest buy that covers with a
   * fee of its own is $2.92. Counted against the whole $20 it looked like $7.90.
   */
  it("counts the reserve as not there to propose with, and says so", async () => {
    const t = await tick({ ...approve, risk: { cashReserveUsd: 5, maxPositionPct: 100 } }, { paperStartingUsd: "20" });
    await propose(t, 12);

    const refused = await t.buy(BONK, 3);
    expect(refused).toMatchObject({ ok: false, unaffordable: true, affordableUsd: 2.92 });
    expect(refused.reason).toBe(
      "Not affordable alongside what is already proposed: cash available to trade $15.00 (your owner keeps $5.00 in reserve), $12.00 already awaiting your owner's decision, and a 0.5% Tocker fee on each fill — at most $2.92 is left for this one. Shrink it to fit or skip it; the set has to add up to the cash you hold.",
    );
    expect(await t.buy(BONK, 2.93)).toMatchObject({ ok: false, unaffordable: true, affordableUsd: 2.92 });
    const fits = await t.buy(BONK, 2.92);
    expect(fits).toMatchObject({ ok: true, proposed: true });
    expect((await t.trades()).filter((trade) => trade.status === "proposed")).toHaveLength(2);
  });

  it("is the whole of the cash, in the words it always used, for an agent with no reserve", async () => {
    const t = await tick({ ...approve, risk: { maxPositionPct: 100 } }, { paperStartingUsd: "20" });
    await propose(t, 18);
    const refused = await t.buy(BONK, 2);
    expect(refused).toMatchObject({ ok: false, unaffordable: true, affordableUsd: 1.9 });
    expect(refused.reason).toBe(
      "Not affordable alongside what is already proposed: cash $20.00, $18.00 already awaiting your owner's decision, and a 0.5% Tocker fee on each fill — at most $1.90 is left for this one. Shrink it to fit or skip it; the set has to add up to the cash you hold.",
    );
  });

  it("counts a proposal that is waiting towards the position limit, so no more are queued than can be opened", async () => {
    const t = await tick({ ...approve, risk: { maxOpenPositions: 1, maxPositionPct: 100 } }, { paperStartingUsd: "20" });
    await propose(t, 5);
    const refused = await t.buy(BONK, 3);
    expect(refused).toMatchObject({ ok: false, rejected: true });
    expect(String(refused.reason)).toContain(
      "this agent may hold at most 1 position and holds 0 with 1 more buy waiting for its owner's approval (maxOpenPositions)",
    );
    expect((await t.trades()).filter((trade) => trade.status === "proposed")).toHaveLength(1);
  });
});

describe("finish, for an agent at its position limit", () => {
  it("is not sent back to sweep: it can open nothing a sweep would find", async () => {
    const full = await tick({ risk: { maxOpenPositions: 1 } });
    await hold(full.agentId, BONK_ID, 27, BONK_PRICE);
    expect(await full.finish()).toMatchObject({ ok: true });
    expect(full.ctx.finished.summary).toBe("Nothing cleared the bar this tick.");

    // The same agent with a slot left is sent back, as every agent is.
    const roomy = await tick({ risk: { maxOpenPositions: 2 } });
    await hold(roomy.agentId, BONK_ID, 27, BONK_PRICE);
    expect(await roomy.finish()).toMatchObject({ ok: false, nudged: true, notSwept: true });
  });

  it("is not sent back to score the candidates a sweep surfaced", async () => {
    const full = await tick({ risk: { maxOpenPositions: 1 } });
    await hold(full.agentId, WIF_ID, 20, 0.5);
    const swept = await full.discover({});
    expect(Number(swept.freshCount)).toBeGreaterThan(0);
    expect(await full.finish()).toMatchObject({ ok: true });

    // With no limit the same tick is sent back for them.
    const open = await tick();
    await hold(open.agentId, WIF_ID, 20, 0.5);
    expect(Number((await open.discover({})).freshCount)).toBeGreaterThan(0);
    expect(await open.finish()).toMatchObject({ ok: false, nudged: true });
  });

  it("is sent back again once a sale has freed a slot", async () => {
    const t = await tick({ risk: { maxOpenPositions: 1 } });
    await hold(t.agentId, BONK_ID, 27, BONK_PRICE);
    expect(await t.sell(BONK, 27)).toMatchObject({ ok: true, status: "filled" });
    expect(await t.finish()).toMatchObject({ ok: false, nudged: true, notSwept: true });
    expect(await t.finish()).toMatchObject({ ok: true });
  });

  it("is let go when the reserve leaves no cash for a ticket, as it is for an agent with no cash", async () => {
    const reserved = await tick({ risk: { cashReserveUsd: 5, maxPositionPct: 100 } }, { paperStartingUsd: "5.10" });
    expect(await reserved.finish()).toMatchObject({ ok: true });
    // A quarter of a dollar above the reserve is a ticket, and the tick is sent back.
    const enough = await tick({ risk: { cashReserveUsd: 5, maxPositionPct: 100 } }, { paperStartingUsd: "5.30" });
    expect(await enough.finish()).toMatchObject({ ok: false, nudged: true, notSwept: true });
  });
});
