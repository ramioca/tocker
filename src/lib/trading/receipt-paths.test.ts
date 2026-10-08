/**
 * Receipts, end to end: a fill on any path writes one, and it says the right things.
 *
 * The pure shape is covered in `./receipt.test.ts`. What this file proves is the part a
 * unit test cannot — that the *wiring* is there, on every path that can move money:
 * the agent's own `place_trade`, an owner-approved proposal, and a guardian exit. A
 * receipt that exists for two of the three is worse than none, because the gap only
 * shows up on the day you go looking for the trade that went wrong.
 *
 * Hermetic: in-memory PGlite, `LLM_MOCK=1`, stubbed `fetch`.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import type { Db } from "@/db";
import * as schema from "@/db/schema";
import { runAgent } from "@/lib/agent/run";
import { seedAgent, setupTestDb } from "@/lib/agent/test-support";
import { feeForFill, platformFeeBps } from "@/lib/platform/fee";
import { seedKnownTokens, tokenId } from "@/lib/trading/tokens";
import { toNumeric } from "@/lib/money";
import type { Session } from "@/server/types";
import type { TradeExecutor, TradeRequest } from "./executor";
import { runGuardian } from "./guardian";
import { PaperExecutor } from "./paper";
import { decideProposal } from "./proposals";
import { SIMULATED_TX, getReceipt } from "./receipt";

/**
 * The venue an order goes to. Null, which is every test unless it says otherwise, is the
 * real `getExecutor`: the paper simulator.
 */
const venue = vi.hoisted(() => ({ override: null as TradeExecutor | null }));
vi.mock("@/lib/trading/executor", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/trading/executor")>();
  return {
    ...actual,
    getExecutor: async (...args: Parameters<typeof actual.getExecutor>) => venue.override ?? actual.getExecutor(...args),
  };
});

/**
 * The fourth path is a server action, so it needs a session and `next/cache`. Nothing
 * else in this file touches either, and everything below the action — scoring, the risk
 * guard, the executor, the fee ledger — is the real code against in-memory PGlite.
 */
let session: Session | null = null;
vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));
vi.mock("@/lib/auth", () => ({
  getSession: async () => session,
  requireSession: async () => session,
}));
const { placeManualTrade } = await import("@/server/actions/trading");

/**
 * The fee a fill of this size is charged. The rate is read from the same place the
 * runtime reads it, so a changed default cannot lie here; the size is each receipt's
 * own, because the fee is a share of what that fill moved.
 */
const feeOn = (fillUsd: number): number => feeForFill(fillUsd, platformFeeBps());

let db: Db;

const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const BONK_ID = `solana:${BONK}`;

beforeAll(async () => {
  process.env.X402_MOCK = "1";
  process.env.LLM_MOCK = "1";
  db = await setupTestDb();
  await seedKnownTokens();
}, 120_000);

