import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import type { Db } from "@/db";
import * as schema from "@/db/schema";
import { seedAgent, setupTestDb } from "@/lib/agent/test-support";
import { resetTokenCaches } from "@/lib/tokens";
import { seedKnownTokens, tokenId } from "./tokens";
import { applyFill, updatePeaks } from "./positions";
import * as prices from "./prices";
import { runGuardian } from "./guardian";

/**
 * The real paper executor is used throughout. To exercise the "one bad position must not
 * stop the others" guarantee, one token's *quote* price is made unavailable, which is
 * exactly how a venue failure looks from the guardian's side.
 */
const realPriceUsd = prices.getPriceUsd;

const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const BONK_ID = tokenId("solana", BONK);
const WIF = "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm";
const WIF_ID = tokenId("solana", WIF);
/** KNOWN_TOKENS fallback price for WIF — used whenever the feeds do not answer. */
const WIF_PRICE = 0.5412;

let db: Db;

beforeAll(async () => {
  process.env.X402_MOCK = "1";
  process.env.LLM_MOCK = "1";
  db = await setupTestDb();
  await seedKnownTokens();
});

/**
 * Offline pricing. `/ultra/v1/order` is refused so the paper executor falls back to the
 * price feed, and the price feed only knows BONK — WIF therefore resolves through the
 * stored/constant fallback, which is deterministic.
 */
