/**
 * A paper buy and a change of the paper starting balance that land at the same moment.
 *
 * An owner may change the balance while the agent has not traded. The change is made
 * under a lock that no trade row can be written through (`changePaperBalance`), but a buy
 * that has already cleared the risk guard on the old balance holds nothing the lock can
 * see until its row is written. Left alone, a $500 ticket cleared against $10,000 would
 * land on a book that now starts with $20. So a paper buy asks, once its row is written,
 * whether the balance it was sized against still stands (`paperBalanceMoved`), on the two
 * paths that fill a buy without asking the owner first: the model's `place_trade` and a
 * buy the owner places by hand.
 *
 * The change is made here at the worst moment, between the read of the book and the
 * write of the order: the one read the two paths make in between (`recentRangePct`) is
 * the stand-in's hook. Everything else is the real code on PGlite with the paper
 * executor.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import type { Db } from "@/db";
import * as schema from "@/db/schema";
import { RunLogger } from "@/lib/agent/logger";
import { seedAgent, setupTestDb, type SeedConfigOverrides } from "@/lib/agent/test-support";
import { resetTokenCaches } from "@/lib/tokens";
import { newBudget } from "@/lib/x402/types";
import type { Session } from "@/server/types";
import { resetPriceCache } from "./prices";
import { seedKnownTokens } from "./tokens";

let session: Session | null = null;
/** What happens between the read of the book and the write of the order, once. */
let betweenReadAndWrite: (() => Promise<unknown>) | null = null;

vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));
vi.mock("@/lib/auth", () => ({
  getSession: async () => session,
  requireSession: async () => session,
}));
vi.mock("./range", async (importOriginal) => {
  const real = await importOriginal<typeof import("./range")>();
  return {
    ...real,
    recentRangePct: async (tokenId: string) => {
      const hook = betweenReadAndWrite;
      betweenReadAndWrite = null;
      await hook?.();
      return real.recentRangePct(tokenId);
    },
  };
});

const { placeManualTrade } = await import("@/server/actions/trading");
const { buildTools } = await import("@/lib/agent/tools");
const { getPortfolio } = await import("@/lib/agent/portfolio");
const { PAPER_BALANCE_MOVED, getPaperCash, paperBalanceMoved } = await import("./paper");
const { changePaperBalance, hasPaperHistory } = await import("./paper-history");

const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const BONK_PRICE = 0.0000027;

let db: Db;

beforeAll(async () => {
  process.env.X402_MOCK = "1";
  db = await setupTestDb();
  await seedKnownTokens();
}, 120_000);

