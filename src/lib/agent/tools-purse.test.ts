/**
 * `place_trade` in approval mode: the one purse a tick's proposals are drawn from.
 *
 * What is already proposed and undecided counts as spent. The purse it is counted against
 * has to be the cash a buy may actually spend, which for an agent that pays for its own
 * thinking is less than its cash (`spendableCashUsd`). It used to be the raw cash, so a
 * set of proposals could add up to money the risk guard would refuse the last approval
 * for.
 *
 * The book is handed in (`getPortfolio` is the one stand-in), because what is under test
 * is what the tool does with a book that holds something back. The token, its score, the
 * risk guard, the proposals table and the tool itself are the real code on PGlite, with
 * the token providers in their mock mode.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { Db } from "@/db";
import * as schema from "@/db/schema";
import { toNumeric } from "@/lib/money";
import { seedKnownTokens, tokenId, USDC_SOLANA } from "@/lib/trading/tokens";
import { newBudget } from "@/lib/x402/types";
import { RunLogger } from "./logger";
import type { Portfolio } from "./portfolio";
import { seedAgent, setupTestDb } from "./test-support";

/** The book each agent is given, by agent id. */
const books = vi.hoisted(() => ({ byAgent: new Map<string, unknown>() }));

vi.mock("./portfolio", async (importOriginal) => {
  const real = await importOriginal<typeof import("./portfolio")>();
  return {
    ...real,
    getPortfolio: async (agentId: string) => (books.byAgent.get(agentId) as Portfolio | undefined) ?? real.getPortfolio(agentId),
  };
});

const { buildTools } = await import("./tools");

const BONK_MINT = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const WIF_MINT = "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm";
const WIF_ID = tokenId("solana", WIF_MINT);
const USDC_ID = tokenId("solana", USDC_SOLANA);

let db: Db;

beforeAll(async () => {
  process.env.X402_MOCK = "1";
  db = await setupTestDb();
  await seedKnownTokens();
  await db.insert(schema.tokens).values({ id: WIF_ID, chain: "solana", address: WIF_MINT, symbol: "WIF", decimals: 6 }).onConflictDoNothing();
}, 120_000);

