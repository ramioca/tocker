/**
 * What an agent pays for its own thinking is a cost, not a trading loss.
 *
 * A pay-per-use agent buys each model step in USDC from its own wallet, the same wallet
 * it trades from. Left alone, every such payment would lower a live agent's equity and
 * so its P&L, on its card, on Home, on /money and on the public leaderboard, while an
 * agent on its owner's key has the same bill and never shows it. So a payment the ledger
 * holds as paid is a money flow out of the book, netted the way a withdrawal is, and
 * /money subtracts it exactly once, as its own line.
 *
 * These tests drive the real queries against in-memory PGlite and pin the edges of that
 * rule, because each one is a way to misstate somebody's money:
 *
 *  - an agent on its owner's key is exactly as it was, and so is an owner who has never
 *    paid for a step;
 *  - only payments PROVEN to have left the wallet are netted (`paid_no_answer`, and
 *    `settled` once it carries a transaction id): one still being checked is not, one
 *    the reconciler found was never charged never is, and a simulated one never is;
 *  - a run that was paying when a mark was taken is cut at that mark, step by step;
 *  - a paper agent is untouched: its equity is a notional, not its wallet;
 *  - the amount is counted once, and never also as an estimated token bill.
 *
 * Only the live wallet read is stubbed, so a test can say what the wallet holds "now".
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { nanoid } from "nanoid";
import { eq, sql } from "drizzle-orm";
import type { Db } from "@/db";
import * as schema from "@/db/schema";
import { DEFAULT_AGENT_CONFIG } from "@/lib/agent/config";
import { seedAgent, setupTestDb } from "@/lib/agent/test-support";
import { toNumeric } from "@/lib/money";
import { INFERENCE_GATEWAY, utcDay, type InferencePaymentStatus } from "@/lib/x402/inference-types";

/** What each live agent's wallet answers with. No entry: the read fails, as an outage does. */
const wallets = vi.hoisted(() => ({ books: new Map<string, { cashUsd: number; equityUsd: number }>() }));

vi.mock("@/lib/agent/portfolio", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/agent/portfolio")>()),
  getPortfolio: async (agentId: string) => {
    const book = wallets.books.get(agentId);
    if (!book) throw new Error("offline in tests");
    return {
      agentId,
      mode: "live" as const,
      cashUsd: book.cashUsd,
      equityUsd: book.equityUsd,
      positions: [],
      realizedPnlUsd: 0,
      unrealizedPnlUsd: 0,
      tradesToday: 0,
      startingUsd: 10_000,
      cashReadFailed: false,
    };
  },
}));

const { loadAgentAggregates, loadMoneyFlows, toAgentCard } = await import("./_shared");
const { getAgentWindowPnl } = await import("./agents");
const { getLeaderboard } = await import("./discover");
const { getHomeOverview } = await import("./home");
const { EMPTY_MONEY, THINKING_CHECKED_FOR_MS, getMoney } = await import("./money");

let db: Db;

beforeAll(async () => {
  db = await setupTestDb();
}, 120_000);

beforeEach(() => {
  wallets.books.clear();
});

const DAY = 86_400_000;
const HOUR = 3_600_000;
const MINUTE = 60_000;
const ago = (days: number) => new Date(Date.now() - days * DAY);
/** Recent enough that the reconciler is still looking, and before the last mark the tests take. */
const anHourAgo = () => new Date(Date.now() - HOUR);

/** A transaction id as the chain prints one. Put together here, so no file holds a real one. */
const TX = "3".repeat(88);

type Seeded = { agentId: string; userId: string; slug: string };

/** The config of an agent that pays for its own thinking. */
const USDC_LLM = {
  ...DEFAULT_AGENT_CONFIG.llm,
  source: "usdc" as const,
  usdc: { model: "google/gemini-2.5-flash", maxUsdPerRun: 0.3, maxUsdPerDay: 3 },
};

const payPerUse = (mode: "paper" | "live") => seedAgent(db, { mode, config: { llm: USDC_LLM } });

/** A second pay-per-use agent for an owner who already has one. */
async function anotherAgent(owner: Seeded, mode: "paper" | "live"): Promise<Seeded> {
  const agentId = nanoid();
  const slug = `test-${nanoid(6)}`;
  await db.insert(schema.agents).values({
    id: agentId,
    ownerId: owner.userId,
    slug,
    name: "Second Agent",
    mode,
    status: "active",
    isPublic: true,
    config: { ...DEFAULT_AGENT_CONFIG, llm: USDC_LLM },
  });
  return { agentId, userId: owner.userId, slug };
}

async function mark(agentId: string, at: Date, equityUsd: number, mode: "paper" | "live" = "live") {
  await db.insert(schema.equitySnapshots).values({
    id: nanoid(),
    agentId,
    equityUsd: toNumeric(equityUsd, 6),
    cashUsd: toNumeric(equityUsd, 6),
    at,
    mode,
  });
}

/**
 * One ledger row, written the way the ledger leaves it in that status. A `settled` row
 * carries its transaction id, as it does once the gateway's receipt or the reconciler has
 * named it; `{ txHash: null }` is the answered step whose payment is still being checked.
 */
async function payment(
  agent: Seeded,
  at: Date,
  usd: number,
  status: InferencePaymentStatus = "settled",
  extra: Partial<typeof schema.inferencePayments.$inferInsert> = {},
): Promise<string> {
  const id = nanoid();
  const signed = !["reserved", "released", "simulated"].includes(status);
  await db.insert(schema.inferencePayments).values({
    id,
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
    quotedUsd: toNumeric(usd, 6),
    settledUsd: status === "settled" ? toNumeric(usd, 6) : null,
    txHash: status === "settled" ? TX : null,
    status,
    answered: status === "settled" ? true : status === "simulated" ? true : signed ? false : null,
    budgetDay: utcDay(at),
    createdAt: at,
    signedAt: signed ? at : null,
    resolvedAt: ["reserved", "signed", "unconfirmed"].includes(status) ? null : at,
    ...extra,
  });
  return id;
}

async function deposit(agent: Seeded, at: Date, amount: number) {
  await db.insert(schema.agentFundingIntents).values({
    id: nanoid(),
    agentId: agent.agentId,
    userId: agent.userId,
    chain: "solana",
    asset: "usdc",
    amount: String(amount),
    status: "sent",
    toAddress: `Agent${agent.agentId}`,
    createdAt: at,
    settledAt: at,
  });
}

async function run(agent: Seeded, tokens: { input: number; output: number }, llmSource: "key" | "usdc" | null) {
  await db.insert(schema.agentRuns).values({
    id: nanoid(),
    agentId: agent.agentId,
    trigger: "schedule",
    status: "succeeded",
    inputTokens: tokens.input,
    outputTokens: tokens.output,
    llmSource,
  });
}

/**
 * How many times the snapshots table has been read so far, by an index or from end to
 * end: the database's own counters, flushed first so that they are current. A lookup of
 * the mark before a payment is one read, so the difference across a call is how many
 * lookups that call made.
 */
