import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { Db } from "@/db";
import * as schema from "@/db/schema";
import { DEFAULT_AGENT_CONFIG } from "./config";
import { applyFill } from "@/lib/trading/positions";
import * as prices from "@/lib/trading/prices";
import { seedKnownTokens, tokenId, USDC_SOLANA } from "@/lib/trading/tokens";
import { effectiveTicketUsd, getPortfolio, snapshotEquity, type Portfolio } from "./portfolio";
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
