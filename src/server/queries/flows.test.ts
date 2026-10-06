/**
 * Money moved is not money made.
 *
 * A live agent's all-time P&L used to be its latest equity less its first live mark, and
 * nothing else. So $25 deposited into a $25 agent read as +$25 (+100%), on its card, its
 * own page, Home, /money and the public leaderboard, where a track record could be
 * bought with a deposit. And $20 withdrawn read as −$20 (−80%) when nothing was lost.
 *
 * Every one of those surfaces now takes the deposits and withdrawals Tocker has a record
 * of out of the number: funding transfers that were sent, and the owner's audited USDC
 * withdrawals. These tests drive each surface through the real queries against
 * in-memory PGlite. Only the live wallet read is stubbed, so a test can say what the
 * wallet holds "now".
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { nanoid } from "nanoid";
import type { Db } from "@/db";
import * as schema from "@/db/schema";
import { seedAgent, setupTestDb } from "@/lib/agent/test-support";
import { toNumeric } from "@/lib/money";

/** What each live agent's wallet answers with. No entry: the read fails, as an outage does. */
const wallets = vi.hoisted(() => ({ books: new Map<string, { cashUsd: number; equityUsd: number }>() }));

vi.mock("@/lib/agent/portfolio", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/agent/portfolio")>()),
  getAgentWallets: async (agentId: string) =>
    wallets.books.has(agentId) ? [{ chain: "solana", walletId: `privy_${agentId}`, address: `Agent${agentId}` }] : [],
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

const { loadAgentAggregates, loadMoneyFlows } = await import("./_shared");
const { getAgentBySlug, getAgentWindowPnl, listMyAgents } = await import("./agents");
const { getLeaderboard } = await import("./discover");
const { getHomeOverview } = await import("./home");
const { getMoney } = await import("./money");

let db: Db;

beforeAll(async () => {
  db = await setupTestDb();
}, 120_000);

beforeEach(() => {
  wallets.books.clear();
});

const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY);

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

async function deposit(
  agent: { agentId: string; userId: string },
  at: Date,
  amount: number,
  status: "pending" | "sent" | "failed" | "cancelled" = "sent",
) {
  await db.insert(schema.agentFundingIntents).values({
    id: nanoid(),
    agentId: agent.agentId,
    userId: agent.userId,
    chain: "base",
    asset: "usdc",
    amount: String(amount),
    status,
    toAddress: "0x0000000000000000000000000000000000000001",
    createdAt: at,
    settledAt: status === "pending" ? null : at,
  });
}

async function audit(agent: { agentId: string; userId: string }, at: Date, metadata: Record<string, unknown>) {
  await db.insert(schema.auditEvents).values({
    id: nanoid(),
    userId: agent.userId,
    kind: "withdraw",
    agentId: agent.agentId,
    summary: "Withdrew.",
    metadata,
    createdAt: at,
  });
}

/** A Base withdrawal as `secureWithdrawAction` records it. */
const baseWithdrawal = (amount: number) => ({ chain: "base", asset: "usdc", amount, to: "0x1", txHash: "0x2" });

/** Every surface's all-time number for one live agent, read the way its page reads it. */
async function everySurface(agent: { agentId: string; userId: string; slug: string }) {
  const [cards, page, home, money, board] = await Promise.all([
    listMyAgents(agent.userId),
    getAgentBySlug(agent.slug, agent.userId),
    getHomeOverview(agent.userId),
    getMoney(agent.userId),
    getLeaderboard("all", 1_000),
  ]);
  const card = cards.find((c) => c.id === agent.agentId)!;
  const row = board.find((r) => r.agent.id === agent.agentId)!;
  return {
    card: { pnlUsd: card.pnlUsd, pnlPct: card.pnlPct },
    page: { pnlUsd: page!.pnlUsd, pnlPct: page!.pnlPct },
    home: { pnlUsd: home.pnlUsd, pnlPct: home.pnlPct },
    money: { pnlUsd: money.live.find((r) => r.id === agent.agentId)!.pnlUsd },
    leaderboard: { pnlUsd: row.pnlUsd, pnlPct: row.pnlPct },
  };
}