async function snapshotReads(): Promise<number> {
  await db.execute(sql`select pg_stat_force_next_flush()`);
  const result = (await db.execute(sql`
    select (select coalesce(sum(idx_scan), 0) from pg_stat_user_indexes where relname = 'equity_snapshots')
         + (select coalesce(sum(seq_scan), 0) from pg_stat_user_tables where relname = 'equity_snapshots') as reads
  `)) as unknown as { rows: Array<{ reads: number | string }> };
  return Number(result.rows[0].reads);
}

/** One agent's all-time number on each surface that prints one. */
async function everySurface(agent: Seeded) {
  const [aggregates, home, money, board] = await Promise.all([
    loadAgentAggregates(db, [agent.agentId]),
    getHomeOverview(agent.userId),
    getMoney(agent.userId),
    getLeaderboard("all", 1_000),
  ]);
  const card = aggregates.get(agent.agentId)!;
  const row = board.find((r) => r.agent.id === agent.agentId);
  const moneyRow = [...money.live, ...money.paper].find((r) => r.id === agent.agentId)!;
  return {
    card: { pnlUsd: card.pnlUsd, pnlPct: card.pnlPct },
    home: { pnlUsd: home.pnlUsd, pnlPct: home.pnlPct },
    money: { pnlUsd: moneyRow.pnlUsd },
    leaderboard: { pnlUsd: row?.pnlUsd ?? null, pnlPct: row?.pnlPct ?? null },
  };
}

describe("an agent on its owner's key", () => {
  it("is exactly as it was: no flow, no thinking line, the same token estimate", async () => {
    // The switch as it ships: unset. Nothing below reads it; what an owner sees is
    // decided by what is on the ledger, and this owner's ledger is empty.
    expect(process.env.INFERENCE_USDC).toBeUndefined();
    const agent = await seedAgent(db, { mode: "live" });
    await mark(agent.agentId, ago(3), 25);
    await deposit(agent, ago(2), 25);
    await mark(agent.agentId, ago(0.01), 53);
    await run(agent, { input: 1_000_000, output: 100_000 }, null);
    await run(agent, { input: 1_000_000, output: 100_000 }, "key");

    // The deposit is the only flow, and it carries no kind.
    const flows = (await loadMoneyFlows(db, [agent.agentId])).get(agent.agentId) ?? [];
    expect(flows.map((f) => ({ amountUsd: f.amountUsd, kind: f.kind }))).toEqual([{ amountUsd: 25, kind: undefined }]);

    const seen = await everySurface(agent);
    expect(seen.card.pnlUsd).toBeCloseTo(3, 9);
    expect(seen.card.pnlPct).toBeCloseTo(6, 9);
    expect(seen.leaderboard.pnlUsd).toBeCloseTo(3, 9);
    expect(seen.home.pnlUsd).toBeCloseTo(3, 9);
    expect(seen.money.pnlUsd).toBeCloseTo(3, 9);

    const money = await getMoney(agent.userId);
    // Nothing about pay-per-use exists for this owner.
    expect(money.thinking).toBeNull();
    expect(money.totals.thinkingUsd).toBe(0);
    expect(money.days.every((day) => day.thinkingUsd === 0)).toBe(true);
    expect(money.today.thinkingUsd).toBe(0);
    const row = money.live[0];
    expect(row).toMatchObject({
      thinkSource: "key",
      thinkingModel: null,
      thinkingUsd: 0,
      thinkingSteps: 0,
      thinkingCheckingUsd: 0,
      thinkingSimulatedUsd: 0,
      // Both runs: one from before the column existed, one marked as a key run.
      inputTokens: 2_000_000,
      outputTokens: 200_000,
    });
    // Sonnet 5.5 at $2 / $10 per million: 2M in and 0.2M out.
    expect(row.modelSpendUsd).toBeCloseTo(6, 9);
    expect(money.totals.costsUsd).toBeCloseTo(money.totals.feesUsd + money.totals.dataSpendUsd + money.totals.modelSpendUsd, 9);
  });

  it("is not touched by another owner's pay-per-use payments", async () => {
    const mine = await seedAgent(db, { mode: "live" });
    const theirs = await payPerUse("live");
    await mark(mine.agentId, ago(3), 25);
    await mark(mine.agentId, ago(0.01), 25);
    await payment(theirs, ago(1), 4);

    expect((await loadMoneyFlows(db, [mine.agentId])).get(mine.agentId)).toBeUndefined();
    const money = await getMoney(mine.userId);
    expect(money.thinking).toBeNull();
    expect(money.live[0].thinkingUsd).toBe(0);
  });
});