function stubPricing(bonkPrice: number): void {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("api.jup.ag/price/v3")) {
      return new Response(JSON.stringify({ [BONK]: { usdPrice: bonkPrice } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response("{}", { status: 404, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}

beforeEach(async () => {
  vi.restoreAllMocks();
  prices.resetPriceCache();
  await resetTokenCaches();
  stubPricing(0.0000027);
});

interface SeedPositionInput {
  agentId: string;
  tokenId?: string;
  amountToken?: number;
  avgCostUsd: number;
  openedAt?: Date;
  peakPriceUsd?: number | null;
  entryScore?: number | null;
  entryLiquidityUsd?: number | null;
}

async function seedPosition(input: SeedPositionInput): Promise<void> {
  await db.insert(schema.positions).values({
    agentId: input.agentId,
    tokenId: input.tokenId ?? BONK_ID,
    amountToken: (input.amountToken ?? 10_000_000).toFixed(12),
    avgCostUsd: input.avgCostUsd.toFixed(12),
    realizedPnlUsd: "0",
    openedAt: input.openedAt ?? new Date(Date.now() - 3 * 3_600_000),
    peakPriceUsd: input.peakPriceUsd === null ? null : (input.peakPriceUsd ?? input.avgCostUsd).toFixed(12),
    entryScore: input.entryScore === null ? null : (input.entryScore ?? 74).toFixed(2),
    entryLiquidityUsd: input.entryLiquidityUsd === null ? null : (input.entryLiquidityUsd ?? 310_000).toFixed(2),
  });
}

function tradesFor(agentId: string) {
  return db.select().from(schema.trades).where(eq(schema.trades.agentId, agentId));
}

function positionFor(agentId: string, token = BONK_ID) {
  return db
    .select()
    .from(schema.positions)
    .where(and(eq(schema.positions.agentId, agentId), eq(schema.positions.tokenId, token)))
    .limit(1);
}

describe("runGuardian — stop loss", () => {
  it("sells the position, records the trade, resets the row, posts and notifies", async () => {
    const { agentId, userId } = await seedAgent(db, {
      config: { chains: ["solana"], risk: { stopLossPct: 15, takeProfitPct: null, exitScoreBelow: null, exitOnLiquidityDropPct: null } },
    });
    const follower = `did:privy:f-${agentId.slice(0, 6)}`;
    await db.insert(schema.users).values({ id: follower, handle: `f${agentId.slice(0, 8)}` });
    await db.insert(schema.follows).values({ followerId: follower, targetType: "agent", targetId: agentId });

    // Entry at 0.0000036, mark 0.0000027 → −25%, through a 15% stop.
    await seedPosition({ agentId, avgCostUsd: 0.0000036 });

    const result = await runGuardian({ agentId, trigger: "marks" });

    expect(result.ran).toBe(true);
    expect(result.positions).toBe(1);
    expect(result.rescored).toBe(0); // no score rule armed → no rescoring at all
    expect(result.exits).toHaveLength(1);
    expect(result.skipped).toHaveLength(0);
    const exit = result.exits[0];
    expect(exit?.status).toBe("filled");
    expect(exit?.reason).toBe("stop_loss");
    expect(exit?.rationale).toMatch(/^Stop loss: BONK at \$[\d.]+, −25\.0% from entry/);

    // The trade: a guardian-origin sell with the reason on it.
    const rows = await tradesFor(agentId);
    expect(rows).toHaveLength(1);
    const trade = rows[0];
    expect(trade?.side).toBe("sell");
    expect(trade?.status).toBe("filled");
    expect(trade?.origin).toBe("guardian");
    expect(trade?.exitReason).toBe("stop_loss");
    expect(trade?.isPaper).toBe(true);
    expect(trade?.runId).toBeNull();
    expect(trade?.filledAt).not.toBeNull();
    expect(Number(trade?.amountUsd)).toBeCloseTo(10_000_000 * 0.0000027, 6);
    expect(Number(trade?.amountToken)).toBeGreaterThan(0);
    expect(Number(trade?.feeUsd)).toBeGreaterThan(0);
    expect(trade?.rationale).toBe(exit?.rationale);

    // The position is flat and its exit bookkeeping is cleared.
    const [position] = await positionFor(agentId);
    expect(Number(position?.amountToken)).toBeCloseTo(0, 9);
    expect(position?.openedAt).toBeNull();
    expect(position?.peakPriceUsd).toBeNull();
    expect(position?.entryScore).toBeNull();
    expect(position?.entryLiquidityUsd).toBeNull();
    expect(Number(position?.realizedPnlUsd)).toBeLessThan(0);

    // The feed post carries the public line: what sold and where, never the 15% stop.
    const feed = await db.select().from(schema.posts).where(eq(schema.posts.agentId, agentId));
    expect(feed).toHaveLength(1);
    expect(feed[0]?.kind).toBe("trade");
    expect(feed[0]?.authorId).toBe(userId);
    expect(feed[0]?.tradeId).toBe(trade?.id);
    expect(feed[0]?.body).toBe(exit?.publicRationale);
    expect(feed[0]?.body).toContain("Stop loss: closed BONK at −25.0% from entry.");
    expect(feed[0]?.body).not.toContain("15%");

    // The owner gets an `exit` notification; the follower gets a `trade` one.
    const owner = await db.select().from(schema.notifications).where(eq(schema.notifications.userId, userId));
    expect(owner).toHaveLength(1);
    expect(owner[0]?.kind).toBe("exit");
    expect(owner[0]?.title).toBe("Stop loss hit: sold BONK");
    expect(owner[0]?.href).toContain("/agents/");
    // The href names the trade so the notifications page can show its receipt under
    // the rationale; the body is the rationale alone, not the receipt summary again.
    expect(owner[0]?.href).toContain(`?trade=${trade?.id}`);
    expect(owner[0]?.body).toBe(exit?.rationale);
    const followerNotes = await db.select().from(schema.notifications).where(eq(schema.notifications.userId, follower));
    expect(followerNotes).toHaveLength(1);
    expect(followerNotes[0]?.kind).toBe("trade");
    expect(followerNotes[0]?.title).toContain("sold BONK");
    expect(followerNotes[0]?.body).not.toContain("15%");
    expect(owner[0]?.body).toContain("15% stop");

    // Equity snapshot after the exit.
    const snaps = await db.select().from(schema.equitySnapshots).where(eq(schema.equitySnapshots.agentId, agentId));
    expect(snaps).toHaveLength(1);
    expect(Number(snaps[0]?.cashUsd)).toBeGreaterThan(10_000);
  });

  it("does nothing while the position is inside the stop", async () => {
    const { agentId } = await seedAgent(db, {
      config: { chains: ["solana"], risk: { stopLossPct: 15, takeProfitPct: null, exitScoreBelow: null, exitOnLiquidityDropPct: null } },
    });
    await seedPosition({ agentId, avgCostUsd: 0.0000028 }); // −3.6%

    const result = await runGuardian({ agentId, trigger: "marks" });
    expect(result.ran).toBe(true);
    expect(result.exits).toHaveLength(0);
    expect(result.note).toBe("no exit rules fired");
    expect(await tradesFor(agentId)).toHaveLength(0);
    // Still snapshots equity: that is the whole point of the marks tick.
    const snaps = await db.select().from(schema.equitySnapshots).where(eq(schema.equitySnapshots.agentId, agentId));
    expect(snaps).toHaveLength(1);
  });

  it("leaves a dust position alone", async () => {
    const { agentId } = await seedAgent(db, {
      config: { chains: ["solana"], risk: { stopLossPct: 15, takeProfitPct: null, exitScoreBelow: null, exitOnLiquidityDropPct: null } },
    });
    // 100k BONK at 0.0000027 = $0.27 — under the dust floor.
    await seedPosition({ agentId, amountToken: 100_000, avgCostUsd: 0.0000036 });

    const result = await runGuardian({ agentId, trigger: "marks" });
    expect(result.exits).toHaveLength(0);
    expect(await tradesFor(agentId)).toHaveLength(0);
  });
});

describe("runGuardian — the other rules", () => {
  it("takes profit and raises the peak from the fresh mark", async () => {
    stubPricing(0.000005);
    const { agentId } = await seedAgent(db, {
      config: { chains: ["solana"], risk: { stopLossPct: null, takeProfitPct: 40, exitScoreBelow: null, exitOnLiquidityDropPct: null } },
    });
    await seedPosition({ agentId, avgCostUsd: 0.0000027, peakPriceUsd: 0.0000027 });

    const result = await runGuardian({ agentId, trigger: "manual" });
    expect(result.exits[0]?.reason).toBe("take_profit");
    const rows = await tradesFor(agentId);
    expect(rows[0]?.exitReason).toBe("take_profit");
    expect(Number(rows[0]?.priceUsd)).toBeCloseTo(0.000005, 12);
    const [position] = await positionFor(agentId);
    expect(Number(position?.amountToken)).toBeCloseTo(0, 9);
  });

  it("fires the trailing stop off the stored peak", async () => {
    const { agentId } = await seedAgent(db, {
      config: {
        chains: ["solana"],
        risk: { stopLossPct: null, takeProfitPct: null, trailingStopPct: 20, exitScoreBelow: null, exitOnLiquidityDropPct: null },
      },
    });
    // Entry 0.0000020, peak 0.0000040, mark 0.0000027: −32% off the peak, still +35% up.
    await seedPosition({ agentId, avgCostUsd: 0.000002, peakPriceUsd: 0.000004 });

    const result = await runGuardian({ agentId, trigger: "marks" });
    expect(result.exits[0]?.reason).toBe("trailing_stop");
    expect(result.exits[0]?.rationale).toContain("from its $0.000004 peak");
    expect((await tradesFor(agentId))[0]?.exitReason).toBe("trailing_stop");
  });

  it("closes a position that outlived maxHoldHours", async () => {
    const { agentId } = await seedAgent(db, {
      config: {
        chains: ["solana"],
        risk: { stopLossPct: null, takeProfitPct: null, maxHoldHours: 6, exitScoreBelow: null, exitOnLiquidityDropPct: null },
      },
    });
    await seedPosition({ agentId, avgCostUsd: 0.0000027, openedAt: new Date(Date.now() - 30 * 3_600_000) });

    const result = await runGuardian({ agentId, trigger: "marks" });
    expect(result.exits[0]?.reason).toBe("max_hold");
    expect(result.exits[0]?.rationale).toContain("open 30.0h");
  });

  it("rescores holdings only when a score rule is armed, and exits on collapse", async () => {
    const { agentId } = await seedAgent(db, {
      config: {
        chains: ["solana"],
        // A floor of 99 makes any real score a collapse, without faking the scorer.
        risk: { stopLossPct: null, takeProfitPct: null, exitScoreBelow: 99, exitOnLiquidityDropPct: null },
      },
    });
    await seedPosition({ agentId, avgCostUsd: 0.0000027 });

    const result = await runGuardian({ agentId, trigger: "marks" });
    expect(result.rescored).toBe(1);
    expect(result.exits[0]?.reason).toBe("score_collapse");
    expect(result.exits[0]?.rationale).toContain("exit floor of 99");

    const rows = await tradesFor(agentId);
    expect(rows[0]?.exitReason).toBe("score_collapse");
    // The fresh score is frozen onto the trade, like any other fill.
    expect(rows[0]?.scoreSnapshot).not.toBeNull();
    expect(typeof rows[0]?.scoreSnapshot?.total).toBe("number");
  });

  it("exits when the pool has drained since entry", async () => {
    const { agentId } = await seedAgent(db, {
      config: {
        chains: ["solana"],
        risk: { stopLossPct: null, takeProfitPct: null, exitScoreBelow: null, exitOnLiquidityDropPct: 50 },
      },
    });
    // Entry liquidity far above anything the fixtures report → a >50% drain.
    await seedPosition({ agentId, avgCostUsd: 0.0000027, entryLiquidityUsd: 500_000_000 });

    const result = await runGuardian({ agentId, trigger: "marks" });
    expect(result.rescored).toBe(1);
    expect(result.exits[0]?.reason).toBe("liquidity_collapse");
    expect((await tradesFor(agentId))[0]?.exitReason).toBe("liquidity_collapse");
  });
});

describe("runGuardian — resilience", () => {
  it("exits every firing position and does not let a venue failure stop the rest", async () => {
    // WIF can be marked (so an exit is decided) but not quoted (so the fill fails).
    vi.spyOn(prices, "getPriceUsd").mockImplementation(async (chain, address) =>
      address === WIF ? null : realPriceUsd(chain, address),
    );
    const { agentId } = await seedAgent(db, {
      config: { chains: ["solana"], risk: { stopLossPct: 15, takeProfitPct: null, exitScoreBelow: null, exitOnLiquidityDropPct: null } },
    });
    await seedPosition({ agentId, avgCostUsd: 0.0000036 }); // BONK, fills
    await seedPosition({ agentId, tokenId: WIF_ID, amountToken: 100, avgCostUsd: WIF_PRICE * 2 }); // WIF, fails

    const result = await runGuardian({ agentId, trigger: "marks" });
    expect(result.positions).toBe(2);
    expect(result.exits).toHaveLength(2);
    expect(result.exits.filter((e) => e.status === "filled").map((e) => e.symbol)).toEqual(["BONK"]);
    const failedExit = result.exits.find((e) => e.status === "failed");
    expect(failedExit?.symbol).toBe("WIF");
    expect(failedExit?.error).toContain("No price available");

    const rows = await tradesFor(agentId);
    expect(rows).toHaveLength(2);
    const failedTrade = rows.find((r) => r.tokenId === WIF_ID);
    expect(failedTrade?.status).toBe("failed");
    expect(failedTrade?.error).toContain("No price available");
    expect(failedTrade?.origin).toBe("guardian");
    expect(failedTrade?.exitReason).toBe("stop_loss");
    // The failed sell left the position untouched — no fill, no bookkeeping change.
    const [wif] = await positionFor(agentId, WIF_ID);
    expect(Number(wif?.amountToken)).toBeCloseTo(100, 9);
    expect(wif?.openedAt).not.toBeNull();
    // Only the filled exit produced a feed post.
    const feed = await db.select().from(schema.posts).where(eq(schema.posts.agentId, agentId));
    expect(feed).toHaveLength(1);
  });

  // W7 H10 widened this from "just filled" to "just attempted": a token the venue keeps
  // refusing was being re-attempted by every overlapping pass, each writing its own row.
  it("stands down when a guardian exit for the token was just attempted", async () => {
    const { agentId } = await seedAgent(db, {
      config: { chains: ["solana"], risk: { stopLossPct: 15, takeProfitPct: null, exitScoreBelow: null, exitOnLiquidityDropPct: null } },
    });
    await seedPosition({ agentId, avgCostUsd: 0.0000036 });
    const first = await runGuardian({ agentId, trigger: "marks" });
    expect(first.exits).toHaveLength(1);

    // A residual sliver plus a second pass a moment later must not re-sell.
    await db
      .update(schema.positions)
      .set({ amountToken: "10000000.000000000000", avgCostUsd: "0.000003600000" })
      .where(and(eq(schema.positions.agentId, agentId), eq(schema.positions.tokenId, BONK_ID)));

    const second = await runGuardian({ agentId, trigger: "marks" });
    expect(second.exits).toHaveLength(0);
    expect(second.skipped[0]?.reason).toContain("attempted moments ago");
    expect(await tradesFor(agentId)).toHaveLength(1);
  });
});

/**
 * W7 H10. An exit that cannot fill retries every five minutes, forever, and until now
 * each retry wrote its own `failed` row and told nobody. One stuck token therefore
 * produced 288 rows a day, buried the real trade history, and the operator — the only
 * person who could do anything about it — never found out.
 */
describe("runGuardian — failing exits", () => {
  /** WIF can be marked (so the exit fires) but never quoted (so it always fails). */
  function breakWifQuotes(): void {
    vi.spyOn(prices, "getPriceUsd").mockImplementation(async (chain, address) =>
      address === WIF ? null : realPriceUsd(chain, address),
    );
  }

  async function seedStuckExit() {
    breakWifQuotes();
    const seeded = await seedAgent(db, {
      config: {
        chains: ["solana"],
        risk: { stopLossPct: 15, takeProfitPct: null, exitScoreBelow: null, exitOnLiquidityDropPct: null },
      },
    });
    await seedPosition({ agentId: seeded.agentId, tokenId: WIF_ID, amountToken: 100, avgCostUsd: WIF_PRICE * 2 });
    return seeded;
  }

  /** The attempt window is a minute; a real retry is five minutes later. */
  async function ageAttempts(agentId: string, minutes: number): Promise<void> {
    const shifted = new Date(Date.now() - minutes * 60_000);
    await db.update(schema.trades).set({ createdAt: shifted }).where(eq(schema.trades.agentId, agentId));
  }

  it("stands down when the back-to-back marks and tick passes both want the same exit", async () => {
    const { agentId } = await seedStuckExit();

    await runGuardian({ agentId, trigger: "marks" });
    // The cron workflow calls marks and then tick within seconds of each other. The
    // second pass must not re-attempt the exit the first one just failed.
    const second = await runGuardian({ agentId, trigger: "tick" });
    expect(second.exits).toHaveLength(0);
    expect(second.skipped[0]?.reason).toContain("attempted moments ago");
  });

  it("reuses one row per exit episode instead of writing a new one every pass", async () => {
    const { agentId } = await seedStuckExit();

    await runGuardian({ agentId, trigger: "marks" });
    const first = await tradesFor(agentId);
    expect(first).toHaveLength(1);

    // Second pass: the row is reused and the episode's start is stamped into the message.
    await ageAttempts(agentId, 5);
    await runGuardian({ agentId, trigger: "marks" });
    const [second] = await tradesFor(agentId);
    const origin = second?.error?.split("has been failing since ")[1];
    expect(origin).toBeTruthy();

    for (let pass = 0; pass < 2; pass += 1) {
      await ageAttempts(agentId, 5);
      await runGuardian({ agentId, trigger: "marks" });
    }

    const rows = await tradesFor(agentId);
    // Four passes, one row. Before H10 this was four.
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(first[0]?.id);
    expect(rows[0]?.status).toBe("failed");
    // `createdAt` tracks the latest attempt — that is what stops two overlapping passes
    // from both firing — so the episode's start survives in the message instead, and it
    // must not drift forward with every retry.
    expect(rows[0]?.createdAt.getTime()).toBeGreaterThan(Date.parse(origin as string));
    expect(rows[0]?.error).toContain(`has been failing since ${origin}`);
  });

  it("notifies the owner once per token per hour, however often it retries", async () => {
    const { agentId, userId } = await seedStuckExit();

    for (let pass = 0; pass < 4; pass += 1) {
      await ageAttempts(agentId, 5);
      await runGuardian({ agentId, trigger: "marks" });
    }

    const notes = await db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.userId, userId));
    const failures = notes.filter((n) => n.kind === "exit_failed");
    expect(failures).toHaveLength(1);
    expect(failures[0]?.title).toContain("could not sell WIF");
    expect(failures[0]?.body).toContain("Stop loss hit");
  });

  /**
   * W7 H1. The exit used to be sized as `amountUsd ÷ a fresh buy-side quote`, which is
   * the one conversion that is guaranteed to be wrong precisely when a stop loss fires:
   * the mark and the route price have just diverged. A full exit asks for the balance.
   */
  it("sends the held balance, not a USD notional converted at a moved price", async () => {
    const { agentId } = await seedAgent(db, {
      config: {
        chains: ["solana"],
        risk: { stopLossPct: 15, takeProfitPct: null, exitScoreBelow: null, exitOnLiquidityDropPct: null },
      },
    });
    await seedPosition({ agentId, amountToken: 10_000_000, avgCostUsd: 0.0000036 });

    const result = await runGuardian({ agentId, trigger: "marks" });
    expect(result.exits[0]?.status).toBe("filled");

    const [row] = await tradesFor(agentId);
    // Every held token, exactly — not `amountUsd / price` rounded to whatever the quote
    // happened to say.
    expect(Number(row?.amountToken)).toBeCloseTo(10_000_000, 6);

    // And the position is closed, with no dust row for the exit engine to keep firing on.
    const [position] = await positionFor(agentId);
    expect(Number(position?.amountToken)).toBe(0);
    expect(position?.openedAt).toBeNull();
    expect(position?.peakPriceUsd).toBeNull();
  });

  it("starts a fresh row and a fresh notification once an hour has passed", async () => {
    const { agentId, userId } = await seedStuckExit();
    await runGuardian({ agentId, trigger: "marks" });

    // Age both the attempt and the notification past the hourly ceiling.
    const longAgo = new Date(Date.now() - 2 * 60 * 60_000);
    await db.update(schema.trades).set({ createdAt: longAgo }).where(eq(schema.trades.agentId, agentId));
    await db.update(schema.notifications).set({ createdAt: longAgo }).where(eq(schema.notifications.userId, userId));

    await runGuardian({ agentId, trigger: "marks" });

    const failures = (await db.select().from(schema.notifications).where(eq(schema.notifications.userId, userId)))
      .filter((n) => n.kind === "exit_failed");
    expect(failures).toHaveLength(2);
    // Past the 24h episode window the row would also be new; inside it, still one row.
    expect(await tradesFor(agentId)).toHaveLength(1);
  });

  it("skips a live agent whose wallets are paper placeholders, without throwing", async () => {
    const { agentId } = await seedAgent(db, {
      mode: "live",
      config: { chains: ["solana"], risk: { stopLossPct: 15, takeProfitPct: null, exitScoreBelow: null, exitOnLiquidityDropPct: null } },
    });
    await seedPosition({ agentId, avgCostUsd: 0.0000036 });

    const result = await runGuardian({ agentId, trigger: "marks" });
    expect(result.ran).toBe(true);
    expect(result.exits).toHaveLength(0);
    expect(result.error).toBeNull();
    expect(result.note).toContain("placeholder");
    expect(await tradesFor(agentId)).toHaveLength(0);
  });

  it("reports a flat agent, an agent with no rules, and a missing agent", async () => {
    const flat = await seedAgent(db, { config: { chains: ["solana"] } });
    const flatResult = await runGuardian({ agentId: flat.agentId, trigger: "marks" });
    expect(flatResult.ran).toBe(true);
    expect(flatResult.note).toBe("flat — nothing to guard");
    expect(flatResult.equityUsd).toBeCloseTo(10_000, 4);

    const unarmed = await seedAgent(db, {
      config: {
        chains: ["solana"],
        risk: {
          stopLossPct: null,
          takeProfitPct: null,
          trailingStopPct: null,
          maxHoldHours: null,
          exitScoreBelow: null,
          exitOnLiquidityDropPct: null,
        },
      },
    });
    await seedPosition({ agentId: unarmed.agentId, avgCostUsd: 0.0000036 });
    const unarmedResult = await runGuardian({ agentId: unarmed.agentId, trigger: "marks" });
    expect(unarmedResult.note).toBe("no exit rules configured");
    expect(await tradesFor(unarmed.agentId)).toHaveLength(0);

    const missing = await runGuardian({ agentId: "nope", trigger: "marks" });
    expect(missing.ran).toBe(false);
    expect(missing.note).toBe("agent not found");
    expect(missing.error).toBeNull();
  });

  it("does not snapshot equity on a tick pass — the run does that at the end", async () => {
    const { agentId } = await seedAgent(db, {
      config: { chains: ["solana"], risk: { stopLossPct: 15, takeProfitPct: null, exitScoreBelow: null, exitOnLiquidityDropPct: null } },
    });
    await seedPosition({ agentId, avgCostUsd: 0.0000036 });

    const result = await runGuardian({ agentId, trigger: "tick", runId: null });
    expect(result.exits).toHaveLength(1);
    const snaps = await db.select().from(schema.equitySnapshots).where(eq(schema.equitySnapshots.agentId, agentId));
    expect(snaps).toHaveLength(0);
  });
});

describe("position bookkeeping", () => {
  it("opens, adds to and closes a position, maintaining the exit columns", async () => {
    const { agentId } = await seedAgent(db, { config: { chains: ["solana"] } });
    const open = new Date("2026-09-13T10:00:00.000Z");

    // Buy from flat: entry time, peak and the entry score snapshot are recorded.
    await applyFill(
      agentId,
      BONK_ID,
      { side: "buy", amountToken: 1_000_000, amountUsd: 3, feeUsd: 0.01 },
      { priceUsd: 0.000003, score: { total: 74.5, liquidityUsd: 310_000 }, now: open },
    );
    let [row] = await positionFor(agentId);
    expect(row?.openedAt?.toISOString()).toBe(open.toISOString());
    expect(Number(row?.peakPriceUsd)).toBeCloseTo(0.000003, 12);
    expect(Number(row?.entryScore)).toBeCloseTo(74.5, 2);
    expect(Number(row?.entryLiquidityUsd)).toBeCloseTo(310_000, 2);

    // Adding keeps openedAt and ratchets the peak; a cheaper add does not lower it.
    const later = new Date(open.getTime() + 2 * 3_600_000);
    await applyFill(
      agentId,
      BONK_ID,
      { side: "buy", amountToken: 1_000_000, amountUsd: 5, feeUsd: 0.01 },
      { priceUsd: 0.000005, score: { total: 20, liquidityUsd: 1 }, now: later },
    );
    [row] = await positionFor(agentId);
    expect(row?.openedAt?.toISOString()).toBe(open.toISOString());
    expect(Number(row?.peakPriceUsd)).toBeCloseTo(0.000005, 12);
    expect(Number(row?.entryScore)).toBeCloseTo(74.5, 2); // never overwritten
    expect(Number(row?.amountToken)).toBeCloseTo(2_000_000, 6);

    await applyFill(
      agentId,
      BONK_ID,
      { side: "buy", amountToken: 1_000_000, amountUsd: 2, feeUsd: 0.01 },
      { priceUsd: 0.000002, now: later },
    );
    [row] = await positionFor(agentId);
    expect(Number(row?.peakPriceUsd)).toBeCloseTo(0.000005, 12);

    // A partial sell keeps the bookkeeping.
    await applyFill(
      agentId,
      BONK_ID,
      { side: "sell", amountToken: 1_000_000, amountUsd: 4, feeUsd: 0.01 },
      { priceUsd: 0.000004, now: later },
    );
    [row] = await positionFor(agentId);
    expect(row?.openedAt?.toISOString()).toBe(open.toISOString());
    expect(Number(row?.entryScore)).toBeCloseTo(74.5, 2);

    // The full close resets everything, so the next entry starts clean.
    await applyFill(
      agentId,
      BONK_ID,
      { side: "sell", amountToken: 2_000_000, amountUsd: 8, feeUsd: 0.01 },
      { priceUsd: 0.000004, now: later },
    );
    [row] = await positionFor(agentId);
    expect(Number(row?.amountToken)).toBeCloseTo(0, 9);
    expect(row?.openedAt).toBeNull();
    expect(row?.peakPriceUsd).toBeNull();
    expect(row?.entryScore).toBeNull();
    expect(row?.entryLiquidityUsd).toBeNull();
  });

  it("derives the fill price when the caller passes no metadata", async () => {
    const { agentId } = await seedAgent(db, { config: { chains: ["solana"] } });
    await applyFill(agentId, BONK_ID, { side: "buy", amountToken: 1_000_000, amountUsd: 4, feeUsd: 0 });
    const [row] = await positionFor(agentId);
    expect(Number(row?.peakPriceUsd)).toBeCloseTo(0.000004, 12);
    expect(row?.openedAt).not.toBeNull();
    expect(row?.entryScore).toBeNull();
  });

  it("updatePeaks only ever raises the peak", async () => {
    const { agentId } = await seedAgent(db, { config: { chains: ["solana"] } });
    await seedPosition({ agentId, avgCostUsd: 0.000003, peakPriceUsd: 0.000004 });

    const lower = await updatePeaks(agentId, new Map([[BONK_ID, 0.000001]]));
    expect(lower.get(BONK_ID)).toBeCloseTo(0.000004, 12);
    let [row] = await positionFor(agentId);
    expect(Number(row?.peakPriceUsd)).toBeCloseTo(0.000004, 12);

    const higher = await updatePeaks(agentId, new Map([[BONK_ID, 0.000009]]));
    expect(higher.get(BONK_ID)).toBeCloseTo(0.000009, 12);
    [row] = await positionFor(agentId);
    expect(Number(row?.peakPriceUsd)).toBeCloseTo(0.000009, 12);

    // An unpriceable mark leaves the stored peak alone.
    await updatePeaks(agentId, new Map([[BONK_ID, null]]));
    [row] = await positionFor(agentId);
    expect(Number(row?.peakPriceUsd)).toBeCloseTo(0.000009, 12);
  });

  it("sets a peak on a position that never had one", async () => {
    const { agentId } = await seedAgent(db, { config: { chains: ["solana"] } });
    await seedPosition({ agentId, avgCostUsd: 0.000003, peakPriceUsd: null });
    await updatePeaks(agentId, new Map([[BONK_ID, 0.0000027]]));
    const [row] = await positionFor(agentId);
    expect(Number(row?.peakPriceUsd)).toBeCloseTo(0.0000027, 12);
  });
});