describe("a deposit into a live agent is not a gain", () => {
  it("funded with 25, 25 more deposited, worth 50: P&L 0 on every surface", async () => {
    const agent = await seedAgent(db, { mode: "live" });
    await mark(agent.agentId, ago(3), 25);
    await deposit(agent, ago(2), 25);
    await mark(agent.agentId, ago(1), 50);
    await mark(agent.agentId, ago(0.01), 50);

    const seen = await everySurface(agent);

    // Each of these read +25 (and +100% where a percent is shown) before.
    expect(seen.card).toEqual({ pnlUsd: 0, pnlPct: 0 });
    expect(seen.page).toEqual({ pnlUsd: 0, pnlPct: 0 });
    expect(seen.home).toEqual({ pnlUsd: 0, pnlPct: 0 });
    expect(seen.money).toEqual({ pnlUsd: 0 });
    expect(seen.leaderboard).toEqual({ pnlUsd: 0, pnlPct: 0 });
  });

  it("still shows what the agent actually made on top of the deposit", async () => {
    const agent = await seedAgent(db, { mode: "live" });
    await mark(agent.agentId, ago(3), 25);
    await deposit(agent, ago(2), 25);
    await mark(agent.agentId, ago(0.01), 53);

    const seen = await everySurface(agent);

    expect(seen.card.pnlUsd).toBeCloseTo(3, 9);
    // On the $50 put in, not on the $25 it started with.
    expect(seen.card.pnlPct).toBeCloseTo(6, 9);
    expect(seen.leaderboard.pnlPct).toBeCloseTo(6, 9);
    expect(seen.home.pnlPct).toBeCloseTo(6, 9);
    expect(seen.page.pnlUsd).toBeCloseTo(3, 9);
    expect(seen.money.pnlUsd).toBeCloseTo(3, 9);
  });

  it("does not count a transfer that never went, or one still waiting on the browser", async () => {
    const agent = await seedAgent(db, { mode: "live" });
    await mark(agent.agentId, ago(3), 25);
    await deposit(agent, ago(2), 25, "failed");
    await deposit(agent, ago(2), 25, "cancelled");
    await deposit(agent, ago(2), 25, "pending");
    await mark(agent.agentId, ago(0.01), 30);

    expect((await loadMoneyFlows(db, [agent.agentId])).get(agent.agentId)).toBeUndefined();
    expect((await everySurface(agent)).card.pnlUsd).toBeCloseTo(5, 9);
  });
});

