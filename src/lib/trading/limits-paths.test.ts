/**
 * The position limit and the cash reserve on every path an order can take that is not the
 * model's own `place_trade` (that one is in `src/lib/agent/tools-limits.test.ts`): a buy or
 * sell the owner places by hand, a proposal the owner approves, and an exit the guardian
 * takes.
 *
 * Two things are held. A buy is refused on each path, in the owner's words. And a sell is
 * never refused, shrunk or delayed on any of them, with the agent at its limit and a
 * reserve larger than everything it owns.
 *
 * The database, the scoring, the risk guard and the paper executor are the real code on
 * PGlite. `getSession` and `next/cache` are stand-ins because one path is a server action.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { Db } from "@/db";
import * as schema from "@/db/schema";
import { seedAgent, setupTestDb, type SeedConfigOverrides } from "@/lib/agent/test-support";
import { toNumeric } from "@/lib/money";
import { resetTokenCaches } from "@/lib/tokens";
import type { Session } from "@/server/types";
import { resetPriceCache } from "./prices";
import { seedKnownTokens, tokenId, USDC_SOLANA } from "./tokens";

let session: Session | null = null;

vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));
vi.mock("@/lib/auth", () => ({
  getSession: async () => session,
  requireSession: async () => session,
}));

const { placeManualTrade, previewTrade } = await import("@/server/actions/trading");
const { decideProposal } = await import("./proposals");
const { listProposals } = await import("@/server/queries/proposals");
const { runGuardian } = await import("./guardian");
const { BUY_IN_FLIGHT_MS, getPortfolio, toRiskPortfolio } = await import("@/lib/agent/portfolio");

const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const BONK_ID = tokenId("solana", BONK);
const WIF = "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm";
const WIF_ID = tokenId("solana", WIF);
const USDC_ID = tokenId("solana", USDC_SOLANA);
const BONK_PRICE = 0.0000027;

/** At its limit of one position, with a reserve larger than everything it owns. */
const LOCKED = { maxOpenPositions: 1, cashReserveUsd: 1_000_000 };

let db: Db;

beforeAll(async () => {
  process.env.X402_MOCK = "1";
  db = await setupTestDb();
  await seedKnownTokens();
  await db.insert(schema.tokens).values({ id: WIF_ID, chain: "solana", address: WIF, symbol: "WIF", decimals: 6 }).onConflictDoNothing();
}, 120_000);