describe("a live agent that pays for its own thinking", () => {
  it("25 in, 1 paid for thinking, 24 left: P&L 0 on every surface, and the 1 is a cost once", async () => {
    const agent = await payPerUse("live");
    await mark(agent.agentId, ago(3), 25);
    await payment(agent, ago(2), 0.6);
    await payment(agent, ago(1.5), 0.4);
    await mark(agent.agentId, ago(1), 24);
    await mark(agent.agentId, ago(0.01), 24);

    const seen = await everySurface(agent);

    // Unnetted, each of these read −1 (−4%): a loss nobody made trading.
    expect(seen.card.pnlUsd).toBeCloseTo(0, 9);
    expect(seen.card.pnlPct).toBeCloseTo(0, 9);
    expect(seen.home.pnlUsd).toBeCloseTo(0, 9);
    expect(seen.money.pnlUsd).toBeCloseTo(0, 9);
    expect(seen.leaderboard.pnlUsd).toBeCloseTo(0, 9);
    expect(seen.leaderboard.pnlPct).toBeCloseTo(0, 9);

    const money = await getMoney(agent.userId);
    expect(money.live[0]).toMatchObject({ thinkSource: "usdc", thinkingModel: "google/gemini-2.5-flash", thinkingSteps: 2 });
    expect(money.live[0].thinkingUsd).toBeCloseTo(1, 9);
    expect(money.totals.thinkingUsd).toBeCloseTo(1, 9);
    // Once: it is in the costs, it is not in the P&L, so net is exactly −1.
    expect(money.totals.pnlUsd).toBeCloseTo(0, 9);
    expect(money.totals.costsUsd).toBeCloseTo(1, 9);
    expect(money.totals.netUsd).toBeCloseTo(-1, 9);
    expect(money.thinking).toMatchObject({ steps: 2, unansweredSteps: 0, checkingSteps: 0, simulatedUsd: 0 });
    expect(money.thinking!.paidUsd).toBeCloseTo(1, 9);
    expect(money.thinking!.liveUsd).toBeCloseTo(1, 9);
  });

  it("still shows what it made trading, on what was put in", async () => {
    const agent = await payPerUse("live");
    await mark(agent.agentId, ago(3), 25);
    await payment(agent, ago(2), 1);
    // 24 after thinking, then 3 made trading.
    await mark(agent.agentId, ago(0.01), 27);

    const seen = await everySurface(agent);

    expect(seen.card.pnlUsd).toBeCloseTo(3, 9);
    // The percent is on the 25 put in: paying for thinking does not shrink the capital.
    expect(seen.card.pnlPct).toBeCloseTo(12, 9);
    expect(seen.leaderboard.pnlPct).toBeCloseTo(12, 9);
    expect(seen.money.pnlUsd).toBeCloseTo(3, 9);
    const agg = (await loadAgentAggregates(db, [agent.agentId])).get(agent.agentId)!;
    expect(agg.startEquityUsd).toBeCloseTo(24, 9);
    expect(agg.capitalUsd).toBeCloseTo(25, 9);
  });

  it("nets only payments proven to have left the wallet", async () => {
    const agent = await payPerUse("live");
    await mark(agent.agentId, ago(3), 25);
    // Proven: answered and named on chain, and paid with no answer.
    await payment(agent, ago(2), 0.3, "settled");
    await payment(agent, ago(2), 0.2, "paid_no_answer");
    // Did not leave the wallet, or is not yet proven to have.
    await payment(agent, ago(2), 5, "reserved");
    await payment(agent, ago(2), 5, "released");
    await payment(agent, anHourAgo(), 5, "signed");
    await payment(agent, anHourAgo(), 5, "unconfirmed");
    await payment(agent, anHourAgo(), 0.7, "settled", { txHash: null });
    await payment(agent, ago(2), 5, "not_charged");
    await payment(agent, ago(2), 5, "simulated");
    await mark(agent.agentId, ago(0.01), 24.5);

    const flows = (await loadMoneyFlows(db, [agent.agentId])).get(agent.agentId) ?? [];
    expect(flows.map((f) => f.kind)).toEqual(["thinking", "thinking"]);
    expect(flows.reduce((sum, f) => sum + f.amountUsd, 0)).toBeCloseTo(-0.5, 9);
    expect((await everySurface(agent)).card.pnlUsd).toBeCloseTo(0, 9);

    const money = await getMoney(agent.userId);
    expect(money.live[0].thinkingUsd).toBeCloseTo(0.5, 9);
    expect(money.live[0].thinkingSteps).toBe(2);
    expect(money.live[0].thinkingUnansweredUsd).toBeCloseTo(0.2, 9);
    // Signed an hour ago, unconfirmed, and answered without a transaction id: all three
    // are counted as charged and being checked, and none is in the total.
    expect(money.live[0].thinkingCheckingUsd).toBeCloseTo(10.7, 9);
    expect(money.live[0].thinkingUncheckedUsd).toBe(0);
    expect(money.live[0].thinkingSimulatedUsd).toBeCloseTo(5, 9);
    expect(money.totals.thinkingUsd).toBeCloseTo(0.5, 9);
    expect(money.totals.costsUsd).toBeCloseTo(0.5, 9);
    expect(money.thinking).toMatchObject({ steps: 2, checkingSteps: 3, checkingAnsweredSteps: 1, uncheckedSteps: 0 });
  });

  it("does not take an answered step out of P&L until the chain names its payment", async () => {
    const agent = await payPerUse("live");
    await mark(agent.agentId, ago(3), 25);
    // Answered, and the gateway gave no transaction for it. The ledger counts it as
    // charged; whether the transfer landed is what the reconciler is still finding out.
    const id = await payment(agent, anHourAgo(), 1, "settled", { txHash: null });
    // It did not land: the wallet still holds the money.
    await mark(agent.agentId, ago(0.01), 25);

    // Netted on the ledger's word alone, every one of these read +1.00 (+4%), a gain
    // nobody made, on the public leaderboard, for good.
    const before = await everySurface(agent);
    expect(before.card).toEqual({ pnlUsd: 0, pnlPct: 0 });
    expect(before.leaderboard).toEqual({ pnlUsd: 0, pnlPct: 0 });
    expect(before.home.pnlUsd).toBeCloseTo(0, 9);
    expect(before.money.pnlUsd).toBeCloseTo(0, 9);
    expect((await loadMoneyFlows(db, [agent.agentId])).get(agent.agentId)).toBeUndefined();

    // On /money it is charged-but-being-checked, exactly like a signed or unconfirmed row:
    // beside the total, never in it.
    let money = await getMoney(agent.userId);
    expect(money.totals.thinkingUsd).toBe(0);
    expect(money.totals.costsUsd).toBe(0);
    expect(money.live[0]).toMatchObject({ thinkingUsd: 0, thinkingSteps: 0 });
    expect(money.live[0].thinkingCheckingUsd).toBeCloseTo(1, 9);
    expect(money.thinking).toMatchObject({ paidUsd: 0, steps: 0, checkingSteps: 1, checkingAnsweredSteps: 1 });
    expect(money.thinking!.checkingUsd).toBeCloseTo(1, 9);
    // It was answered, so it is not in the list of steps that got no answer.
    expect(money.thinking!.unanswered).toEqual([]);

    // The reconciler finds the transfer after all and writes its transaction id: now it
    // is proven, the wallet did fall by it, and it is a cost and not a loss.
    await db.update(schema.inferencePayments).set({ txHash: TX }).where(eq(schema.inferencePayments.id, id));
    await mark(agent.agentId, new Date(), 24);
    const after = await everySurface(agent);
    expect(after.card.pnlUsd).toBeCloseTo(0, 9);
    expect(after.leaderboard.pnlUsd).toBeCloseTo(0, 9);
    money = await getMoney(agent.userId);
    expect(money.totals.thinkingUsd).toBeCloseTo(1, 9);
    expect(money.thinking).toMatchObject({ steps: 1, checkingSteps: 0, checkingAnsweredSteps: 0 });
    expect(money.thinking!.checkingUsd).toBe(0);
  });

  it("reads an answered step still being checked as a loss when the wallet did fall, never as a gain", async () => {
    const agent = await payPerUse("live");
    await mark(agent.agentId, ago(3), 25);
    await payment(agent, anHourAgo(), 0.4, "settled", { txHash: null });
    await mark(agent.agentId, ago(0.01), 24.6);

    const seen = await everySurface(agent);
    expect(seen.card.pnlUsd).toBeCloseTo(-0.4, 9);
    expect(seen.leaderboard.pnlUsd).toBeCloseTo(-0.4, 9);
    // Net is right either way: the amount is in the P&L and not in the costs.
    const money = await getMoney(agent.userId);
    expect(money.totals.pnlUsd).toBeCloseTo(-0.4, 9);
    expect(money.totals.costsUsd).toBe(0);
    expect(money.totals.netUsd).toBeCloseTo(-0.4, 9);
  });

  it("never nets, and never shows as paid, a step the reconciler found was not charged", async () => {
    const agent = await payPerUse("live");
    await mark(agent.agentId, ago(3), 25);
    // Signed, the request failed, and the chain was asked: the payment never landed.
    await payment(agent, anHourAgo(), 0.5, "not_charged", { httpStatus: 504 });
    await mark(agent.agentId, ago(0.01), 25);

    expect((await loadMoneyFlows(db, [agent.agentId])).get(agent.agentId)).toBeUndefined();
    expect((await everySurface(agent)).card).toEqual({ pnlUsd: 0, pnlPct: 0 });
    const money = await getMoney(agent.userId);
    // Nothing was paid, nothing is being checked: the owner has no pay-per-use figure.
    expect(money.thinking).toBeNull();
    expect(money.live[0]).toMatchObject({ thinkingUsd: 0, thinkingSteps: 0, thinkingCheckingUsd: 0, thinkingUncheckedUsd: 0 });
    expect(money.totals.costsUsd).toBe(0);
  });

  it("reads a payment still being checked as a few cents of loss, never as a gain", async () => {
    const agent = await payPerUse("live");
    await mark(agent.agentId, ago(3), 25);
    const id = await payment(agent, ago(2), 0.05, "unconfirmed");
    // The wallet did fall by it.
    await mark(agent.agentId, ago(0.01), 24.95);

    expect((await everySurface(agent)).card.pnlUsd).toBeCloseTo(-0.05, 9);

    // The reconciler finds it on chain: now it is a cost, and the loss is gone.
    await db
      .update(schema.inferencePayments)
      .set({ status: "paid_no_answer", resolvedAt: new Date() })
      .where(eq(schema.inferencePayments.id, id));
    expect((await everySurface(agent)).card.pnlUsd).toBeCloseTo(0, 9);
  });

  it("takes the settled amount, and the quote when the gateway named none", async () => {
    const agent = await payPerUse("live");
    await mark(agent.agentId, ago(3), 25);
    await payment(agent, ago(2), 0.4, "settled", { settledUsd: toNumeric(0.38, 6) });
    await payment(agent, ago(2), 0.12, "settled", { settledUsd: null });
    await mark(agent.agentId, ago(0.01), 24.5);

    const flows = (await loadMoneyFlows(db, [agent.agentId])).get(agent.agentId) ?? [];
    expect(flows.reduce((sum, f) => sum + f.amountUsd, 0)).toBeCloseTo(-0.5, 9);
    expect((await getMoney(agent.userId)).live[0].thinkingUsd).toBeCloseTo(0.5, 9);
  });

  it("is one flow per run between two marks, at the run's last payment", async () => {
    const agent = await payPerUse("live");
    const first = ago(2);
    const last = new Date(first.getTime() + 3 * MINUTE);
    await mark(agent.agentId, ago(3), 25);
    await payment(agent, first, 0.01, "settled", { runId: "run_a", seq: 0 });
    await payment(agent, new Date(first.getTime() + MINUTE), 0.02, "settled", { runId: "run_a", seq: 1 });
    await payment(agent, last, 0.03, "paid_no_answer", { runId: "run_a", seq: 2 });
    await payment(agent, ago(1), 0.1, "settled", { runId: "run_b", seq: 0 });

    const flows = ((await loadMoneyFlows(db, [agent.agentId])).get(agent.agentId) ?? [])
      .map((f) => ({ at: Number(f.at), amountUsd: f.amountUsd }))
      .sort((a, b) => a.at - b.at);
    expect(flows).toHaveLength(2);
    expect(flows[0].amountUsd).toBeCloseTo(-0.06, 9);
    expect(flows[0].at).toBeCloseTo(last.getTime(), -1);
    expect(flows[1].amountUsd).toBeCloseTo(-0.1, 9);
  });

  it("does not net what was paid before the book's first live mark", async () => {
    const agent = await payPerUse("live");
    // Paid while still on paper: the first live mark already has that money gone.
    await payment(agent, ago(5), 2);
    await mark(agent.agentId, ago(3), 23);
    await payment(agent, ago(2), 1);
    await mark(agent.agentId, ago(0.01), 22);

    // Only the later payment is a flow at all.
    const flows = (await loadMoneyFlows(db, [agent.agentId])).get(agent.agentId) ?? [];
    expect(flows.map((f) => f.amountUsd)).toEqual([-1]);
    const seen = await everySurface(agent);
    expect(seen.card.pnlUsd).toBeCloseTo(0, 9);
    expect(seen.leaderboard.pnlUsd).toBeCloseTo(0, 9);
    // The Money line is the ledger's own total, whenever it was paid.
    expect((await getMoney(agent.userId)).live[0].thinkingUsd).toBeCloseTo(3, 9);
  });

  it("splits the run that was in flight when the agent went live, step by step", async () => {
    const agent = await payPerUse("live");
    const wentLive = ago(3);
    // One run, five minutes long. Two steps were paid before the first live mark, which
    // therefore already lacks them, and two after it.
    const step = (minutes: number, usd: number, seq: number) =>
      payment(agent, new Date(wentLive.getTime() + minutes * MINUTE), usd, "settled", { runId: "run_in_flight", seq });
    await step(-2, 0.4, 0);
    await step(-1, 0.4, 1);
    await mark(agent.agentId, wentLive, 24.2);
    await step(1, 0.1, 2);
    await step(2, 0.1, 3);
    await mark(agent.agentId, ago(0.01), 24);

    // Netting the run as a whole, at its last payment, would count all four: a basis
    // 0.80 too low, and that much profit nobody made, for good.
    const flows = (await loadMoneyFlows(db, [agent.agentId])).get(agent.agentId) ?? [];
    expect(flows).toHaveLength(1);
    expect(flows[0].amountUsd).toBeCloseTo(-0.2, 9);
    const seen = await everySurface(agent);
    expect(seen.card.pnlUsd).toBeCloseTo(0, 9);
    expect(seen.leaderboard.pnlUsd).toBeCloseTo(0, 9);
    expect(seen.money.pnlUsd).toBeCloseTo(0, 9);
  });

  it("cuts a run that was paying when a window's baseline mark was taken, at that mark", async () => {
    const agent = await payPerUse("live");
    // The mark the 7-day window is measured from: the last one before the window opens.
    const baseline = new Date(Date.now() - 7 * DAY - 10 * MINUTE);
    const step = (minutes: number, usd: number, seq: number) =>
      payment(agent, new Date(baseline.getTime() + minutes * MINUTE), usd, "settled", { runId: "run_over_baseline", seq });
    await mark(agent.agentId, ago(10), 100);
    // One run, no trade. Half of what it paid had left the wallet when the baseline mark
    // was taken, and half left after it.
    await step(-2, 0.25, 0);
    await step(-1, 0.25, 1);
    await mark(agent.agentId, baseline, 99.5);
    await step(1, 0.25, 2);
    await step(2, 0.25, 3);
    await mark(agent.agentId, ago(0.01), 99);

    // Two flows for the one run, one on each side of the mark it was paying across.
    const flows = ((await loadMoneyFlows(db, [agent.agentId])).get(agent.agentId) ?? [])
      .map((f) => ({ at: Number(f.at), amountUsd: f.amountUsd }))
      .sort((a, b) => a.at - b.at);
    expect(flows.map((f) => f.amountUsd)).toEqual([-0.5, -0.5]);
    expect(flows[0].at).toBeLessThan(baseline.getTime());
    expect(flows[1].at).toBeGreaterThan(baseline.getTime());

    // The whole run dated at its last payment netted $1.00 against a baseline that
    // already lacked half of it: 99 − (99.50 − 1.00) = +$0.50, a gain nobody made.
    const week = (await getLeaderboard("7d", 1_000)).find((r) => r.agent.id === agent.agentId)!;
    expect(week.pnlUsd).toBeCloseTo(0, 9);
    expect(week.pnlPct).toBeCloseTo(0, 9);
    const windowed = await getAgentWindowPnl(agent.agentId, "7d");
    expect(windowed!.startEquityUsd).toBeCloseTo(99.5, 9);
    expect(windowed!.pnlUsd).toBeCloseTo(0, 9);
    expect(windowed!.flowUsd).toBeCloseTo(-0.5, 9);
    // All time is measured from the first mark, with the whole dollar after it.
    expect((await everySurface(agent)).card.pnlUsd).toBeCloseTo(0, 9);
    expect((await getAgentWindowPnl(agent.agentId, "all"))!.pnlUsd).toBeCloseTo(0, 9);
  });

  it("puts a payment made at the very instant of a mark inside that mark", async () => {
    const agent = await payPerUse("live");
    const at = ago(2);
    await mark(agent.agentId, ago(3), 25);
    await payment(agent, at, 0.3);
    // Marked at the same instant, with the payment already gone from the wallet.
    await mark(agent.agentId, at, 24.7);
    await mark(agent.agentId, ago(0.01), 24.7);

    const flows = (await loadMoneyFlows(db, [agent.agentId])).get(agent.agentId) ?? [];
    expect(flows).toHaveLength(1);
    // Not after it: measured from that mark, nothing moved.
    expect(Number(flows[0].at)).toBe(at.getTime());
    expect((await everySurface(agent)).card.pnlUsd).toBeCloseTo(0, 9);
  });

  it("makes no flow of a payment at the very instant of the book's first mark, or of any before it", async () => {
    const agent = await payPerUse("live");
    const wentLive = ago(3);
    // A stint on paper first, marked and paying: none of it is the live book's.
    await mark(agent.agentId, ago(6), 10_000, "paper");
    await mark(agent.agentId, ago(5), 10_050, "paper");
    await payment(agent, ago(5.5), 0.3);
    await payment(agent, ago(4), 0.3);
    // Paid at the instant the first live mark was taken: that mark already lacks it.
    await payment(agent, wentLive, 0.4);
    await mark(agent.agentId, wentLive, 24);
    await payment(agent, ago(2), 0.25);
    await mark(agent.agentId, ago(0.01), 23.75);

    // Only what was paid strictly after the first live mark moves the basis.
    const flows = (await loadMoneyFlows(db, [agent.agentId])).get(agent.agentId) ?? [];
    expect(flows.map((f) => f.amountUsd)).toEqual([-0.25]);
    const seen = await everySurface(agent);
    expect(seen.card.pnlUsd).toBeCloseTo(0, 9);
    expect(seen.leaderboard.pnlUsd).toBeCloseTo(0, 9);
    // The ledger's own total is every proven payment, whenever it was made.
    expect((await getMoney(agent.userId)).live[0].thinkingUsd).toBeCloseTo(1.25, 9);
  });

  it("looks a mark up only for the payments made after the book's first mark", async () => {
    // This read runs for every card, the leaderboard and /money. An agent that paid for
    // its thinking through a long stint on paper and then went live has far more
    // payments from before its live book than since, and each lookup for one of those
    // walks back through every paper snapshot to find nothing. Looked up per payment,
    // an agent with 2,000 of them took 430 ms to read; they are dropped first instead.
    const agent = await payPerUse("live");
    const wentLive = ago(3);
    const PAPER_PAYMENTS = 40;
    const LIVE_PAYMENTS = 6;
    for (let i = 0; i < 30; i += 1) await mark(agent.agentId, new Date(wentLive.getTime() - (i + 1) * HOUR), 10_000, "paper");
    for (let i = 0; i < PAPER_PAYMENTS; i += 1) {
      await payment(agent, new Date(wentLive.getTime() - (i + 1) * 30 * MINUTE), 0.01, i % 2 === 0 ? "settled" : "paid_no_answer");
    }
    await mark(agent.agentId, wentLive, 25);
    for (let i = 0; i < LIVE_PAYMENTS; i += 1) await payment(agent, new Date(wentLive.getTime() + (i + 1) * HOUR), 0.05);
    await mark(agent.agentId, ago(0.01), 25 - LIVE_PAYMENTS * 0.05);

    const before = await snapshotReads();
    const flows = (await loadMoneyFlows(db, [agent.agentId])).get(agent.agentId) ?? [];
    const lookups = (await snapshotReads()) - before;

    // What it returns is what it always returned: the live payments, each its own run.
    expect(flows).toHaveLength(LIVE_PAYMENTS);
    expect(flows.reduce((sum, f) => sum + f.amountUsd, 0)).toBeCloseTo(-LIVE_PAYMENTS * 0.05, 9);
    // One read for the book's first mark and one per payment after it. Not one per
    // payment the agent ever made, which is what it cost before.
    expect(lookups).toBeGreaterThan(0);
    expect(lookups).toBeLessThanOrEqual(LIVE_PAYMENTS + 2);
    expect(lookups).toBeLessThan(PAPER_PAYMENTS);
  });

  it("reads no snapshot at all for agents that never paid for a step", async () => {
    // With the feature switched off the ledger is empty, and this part of every card
    // must cost what it cost before the feature existed: nothing.
    const keyed = await seedAgent(db, { mode: "live" });
    await mark(keyed.agentId, ago(3), 25);
    await mark(keyed.agentId, ago(0.01), 26);

    const before = await snapshotReads();
    expect((await loadMoneyFlows(db, [keyed.agentId])).get(keyed.agentId)).toBeUndefined();
    expect((await snapshotReads()) - before).toBe(0);
  });

  it("has no thinking flow for a live agent that has never been marked", async () => {
    const agent = await payPerUse("live");
    await payment(agent, ago(1), 0.5);

    // Nothing measures a book with no mark, so there is nothing to net against. The
    // ledger's own total is still on /money.
    expect((await loadMoneyFlows(db, [agent.agentId])).get(agent.agentId)).toBeUndefined();
    expect((await getMoney(agent.userId)).live[0].thinkingUsd).toBeCloseTo(0.5, 9);
  });

  it("measures from the current book's first mark, not from an earlier paper one", async () => {
    const agent = await payPerUse("live");
    // On paper first: marked there, and paying for thinking from the real wallet.
    await mark(agent.agentId, ago(9), 10_000, "paper");
    await payment(agent, ago(8), 1.25);
    // Then live. Its book starts here, with that 1.25 already gone from the wallet.
    await mark(agent.agentId, ago(5), 30);
    await payment(agent, ago(4), 0.5);
    await mark(agent.agentId, ago(0.01), 29.5);

    const flows = (await loadMoneyFlows(db, [agent.agentId])).get(agent.agentId) ?? [];
    expect(flows.map((f) => f.amountUsd)).toEqual([-0.5]);
    expect((await everySurface(agent)).card.pnlUsd).toBeCloseTo(0, 9);
  });

  it("keeps what was paid after the last mark apart, and in the basis of a wallet read now", async () => {
    const agent = await payPerUse("live");
    await mark(agent.agentId, ago(3), 25);
    await mark(agent.agentId, ago(1), 25);
    // Paid an hour ago; no mark since.
    await payment(agent, ago(1 / 24), 0.5);

    const agg = (await loadAgentAggregates(db, [agent.agentId])).get(agent.agentId)!;
    expect(agg.equityUsd).toBe(25);
    expect(agg.pnlUsd).toBe(0);
    expect(agg.flowSinceMarkUsd).toBeCloseTo(-0.5, 9);
    // Money that left is not money that came in.
    expect(agg.depositsSinceMarkUsd).toBe(0);

    // The wallet answers, and already lacks the payment.
    wallets.books.set(agent.agentId, { cashUsd: 24.5, equityUsd: 24.5 });
    const money = await getMoney(agent.userId);
    expect(money.live[0]).toMatchObject({ equityUsd: 24.5, stale: false });
    expect(money.live[0].pnlUsd).toBeCloseTo(0, 9);
  });

  it("is netted out of the leaderboard's windows as well", async () => {
    const agent = await payPerUse("live");
    await mark(agent.agentId, ago(10), 100);
    await mark(agent.agentId, ago(3), 100);
    await payment(agent, ago(2), 4);
    await mark(agent.agentId, ago(0.01), 96);

    for (const window of ["7d", "30d", "all"] as const) {
      const row = (await getLeaderboard(window, 1_000)).find((r) => r.agent.id === agent.agentId)!;
      expect(row.pnlUsd).toBeCloseTo(0, 9);
      expect(row.pnlPct).toBeCloseTo(0, 9);
    }
  });

  it("takes the day's thinking out of the day's change, and says how much it was", async () => {
    const agent = await payPerUse("live");
    const today = new Date();
    const noonYesterday = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()) - DAY / 2);
    await mark(agent.agentId, noonYesterday, 50);
    // Paid and marked today. A minute apart, so both land in today's UTC day at any hour
    // this test runs after 00:02.
    const paidAt = new Date(Math.max(today.getTime() - 2 * MINUTE, noonYesterday.getTime() + DAY / 2 + 1_000));
    await payment(agent, paidAt, 0.75);
    await mark(agent.agentId, new Date(paidAt.getTime() + 1_000), 49.25);

    const money = await getMoney(agent.userId);
    const last = money.days.at(-1)!;
    expect(last.equityUsd).toBeCloseTo(49.25, 9);
    expect(last.pnlUsd).toBeCloseTo(0, 9);
    expect(last.thinkingUsd).toBeCloseTo(0.75, 9);
    // Not a deposit and not a withdrawal: the day is not marked as money moved.
    expect(last.flowUsd).toBe(0);
    expect(money.today).toMatchObject({ flowUsd: 0 });
    expect(money.today.pnlUsd).toBeCloseTo(0, 9);
    expect(money.today.thinkingUsd).toBeCloseTo(0.75, 9);
  });

  it("never also estimates a pay-per-use run's tokens as a bill on a key", async () => {
    const agent = await payPerUse("live");
    await mark(agent.agentId, ago(3), 25);
    await mark(agent.agentId, ago(0.01), 25);
    // An earlier life on the owner's key, then pay-per-use.
    await run(agent, { input: 1_000_000, output: 0 }, "key");
    await run(agent, { input: 50_000_000, output: 5_000_000 }, "usdc");

    const row = (await getMoney(agent.userId)).live[0];
    expect(row.inputTokens).toBe(1_000_000);
    expect(row.outputTokens).toBe(0);
    // 1M input on the key model the config still names (Sonnet 5.5, $2 per million).
    expect(row.modelSpendUsd).toBeCloseTo(2, 9);
    expect(row.runCount).toBe(2);
  });

  it("estimates nothing, rather than 'no price', for an agent that never ran on a key", async () => {
    const agent = await seedAgent(db, {
      mode: "live",
      config: { llm: { ...USDC_LLM, model: "some-model/nobody-lists" } },
    });
    await mark(agent.agentId, ago(3), 25);
    await mark(agent.agentId, ago(0.01), 25);
    await run(agent, { input: 9_000_000, output: 900_000 }, "usdc");

    const money = await getMoney(agent.userId);
    expect(money.live[0].modelSpendUsd).toBe(0);
    expect(money.totals.unpricedAgents).toBe(0);
  });
});