describe("a withdrawal out of a live agent is not a loss", () => {
  it("funded with 25, 20 withdrawn, 5 left: P&L 0 on every surface", async () => {
    const agent = await seedAgent(db, { mode: "live" });
    await mark(agent.agentId, ago(3), 25);
    await audit(agent, ago(2), baseWithdrawal(20));
    await mark(agent.agentId, ago(1), 5);
    await mark(agent.agentId, ago(0.01), 5);

    const seen = await everySurface(agent);

    // Each of these read −20 (−80%) before.
    expect(seen.card).toEqual({ pnlUsd: 0, pnlPct: 0 });
    expect(seen.page).toEqual({ pnlUsd: 0, pnlPct: 0 });
    expect(seen.home).toEqual({ pnlUsd: 0, pnlPct: 0 });
    expect(seen.money).toEqual({ pnlUsd: 0 });
    expect(seen.leaderboard).toEqual({ pnlUsd: 0, pnlPct: 0 });
  });

  it("reads a Solana withdrawal by what was delivered, and none of a failed one", async () => {
    const agent = await seedAgent(db, { mode: "live" });
    await mark(agent.agentId, ago(3), 25);
    await audit(agent, ago(2), { chain: "solana", asset: "usdc", requested: 20, delivered: 20, status: "succeeded", route: "sponsored" });
    await audit(agent, ago(2), { chain: "solana", asset: "usdc", requested: 4, delivered: 4, status: "failed", route: "sponsored" });
    // Leftover SOL is not USDC, and it never was in the equity.
    await audit(agent, ago(2), { chain: "solana", asset: "native", requested: 0.2, delivered: 0.2, status: "succeeded" });
    await mark(agent.agentId, ago(0.01), 5);

    const flows = (await loadMoneyFlows(db, [agent.agentId])).get(agent.agentId) ?? [];
    expect(flows.map((f) => f.amountUsd)).toEqual([-20]);
    expect((await everySurface(agent)).card).toEqual({ pnlUsd: 0, pnlPct: 0 });
  });

  it("does not mistake a fee sweep for the owner taking money out", async () => {
    const agent = await seedAgent(db, { mode: "live" });
    await mark(agent.agentId, ago(3), 25);
    // The sweep shares the audit kind. It is a cost: the equity fell by it and so does P&L.
    await audit(agent, ago(2), { reason: "platform_fee_settlement", chain: "base", amountUsd: 1.2, fills: 12 });
    await mark(agent.agentId, ago(0.01), 23.8);

    expect((await loadMoneyFlows(db, [agent.agentId])).get(agent.agentId)).toBeUndefined();
    expect((await everySurface(agent)).card.pnlUsd).toBeCloseTo(-1.2, 9);
  });

  it("cannot be used to raise the percent: it is taken on what was put in", async () => {
    const agent = await seedAgent(db, { mode: "live" });
    // $1,000 in, $50 made, $1,045 out. $5 is left; it made 5%, not 1,000%.
    await mark(agent.agentId, ago(3), 1_000);
    await audit(agent, ago(2), baseWithdrawal(1_045));
    await mark(agent.agentId, ago(0.01), 5);

    const seen = await everySurface(agent);

    expect(seen.card.pnlUsd).toBeCloseTo(50, 9);
    expect(seen.card.pnlPct).toBeCloseTo(5, 9);
    expect(seen.leaderboard.pnlPct).toBeCloseTo(5, 9);
    expect(seen.page.pnlPct).toBeCloseTo(5, 9);
    expect(seen.home.pnlPct).toBeCloseTo(5, 9);
  });
});

describe("money that moved after the last mark", () => {
  it("is not netted against a mark that does not hold it yet", async () => {
    const agent = await seedAgent(db, { mode: "live" });
    await mark(agent.agentId, ago(3), 25);
    await mark(agent.agentId, ago(1), 25);
    // Deposited an hour ago; the marks pass has not run since (a paused, flat agent is
    // never marked again). The card still shows the $25 book, and no loss.
    await deposit(agent, ago(1 / 24), 25);

    const agg = (await loadAgentAggregates(db, [agent.agentId])).get(agent.agentId)!;
    expect(agg.equityUsd).toBe(25);
    expect(agg.pnlUsd).toBe(0);
    expect(agg.flowSinceMarkUsd).toBe(25);
    expect((await getHomeOverview(agent.userId)).pnlUsd).toBe(0);
  });

  it("is in the basis of a book read from the wallet just now", async () => {
    const agent = await seedAgent(db, { mode: "live" });
    await mark(agent.agentId, ago(3), 25);
    await mark(agent.agentId, ago(1), 25);
    await deposit(agent, ago(1 / 24), 25);
    // The wallet answers, and already holds the deposit.
    wallets.books.set(agent.agentId, { cashUsd: 50, equityUsd: 50 });

    const page = await getAgentBySlug(agent.slug, agent.userId);
    expect(page!.equityUsd).toBe(50);
    expect(page!.pnlUsd).toBe(0);
    expect(page!.pnlPct).toBe(0);

    const money = await getMoney(agent.userId);
    expect(money.live[0]).toMatchObject({ equityUsd: 50, pnlUsd: 0, stale: false });
  });

  it("covers the usual way out: sell, pause, withdraw everything", async () => {
    const agent = await seedAgent(db, { mode: "live" });
    await mark(agent.agentId, ago(3), 25);
    await mark(agent.agentId, ago(1), 27);
    await audit(agent, ago(1 / 24), baseWithdrawal(27));
    wallets.books.set(agent.agentId, { cashUsd: 0, equityUsd: 0 });

    // The wallet is empty and the agent made $2. Not −$25, and not +$27.
    const page = await getAgentBySlug(agent.slug, agent.userId);
    expect(page!.equityUsd).toBe(0);
    expect(page!.pnlUsd).toBeCloseTo(2, 9);
    expect(page!.pnlPct).toBeCloseTo(8, 9);
    // The card is the last mark, and says the same $2.
    const [card] = await listMyAgents(agent.userId);
    expect(card.pnlUsd).toBeCloseTo(2, 9);
  });
});

