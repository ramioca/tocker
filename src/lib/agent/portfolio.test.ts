import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { Db } from "@/db";
import * as schema from "@/db/schema";
import { DEFAULT_AGENT_CONFIG } from "./config";
import { PAYMENT_IN_FLIGHT_MS } from "./inference";
import { applyFill } from "@/lib/trading/positions";
import { RECONCILE_AFTER_MS } from "@/lib/x402/inference-reconcile";
import { INFERENCE_GATEWAY, PAID_TIMEOUT_MS, utcDay, type InferencePaymentStatus } from "@/lib/x402/inference-types";
import * as prices from "@/lib/trading/prices";
import { seedKnownTokens, tokenId, USDC_SOLANA } from "@/lib/trading/tokens";
import { describePortfolio, effectiveTicketUsd, getPortfolio, snapshotEquity, spendableCashUsd, toRiskPortfolio, type Portfolio } from "./portfolio";
import { seedAgent, setupTestDb } from "./test-support";

let db: Db;

beforeAll(async () => {
  db = await setupTestDb();
});

function book(overrides: Partial<Portfolio> = {}): Portfolio {
  return {
    agentId: "a1",
    mode: "paper",
    cashUsd: 100,
    equityUsd: 100,
    positions: [],
    realizedPnlUsd: 0,
    unrealizedPnlUsd: 0,
    tradesToday: 0,
    startingUsd: 100,
    cashReadFailed: false,
    ...overrides,
  };
}

/**
 * W7 H8. A paper book starts at `paperStartingUsd` (10,000 by default) and a live book
 * at whatever was deposited, so a series that mixes the two reads as a −99.9% crash from
 * the moment an agent goes live — on its own card and on the public leaderboard. Readers
 * filter by the agent's current mode; that only works if writers stamp it.
 */
describe("snapshotEquity", () => {
  it("stamps the agent's mode on the point", async () => {
    const paper = await seedAgent(db);
    const live = await seedAgent(db, { mode: "live" });

    expect(await snapshotEquity(book({ agentId: paper.agentId, mode: "paper" }))).toBe(true);
    expect(await snapshotEquity(book({ agentId: live.agentId, mode: "live", cashUsd: 10, equityUsd: 10 }))).toBe(true);

    const [paperRow] = await db
      .select()
      .from(schema.equitySnapshots)
      .where(eq(schema.equitySnapshots.agentId, paper.agentId));
    const [liveRow] = await db
      .select()
      .from(schema.equitySnapshots)
      .where(eq(schema.equitySnapshots.agentId, live.agentId));

    expect(paperRow?.mode).toBe("paper");
    expect(liveRow?.mode).toBe("live");
    expect(Number(liveRow?.equityUsd)).toBeCloseTo(10, 6);
  });

  it("writes no point at all when a live balance read failed", async () => {
    const { agentId } = await seedAgent(db, { mode: "live" });

    // The wallet could not be read, so `cashUsd` understates the book. A point drawn on
    // that says the agent lost everything at 14:05 and got it back at 14:10; a gap says
    // nothing, which is the truth.
    expect(await snapshotEquity(book({ agentId, mode: "live", cashUsd: 0, equityUsd: 0, cashReadFailed: true }))).toBe(
      false,
    );

    const rows = await db
      .select()
      .from(schema.equitySnapshots)
      .where(eq(schema.equitySnapshots.agentId, agentId));
    expect(rows).toHaveLength(0);
  });
});

/**
 * W7 H11. The prompt printed the sizing ceiling alone, which on the exact configuration
 * the product recommends to a new operator was a lie: a $10 wallet under the first-trade
 * preset was told its clip was $2 while `maxPositionPct` refused anything over $1.
 */