describe("a paper agent that pays for its own thinking", () => {
  it("is measured from its notional: the payments are real, and are no part of its book", async () => {
    const agent = await payPerUse("paper");
    await mark(agent.agentId, ago(3), 10_000, "paper");
    await payment(agent, ago(2), 1.5);
    await mark(agent.agentId, ago(0.01), 10_100, "paper");

    expect(await loadMoneyFlows(db, [agent.agentId])).toEqual(new Map());
    const agg = (await loadAgentAggregates(db, [agent.agentId])).get(agent.agentId)!;
    expect(agg).toMatchObject({
      startEquityUsd: 10_000,
      capitalUsd: 10_000,
      pnlUsd: 100,
      pnlPct: 1,
      flowSinceMarkUsd: 0,
      depositsSinceMarkUsd: 0,
    });
    const row = (await getLeaderboard("all", 1_000)).find((r) => r.agent.id === agent.agentId)!;
    expect(row).toMatchObject({ pnlUsd: 100, pnlPct: 1 });
    expect((await getHomeOverview(agent.userId)).paper).toMatchObject({ pnlUsd: 100, pnlPct: 1 });

    // /money: the amount is on the agent's own row, because it is real USDC, and in no
    // total, because every total there is live-only.
    const money = await getMoney(agent.userId);
    expect(money.paper[0].pnlUsd).toBe(100);
    expect(money.paper[0].thinkingUsd).toBeCloseTo(1.5, 9);
    expect(money.totals.thinkingUsd).toBe(0);
    expect(money.totals.costsUsd).toBe(0);
    expect(money.thinking!.paidUsd).toBeCloseTo(1.5, 9);
    expect(money.thinking!.paperUsd).toBeCloseTo(1.5, 9);
    expect(money.thinking!.liveUsd).toBe(0);
  });
});