beforeEach(async () => {
  vi.stubEnv("PLATFORM_FEE_BPS", "50");
  resetPriceCache();
  await resetTokenCaches();
  session = null;
  betweenReadAndWrite = null;
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
      return new Response(JSON.stringify({ [BONK]: { usdPrice: BONK_PRICE } }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

type Seeded = { agentId: string; userId: string };

async function paperAgent(paperStartingUsd: string, config: SeedConfigOverrides = {}): Promise<Seeded> {
  const seeded = await seedAgent(db, {
    config: { chains: ["solana"], dataSources: [], risk: { maxTradeUsd: 5_000, maxPositionPct: 100 }, ...config },
    paperStartingUsd,
  });
  session = { userId: seeded.userId, handle: "owner", displayName: null, avatarUrl: null, email: null };
  return seeded;
}

/** The owner's save, as `updateAgent` makes it. */
const changeTo = (agent: Seeded, paperStartingUsd: number) =>
  changePaperBalance({ agentId: agent.agentId, ownerId: agent.userId, paperStartingUsd, patch: {} });

const byHand = (agentId: string, amountUsd: number) =>
  placeManualTrade({ agentId, chain: "solana", side: "buy", tokenAddress: BONK, amountUsd });

type ToolExec = (input: unknown, options: unknown) => Promise<Record<string, unknown>>;

/** The model's own `place_trade`, for one run of this agent. */
async function byModel(agentId: string, amountUsd: number): Promise<Record<string, unknown>> {
  const [agent] = await db.select().from(schema.agents).where(eq(schema.agents.id, agentId)).limit(1);
  if (!agent) throw new Error("agent missing");
  const runId = `run-${agentId.slice(0, 8)}`;
  await db
    .insert(schema.agentRuns)
    .values({ id: runId, agentId, trigger: "manual", status: "running", startedAt: new Date() })
    .onConflictDoNothing();
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
  const execute = tools.place_trade?.execute as unknown as ToolExec;
  return execute(
    { chain: "solana", side: "buy", tokenAddress: BONK, amountUsd, rationale: "Scored 84/100 with organic volume leading; a starter position." },
    { toolCallId: "call_place_trade", messages: [] },
  );
}

const tradesOf = (agentId: string) => db.select().from(schema.trades).where(eq(schema.trades.agentId, agentId));
const heldBy = async (agentId: string) =>
  (await db.select().from(schema.positions).where(eq(schema.positions.agentId, agentId))).filter((row) => Number(row.amountToken) > 0);
const balanceOf = async (agentId: string) =>
  (await db.select().from(schema.agents).where(eq(schema.agents.id, agentId)))[0]?.paperStartingUsd;

describe("paperBalanceMoved", () => {
  it("is no while the balance is the one the book was read with, and yes once it is not", async () => {
    const agent = await paperAgent("10000");
    const book = await getPortfolio(agent.agentId, { forBuy: true });
    expect(await paperBalanceMoved(agent.agentId, book.startingUsd)).toBe(false);
    expect(await changeTo(agent, 20)).toBe("changed");
    expect(await paperBalanceMoved(agent.agentId, book.startingUsd)).toBe(true);
    expect(await paperBalanceMoved(agent.agentId, 20)).toBe(false);
    // An agent that is gone is not one to fill an order for.
    expect(await paperBalanceMoved("no-such-agent", 20)).toBe(true);
  });
});

describe.each([
  ["a buy the owner places by hand", byHand],
  ["a buy the model places", byModel],
] as const)("%s, with the paper balance changed under it", (_path, buy) => {
  const refusalOf = (result: unknown) => {
    const answer = result as { ok: boolean; error?: string; reason?: string };
    return answer.ok ? null : (answer.error ?? answer.reason ?? "");
  };

  it("fills as it always did when nothing changes the balance", async () => {
    const agent = await paperAgent("10000");
    expect(refusalOf(await buy(agent.agentId, 500))).toBeNull();
    expect((await tradesOf(agent.agentId)).map((row) => `${row.side} ${row.status}`)).toEqual(["buy filled"]);
    expect(await heldBy(agent.agentId)).toHaveLength(1);
  });

  it("is not filled when the balance was lowered after it cleared the guard, and the book is left whole", async () => {
    const agent = await paperAgent("10000");
    // $500 clears a $10,000 book. The owner's save lands before the order's row does.
    betweenReadAndWrite = async () => expect(await changeTo(agent, 20)).toBe("changed");

    expect(refusalOf(await buy(agent.agentId, 500))).toBe(PAPER_BALANCE_MOVED);

    // The save went through, and the order did not: no position, and all $20 still there.
    expect(await balanceOf(agent.agentId)).toBe("20.00");
    expect(await heldBy(agent.agentId)).toEqual([]);
    expect(await getPaperCash(agent.agentId)).toBe(20);
    const rows = await tradesOf(agent.agentId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ side: "buy", status: "failed", isPaper: true, error: PAPER_BALANCE_MOVED });
    // The order's row is paper history like any other, so the balance is now settled.
    expect(await hasPaperHistory(db, agent.agentId)).toBe(true);
    expect(await changeTo(agent, 10_000)).toBe("paper");
    expect(await balanceOf(agent.agentId)).toBe("20.00");
  });

  it("is not filled when the balance was raised either: it is judged again on the book it lands on", async () => {
    const agent = await paperAgent("1000");
    betweenReadAndWrite = () => changeTo(agent, 2_500_000);
    expect(refusalOf(await buy(agent.agentId, 500))).toBe(PAPER_BALANCE_MOVED);
    expect(await heldBy(agent.agentId)).toEqual([]);
    expect(await getPaperCash(agent.agentId)).toBe(2_500_000);
  });

  it("fills on the new balance when the change came first, and is refused by the guard when it no longer fits", async () => {
    const agent = await paperAgent("10000");
    expect(await changeTo(agent, 600)).toBe("changed");
    // Too large for the book it now is: the risk guard's refusal, and no order row at all.
    const tooLarge = refusalOf(await buy(agent.agentId, 5_000));
    expect(tooLarge).not.toBeNull();
    expect(tooLarge).not.toBe(PAPER_BALANCE_MOVED);
    expect(await tradesOf(agent.agentId)).toEqual([]);
    // One that fits is filled, and the cash that is left is the new balance less the buy.
    expect(refusalOf(await buy(agent.agentId, 500))).toBeNull();
    expect((await tradesOf(agent.agentId)).map((row) => row.status)).toEqual(["filled"]);
    const cash = await getPaperCash(agent.agentId);
    expect(cash).toBeGreaterThan(0);
    expect(cash).toBeLessThan(100);
  });

  it("cannot be used to put a large position on a small book, however the changes are timed", async () => {
    const agent = await paperAgent("20");
    // Raised before the read, so the guard clears $5,000 against $2,500,000, and lowered
    // again before the order is written: the book it would land on starts with $20.
    expect(await changeTo(agent, 2_500_000)).toBe("changed");
    betweenReadAndWrite = () => changeTo(agent, 20);
    expect(refusalOf(await buy(agent.agentId, 5_000))).toBe(PAPER_BALANCE_MOVED);
    expect(await heldBy(agent.agentId)).toEqual([]);
    expect(await getPaperCash(agent.agentId)).toBe(20);
  });
});

describe("the other orders, which this is not about", () => {
  it("does not ask a sell: one by hand fills whatever the balance has become", async () => {
    const agent = await paperAgent("10000");
    expect((await byHand(agent.agentId, 500)).ok).toBe(true);
    // A book with a fill on it cannot have its balance changed, so the row is rewritten
    // here by hand, as no request can: what is held is that a sell reads nothing of it.
    await db.update(schema.agents).set({ paperStartingUsd: "20" }).where(eq(schema.agents.id, agent.agentId));
    const sold = await placeManualTrade({ agentId: agent.agentId, chain: "solana", side: "sell", tokenAddress: BONK, amountUsd: 500, sellAll: true });
    expect(sold.ok).toBe(true);
    expect(await heldBy(agent.agentId)).toEqual([]);
  });

  it("leaves a proposal to be judged when it is approved: its row alone settles the balance", async () => {
    const agent = await paperAgent("10000", { execution: { mode: "approve", proposalTtlMinutes: 60 } });
    betweenReadAndWrite = () => changeTo(agent, 20);
    const proposed = await byModel(agent.agentId, 500);
    expect(proposed).toMatchObject({ ok: true, proposed: true });
    expect((await tradesOf(agent.agentId)).map((row) => row.status)).toEqual(["proposed"]);
    // Nothing was bought, and from this row on the balance cannot change again.
    expect(await heldBy(agent.agentId)).toEqual([]);
    expect(await changeTo(agent, 10_000)).toBe("paper");
  });
});