describe("effectiveTicketUsd", () => {
  const config = {
    ...DEFAULT_AGENT_CONFIG,
    risk: { ...DEFAULT_AGENT_CONFIG.risk, maxTradeUsd: 2, maxPositionPct: 10 },
  };

  it("returns the concentration cap when that is what actually binds", () => {
    const ticket = effectiveTicketUsd({ cashUsd: 10, equityUsd: 10 }, config);
    expect(ticket.amountUsd).toBeCloseTo(1, 6);
    expect(ticket.reason).toContain("maxPositionPct 10%");
  });

  it("returns the sizing ceiling when that is the smallest", () => {
    const ticket = effectiveTicketUsd({ cashUsd: 1_000, equityUsd: 1_000 }, config);
    expect(ticket.amountUsd).toBeCloseTo(2, 6);
    expect(ticket.reason).toContain("fixed usd sizing");
  });

  it("subtracts the platform fee from cash, so the guard and the prompt agree", () => {
    const ticket = effectiveTicketUsd({ cashUsd: 1.5, equityUsd: 100 }, config);
    // $1.50 of cash, a $0.10 fee on the fill: $1.40 is the most that can be spent.
    expect(ticket.amountUsd).toBeCloseTo(1.4, 6);
    expect(ticket.reason).toContain("Tocker fee");
  });

  it("never goes negative when the wallet cannot even cover the fee", () => {
    const ticket = effectiveTicketUsd({ cashUsd: 0.05, equityUsd: 0.05 }, config);
    expect(ticket.amountUsd).toBe(0);
  });
});

/**
 * The agent page prints Equity, a Cash row and every position's value side by side; a
 * manual buy between runs once left them $25 apart because cash came from a stale
 * snapshot. The book itself has to add up: equity is cash plus what the positions are
 * worth, read from the same ledger.
 */
describe("getPortfolio", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reports equity as cash plus the value of every position", async () => {
    await seedKnownTokens();
    const { agentId, userId } = await seedAgent(db);
    const BONK = tokenId("solana", "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263");
    const WIF = tokenId("solana", "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm");
    const marks = new Map<string, number | null>([
      [BONK, 0.00003],
      [WIF, 0.6],
    ]);
    vi.spyOn(prices, "getMarks").mockImplementation(async (ids) => new Map(ids.map((id) => [id, marks.get(id) ?? null])));

    const fills = [
      { tokenId: BONK, amountToken: 2_000_000, amountUsd: 50, priceUsd: 0.000025 },
      { tokenId: WIF, amountToken: 20, amountUsd: 10, priceUsd: 0.5 },
    ];
    for (const f of fills) {
      await db.insert(schema.trades).values({
        id: nanoid(),
        agentId,
        ownerId: userId,
        chain: "solana",
        side: "buy",
        tokenId: f.tokenId,
        quoteTokenId: tokenId("solana", USDC_SOLANA),
        amountToken: String(f.amountToken),
        amountUsd: f.amountUsd.toFixed(6),
        priceUsd: String(f.priceUsd),
        feeUsd: "0",
        status: "filled",
        isPaper: true,
      });
      await applyFill(agentId, f.tokenId, { side: "buy", amountToken: f.amountToken, amountUsd: f.amountUsd, feeUsd: 0, decimals: 6 });
    }

    const book = await getPortfolio(agentId);
    const positionsValue = book.positions.reduce((sum, p) => sum + (p.valueUsd ?? 0), 0);

    expect(book.cashUsd).toBeCloseTo(10_000 - 60, 6);
    expect(positionsValue).toBeCloseTo(60 + 12, 6);
    expect(book.equityUsd).toBeCloseTo(book.cashUsd + positionsValue, 6);
  });
});

/**
 * A live agent that pays for its own thinking keeps two runs' worth of it, and the wallet
 * floor, out of its trades. The money is still its own: it stays in cash and equity, and
 * is only left out of what a buy may spend. (The figures below are a book's, handed in;
 * `portfolio-thinking.test.ts` is where the size of the reserve is pinned.)
 */