describe("an owner with a live and a paper agent that both pay", () => {
  it("totals the live one only, and says what the paper one paid apart", async () => {
    const live = await payPerUse("live");
    const paper = await anotherAgent(live, "paper");
    await mark(live.agentId, ago(3), 25);
    await payment(live, ago(2), 0.4);
    await mark(live.agentId, ago(0.01), 24.6);
    await mark(paper.agentId, ago(3), 10_000, "paper");
    await payment(paper, ago(2), 0.9);
    await mark(paper.agentId, ago(0.01), 10_000, "paper");

    const money = await getMoney(live.userId);
    expect(money.live[0].thinkingUsd).toBeCloseTo(0.4, 9);
    expect(money.paper[0].thinkingUsd).toBeCloseTo(0.9, 9);
    // Every total on the page is live-only, this one included.
    expect(money.totals.thinkingUsd).toBeCloseTo(0.4, 9);
    expect(money.totals.costsUsd).toBeCloseTo(0.4, 9);
    expect(money.totals.netUsd).toBeCloseTo(-0.4, 9);
    expect(money.thinking!.paidUsd).toBeCloseTo(1.3, 9);
    expect(money.thinking!.liveUsd).toBeCloseTo(0.4, 9);
    expect(money.thinking!.paperUsd).toBeCloseTo(0.9, 9);
    expect(money.thinking!.formerAgentsUsd).toBe(0);
    // Only the live agent's payment is a flow in the daily table.
    expect(money.days.reduce((sum, day) => sum + day.thinkingUsd, 0)).toBeLessThanOrEqual(0.4 + 1e-9);
  });
});