beforeEach(() => {
  books.byAgent.clear();
  vi.stubEnv("PLATFORM_FEE_BPS", "50");
  // A proposal is priced with an indicative quote; keep it offline and the same every time.
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/ultra/v1/order")) {
      const amount = Number(new URL(url).searchParams.get("amount"));
      const out = (amount / 1e6 / 0.0000027) * 10 ** 5;
      return new Response(JSON.stringify({ requestId: "req", transaction: null, inAmount: String(amount), outAmount: String(Math.round(out)) }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (url.includes("api.jup.ag/price/v3")) {
      return new Response(JSON.stringify({ [BONK_MINT]: { usdPrice: 0.0000027 } }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

type ToolExec = (input: unknown, options: unknown) => Promise<Record<string, unknown>>;

/**
 * An agent in approval mode with `cashUsd` in its book, `heldUsd` of it held back for
 * thinking, and `proposedUsd` already proposed for another token and not yet decided.
 */
async function proposer(options: { cashUsd: number; heldUsd?: number; proposedUsd: number }) {
  const seeded = await seedAgent(db, {
    config: {
      chains: ["solana"],
      dataSources: [],
      execution: { mode: "approve", proposalTtlMinutes: 60 },
      risk: { maxTradeUsd: 100, maxPositionPct: 100, maxDailyTrades: 10 },
    },
  });
  const [agent] = await db.select().from(schema.agents).where(eq(schema.agents.id, seeded.agentId)).limit(1);
  if (!agent) throw new Error("agent missing");

  const book: Portfolio = {
    agentId: agent.id,
    mode: agent.mode,
    cashUsd: options.cashUsd,
    equityUsd: options.cashUsd,
    positions: [],
    realizedPnlUsd: 0,
    unrealizedPnlUsd: 0,
    tradesToday: 0,
    startingUsd: options.cashUsd,
    cashReadFailed: false,
    ...(options.heldUsd ? { thinkingReserveUsd: options.heldUsd } : {}),
  };
  books.byAgent.set(agent.id, book);

  await db.insert(schema.trades).values({
    id: nanoid(),
    agentId: agent.id,
    ownerId: agent.ownerId,
    chain: "solana",
    side: "buy",
    tokenId: WIF_ID,
    quoteTokenId: USDC_ID,
    amountToken: toNumeric(0, 12),
    amountUsd: toNumeric(options.proposedUsd, 6),
    requestedUsd: toNumeric(options.proposedUsd, 6),
    priceUsd: toNumeric(1, 12),
    feeUsd: toNumeric(0, 6),
    status: "proposed",
    proposedAt: new Date(),
    isPaper: true,
  });

  const runId = `run-${agent.id.slice(0, 8)}`;
  await db.insert(schema.agentRuns).values({ id: runId, agentId: agent.id, trigger: "manual", status: "running", startedAt: new Date() });
  const budget = newBudget(agent.config.risk.maxDataSpendUsdPerRun);
  const tools = buildTools({
    runId,
    agent: { id: agent.id, ownerId: agent.ownerId, slug: agent.slug, name: agent.name, mode: agent.mode, config: agent.config },
    x402: { agentId: agent.id, runId, mode: agent.mode, wallets: [], budget },
    budget,
    logger: new RunLogger(runId),
    finished: { summary: null },
    tradeIds: [],
    postIds: [],
  });
  const execute = tools.place_trade?.execute as unknown as ToolExec | undefined;
  if (!execute) throw new Error("place_trade is not registered");
  const propose = (amountUsd: number) =>
    execute(
      { chain: "solana", side: "buy", tokenAddress: BONK_MINT, amountUsd, rationale: "Scored 84/100 with organic volume leading; a starter position." },
      { toolCallId: "call_place_trade", messages: [] },
    );
  const proposals = () => db.select().from(schema.trades).where(eq(schema.trades.agentId, agent.id));
  /** What the model is told `amountUsd` means, read off the tool it is handed. */
  const amountWords = (tools.place_trade?.inputSchema as unknown as { shape: { amountUsd: { description?: string } } }).shape
    .amountUsd.description;
  return { agentId: agent.id, propose, proposals, amountWords };
}

describe("place_trade in approval mode: one purse", () => {
  /**
   * $20 in the wallet, $4.25 of it held back for thinking, $14 already proposed. A buy
   * may spend $15.75. The waiting $14 will pay $0.07 in fees when it is approved, which
   * leaves $1.68, and the largest buy $1.68 covers with a fee of its own is $1.67.
   * Counted against the raw $20 it looked like $5.90, the $2 proposal went out, and the
   * owner's last approval was refused at the fill for cash that was never there to spend.
   */
  it("counts what is held back for thinking as not there to propose with, and says so", async () => {
    const agent = await proposer({ cashUsd: 20, heldUsd: 4.25, proposedUsd: 14 });

    const refused = await agent.propose(2);
    expect(refused).toMatchObject({ ok: false, unaffordable: true });
    expect(refused.affordableUsd).toBe(1.67);
    expect(refused.reason).toBe(
      "Not affordable alongside what is already proposed: cash available to trade $15.75 (part of your cash is kept back to pay for your thinking), $14.00 already awaiting your owner's decision, and a 0.5% Tocker fee on each fill — at most $1.67 is left for this one. Shrink it to fit or skip it; the set has to add up to the cash you hold.",
    );
    // How much is kept back follows a limit only the owner may read, and the model that
    // reads this refusal writes public text: the figure is nowhere in what it is handed.
    expect(JSON.stringify(refused)).not.toContain("4.25");
    // Nothing new was proposed: the one already waiting is still the only one.
    expect(await agent.proposals()).toHaveLength(1);

    // A cent over the figure it was told does not fit either.
    expect(await agent.propose(1.68)).toMatchObject({ ok: false, unaffordable: true, affordableUsd: 1.67 });

    // The figure it was told does, and is proposed.
    const fits = await agent.propose(1.67);
    expect(fits.unaffordable).toBeUndefined();
    expect(fits.ok).toBe(true);
    expect(await agent.proposals()).toHaveLength(2);
  });

  it("is what it was for an agent that holds nothing back: the same sum and the same sentence", async () => {
    const roomy = await proposer({ cashUsd: 20, proposedUsd: 14 });
    const fits = await roomy.propose(2);
    expect(fits.unaffordable).toBeUndefined();
    expect(fits.ok).toBe(true);

    const full = await proposer({ cashUsd: 20, proposedUsd: 18 });
    const refused = await full.propose(2);
    expect(refused).toMatchObject({ ok: false, unaffordable: true });
    expect(refused.affordableUsd).toBe(1.9);
    expect(refused.reason).toBe(
      "Not affordable alongside what is already proposed: cash $20.00, $18.00 already awaiting your owner's decision, and a 0.5% Tocker fee on each fill — at most $1.90 is left for this one. Shrink it to fit or skip it; the set has to add up to the cash you hold.",
    );
  });

  /**
   * The $18 waiting will pay $0.09 in fees of its own when it is approved. Reserving a
   * fee for the new buy alone would let $1.95 through ($1.95975 with its fee, under the
   * $2 that looks free), and the set would then cost $20.04975 against $20.00.
   */
  it("keeps back the fee each waiting proposal will pay, not only the new one's", async () => {
    const full = await proposer({ cashUsd: 20, proposedUsd: 18 });
    expect(await full.propose(1.95)).toMatchObject({ ok: false, unaffordable: true, affordableUsd: 1.9 });
    expect(await full.propose(1.91)).toMatchObject({ ok: false, unaffordable: true, affordableUsd: 1.9 });
    const fits = await full.propose(1.9);
    expect(fits.unaffordable).toBeUndefined();
    expect(fits.ok).toBe(true);
  });

  it("is the cash less what is waiting, with no word about a fee, when the fee is off", async () => {
    vi.stubEnv("PLATFORM_FEE_BPS", "0");
    const full = await proposer({ cashUsd: 20, proposedUsd: 18 });
    const refused = await full.propose(2.01);
    expect(refused).toMatchObject({ ok: false, unaffordable: true, affordableUsd: 2 });
    expect(refused.reason).toBe(
      "Not affordable alongside what is already proposed: cash $20.00, $18.00 already awaiting your owner's decision — at most $2.00 is left for this one. Shrink it to fit or skip it; the set has to add up to the cash you hold.",
    );
    const fits = await full.propose(2);
    expect(fits.unaffordable).toBeUndefined();
    expect(fits.ok).toBe(true);
  });
});

/**
 * The fee is charged on top of a buy. The model is told so where it writes the size, at
 * the rate in force, and is told of no fee when there is none.
 */
describe("place_trade: what the model is told amountUsd is", () => {
  it("says the fee is on top of a buy and never off the size of a sell, at the rate set", async () => {
    expect((await proposer({ cashUsd: 20, proposedUsd: 1 })).amountWords).toBe(
      "USD notional to buy, or USD worth of the position to sell. A buy is charged the 0.5% Tocker fee on top of this amount, so your cash has to cover both; a sell's fee comes off what the sale brings in, never off the size you may sell",
    );
    vi.stubEnv("PLATFORM_FEE_BPS", "25");
    expect((await proposer({ cashUsd: 20, proposedUsd: 1 })).amountWords).toContain("the 0.25% Tocker fee on top of this amount");
  });

  it("says nothing of a fee when the fee is off", async () => {
    vi.stubEnv("PLATFORM_FEE_BPS", "0");
    expect((await proposer({ cashUsd: 20, proposedUsd: 1 })).amountWords).toBe(
      "USD notional to buy, or USD worth of the position to sell",
    );
  });
});