beforeEach(async () => {
  vi.stubEnv("PLATFORM_FEE_BPS", "50");
  resetPriceCache();
  await resetTokenCaches();
  session = null;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
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
      return new Response(JSON.stringify({ [BONK]: { usdPrice: BONK_PRICE } }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
});

function asOwner(userId: string): void {
  session = { userId, handle: "owner", displayName: null, avatarUrl: null, email: null };
}

async function agentWith(config: SeedConfigOverrides = {}, paperStartingUsd = "10000") {
  const seeded = await seedAgent(db, { config: { chains: ["solana"], dataSources: [], ...config }, paperStartingUsd });
  asOwner(seeded.userId);
  return seeded;
}

/** Changes an agent's risk settings after the fact, as a save from its settings page does. */
async function setRisk(agentId: string, risk: Partial<schema.AgentConfig["risk"]>): Promise<void> {
  const [agent] = await db.select().from(schema.agents).where(eq(schema.agents.id, agentId));
  await db
    .update(schema.agents)
    .set({ config: { ...agent!.config, risk: { ...agent!.config.risk, ...risk } } })
    .where(eq(schema.agents.id, agentId));
}

/** A position the agent already holds, worth `usd` at the stubbed BONK price. */
async function holdBonk(agentId: string, usd: number, avgCostUsd = BONK_PRICE): Promise<void> {
  await db.insert(schema.positions).values({
    agentId,
    tokenId: BONK_ID,
    amountToken: toNumeric(usd / BONK_PRICE, 12),
    avgCostUsd: toNumeric(avgCostUsd, 12),
    realizedPnlUsd: "0",
    openedAt: new Date(Date.now() - 3 * 3_600_000),
    peakPriceUsd: toNumeric(avgCostUsd, 12),
  });
}

async function proposal(
  agent: { agentId: string; userId: string },
  input: { side: "buy" | "sell"; token: string; usd: number },
): Promise<string> {
  const id = nanoid();
  await db.insert(schema.trades).values({
    id,
    agentId: agent.agentId,
    ownerId: agent.userId,
    chain: "solana",
    side: input.side,
    tokenId: input.token,
    quoteTokenId: USDC_ID,
    amountToken: toNumeric(0, 12),
    amountUsd: toNumeric(input.usd, 6),
    requestedUsd: toNumeric(input.usd, 6),
    priceUsd: toNumeric(BONK_PRICE, 12),
    feeUsd: toNumeric(0, 6),
    status: "proposed",
    origin: "agent",
    proposedAt: new Date(),
    isPaper: true,
    rationale: "Scored 84/100 with organic volume leading; a starter position.",
  });
  return id;
}

const heldBonk = async (agentId: string) =>
  Number(
    (await db.select().from(schema.positions).where(and(eq(schema.positions.agentId, agentId), eq(schema.positions.tokenId, BONK_ID))))[0]
      ?.amountToken ?? 0,
  );

describe("a buy the owner places by hand", () => {
  it("is refused at the position limit, in the owner's words, before anything is written", async () => {
    const { agentId } = await agentWith({ risk: { maxOpenPositions: 1 } });
    await db.insert(schema.positions).values({ agentId, tokenId: WIF_ID, amountToken: "40", avgCostUsd: "0.5", openedAt: new Date() });

    const refused = await placeManualTrade({ agentId, chain: "solana", side: "buy", tokenAddress: BONK, amountUsd: 25 });
    expect(refused).toEqual({
      ok: false,
      error: "This agent may hold at most 1 position and holds 1. Sell one first, or raise Max open positions in Settings.",
    });
    expect(await db.select().from(schema.trades).where(eq(schema.trades.agentId, agentId))).toHaveLength(0);
    // The preview says the same before the button is pressed.
    const preview = await previewTrade({ agentId, chain: "solana", side: "buy", tokenAddress: BONK, amountUsd: 25 });
    expect(preview.ok && preview.data.allowed).toBe(false);
  });

  it("is refused when it would go into the cash reserve, and filled when it leaves it", async () => {
    const { agentId } = await agentWith({ risk: { cashReserveUsd: 5, maxPositionPct: 100 } }, "30");
    const refused = await placeManualTrade({ agentId, chain: "solana", side: "buy", tokenAddress: BONK, amountUsd: 26 });
    expect(refused).toEqual({
      ok: false,
      error: "This buy would leave $3.87 in cash; the agent keeps $5.00 in reserve. The most you can buy is $24.87.",
    });
    const filled = await placeManualTrade({ agentId, chain: "solana", side: "buy", tokenAddress: BONK, amountUsd: 24.87 });
    expect(filled.ok).toBe(true);
  });
});

describe("a sell is never refused, shrunk or delayed by either limit", () => {
  it("by hand: the whole position sells at the limit, under a reserve larger than the book", async () => {
    const { agentId } = await agentWith({ risk: LOCKED });
    await holdBonk(agentId, 40);
    const held = await heldBonk(agentId);

    const part = await placeManualTrade({ agentId, chain: "solana", side: "sell", tokenAddress: BONK, amountUsd: 10 });
    expect(part.ok).toBe(true);
    if (!part.ok) return;
    // The size that was asked for is the size that sold.
    expect(part.data.amountToken).toBeCloseTo(held / 4, 0);

    const rest = await placeManualTrade({ agentId, chain: "solana", side: "sell", tokenAddress: BONK, amountUsd: 30, sellAll: true });
    expect(rest.ok).toBe(true);
    expect(await heldBonk(agentId)).toBe(0);
    const rows = await db.select().from(schema.trades).where(eq(schema.trades.agentId, agentId));
    expect(rows.map((row) => `${row.side} ${row.status}`)).toEqual(["sell filled", "sell filled"]);
  });

  it("approved: a proposed sell fills at the limit, under the same reserve", async () => {
    const agent = await agentWith({ execution: { mode: "approve", proposalTtlMinutes: 60 }, risk: LOCKED });
    await holdBonk(agent.agentId, 40);
    const tradeId = await proposal(agent, { side: "sell", token: BONK_ID, usd: 40 });

    // The card offers Approve, and the approval fills.
    const [card] = await listProposals(agent.agentId, agent.userId);
    expect(card?.stillValid).toBe(true);
    const decision = await decideProposal({ tradeId, ownerId: agent.userId, decision: "approve" });
    expect(decision).toMatchObject({ ok: true, status: "filled", side: "sell" });
    expect(await heldBonk(agent.agentId)).toBe(0);
  });

  it("the guardian: a stop loss fires and fills at the limit, under the same reserve", async () => {
    const { agentId } = await agentWith({
      risk: { ...LOCKED, stopLossPct: 15, takeProfitPct: null, exitScoreBelow: null, exitOnLiquidityDropPct: null },
    });
    // Entry at 0.0000036, mark 0.0000027: 25% down, through a 15% stop.
    await holdBonk(agentId, 27, 0.0000036);

    const result = await runGuardian({ agentId, trigger: "marks" });
    expect(result.exits).toHaveLength(1);
    expect(result.skipped).toHaveLength(0);
    expect(result.exits[0]).toMatchObject({ status: "filled", reason: "stop_loss" });
    // All of it, not a part of it.
    expect(await heldBonk(agentId)).toBe(0);
    const [trade] = await db.select().from(schema.trades).where(eq(schema.trades.agentId, agentId));
    expect(trade).toMatchObject({ side: "sell", status: "filled", origin: "guardian" });
  });

  it("the guardian exits the same position the same way with neither limit set", async () => {
    const plain = { stopLossPct: 15, takeProfitPct: null, exitScoreBelow: null, exitOnLiquidityDropPct: null };
    const outcomes: Array<{ status: string; amountUsd: number }> = [];
    for (const risk of [plain, { ...plain, ...LOCKED }]) {
      const { agentId } = await agentWith({ risk });
      await holdBonk(agentId, 27, 0.0000036);
      const result = await runGuardian({ agentId, trigger: "marks" });
      outcomes.push({ status: result.exits[0]?.status ?? "none", amountUsd: Number(result.exits[0]?.amountUsd.toFixed(6)) });
    }
    expect(outcomes[1]).toEqual(outcomes[0]);
    expect(outcomes[0]?.status).toBe("filled");
  });
});

describe("a proposal the owner approves", () => {
  it("is refused when a reserve set since would be broken, in the owner's words", async () => {
    const agent = await agentWith({ execution: { mode: "approve", proposalTtlMinutes: 60 }, risk: { maxPositionPct: 100 } }, "60");
    const tradeId = await proposal(agent, { side: "buy", token: BONK_ID, usd: 50 });
    // Valid when it was made. Then the owner sets a $20 reserve.
    expect((await listProposals(agent.agentId, agent.userId))[0]?.stillValid).toBe(true);
    await setRisk(agent.agentId, { cashReserveUsd: 20 });

    const [card] = await listProposals(agent.agentId, agent.userId);
    expect(card?.stillValid).toBe(false);
    expect(card?.invalidReason).toBe("This buy would leave $9.75 in cash; the agent keeps $20.00 in reserve. The most you can buy is $39.80.");

    const decision = await decideProposal({ tradeId, ownerId: agent.userId, decision: "approve" });
    expect(decision).toEqual({
      ok: false,
      error: "No longer allowed: This buy would leave $9.75 in cash; the agent keeps $20.00 in reserve. The most you can buy is $39.80.",
      status: "rejected",
    });
    const [row] = await db.select().from(schema.trades).where(eq(schema.trades.id, tradeId));
    expect(row).toMatchObject({ status: "rejected", decidedBy: "guard" });
    expect(await heldBonk(agent.agentId)).toBe(0);
  });

  it("is judged on what is held: another proposal still waiting does not turn it down, and the limit holds after it fills", async () => {
    // Two proposals were made under a higher limit, which the owner then lowered to one.
    const agent = await agentWith({ execution: { mode: "approve", proposalTtlMinutes: 60 }, risk: { maxPositionPct: 100 } });
    const first = await proposal(agent, { side: "buy", token: BONK_ID, usd: 20 });
    const second = await proposal(agent, { side: "buy", token: WIF_ID, usd: 20 });
    await setRisk(agent.agentId, { maxOpenPositions: 1 });

    // Each card alone could still be approved.
    const cards = await listProposals(agent.agentId, agent.userId);
    expect(cards.find((card) => card.id === first)?.stillValid).toBe(true);

    expect(await decideProposal({ tradeId: first, ownerId: agent.userId, decision: "approve" })).toMatchObject({ ok: true, status: "filled" });
    expect(await heldBonk(agent.agentId)).toBeGreaterThan(0);

    // One is held now, which is the limit: the other is refused, and says so.
    const after = await listProposals(agent.agentId, agent.userId);
    expect(after.find((card) => card.id === second)).toMatchObject({
      stillValid: false,
      invalidReason: "This agent may hold at most 1 position and holds 1. Sell one first, or raise Max open positions in Settings.",
    });
    expect(await decideProposal({ tradeId: second, ownerId: agent.userId, decision: "approve" })).toEqual({
      ok: false,
      error:
        "No longer allowed: This agent may hold at most 1 position and holds 1. Sell one first, or raise Max open positions in Settings.",
      status: "rejected",
    });
  });
});

/**
 * A buy that has passed the guard and has not settled is not a position yet, and its cash
 * has not left. For the seconds it takes to fill, a second buy from another request (the
 * owner's beside a run's, a buy by hand beside an approval) was judged on a book that
 * showed neither, and both went through a limit that had room for one.
 */
describe("a buy that is still filling counts against both limits", () => {
  /** A buy the agent has placed and not settled: what an order's row is while it fills. */
  async function inFlight(
    agent: { agentId: string; userId: string },
    input: {
      token: string;
      usd: number;
      status?: "pending" | "submitted";
      /** When the row was written. */
      placedAt?: Date;
      /** Set for a proposal its owner approved: when it was claimed. */
      claimedAt?: Date;
      isPaper?: boolean;
    },
  ): Promise<string> {
    const id = nanoid();
    await db.insert(schema.trades).values({
      id,
      agentId: agent.agentId,
      ownerId: agent.userId,
      chain: "solana",
      side: "buy",
      tokenId: input.token,
      quoteTokenId: USDC_ID,
      amountToken: toNumeric(0, 12),
      amountUsd: toNumeric(input.usd, 6),
      requestedUsd: toNumeric(input.usd, 6),
      priceUsd: toNumeric(0, 12),
      feeUsd: toNumeric(0, 6),
      status: input.status ?? "pending",
      origin: "agent",
      isPaper: input.isPaper ?? true,
      createdAt: input.placedAt ?? new Date(),
      ...(input.claimedAt ? { proposedAt: input.placedAt ?? new Date(), decidedAt: input.claimedAt, decidedBy: "owner" } : {}),
    });
    return id;
  }

  const AT_LIMIT = "This agent may hold at most 1 position and holds 1. Sell one first, or raise Max open positions in Settings.";
  /** Nothing is held yet: the slot is taken by the order that is filling, and the owner is told so. */
  const BEING_BOUGHT =
    "This agent may hold at most 1 position and holds 0, with 1 more being bought right now. Try again when that buy has settled, or raise Max open positions in Settings.";
  /** What an approval says when only a buy in flight stands in its way. The proposal is kept. */
  const STILL_PLACING =
    "Another buy of this agent's has not settled yet, and with it counted this one does not fit the agent's limits. Nothing was sent — the proposal is still open, so you can approve it again in a moment.";
  const buyBonk = (agentId: string, amountUsd = 25) =>
    placeManualTrade({ agentId, chain: "solana", side: "buy", tokenAddress: BONK, amountUsd });

  it("refuses a second position while the first is being bought, and allows it once that order has failed", async () => {
    const agent = await agentWith({ risk: { maxOpenPositions: 1 } });
    // A run's buy of WIF, three seconds in. Nothing is held yet.
    const order = await inFlight(agent, { token: WIF_ID, usd: 25, placedAt: new Date(Date.now() - 3_000) });
    expect((await getPortfolio(agent.agentId, { forBuy: true })).buysInFlight).toMatchObject([
      { tradeId: order, tokenId: WIF_ID, approved: false },
    ]);
    // Only a book that is about to judge a buy reads them: every other read is as it was.
    expect(await getPortfolio(agent.agentId)).not.toHaveProperty("buysInFlight");

    expect(await buyBonk(agent.agentId)).toEqual({ ok: false, error: BEING_BOUGHT });
    // The preview answers for the order: it reads the book the same way.
    const preview = await previewTrade({ agentId: agent.agentId, chain: "solana", side: "buy", tokenAddress: BONK, amountUsd: 25 });
    expect(preview.ok && preview.data.allowed).toBe(false);
    // Signed and sent is still in flight.
    await db.update(schema.trades).set({ status: "submitted" }).where(eq(schema.trades.id, order));
    expect(await buyBonk(agent.agentId)).toEqual({ ok: false, error: BEING_BOUGHT });

    // The order failed: nothing is being bought, and there is room.
    await db.update(schema.trades).set({ status: "failed" }).where(eq(schema.trades.id, order));
    expect((await getPortfolio(agent.agentId, { forBuy: true })).buysInFlight).toBeUndefined();
    const clear = await previewTrade({ agentId: agent.agentId, chain: "solana", side: "buy", tokenAddress: BONK, amountUsd: 25 });
    expect(clear.ok && clear.data.allowed).toBe(true);
    expect((await buyBonk(agent.agentId)).ok).toBe(true);
  });

  it("does not count an order an invocation left behind, one from the other mode, or a sell", async () => {
    const agent = await agentWith({ risk: { maxOpenPositions: 1 } });
    // Older than any order takes to fill: nobody is coming back to it.
    await inFlight(agent, { token: WIF_ID, usd: 25, placedAt: new Date(Date.now() - BUY_IN_FLIGHT_MS - 1_000) });
    // Placed with real money, on an agent that is on paper now.
    await inFlight(agent, { token: WIF_ID, usd: 25, isPaper: false });
    expect((await getPortfolio(agent.agentId, { forBuy: true })).buysInFlight).toBeUndefined();
    expect((await buyBonk(agent.agentId)).ok).toBe(true);
  });

  it("takes an order's cost off the cash the reserve is measured against, and says so", async () => {
    const agent = await agentWith({ risk: { cashReserveUsd: 5, maxPositionPct: 100 } }, "30");
    // $10 and its 5 cent fee are on their way out of $30.
    await inFlight(agent, { token: WIF_ID, usd: 10 });
    expect(await buyBonk(agent.agentId, 16)).toEqual({
      ok: false,
      error:
        "This buy would leave $3.87 in cash once the $10.05 of buys already placed have settled; the agent keeps $5.00 in reserve. The most you can buy is $14.87.",
    });
    expect((await buyBonk(agent.agentId, 14.87)).ok).toBe(true);
  });

  it("reads nothing for an agent with neither limit: its book and its buys are what they were", async () => {
    const agent = await agentWith({ risk: { maxPositionPct: 100 } }, "30");
    await inFlight(agent, { token: WIF_ID, usd: 10 });
    const book = await getPortfolio(agent.agentId, { forBuy: true });
    expect(book).not.toHaveProperty("buysInFlight");
    expect(book).not.toHaveProperty("pendingBuyTokenIds");
    expect(toRiskPortfolio(book)).not.toHaveProperty("inFlightBuyTokenIds");
    expect(toRiskPortfolio(book)).not.toHaveProperty("cashSpokenForUsd");
    // The whole of its cash, less the fee: the buy it could always make.
    expect((await buyBonk(agent.agentId, 29.85)).ok).toBe(true);
  });

  describe("at an approval", () => {
    const approving = (risk: SeedConfigOverrides["risk"], paperStartingUsd = "10000") =>
      agentWith({ execution: { mode: "approve", proposalTtlMinutes: 60 }, risk: { maxPositionPct: 100, ...risk } }, paperStartingUsd);

    it("does not count the proposal being approved against itself", async () => {
      // The claim moves the row to `pending` before the book is read, so it is in flight
      // by then. Counted, its own cost would come off the cash it is about to spend.
      const agent = await approving({ cashReserveUsd: 5 }, "30");
      const tradeId = await proposal(agent, { side: "buy", token: BONK_ID, usd: 24.87 });
      expect(await decideProposal({ tradeId, ownerId: agent.userId, decision: "approve" })).toMatchObject({ ok: true, status: "filled" });
    });

    it("still refuses a new position at the limit, for good", async () => {
      const agent = await approving({ maxOpenPositions: 1 });
      await db.insert(schema.positions).values({ agentId: agent.agentId, tokenId: WIF_ID, amountToken: "40", avgCostUsd: "0.5", openedAt: new Date() });
      const tradeId = await proposal(agent, { side: "buy", token: BONK_ID, usd: 20 });
      expect(await decideProposal({ tradeId, ownerId: agent.userId, decision: "approve" })).toEqual({
        ok: false,
        error: `No longer allowed: ${AT_LIMIT}`,
        status: "rejected",
      });
    });

    it("counts a buy placed by hand or by a run that is still filling, and keeps the proposal for when it has settled", async () => {
      const agent = await approving({ maxOpenPositions: 1 });
      const tradeId = await proposal(agent, { side: "buy", token: BONK_ID, usd: 20 });
      const order = await inFlight(agent, { token: WIF_ID, usd: 20 });
      // Not bought, and not thrown away either: a refusal at an approval is final, and
      // this one is explained by an order that will have settled in seconds.
      expect(await decideProposal({ tradeId, ownerId: agent.userId, decision: "approve" })).toEqual({
        ok: false,
        error: STILL_PLACING,
        status: "proposed",
      });
      expect(await heldBonk(agent.agentId)).toBe(0);
      const [kept] = await db.select().from(schema.trades).where(eq(schema.trades.id, tradeId));
      expect(kept).toMatchObject({ status: "proposed", decidedAt: null, decidedBy: null });

      // That order failed: approved again, the proposal fills.
      await db.update(schema.trades).set({ status: "failed" }).where(eq(schema.trades.id, order));
      expect(await decideProposal({ tradeId, ownerId: agent.userId, decision: "approve" })).toMatchObject({ ok: true, status: "filled" });
    });

    it("is refused for good once that buy has landed and the limit is met by what is held", async () => {
      const agent = await approving({ maxOpenPositions: 1 });
      const tradeId = await proposal(agent, { side: "buy", token: BONK_ID, usd: 20 });
      const order = await inFlight(agent, { token: WIF_ID, usd: 20 });
      expect(await decideProposal({ tradeId, ownerId: agent.userId, decision: "approve" })).toMatchObject({ status: "proposed" });
      // The order filled: WIF is held, which is the limit with nothing in flight at all.
      await db.update(schema.trades).set({ status: "filled", filledAt: new Date() }).where(eq(schema.trades.id, order));
      await db.insert(schema.positions).values({ agentId: agent.agentId, tokenId: WIF_ID, amountToken: "40", avgCostUsd: "0.5", openedAt: new Date() });
      expect(await decideProposal({ tradeId, ownerId: agent.userId, decision: "approve" })).toEqual({
        ok: false,
        error: `No longer allowed: ${AT_LIMIT}`,
        status: "rejected",
      });
    });

    it("keeps a proposal the reserve refuses only because of a buy still settling", async () => {
      const agent = await approving({ cashReserveUsd: 5 }, "30");
      const tradeId = await proposal(agent, { side: "buy", token: BONK_ID, usd: 16 });
      const order = await inFlight(agent, { token: WIF_ID, usd: 10 });
      expect(await decideProposal({ tradeId, ownerId: agent.userId, decision: "approve" })).toEqual({
        ok: false,
        error: STILL_PLACING,
        status: "proposed",
      });
      await db.update(schema.trades).set({ status: "failed" }).where(eq(schema.trades.id, order));
      expect(await decideProposal({ tradeId, ownerId: agent.userId, decision: "approve" })).toMatchObject({ ok: true, status: "filled" });
    });

    it("lets the earlier of two approvals through and judges the later one with it counted", async () => {
      // Two proposals approved together under a limit with room for one. Each finds the
      // other in flight. With no order between them both would be refused, for good.
      const now = new Date();
      const first = await approving({ maxOpenPositions: 1 });
      const mine = await proposal(first, { side: "buy", token: BONK_ID, usd: 20 });
      // The other one was claimed a second after this one.
      await inFlight(first, { token: WIF_ID, usd: 20, placedAt: new Date(now.getTime() - 60_000), claimedAt: new Date(now.getTime() + 1_000) });
      expect(await decideProposal({ tradeId: mine, ownerId: first.userId, decision: "approve", now })).toMatchObject({ ok: true, status: "filled" });

      const second = await approving({ maxOpenPositions: 1 });
      const later = await proposal(second, { side: "buy", token: BONK_ID, usd: 20 });
      // The other one was claimed a second before this one, and is filling.
      await inFlight(second, { token: WIF_ID, usd: 20, placedAt: new Date(now.getTime() - 60_000), claimedAt: new Date(now.getTime() - 1_000) });
      expect(await decideProposal({ tradeId: later, ownerId: second.userId, decision: "approve", now })).toEqual({
        ok: false,
        error: STILL_PLACING,
        status: "proposed",
      });
    });
  });
});
