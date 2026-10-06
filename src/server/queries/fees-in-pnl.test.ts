/**
 * One realised P&L for one sale, everywhere: after fees, the Tocker fee included.
 *
 * The position ledger books a fill with the venue's fee plus the Tocker fee, and the
 * Sold dialog and the stat cards are built on that. The feed, Home's activity, the
 * Performance tab and every win rate replayed fills with the venue's fee alone, so the
 * same sale read up to twenty cents better there (ten on each leg), and a sale that lost
 * money after fees could be published as a win.
 *
 * The sale below is exactly that case: bought for $1.00, sold for $1.15, ten cents of
 * Tocker fee on each leg. Before fees it is +$0.15; after them, −$0.05.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { Db } from "@/db";
import * as schema from "@/db/schema";
import { seedAgent, setupTestDb } from "@/lib/agent/test-support";
import { toNumeric } from "@/lib/money";
import { seedKnownTokens, tokenId } from "@/lib/trading/tokens";
import { attachRealizedPnl, loadTokens, toTradeRow } from "./_shared";
import { getAgentBySlug } from "./agents";
import { getAgentAnalytics } from "./analytics";
import { getHomeActivity } from "./home";
import { getMoney } from "./money";

const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const BONK_ID = tokenId("solana", BONK);
const USDC_ID = tokenId("solana", "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
const TOCKER_FEE = 0.1;

let db: Db;

beforeAll(async () => {
  db = await setupTestDb();
  await seedKnownTokens();
}, 120_000);

const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000);

async function fill(
  agent: { agentId: string; userId: string },
  side: "buy" | "sell",
  amountUsd: number,
  at: Date,
  tockerFeeUsd: number | null,
): Promise<string> {
  const id = nanoid();
  const amountToken = 100_000;
  await db.insert(schema.trades).values({
    id,
    agentId: agent.agentId,
    ownerId: agent.userId,
    chain: "solana",
    side,
    tokenId: BONK_ID,
    quoteTokenId: USDC_ID,
    amountToken: toNumeric(amountToken, 12),
    amountUsd: toNumeric(amountUsd, 6),
    priceUsd: toNumeric(amountUsd / amountToken, 12),
    // The trade row holds the venue's fee alone. A paper fill has none.
    feeUsd: toNumeric(0, 6),
    status: "filled",
    isPaper: true,
    origin: "manual",
    createdAt: at,
    filledAt: at,
  });
  if (tockerFeeUsd !== null) {
    await db.insert(schema.platformFees).values({
      id: nanoid(),
      agentId: agent.agentId,
      tradeId: id,
      chain: "solana",
      amountUsd: toNumeric(tockerFeeUsd, 6),
      status: "settled",
      txHash: "simulated",
      createdAt: at,
      settledAt: at,
    });
  }
  return id;
}

/** Bought for $1.00, sold for $1.15. With or without the Tocker fee on each leg. */
async function roundTrip(tockerFeeUsd: number | null) {
  const agent = await seedAgent(db);
  await fill(agent, "buy", 1, minutesAgo(30), tockerFeeUsd);
  const sellId = await fill(agent, "sell", 1.15, minutesAgo(10), tockerFeeUsd);
  return { ...agent, sellId };
}

async function realisedOnFeed(sellId: string) {
  const [row] = await db.select().from(schema.trades).where(eq(schema.trades.id, sellId));
  const token = (await loadTokens(db, [row.tokenId])).get(row.tokenId)!;
  const [trade] = await attachRealizedPnl(db, [toTradeRow(row, token)]);
  return trade;
}

describe("what a sale realised, after fees", () => {
  it("is 0.20 less with a 0.10 Tocker fee on the buy and on the sell than without", async () => {
    const free = await roundTrip(null);
    const charged = await roundTrip(TOCKER_FEE);

    const before = await realisedOnFeed(free.sellId);
    const after = await realisedOnFeed(charged.sellId);

    expect(before.realizedPnlUsd).toBeCloseTo(0.15, 9);
    expect(after.realizedPnlUsd).toBeCloseTo(-0.05, 9);
    expect(before.realizedPnlUsd! - after.realizedPnlUsd!).toBeCloseTo(0.2, 9);
    // Against what the tokens cost with the buy's fee in it: $1.10, not $1.00.
    expect(after.realizedPnlPct).toBeCloseTo((-0.05 / 1.1) * 100, 6);
  });

  it("is the same figure on Home's activity, the Performance tab and the feed", async () => {
    const agent = await roundTrip(TOCKER_FEE);

    const feed = await realisedOnFeed(agent.sellId);
    const activity = await getHomeActivity(agent.userId, 8);
    const sold = activity.find((item) => item.id === agent.sellId)!;
    const analytics = await getAgentAnalytics(agent.agentId, "all", agent.userId);

    expect(sold.trade.realizedPnlUsd).toBeCloseTo(-0.05, 9);
    expect(sold.trade.realizedPnlUsd).toBe(feed.realizedPnlUsd);
    expect(analytics!.realizedPnlUsd).toBeCloseTo(-0.05, 9);
    // The only closed sale is best and worst at once, and it is shown once: as the best.
    expect(analytics!.bestTradePnlUsd).toBeCloseTo(-0.05, 9);
  });

  it("does not count a sale that lost money after fees as a win", async () => {
    const agent = await roundTrip(TOCKER_FEE);

    const [analytics, page, money] = await Promise.all([
      getAgentAnalytics(agent.agentId, "all", agent.userId),
      getAgentBySlug(agent.slug, agent.userId),
      getMoney(agent.userId),
    ]);

    // One closed sale, and it lost five cents: 0%, not 100%.
    expect(analytics!.winRate).toBe(0);
    expect(page!.stats.winRate).toBe(0);
    expect(money.paper.find((row) => row.id === agent.agentId)!.winRate).toBe(0);
  });

  it("still counts it as the win it was when no Tocker fee was charged", async () => {
    const agent = await roundTrip(null);

    const [analytics, page, money] = await Promise.all([
      getAgentAnalytics(agent.agentId, "all", agent.userId),
      getAgentBySlug(agent.slug, agent.userId),
      getMoney(agent.userId),
    ]);

    expect(analytics!.realizedPnlUsd).toBeCloseTo(0.15, 9);
    expect(analytics!.winRate).toBe(1);
    expect(page!.stats.winRate).toBe(1);
    expect(money.paper.find((row) => row.id === agent.agentId)!.winRate).toBe(1);
  });
});