function stubPricing(pricePerToken = 0.0000027): void {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/ultra/v1/order")) {
      const amount = Number(new URL(url).searchParams.get("amount"));
      const out = (amount / 1e6 / pricePerToken) * 10 ** 5; // BONK has 5 decimals
      return new Response(
        JSON.stringify({
          requestId: "req",
          transaction: null,
          inAmount: String(amount),
          outAmount: String(Math.round(out)),
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (url.includes("api.jup.ag/price/v3")) {
      return new Response(JSON.stringify({ [BONK]: { usdPrice: pricePerToken } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}

beforeEach(() => {
  stubPricing();
  session = null;
  venue.override = null;
});

describe("receipts are written on every execution path", () => {
  it("the agent's own trade gets one, and it says the fill was simulated", async () => {
    const { agentId, userId } = await seedAgent(db, { config: { chains: ["solana"] } });
    const result = await runAgent({ agentId, trigger: "manual" });
    expect(result.status).toBe("succeeded");

    const [trade] = await db
      .select()
      .from(schema.trades)
      .where(and(eq(schema.trades.agentId, agentId), eq(schema.trades.status, "filled")));
    expect(trade).toBeDefined();

    const receipt = await getReceipt(trade!.id);
    expect(receipt).not.toBeNull();
    expect(receipt!.venue).toBe("paper");
    expect(receipt!.venueLabel).toBe("Paper simulator");
    expect(receipt!.simulated).toBe(true);
    expect(receipt!.txHash).toBe(SIMULATED_TX);
    expect(receipt!.explorerUrl).toBeNull();
    expect(receipt!.symbol).toBe("BONK");
    expect(receipt!.quotedPriceUsd).toBeGreaterThan(0);
    expect(receipt!.filledPriceUsd).toBeGreaterThan(0);
    // The paper simulator fills at its own quote, so there is nothing to slip against.
    expect(receipt!.slippageBps).toBe(0);
    expect(receipt!.slippageToleranceBps).toBe(300);
    expect(receipt!.venueFeeUsd).toBeGreaterThan(0);
    // The platform's cut is on the document, and inside the total: the rate times what
    // this fill moved, which is also what the trade row says it moved.
    expect(receipt!.platformFeeUsd).toBeGreaterThan(0);
    expect(receipt!.platformFeeUsd).toBe(feeOn(receipt!.amountUsd));
    expect(receipt!.platformFeeUsd).toBe(feeOn(Number(trade!.amountUsd)));
    expect(receipt!.totalFeeUsd).toBeCloseTo(receipt!.venueFeeUsd + feeOn(receipt!.amountUsd), 6);

    // One ledger row per fill, for a paper agent settled on the spot, and it holds the
    // figure the receipt shows.
    const fees = await db.select().from(schema.platformFees).where(eq(schema.platformFees.tradeId, trade!.id));
    expect(fees).toHaveLength(1);
    expect(Number(fees[0]?.amountUsd)).toBe(receipt!.platformFeeUsd);
    expect(fees[0]?.status).toBe("settled");
    expect(fees[0]?.txHash).toBe("simulated");

    // The row carries the queryable columns too, not just the blob.
    const [row] = await db.select().from(schema.tradeReceipts).where(eq(schema.tradeReceipts.tradeId, trade!.id));
    expect(row?.agentId).toBe(agentId);
    expect(row?.simulated).toBe(true);
    expect(row?.txHash).toBeNull();

    // And the owner is told, with the execution line on the notification.
    const fills = await db
      .select()
      .from(schema.notifications)
      .where(and(eq(schema.notifications.userId, userId), eq(schema.notifications.kind, "fill")));
    expect(fills).toHaveLength(1);
    expect(fills[0]?.body).toContain("Simulated fill");
    expect(fills[0]?.href).toContain(`?trade=${trade!.id}`);
  });

  it("an approved proposal gets one, quoted at approval rather than at proposal time", async () => {
    const { agentId } = await seedAgent(db, {
      config: { chains: ["solana"], execution: { mode: "approve", proposalTtlMinutes: 60 } },
    });
    await runAgent({ agentId, trigger: "manual" });

    const [proposal] = await db
      .select()
      .from(schema.trades)
      .where(and(eq(schema.trades.agentId, agentId), eq(schema.trades.status, "proposed")));
    expect(proposal).toBeDefined();
    expect(await getReceipt(proposal!.id)).toBeNull(); // a proposal is not a fill

    const [agent] = await db.select().from(schema.agents).where(eq(schema.agents.id, agentId));
    const decision = await decideProposal({
      tradeId: proposal!.id,
      ownerId: agent!.ownerId,
      decision: "approve",
    });
    expect(decision.ok).toBe(true);

    const receipt = await getReceipt(proposal!.id);
    expect(receipt).not.toBeNull();
    expect(receipt!.side).toBe("buy");
    expect(receipt!.symbol).toBe("BONK");
    expect(receipt!.filledPriceUsd).toBeGreaterThan(0);
    expect(receipt!.platformFeeUsd).toBeGreaterThan(0);
    expect(receipt!.platformFeeUsd).toBe(feeOn(receipt!.amountUsd));
    const approvedFees = await db.select().from(schema.platformFees).where(eq(schema.platformFees.tradeId, proposal!.id));
    expect(approvedFees).toHaveLength(1);
    expect(Number(approvedFees[0]?.amountUsd)).toBe(receipt!.platformFeeUsd);
    expect(new Date(receipt!.filledAt).getTime()).toBeGreaterThanOrEqual(new Date(receipt!.quotedAt).getTime());
  });

  it("a guardian exit gets one, and its rule appears on the owner's notification", async () => {
    const { agentId, userId } = await seedAgent(db, {
      config: {
        chains: ["solana"],
        risk: { stopLossPct: 15, takeProfitPct: null, exitScoreBelow: null, exitOnLiquidityDropPct: null },
      },
    });
    // Entered well above the current mark: the stop is already broken.
    await db.insert(schema.positions).values({
      agentId,
      tokenId: tokenId("solana", BONK),
      amountToken: toNumeric(50_000_000, 12),
      avgCostUsd: toNumeric(0.0000045, 12),
      realizedPnlUsd: "0",
      openedAt: new Date(Date.now() - 3_600_000),
      peakPriceUsd: toNumeric(0.0000045, 12),
    });

    const result = await runGuardian({ agentId, trigger: "marks" });
    expect(result.exits).toHaveLength(1);
    const exit = result.exits[0]!;
    expect(exit.status).toBe("filled");
    expect(exit.reason).toBe("stop_loss");

    const receipt = await getReceipt(exit.tradeId!);
    expect(receipt).not.toBeNull();
    expect(receipt!.side).toBe("sell");
    expect(receipt!.venue).toBe("paper");
    expect(receipt!.amountUsd).toBeGreaterThan(0);
    // A guardian exit pays the fee like any other fill — selling is not free either. It
    // is a share of what the sale brought in, booked after the sale, in one ledger row.
    expect(receipt!.platformFeeUsd).toBeGreaterThan(0);
    expect(receipt!.platformFeeUsd).toBe(feeOn(receipt!.amountUsd));
    const exitFees = await db.select().from(schema.platformFees).where(eq(schema.platformFees.tradeId, exit.tradeId!));
    expect(exitFees).toHaveLength(1);
    expect(Number(exitFees[0]?.amountUsd)).toBe(receipt!.platformFeeUsd);
    const [sold] = await db.select().from(schema.trades).where(eq(schema.trades.id, exit.tradeId!));
    expect(receipt!.platformFeeUsd).toBe(feeOn(Number(sold!.amountUsd)));

    // One owner notification: the rule in its body, and the trade in its href, which is
    // how the notifications page finds this receipt and shows it under the rule.
    const owner = await db
      .select()
      .from(schema.notifications)
      .where(and(eq(schema.notifications.userId, userId), eq(schema.notifications.kind, "exit")));
    expect(owner).toHaveLength(1);
    expect(owner[0]?.title).toContain("stop loss hit");
    expect(owner[0]?.body).toContain("15% stop");
    expect(owner[0]?.href).toContain(`?trade=${exit.tradeId}`);
  });

  it("a manual trade gets one, and the owner's own hands pay the same fee", async () => {
    const { agentId, userId } = await seedAgent(db, { config: { chains: ["solana"] } });
    session = { userId, handle: "owner", displayName: null, avatarUrl: null, email: null };

    const result = await placeManualTrade({
      agentId,
      chain: "solana",
      side: "buy",
      tokenAddress: BONK,
      amountUsd: 30,
      note: "Taking this one myself.",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const receipt = await getReceipt(result.data.tradeId);
    expect(receipt).not.toBeNull();
    expect(receipt!.side).toBe("buy");
    // 0.5% of the $30 that filled.
    expect(receipt!.amountUsd).toBeCloseTo(30, 6);
    expect(receipt!.platformFeeUsd).toBe(feeOn(receipt!.amountUsd));
    expect(receipt!.platformFeeUsd).toBe(0.15);
    expect(receipt!.totalFeeUsd).toBeCloseTo(receipt!.venueFeeUsd + 0.15, 6);
    // The receipt the sheet renders is the one that was stored, fee included.
    expect(result.data.receipt.platformFeeUsd).toBe(0.15);

    const fees = await db.select().from(schema.platformFees).where(eq(schema.platformFees.agentId, agentId));
    expect(fees).toHaveLength(1);
    expect(fees[0]?.tradeId).toBe(result.data.tradeId);
    expect(fees[0]?.amountUsd).toBe("0.150000");
  });

  it("never carries anything from the strategy onto a public document", async () => {
    const { agentId } = await seedAgent(db, {
      config: {
        chains: ["solana"],
        strategyPrompt:
          "SECRET EDGE: buy every launch whose organic buyer ratio beats 0.42 within nine minutes of the first pool.",
        universe: { ...(await import("@/lib/agent/config")).DEFAULT_AGENT_CONFIG.universe, minScore: 51 },
      },
    });
    await runAgent({ agentId, trigger: "manual" });

    const rows = await db.select().from(schema.tradeReceipts).where(eq(schema.tradeReceipts.agentId, agentId));
    expect(rows.length).toBeGreaterThan(0);
    const serialised = JSON.stringify(rows.map((r) => r.data));
    expect(serialised).not.toContain("SECRET EDGE");
    expect(serialised).not.toContain("minScore");
    expect(serialised).not.toContain("dataSources");
    expect(serialised).not.toContain("blocklist");

    // Stronger than substring-hunting: the receipt's key set is closed. Anything a
    // future edit adds has to be added to this list deliberately, in a diff that shows
    // someone the question "is this public?".
    const ALLOWED = new Set([
      "chain", "side", "venue", "venueLabel", "simulated", "txHash", "explorerUrl",
      "symbol", "tokenAddress", "quotedPriceUsd", "filledPriceUsd", "slippageBps",
      "slippageToleranceBps", "amountToken", "amountUsd", "networkFeeUsd", "venueFeeUsd",
      "totalFeeUsd", "scoreTotal", "scoreVerdict", "scoreReasons", "quotedAt", "filledAt",
      "latencyMs",
      // W5: the flat Tocker fee charged on this fill. Added deliberately — it is a fact
      // about what the platform took from this trade, which is exactly as public as the
      // venue's fee and says nothing about the strategy that placed it.
      "platformFeeUsd",
    ]);
    for (const row of rows) {
      for (const key of Object.keys(row.data)) expect(ALLOWED.has(key)).toBe(true);
      // Score reasons are component names and numbers. Nothing else.
      for (const reason of row.data.scoreReasons) {
        expect(Object.keys(reason).sort()).toEqual(["key", "label", "value"]);
      }
    }
  });
});

/**
 * The simulator fills exactly what it is asked for, so on it a fee worked out on the
 * request is the same number as a fee worked out on the fill. A real venue is not so
 * obliging: a stop loss sized from the mark sells into a thinner pool, and a buy can
 * fill short. Here every fill is a share of its quote, and the fee has to follow it.
 */
describe("the fee is a share of what filled, not of what was asked for", () => {
  const FILLED_SHARE = 0.925;

  /** The simulator, filling 92.5% of each quote. Returns the requests it executed. */
  function shortFills(): { executed: TradeRequest[] } {
    const paper = new PaperExecutor();
    const executed: TradeRequest[] = [];
    venue.override = {
      venue: paper.venue,
      isPaper: paper.isPaper,
      quote: (request) => paper.quote(request),
      execute: async (quote) => {
        executed.push(quote.request);
        const fill = await paper.execute(quote);
        const short = { amountUsd: fill.amountUsd * FILLED_SHARE, feeUsd: fill.feeUsd * FILLED_SHARE };
        // A sell brings in fewer dollars for the same tokens; a buy spends fewer dollars.
        return quote.request.side === "sell"
          ? { ...fill, ...short, priceUsd: fill.priceUsd * FILLED_SHARE }
          : { ...fill, ...short, amountToken: fill.amountToken * FILLED_SHARE };
      },
    };
    return { executed };
  }

  /** The one fee row of a trade, checked against the trade's own filled size. */
  async function feeOnTheFill(tradeId: string, asked: TradeRequest | undefined): Promise<string> {
    expect(asked).toBeDefined();
    const [trade] = await db.select().from(schema.trades).where(eq(schema.trades.id, tradeId));
    expect(trade?.status).toBe("filled");
    const filledUsd = Number(trade!.amountUsd);
    expect(filledUsd).toBeCloseTo(asked!.amountUsd * FILLED_SHARE, 4);

    const fees = await db.select().from(schema.platformFees).where(eq(schema.platformFees.tradeId, tradeId));
    expect(fees).toHaveLength(1);
    expect(fees[0]!.amountUsd).toBe(toNumeric(feeOn(filledUsd), 6));
    // The size asked for would have been charged more.
    expect(fees[0]!.amountUsd).not.toBe(toNumeric(feeOn(asked!.amountUsd), 6));
    expect((await getReceipt(tradeId))?.platformFeeUsd).toBe(feeOn(filledUsd));
    return fees[0]!.amountUsd;
  }

  it("on the agent's own trade", async () => {
    const { agentId } = await seedAgent(db, { config: { chains: ["solana"] } });
    const { executed } = shortFills();

    const result = await runAgent({ agentId, trigger: "manual" });
    expect(result.status).toBe("succeeded");

    const filled = await db
      .select()
      .from(schema.trades)
      .where(and(eq(schema.trades.agentId, agentId), eq(schema.trades.status, "filled")));
    expect(filled).toHaveLength(1);
    expect(executed).toHaveLength(1);
    await feeOnTheFill(filled[0]!.id, executed[0]);
  });

  it("on an approved proposal", async () => {
    const { agentId } = await seedAgent(db, {
      config: { chains: ["solana"], execution: { mode: "approve", proposalTtlMinutes: 60 } },
    });
    await runAgent({ agentId, trigger: "manual" });
    const [proposal] = await db
      .select()
      .from(schema.trades)
      .where(and(eq(schema.trades.agentId, agentId), eq(schema.trades.status, "proposed")));
    expect(proposal).toBeDefined();
    const [agent] = await db.select().from(schema.agents).where(eq(schema.agents.id, agentId));

    const { executed } = shortFills();
    const decision = await decideProposal({ tradeId: proposal!.id, ownerId: agent!.ownerId, decision: "approve" });
    expect(decision.ok).toBe(true);

    expect(executed).toHaveLength(1);
    await feeOnTheFill(proposal!.id, executed[0]);
  });

  it("on a guardian exit, which is sized from the mark and paid what the pool pays", async () => {
    const { agentId } = await seedAgent(db, {
      config: {
        chains: ["solana"],
        risk: { stopLossPct: 15, takeProfitPct: null, exitScoreBelow: null, exitOnLiquidityDropPct: null },
      },
    });
    // 50M BONK at $0.0000027 is $135 at the mark, entered well above it.
    await db.insert(schema.positions).values({
      agentId,
      tokenId: tokenId("solana", BONK),
      amountToken: toNumeric(50_000_000, 12),
      avgCostUsd: toNumeric(0.0000045, 12),
      realizedPnlUsd: "0",
      openedAt: new Date(Date.now() - 3_600_000),
      peakPriceUsd: toNumeric(0.0000045, 12),
    });
    const { executed } = shortFills();

    const result = await runGuardian({ agentId, trigger: "marks" });
    expect(result.exits).toHaveLength(1);
    expect(result.exits[0]!.status).toBe("filled");

    expect(executed).toHaveLength(1);
    expect(executed[0]!.amountUsd).toBeCloseTo(135, 6);
    // The sale brought in $124.875, and 0.5% of that is charged: not the $0.675 that
    // 0.5% of the $135 it was sized at would be.
    expect(await feeOnTheFill(result.exits[0]!.tradeId!, executed[0])).toBe("0.624375");
  });
});

describe("receipts on the token page query", () => {
  it("are keyed by trade id and simply absent for trades that have none", async () => {
    const { agentId } = await seedAgent(db, { config: { chains: ["solana"] } });
    await runAgent({ agentId, trigger: "manual" });
    const filled = await db
      .select()
      .from(schema.trades)
      .where(and(eq(schema.trades.agentId, agentId), eq(schema.trades.status, "filled")));
    expect(filled.length).toBeGreaterThan(0);

    const { getReceipts } = await import("./receipt");
    const map = await getReceipts([...filled.map((t) => t.id), "a-trade-that-never-existed"]);
    expect(map.size).toBe(filled.length);
    expect(map.has("a-trade-that-never-existed")).toBe(false);
    expect(map.get(filled[0]!.id)?.tokenAddress).toBe(BONK);
    expect(BONK_ID).toBe(tokenId("solana", BONK));
  });
});