describe("simulated payments", () => {
  it("move no money and are counted in nothing", async () => {
    const agent = await payPerUse("live");
    await mark(agent.agentId, ago(3), 25);
    await payment(agent, ago(2), 0.9, "simulated");
    await payment(agent, ago(1), 0.9, "simulated");
    await mark(agent.agentId, ago(0.01), 25);

    expect((await loadMoneyFlows(db, [agent.agentId])).get(agent.agentId)).toBeUndefined();
    expect((await everySurface(agent)).card).toEqual({ pnlUsd: 0, pnlPct: 0 });

    const money = await getMoney(agent.userId);
    expect(money.live[0].thinkingUsd).toBe(0);
    expect(money.live[0].thinkingSimulatedUsd).toBeCloseTo(1.8, 9);
    expect(money.totals.thinkingUsd).toBe(0);
    expect(money.totals.costsUsd).toBe(0);
    expect(money.totals.netUsd).toBeCloseTo(0, 9);
    // Shown, so a local run can be read, and labelled as what it is.
    expect(money.thinking).toMatchObject({ paidUsd: 0, steps: 0 });
    expect(money.thinking!.simulatedUsd).toBeCloseTo(1.8, 9);
    expect(money.days.every((day) => day.thinkingUsd === 0)).toBe(true);
  });
});