describe("the public leaderboard's windows", () => {
  it("nets a deposit made inside the window out of that window's P&L", async () => {
    const agent = await seedAgent(db, { mode: "live" });
    // Flat at $100, then $500 deposited two days ago. Unnetted, the week reads +500%.
    await mark(agent.agentId, ago(10), 100);
    await mark(agent.agentId, ago(3), 100);
    await deposit(agent, ago(2), 500);
    await mark(agent.agentId, ago(0.01), 600);

    for (const window of ["7d", "30d", "all"] as const) {
      const row = (await getLeaderboard(window, 1_000)).find((r) => r.agent.id === agent.agentId)!;
      expect({ window, pnlUsd: row.pnlUsd, pnlPct: row.pnlPct }).toEqual({ window, pnlUsd: 0, pnlPct: 0 });
    }
    const week = await getAgentWindowPnl(agent.agentId, "7d");
    expect(week).toMatchObject({ pnlUsd: 0, pnlPct: 0, flowUsd: 500, startEquityUsd: 100, endEquityUsd: 600 });
  });

  it("leaves a deposit from before the window's baseline to the windows that span it", async () => {
    const agent = await seedAgent(db, { mode: "live" });
    await mark(agent.agentId, ago(20), 100);
    await deposit(agent, ago(15), 500);
    await mark(agent.agentId, ago(8), 600);
    await mark(agent.agentId, ago(0.01), 630);

    const rowFor = async (window: "7d" | "30d" | "all") =>
      (await getLeaderboard(window, 1_000)).find((r) => r.agent.id === agent.agentId)!;

    // The week starts at the $600 mark, which already holds the deposit: +$30 on $600.
    expect((await rowFor("7d")).pnlUsd).toBeCloseTo(30, 9);
    expect((await rowFor("7d")).pnlPct).toBeCloseTo(5, 9);
    // The month and all time start before it: still +$30, on the $600 put in.
    expect((await rowFor("30d")).pnlUsd).toBeCloseTo(30, 9);
    expect((await rowFor("30d")).pnlPct).toBeCloseTo(5, 9);
    expect((await rowFor("all")).pnlPct).toBeCloseTo(5, 9);
  });
});

describe("paper agents", () => {
  it("are measured from their notional, whatever was sent to their wallet", async () => {
    const agent = await seedAgent(db);
    await mark(agent.agentId, ago(3), 10_000, "paper");
    // Real USDC funded while on paper is not part of the simulated book.
    await deposit(agent, ago(2), 25);
    await audit(agent, ago(1), baseWithdrawal(10));
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
    const [card] = await listMyAgents(agent.userId);
    expect(card.pnlUsd).toBe(100);
    expect((await getHomeOverview(agent.userId)).paper).toMatchObject({ pnlUsd: 100, pnlPct: 1 });
    const row = (await getLeaderboard("all", 1_000)).find((r) => r.agent.id === agent.agentId)!;
    expect(row).toMatchObject({ pnlUsd: 100, pnlPct: 1 });
  });
});