describe("what is held back for thinking", () => {
  afterEach(() => vi.unstubAllEnvs());

  const config = { ...DEFAULT_AGENT_CONFIG, risk: { ...DEFAULT_AGENT_CONFIG.risk, maxTradeUsd: 100, maxPositionPct: 100 } };

  it("is nothing for a book that holds nothing back: every figure is as it was", () => {
    const plain = book({ mode: "live", cashUsd: 10, equityUsd: 10 });
    expect(spendableCashUsd(plain)).toBe(10);
    expect(toRiskPortfolio(plain).cashUsd).toBe(10);
    expect(spendableCashUsd({ cashUsd: 10, thinkingReserveUsd: 0 })).toBe(10);
    vi.stubEnv("PLATFORM_FEE_USD", "0.10");
    expect(effectiveTicketUsd(plain, config)).toEqual({
      amountUsd: 9.9,
      reason: "cash $10.00 minus the $0.10 Tocker fee charged on the fill",
    });
    expect(describePortfolio(plain, config)).not.toMatch(/held back|kept back/);
  });

  it("comes out of what the risk guard may spend, and not out of equity", () => {
    const held = book({ mode: "live", cashUsd: 10, equityUsd: 14, thinkingReserveUsd: 0.55 });
    expect(spendableCashUsd(held)).toBeCloseTo(9.45, 6);
    const risk = toRiskPortfolio(held);
    expect(risk.cashUsd).toBeCloseTo(9.45, 6);
    // The concentration cap is still measured against everything the agent owns.
    expect(risk.equityUsd).toBe(14);
  });

  it("never leaves the guard a negative number to size against", () => {
    expect(spendableCashUsd({ cashUsd: 0.3, thinkingReserveUsd: 0.55 })).toBe(0);
  });

  it("is in the ceiling the model is told, with the reason, so it does not go looking for the rest", () => {
    vi.stubEnv("PLATFORM_FEE_USD", "0.10");
    const held = book({ mode: "live", cashUsd: 10, equityUsd: 10, thinkingReserveUsd: 0.55 });
    const ticket = effectiveTicketUsd(held, config);
    expect(ticket.amountUsd).toBeCloseTo(9.35, 6);
    expect(ticket.reason).toBe(
      "the $9.45 of your cash that is available to trade (part of your cash is kept back to pay for your thinking) minus the $0.10 Tocker fee charged on the fill",
    );
    // With no fee the same words stand alone.
    vi.stubEnv("PLATFORM_FEE_USD", "0");
    expect(effectiveTicketUsd(held, config).reason).toBe(
      "the $9.45 of your cash that is available to trade (part of your cash is kept back to pay for your thinking)",
    );
    vi.stubEnv("PLATFORM_FEE_USD", "0.10");

    const said = describePortfolio(held, config);
    expect(said).toMatch(/Cash: \$10\.00/);
    expect(said).toContain("Part of that cash is kept back to pay for your own thinking and cannot be spent on a buy: $9.45 is available to trade.");
  });

  /**
   * How much is kept back is twice the owner's limit for one run plus a fixed floor, so
   * the figure gives that limit away, and the limit is the owner's private setting. The
   * model that reads its book writes text anyone can read (a rationale, a post, its
   * summary), and nothing strips a dollar amount out of that. So the figure is not handed
   * to the model at all: not in its book, and not in the reason for its ceiling. It used
   * to be in both, with only a sentence asking the model not to repeat it.
   */
  it("never tells the model how much is kept back: only that some is, and what it may trade with", () => {
    vi.stubEnv("PLATFORM_FEE_USD", "0.10");
    // Figures chosen so the amount kept back appears nowhere else in the book.
    for (const [cashUsd, reserve, spendable] of [
      [10, 0.85, "9.15"],
      [20, 4.25, "15.75"],
      [5, 0.35, "4.65"],
    ] as const) {
      const held = book({ mode: "live", cashUsd, equityUsd: cashUsd, thinkingReserveUsd: reserve });
      const figure = reserve.toFixed(2);
      for (const text of [describePortfolio(held, config), effectiveTicketUsd(held, config).reason]) {
        expect(text, text).not.toContain(figure);
        expect(text, text).toContain(`$${spendable}`);
        expect(text, text).toMatch(/kept back to pay for your (own )?thinking/);
      }
    }
  });

  it("asks the model to keep it, and the amount it may trade with, out of anything public", () => {
    const held = book({ mode: "live", cashUsd: 10, equityUsd: 10, thinkingReserveUsd: 0.85 });
    const line = describePortfolio(held, config)
      .split("\n")
      .find((text) => text.includes("kept back to pay for your own thinking"));
    // Cash is in the book and on chain, so cash less what may be traded is the amount itself.
    expect(line).toMatch(/never mention it, or the amount available to trade, in a rationale, a post or your summary\.$/);
    // Nothing of the kind is said to an agent that holds nothing back.
    const plain = describePortfolio(book({ mode: "live", cashUsd: 10, equityUsd: 10 }), config);
    expect(plain).not.toMatch(/never mention it/);
    expect(plain).not.toMatch(/kept back/);
  });

  it("is not held back from a paper agent, whose cash is not what pays", async () => {
    const paper = await seedAgent(db, {
      config: { llm: { ...DEFAULT_AGENT_CONFIG.llm, source: "usdc", usdc: { model: "google/gemini-2.5-flash", maxUsdPerRun: 0.3, maxUsdPerDay: 3 } } },
    });
    const portfolio = await getPortfolio(paper.agentId);
    expect(portfolio.thinkingReserveUsd).toBeUndefined();
    expect(toRiskPortfolio(portfolio).cashUsd).toBe(portfolio.cashUsd);
    // Its marks are of a notional book, which no payment moves: they are never put off.
    expect("cashReadAt" in portfolio).toBe(false);
  });
});