describe("the Thinking line on /money", () => {
  it("lists the steps that were paid for and not answered, newest first, without the provider's words", async () => {
    const agent = await payPerUse("live");
    await mark(agent.agentId, ago(3), 25);
    await mark(agent.agentId, ago(0.01), 25);
    const txHash = "5".repeat(88);
    await payment(agent, ago(2), 0.011, "paid_no_answer", {
      httpStatus: 502,
      txHash,
      detail: "upstream said: contact @someone on Telegram for a refund",
    });
    await payment(agent, anHourAgo(), 0.012, "unconfirmed", { httpStatus: null, detail: "timed out" });
    // A request in flight right now is not a step that went unanswered.
    await payment(agent, new Date(), 0.013, "signed");
    // A transaction id that does not read as one is never turned into a link.
    await payment(agent, ago(4), 0.014, "paid_no_answer", { txHash: "javascript:alert(1)" });
    await payment(agent, ago(0.5), 0.2, "settled");
    // Answered, with its payment still being confirmed: counted, and not a step that
    // got no answer.
    await payment(agent, anHourAgo(), 0.09, "settled", { txHash: null });

    const thinking = (await getMoney(agent.userId)).thinking!;
    expect(thinking.unanswered.map((step) => ({ usd: step.usd, state: step.state, httpStatus: step.httpStatus, txHash: step.txHash }))).toEqual([
      { usd: 0.012, state: "checking", httpStatus: null, txHash: null },
      { usd: 0.011, state: "unanswered", httpStatus: 502, txHash },
      { usd: 0.014, state: "unanswered", httpStatus: null, txHash: null },
    ]);
    expect(thinking.unanswered[0]).toMatchObject({ agentName: "Test Agent", agentSlug: agent.slug, model: "google/gemini-2.5-flash" });
    // The row carries no field the provider's text could ride in.
    expect(JSON.stringify(thinking.unanswered)).not.toContain("Telegram");
    expect(thinking.unansweredSteps).toBe(2);
    expect(thinking.unansweredUsd).toBeCloseTo(0.025, 9);
    expect(thinking.checkingSteps).toBe(2);
    expect(thinking.checkingAnsweredSteps).toBe(1);
    expect(thinking.checkingUsd).toBeCloseTo(0.102, 9);
    expect(thinking.uncheckedSteps).toBe(0);
    // Paid: the two unanswered and the answered one that is proven. Not the three open.
    expect(thinking.paidUsd).toBeCloseTo(0.225, 9);
    expect(thinking.steps).toBe(3);
  });

  it("stops saying a payment is being checked once the reconciler has stopped looking", async () => {
    const agent = await payPerUse("live");
    await mark(agent.agentId, ago(3), 25);
    const justInside = new Date(Date.now() - THINKING_CHECKED_FOR_MS + 5 * MINUTE);
    const justPast = new Date(Date.now() - THINKING_CHECKED_FOR_MS - 5 * MINUTE);
    // Signed, the request failed, and nothing could settle it in time (the node was
    // down, or the cron was not running). The reconciler looks no further back.
    await payment(agent, justPast, 0.2, "unconfirmed", { httpStatus: 503 });
    await payment(agent, ago(2), 0.05, "signed");
    await payment(agent, ago(2), 0.3, "settled", { txHash: null });
    // Still inside the time the reconciler looks.
    await payment(agent, justInside, 0.07, "unconfirmed");
    // The wallet fell by the first one: it did land, and nobody will ever know.
    await mark(agent.agentId, ago(0.01), 24.8);

    const money = await getMoney(agent.userId);
    const thinking = money.thinking!;
    // "Being checked" is only what something is still checking.
    expect(thinking.checkingSteps).toBe(1);
    expect(thinking.checkingUsd).toBeCloseTo(0.07, 9);
    expect(thinking.uncheckedSteps).toBe(3);
    expect(thinking.uncheckedAnsweredSteps).toBe(1);
    expect(thinking.uncheckedUsd).toBeCloseTo(0.55, 9);
    expect(money.live[0].thinkingCheckingUsd).toBeCloseTo(0.07, 9);
    expect(money.live[0].thinkingUncheckedUsd).toBeCloseTo(0.55, 9);
    // In the list the old ones say so, and the answered one is not a step with no answer.
    expect(thinking.unanswered.map((step) => ({ usd: step.usd, state: step.state }))).toEqual([
      { usd: 0.07, state: "checking" },
      { usd: 0.2, state: "unchecked" },
      { usd: 0.05, state: "unchecked" },
    ]);
    // None of it is proven, so none of it is in the total or taken out of the P&L: the
    // one that did land stays a loss of that amount, and the page has to say so.
    expect(thinking.paidUsd).toBe(0);
    expect(money.totals.thinkingUsd).toBe(0);
    expect((await loadMoneyFlows(db, [agent.agentId])).get(agent.agentId)).toBeUndefined();
    expect((await everySurface(agent)).card.pnlUsd).toBeCloseTo(-0.2, 9);
  });

  it("still shows an owner with no agent left what the deleted ones paid", async () => {
    const agent = await payPerUse("live");
    await payment(agent, ago(2), 0.45);
    await payment(agent, ago(2), 0.15, "paid_no_answer", { httpStatus: 502, txHash: TX });
    await payment(agent, anHourAgo(), 0.02, "unconfirmed");
    // The owner deletes their only agent. The ledger has no foreign keys and keeps its rows.
    await db.delete(schema.agents).where(eq(schema.agents.id, agent.agentId));

    const money = await getMoney(agent.userId);
    expect(money.live).toEqual([]);
    expect(money.paper).toEqual([]);
    expect(money.totals).toEqual(EMPTY_MONEY.totals);
    const thinking = money.thinking!;
    expect(thinking.paidUsd).toBeCloseTo(0.6, 9);
    expect(thinking.formerAgentsUsd).toBeCloseTo(0.6, 9);
    expect(thinking).toMatchObject({ liveUsd: 0, paperUsd: 0, steps: 2, unansweredSteps: 1, checkingSteps: 1 });
    expect(thinking.unansweredUsd).toBeCloseTo(0.15, 9);
    expect(thinking.unanswered.map((step) => ({ state: step.state, agentName: step.agentName, txHash: step.txHash }))).toEqual([
      { state: "checking", agentName: null, txHash: null },
      { state: "unanswered", agentName: null, txHash: TX },
    ]);
  });

  it("gives an owner with no agent and no payment the very same empty summary as before", async () => {
    const agent = await seedAgent(db);
    await db.delete(schema.agents).where(eq(schema.agents.id, agent.agentId));
    // The same object, so nothing about it can have changed.
    expect(await getMoney(agent.userId)).toBe(EMPTY_MONEY);
    expect(await getMoney(`did:privy:nobody-${nanoid(6)}`)).toBe(EMPTY_MONEY);
    expect(EMPTY_MONEY.thinking).toBeNull();
  });

  it("sets what the same tokens cost at list price on a key beside what they cost paid per use", async () => {
    const agent = await payPerUse("live");
    await mark(agent.agentId, ago(3), 25);
    await mark(agent.agentId, ago(0.01), 25);
    // Gemini 2.5 Flash lists at $0.30 / $2.50 per million.
    await payment(agent, ago(2), 0.4, "settled", { inputTokens: 1_000_000, outputTokens: 10_000 });
    await payment(agent, ago(2), 0.2, "settled", { inputTokens: 500_000, outputTokens: 2_000 });
    // No usage reported, and a step with no answer: nothing to price, in neither figure.
    // The unanswered one is given counts on purpose: only an answered step is priced.
    await payment(agent, ago(2), 0.3, "settled");
    await payment(agent, ago(2), 0.1, "paid_no_answer", { inputTokens: 7_000_000, outputTokens: 7_000_000 });
    // A model nobody lists.
    await payment(agent, ago(2), 0.05, "settled", { model: "some-model/nobody-lists", inputTokens: 10, outputTokens: 10 });
    // Answered, but its payment is not yet proven: "what the same steps cost paid per
    // use" is money known to have been paid, so it waits for the chain like the total.
    await payment(agent, anHourAgo(), 0.9, "settled", { txHash: null, inputTokens: 9_000_000, outputTokens: 90_000 });

    const compare = (await getMoney(agent.userId)).thinking!.ownKey!;
    expect(compare).toMatchObject({ steps: 2, inputTokens: 1_500_000, outputTokens: 12_000, unpricedSteps: 1 });
    expect(compare.ownKeyUsd).toBeCloseTo(1.5 * 0.3 + 0.012 * 2.5, 9);
    expect(compare.paidUsd).toBeCloseTo(0.6, 9);
  });

  it("counts what a deleted agent paid toward the account, and names it apart", async () => {
    const agent = await payPerUse("live");
    await mark(agent.agentId, ago(3), 25);
    await mark(agent.agentId, ago(0.01), 25);
    await payment(agent, ago(2), 0.25);
    // The ledger has no foreign keys: the agent is gone, its payments are not.
    const gone = { ...agent, agentId: `gone_${nanoid(6)}` };
    await payment(gone, ago(2), 0.75, "paid_no_answer");

    const money = await getMoney(agent.userId);
    expect(money.thinking!.paidUsd).toBeCloseTo(1, 9);
    expect(money.thinking!.liveUsd).toBeCloseTo(0.25, 9);
    expect(money.thinking!.formerAgentsUsd).toBeCloseTo(0.75, 9);
    expect(money.totals.thinkingUsd).toBeCloseTo(0.25, 9);
    expect(money.thinking!.unanswered).toHaveLength(1);
    expect(money.thinking!.unanswered[0]).toMatchObject({ agentName: null, agentSlug: null });
  });

  it("never shows one owner another owner's steps", async () => {
    const mine = await payPerUse("live");
    const theirs = await payPerUse("live");
    await payment(mine, ago(2), 0.1);
    await payment(theirs, ago(2), 7, "paid_no_answer");

    const thinking = (await getMoney(mine.userId)).thinking!;
    expect(thinking.paidUsd).toBeCloseTo(0.1, 9);
    expect(thinking.unanswered).toEqual([]);
    expect(thinking.unansweredUsd).toBe(0);
  });

  it("never names an agent that is not the viewer's own, whatever a ledger row says", async () => {
    const mine = await payPerUse("live");
    const theirs = await payPerUse("live");
    // A row that should not exist: my account, somebody else's agent id. The amount is
    // still mine to see. The other owner's agent name and link are not.
    await payment({ ...mine, agentId: theirs.agentId }, ago(2), 0.3, "paid_no_answer");

    const thinking = (await getMoney(mine.userId)).thinking!;
    expect(thinking.unanswered).toHaveLength(1);
    expect(thinking.unanswered[0]).toMatchObject({ agentName: null, agentSlug: null });
    expect(thinking.formerAgentsUsd).toBeCloseTo(0.3, 9);
  });
});

describe("the public card of a pay-per-use agent", () => {
  it("names the model it thinks on, not the key model its config still carries", async () => {
    const usdc = await payPerUse("paper");
    const keyed = await seedAgent(db);
    const owner = { id: "u", handle: "u", displayName: null, avatarUrl: null };
    const [usdcRow] = await db.select().from(schema.agents).where(eq(schema.agents.id, usdc.agentId));
    const [keyRow] = await db.select().from(schema.agents).where(eq(schema.agents.id, keyed.agentId));

    expect(toAgentCard(usdcRow, owner).model).toBe("google/gemini-2.5-flash");
    expect(toAgentCard(keyRow, owner).model).toBe(DEFAULT_AGENT_CONFIG.llm.model);
  });
});