/**
 * A live agent that pays for its own thinking is not marked while one of its paid steps
 * is in flight.
 *
 * A step's price leaves the wallet seconds after it is signed for, and is taken back out
 * of the P&L as a flow dated when the step was resolved. A mark read in between holds,
 * or does not hold, a payment whose flow is on one side of it or the other; where the
 * two disagree, the step's price reads as a gain nobody made (at once, or when that mark
 * is later the baseline a window is measured from). No mark, no disagreement: the next
 * marks pass is five minutes away. `thinking-flows.test.ts` has the reading side.
 */
describe("a paid step in flight when the wallet was read", () => {
  const SECOND = 1_000;
  const USDC_LLM = { ...DEFAULT_AGENT_CONFIG.llm, source: "usdc" as const, usdc: { model: "google/gemini-2.5-flash", maxUsdPerRun: 0.3, maxUsdPerDay: 3 } };
  const payingLive = () => seedAgent(db, { mode: "live", config: { llm: USDC_LLM } });

  /** One ledger row for a step signed `signedMs` before the wallet was read at `readAt` (negative: after it). */
  async function step(
    agent: { agentId: string; userId: string },
    readAt: Date,
    signedMs: number,
    status: InferencePaymentStatus,
    resolvedMs: number | null,
  ) {
    const signedAt = new Date(readAt.getTime() - signedMs);
    await db.insert(schema.inferencePayments).values({
      id: nanoid(),
      ownerId: agent.userId,
      agentId: agent.agentId,
      runId: `run_${nanoid(8)}`,
      seq: 0,
      requestHash: "0".repeat(64),
      chain: "solana",
      network: INFERENCE_GATEWAY.solana.network,
      host: INFERENCE_GATEWAY.solana.host,
      model: USDC_LLM.usdc.model,
      payerWalletId: `wallet_${agent.agentId}`,
      payerAddress: `Agent${agent.agentId}`,
      payTo: INFERENCE_GATEWAY.solana.payTo[0],
      asset: INFERENCE_GATEWAY.solana.asset,
      quotedUsd: "0.020000",
      status,
      budgetDay: utcDay(signedAt),
      // Reserved a moment before it was signed, as the pay path does.
      createdAt: new Date(signedAt.getTime() - 2 * SECOND),
      signedAt,
      resolvedAt: resolvedMs === null ? null : new Date(readAt.getTime() + resolvedMs),
    });
  }

  const marksOf = async (agentId: string) => db.select().from(schema.equitySnapshots).where(eq(schema.equitySnapshots.agentId, agentId));
  const liveBook = (agentId: string, readAt: Date | null) =>
    book({ agentId, mode: "live", cashUsd: 25, equityUsd: 25, ...(readAt ? { cashReadAt: readAt } : {}) });

  it("writes no mark while a step is signed for and has no outcome yet", async () => {
    const agent = await payingLive();
    const readAt = new Date();
    await step(agent, readAt, 10 * SECOND, "signed", null);

    expect(await snapshotEquity(liveBook(agent.agentId, readAt))).toBe(false);
    expect(await marksOf(agent.agentId)).toHaveLength(0);
  });

  it("writes none either when the step was resolved only after the wallet was read", async () => {
    const agent = await payingLive();
    const readAt = new Date(Date.now() - 5 * SECOND);
    // Signed before the read, answered and proven three seconds after it: by the time the
    // mark would be written the row looks finished, and the balance may not hold it.
    await step(agent, readAt, 10 * SECOND, "settled", 3 * SECOND);
    expect(await snapshotEquity(liveBook(agent.agentId, readAt))).toBe(false);

    // Resolved at the very instant of the read counts as after it.
    const other = await payingLive();
    await step(other, readAt, 10 * SECOND, "paid_no_answer", 0);
    expect(await snapshotEquity(liveBook(other.agentId, readAt))).toBe(false);
    expect(await marksOf(other.agentId)).toHaveLength(0);
  });

  it("covers a step whose request failed, for as long as its transfer could still land", async () => {
    const agent = await payingLive();
    const readAt = new Date();
    await step(agent, readAt, 90 * SECOND, "unconfirmed", null);
    expect(await snapshotEquity(liveBook(agent.agentId, readAt))).toBe(false);
  });

  it("marks the book once the step is resolved, which is where a run's own last mark is taken", async () => {
    const agent = await payingLive();
    const readAt = new Date();
    await step(agent, readAt, 20 * SECOND, "settled", -1);
    await step(agent, readAt, 40 * SECOND, "paid_no_answer", -15 * SECOND);
    await step(agent, readAt, 60 * SECOND, "not_charged", -30 * SECOND);

    expect(await snapshotEquity(liveBook(agent.agentId, readAt))).toBe(true);
    expect(await marksOf(agent.agentId)).toHaveLength(1);
  });

  it("does not wait on a step signed longer ago than a transfer can take to land", async () => {
    const agent = await payingLive();
    const readAt = new Date();
    // Left open by a process that died, or waiting hours for the reconciler: if it
    // landed, it landed before this read. A book is never left unmarked over it.
    await step(agent, readAt, PAYMENT_IN_FLIGHT_MS + SECOND, "signed", null);
    await step(agent, readAt, 3 * 60 * 60 * SECOND, "unconfirmed", null);
    expect(await snapshotEquity(liveBook(agent.agentId, readAt))).toBe(true);

    // The same two minutes the reconciler leaves a row to its own request, and longer
    // than that request is allowed to take.
    expect(PAYMENT_IN_FLIGHT_MS).toBe(RECONCILE_AFTER_MS);
    expect(PAYMENT_IN_FLIGHT_MS).toBeGreaterThan(PAID_TIMEOUT_MS);
  });

  it("is about that agent's own steps, and reads nothing for a book that was not read as a paying agent's", async () => {
    const paying = await payingLive();
    const bystander = await payingLive();
    const readAt = new Date();
    await step(paying, readAt, 10 * SECOND, "signed", null);

    // Another agent's step in flight is nothing to this one.
    expect(await snapshotEquity(liveBook(bystander.agentId, readAt))).toBe(true);
    // A book with no read time on it (every key agent's, every paper agent's) is marked
    // as it always was, whatever the ledger holds for that agent.
    expect(await snapshotEquity(liveBook(paying.agentId, null))).toBe(true);
    expect(await snapshotEquity(book({ agentId: paying.agentId, mode: "paper", cashReadAt: readAt }))).toBe(true);
    expect(await marksOf(paying.agentId)).toHaveLength(2);
  });
});

