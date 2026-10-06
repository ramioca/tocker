/**
 * Manual trading: the operator's own hands on the agent's book.
 *
 * The point of these tests is that "manual" is not "unguarded". A manual buy goes
 * through the same score and the same `riskGuard` as the agent's own order, and the
 * refusal has to read like a sentence a person can act on.
 *
 * `getSession` and `next/cache` are mocked because this is a server action; everything
 * else — database, scoring, executor — is the real code path against in-memory PGlite.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import type { Db } from "@/db";
import * as schema from "@/db/schema";
import { DEFAULT_AGENT_CONFIG } from "@/lib/agent/config";
import { seedAgent, setupTestDb } from "@/lib/agent/test-support";
import type { ExecuteHooks, Fill, Quote, TradeExecutor, TradeRequest } from "@/lib/trading/executor";
import { PaperExecutor } from "@/lib/trading/paper";
import { resetPriceCache } from "@/lib/trading/prices";
import { seedKnownTokens } from "@/lib/trading/tokens";
import type { Session } from "@/server/types";

const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";

let session: Session | null = null;

/**
 * The venue an agent's orders go to. Null, which is every test unless it says otherwise,
 * is the real `getExecutor`: the paper simulator. A test sets it to watch what reaches
 * the venue, or to stand in for a live one that fails the way Jupiter does.
 */
const venue = vi.hoisted(() => ({ override: null as TradeExecutor | null }));

vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));
vi.mock("@/lib/trading/executor", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/trading/executor")>();
  return {
    ...actual,
    getExecutor: async (...args: Parameters<typeof actual.getExecutor>) => venue.override ?? actual.getExecutor(...args),
  };
});
vi.mock("@/lib/auth", () => ({
  getSession: async () => session,
  requireSession: async () => session,
}));

const { placeManualTrade, previewTrade } = await import("./trading");

let db: Db;

beforeAll(async () => {
  process.env.X402_MOCK = "1";
  db = await setupTestDb();
  await seedKnownTokens();
  // Generous: PGlite + drizzle-kit pushSchema can take well over the 10s default
  // hook timeout on a loaded machine.
}, 120_000);

function stubPricing(pricePerToken = 0.0000027): void {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/ultra/v1/order")) {
      const amount = Number(new URL(url).searchParams.get("amount"));
      const out = (amount / 1e6 / pricePerToken) * 10 ** 5;
      return new Response(
        JSON.stringify({ requestId: "req", transaction: null, inAmount: String(amount), outAmount: String(Math.round(out)) }),
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
  // Marks are cached for 30 s per process; a test that moves the price must not hand
  // its mark to the next one.
  resetPriceCache();
  session = null;
  venue.override = null;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function asOwner(userId: string): void {
  session = { userId, handle: "owner", displayName: null, avatarUrl: null, email: null };
}

/** The simulator, with every request that reaches it written down. */
function watchedVenue(): { requests: TradeRequest[] } {
  const paper = new PaperExecutor();
  const requests: TradeRequest[] = [];
  venue.override = {
    venue: paper.venue,
    isPaper: paper.isPaper,
    quote: (request) => {
      requests.push(request);
      return paper.quote(request);
    },
    execute: (quote) => paper.execute(quote),
  };
  return { requests };
}

/** An error shaped like the Solana executor's, which the action reads by name. */
function jupiterError(message: string, facts: { kind?: string; httpStatus?: number; errorCode?: number } = {}): Error {
  return Object.assign(new Error(message), {
    name: "JupiterError",
    kind: facts.kind ?? null,
    httpStatus: facts.httpStatus ?? null,
    errorCode: facts.errorCode ?? null,
  });
}

/**
 * A live Jupiter venue that quotes like the simulator and then does what the test says.
 * Only for orders that fail: nothing here settles a real fill.
 */
function liveVenue(behaviour: {
  quote?: (request: TradeRequest) => Promise<Quote>;
  execute?: (quote: Quote, hooks?: ExecuteHooks) => Promise<Fill>;
}): void {
  const paper = new PaperExecutor();
  venue.override = {
    venue: "jupiter",
    isPaper: false,
    quote: behaviour.quote ?? (async (request) => ({ ...(await paper.quote(request)), venue: "jupiter" as const })),
    execute: behaviour.execute ?? ((quote) => paper.execute(quote)),
  };
}

/** A paper agent holding $40 of BONK. */
async function agentHoldingBonk(): Promise<{ agentId: string; heldToken: number }> {
  const { agentId, userId } = await seedAgent(db, { config: { chains: ["solana"] } });
  asOwner(userId);
  const bought = await placeManualTrade({ agentId, chain: "solana", side: "buy", tokenAddress: BONK, amountUsd: 40 });
  if (!bought.ok) throw new Error(`seed buy failed: ${bought.error}`);
  return { agentId, heldToken: bought.data.amountToken };
}

async function lastTrade(agentId: string): Promise<typeof schema.trades.$inferSelect> {
  const rows = await db.select().from(schema.trades).where(eq(schema.trades.agentId, agentId));
  const newest = rows.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()).at(-1);
  if (!newest) throw new Error("no trades");
  return newest;
}

describe("placeManualTrade", () => {
  it("fills, books the position, posts to the feed and records origin 'manual'", async () => {
    const { agentId, userId } = await seedAgent(db, { config: { chains: ["solana"] } });
    asOwner(userId);

    const result = await placeManualTrade({
      agentId,
      chain: "solana",
      side: "buy",
      tokenAddress: BONK,
      amountUsd: 40,
      note: "Taking this one myself.",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.symbol).toBe("BONK");
    expect(result.data.amountToken).toBeGreaterThan(0);

    const rows = await db.select().from(schema.trades).where(eq(schema.trades.agentId, agentId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("filled");
    expect(rows[0]?.origin).toBe("manual");
    expect(rows[0]?.decidedBy).toBe("owner");
    expect(rows[0]?.runId).toBeNull();
    expect(rows[0]?.rationale).toBe("Taking this one myself.");
    expect(rows[0]?.scoreSnapshot?.total).toBeGreaterThan(0);

    const held = await db.select().from(schema.positions).where(eq(schema.positions.agentId, agentId));
    expect(held).toHaveLength(1);

    const feed = await db
      .select()
      .from(schema.posts)
      .where(and(eq(schema.posts.agentId, agentId), eq(schema.posts.kind, "trade")));
    expect(feed).toHaveLength(1);
    expect(feed[0]?.body).toBe("Taking this one myself.");
  });

  it("defaults the rationale so a manual fill is never a blank line in the feed", async () => {
    const { agentId, userId } = await seedAgent(db, { config: { chains: ["solana"] } });
    asOwner(userId);

    const result = await placeManualTrade({ agentId, chain: "solana", side: "buy", tokenAddress: BONK, amountUsd: 25 });
    expect(result.ok).toBe(true);

    const rows = await db.select().from(schema.trades).where(eq(schema.trades.agentId, agentId));
    expect(rows[0]?.rationale).toBe("Manual trade by the owner.");
  });

  it("is refused by the agent's own universe gate, with both numbers in the message", async () => {
    const { agentId, userId } = await seedAgent(db, {
      config: {
        chains: ["solana"],
        universe: { ...DEFAULT_AGENT_CONFIG.universe, minScore: 99 },
      },
    });
    asOwner(userId);

    const result = await placeManualTrade({ agentId, chain: "solana", side: "buy", tokenAddress: BONK, amountUsd: 25 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("minimum score is 99");
    expect(result.error).toMatch(/BONK scores \d/);
    expect(result.error).toContain("Settings");

    // Refused before anything was written.
    const rows = await db.select().from(schema.trades).where(eq(schema.trades.agentId, agentId));
    expect(rows).toHaveLength(0);
  });

  it("is refused by the blocklist, which stays subtractive even for the owner", async () => {
    const { agentId, userId } = await seedAgent(db, {
      config: {
        chains: ["solana"],
        universe: {
          ...DEFAULT_AGENT_CONFIG.universe,
          blocklist: [{ chain: "solana", address: BONK, symbol: "BONK" }],
        },
      },
    });
    asOwner(userId);

    const result = await placeManualTrade({ agentId, chain: "solana", side: "buy", tokenAddress: BONK, amountUsd: 25 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("blocklist");
  });

  it("will not sell a position the agent does not hold", async () => {
    const { agentId, userId } = await seedAgent(db, { config: { chains: ["solana"] } });
    asOwner(userId);

    const result = await placeManualTrade({ agentId, chain: "solana", side: "sell", tokenAddress: BONK, amountUsd: 10 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("holds no BONK");
  });

  it("refuses a stranger and refuses an anonymous caller", async () => {
    const { agentId } = await seedAgent(db, { config: { chains: ["solana"] } });
    const other = await seedAgent(db);

    session = null;
    const anon = await placeManualTrade({ agentId, chain: "solana", side: "buy", tokenAddress: BONK, amountUsd: 10 });
    expect(anon.ok).toBe(false);
    if (!anon.ok) expect(anon.error).toContain("Sign in");

    asOwner(other.userId);
    const stranger = await placeManualTrade({ agentId, chain: "solana", side: "buy", tokenAddress: BONK, amountUsd: 10 });
    expect(stranger.ok).toBe(false);
    if (!stranger.ok) expect(stranger.error).toContain("do not own");
  });

  it("rejects a non-positive size before it touches a venue", async () => {
    const { agentId, userId } = await seedAgent(db, { config: { chains: ["solana"] } });
    asOwner(userId);
    const result = await placeManualTrade({ agentId, chain: "solana", side: "buy", tokenAddress: BONK, amountUsd: 0 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("greater than zero");
  });
});

/**
 * The Sell dialog prefills the position's value as the page rendered it and says "sell
 * everything". By the time the click lands the mark has moved, and on a falling token it
 * has moved down: the typed figure is then more than the position is worth, which is
 * the one thing the guard refuses a sell for.
 */
describe("sell everything after the price fell", () => {
  const PRICE = 0.0000027;

  /** A $40 BONK position, then a mark 20% lower than the one the page was rendered at. */
  async function heldThenFallen(): Promise<{ agentId: string }> {
    const { agentId, userId } = await seedAgent(db, { config: { chains: ["solana"] } });
    asOwner(userId);
    const bought = await placeManualTrade({ agentId, chain: "solana", side: "buy", tokenAddress: BONK, amountUsd: 40 });
    expect(bought.ok).toBe(true);
    resetPriceCache();
    stubPricing(PRICE * 0.8);
    return { agentId };
  }

  it("sells the whole balance although the typed figure is now over the position", async () => {
    const { agentId } = await heldThenFallen();

    const sold = await placeManualTrade({
      agentId,
      chain: "solana",
      side: "sell",
      tokenAddress: BONK,
      amountUsd: 40,
      sellAll: true,
    });
    expect(sold.ok).toBe(true);
    if (!sold.ok) return;
    // Priced at the fallen mark, not at the figure that was typed.
    expect(sold.data.amountUsd).toBeCloseTo(32, 1);

    const [row] = await db.select().from(schema.positions).where(eq(schema.positions.agentId, agentId));
    expect(Number(row?.amountToken)).toBe(0);
  });

  it("previews as allowed, so the button is not dead before the click", async () => {
    const { agentId } = await heldThenFallen();

    const preview = await previewTrade({
      agentId,
      chain: "solana",
      side: "sell",
      tokenAddress: BONK,
      amountUsd: 40,
      sellAll: true,
    });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.data.allowed).toBe(true);
    expect(preview.data.reason).toBeNull();
  });

  it("still refuses the same figure when it is not a sell-all", async () => {
    const { agentId } = await heldThenFallen();

    const sold = await placeManualTrade({ agentId, chain: "solana", side: "sell", tokenAddress: BONK, amountUsd: 40 });
    expect(sold.ok).toBe(false);
    if (sold.ok) return;
    expect(sold.error).toContain("more than the position is worth");

    const preview = await previewTrade({ agentId, chain: "solana", side: "sell", tokenAddress: BONK, amountUsd: 40 });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.data.allowed).toBe(false);
    expect(preview.data.reason).toContain("more than the position is worth");

    // Nothing was sold: the position is as the buy left it.
    const [row] = await db.select().from(schema.positions).where(eq(schema.positions.agentId, agentId));
    expect(Number(row?.amountToken)).toBeGreaterThan(0);
  });
});

describe("previewTrade", () => {
  it("returns the score, the guard's verdict and a price without trading", async () => {
    const { agentId, userId } = await seedAgent(db, { config: { chains: ["solana"] } });
    asOwner(userId);

    const preview = await previewTrade({ agentId, chain: "solana", side: "buy", tokenAddress: BONK, amountUsd: 50 });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.data.token.symbol).toBe("BONK");
    expect(preview.data.score?.total).toBeGreaterThan(0);
    expect(preview.data.allowed).toBe(true);
    expect(preview.data.reason).toBeNull();
    expect(preview.data.priceUsd).toBeGreaterThan(0);
    expect(preview.data.estimatedToken).toBeGreaterThan(0);
    expect(preview.data.isPaper).toBe(true);
    expect(preview.data.requiresApproval).toBe(false);

    // Nothing was written.
    const rows = await db.select().from(schema.trades).where(eq(schema.trades.agentId, agentId));
    expect(rows).toHaveLength(0);
  });

  it("explains a refusal instead of just saying no", async () => {
    const { agentId, userId } = await seedAgent(db, {
      config: { chains: ["solana"], risk: { ...DEFAULT_AGENT_CONFIG.risk, maxTradeUsd: 20 } },
    });
    asOwner(userId);

    const preview = await previewTrade({ agentId, chain: "solana", side: "buy", tokenAddress: BONK, amountUsd: 500 });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.data.allowed).toBe(false);
    // The owner's words, with both numbers, never the config key the model reads.
    expect(preview.data.reason).toBe("$500 is over this agent's $20 per-trade cap. Lower the size or raise Max per trade in Settings.");
    expect(preview.data.reason).not.toContain("maxTradeUsd");
  });

  it("flags an approve-mode agent so the sheet can say the order becomes a proposal", async () => {
    const { agentId, userId } = await seedAgent(db, {
      config: { chains: ["solana"], execution: { mode: "approve", proposalTtlMinutes: 60 } },
    });
    asOwner(userId);

    const preview = await previewTrade({ agentId, chain: "solana", side: "buy", tokenAddress: BONK, amountUsd: 50 });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.data.requiresApproval).toBe(true);
  });
});

/**
 * The preview has to describe the order that will be sent: the same tokens, priced by
 * the venue, or an honest "no quote" when the venue did not answer.
 */
describe("previewTrade for a sell", () => {
  it("shows the whole holding and what the venue would pay for it on a sell-all", async () => {
    const { agentId, heldToken } = await agentHoldingBonk();
    const { requests } = watchedVenue();

    const preview = await previewTrade({ agentId, chain: "solana", side: "sell", tokenAddress: BONK, amountUsd: 40, sellAll: true });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.data.allowed).toBe(true);
    expect(preview.data.quoted).toBe(true);
    expect(preview.data.quoteNote).toBeNull();
    expect(preview.data.sell?.amountToken).toBeCloseTo(heldToken, 6);
    expect(preview.data.sell?.proceedsUsd).toBeGreaterThan(0);
    expect(preview.data.sell?.fullExit).toBe(true);
    // The simulator applies no slippage bound, so there is no "at worst" to print.
    expect(preview.data.sell?.minProceedsUsd).toBeNull();
    expect(preview.data.slippageLimitBps).toBe(DEFAULT_AGENT_CONFIG.risk.slippageBps);

    // The venue was asked about the position's tokens, as the order itself would ask.
    expect(requests).toHaveLength(1);
    expect(requests[0]?.amountToken).toBeCloseTo(heldToken, 6);

    // Nothing was sold and nothing was written.
    const rows = await db.select().from(schema.trades).where(eq(schema.trades.agentId, agentId));
    expect(rows).toHaveLength(1);
  });

  it("shows a partial sell as its share of the holding", async () => {
    const { agentId, heldToken } = await agentHoldingBonk();

    const preview = await previewTrade({ agentId, chain: "solana", side: "sell", tokenAddress: BONK, amountUsd: 20 });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.data.sell?.fullExit).toBe(false);
    expect(preview.data.sell?.amountToken).toBeCloseTo(heldToken / 2, 0);
    expect(preview.data.sell?.proceedsUsd).toBeCloseTo(20, 1);
  });

  it("says there is no live quote, and why, when the venue refuses to quote", async () => {
    const { agentId, heldToken } = await agentHoldingBonk();
    liveVenue({
      quote: async () => {
        throw jupiterError('Jupiter Ultra /order failed (HTTP 400). {"error":"Failed to get quotes"}', { httpStatus: 400 });
      },
    });

    const preview = await previewTrade({ agentId, chain: "solana", side: "sell", tokenAddress: BONK, amountUsd: 40, sellAll: true });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    // The guard's answer does not depend on the venue: the exit is still allowed.
    expect(preview.data.allowed).toBe(true);
    expect(preview.data.quoted).toBe(false);
    expect(preview.data.quoteNote).toBe(
      "Jupiter has no route for BONK right now. Nothing was sent. Thin or brand-new pools drop in and out: try again in a minute, or sell a smaller slice.",
    );
    // The last mark still prices it, and the size is still the order's size.
    expect(preview.data.priceUsd).toBeGreaterThan(0);
    expect(preview.data.sell?.amountToken).toBeCloseTo(heldToken, 6);
    expect(preview.data.sell?.proceedsUsd).toBeNull();
    expect(preview.data.sell?.minProceedsUsd).toBeNull();
  });

  it("falls back to a plain sentence when the venue's failure is not one it knows", async () => {
    const { agentId } = await agentHoldingBonk();
    liveVenue({
      quote: async () => {
        throw new Error("ECONNRESET");
      },
    });

    const preview = await previewTrade({ agentId, chain: "solana", side: "sell", tokenAddress: BONK, amountUsd: 40, sellAll: true });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.data.quoted).toBe(false);
    expect(preview.data.quoteNote).toBe("Jupiter didn't return a quote just now.");
  });

  it("works out the least a quoted sell can pay from the tolerance the venue applied", async () => {
    const { agentId } = await agentHoldingBonk();
    const paper = new PaperExecutor();
    liveVenue({
      quote: async (request) => ({ ...(await paper.quote(request)), venue: "jupiter" as const, appliedSlippageBps: 250 }),
    });

    const preview = await previewTrade({ agentId, chain: "solana", side: "sell", tokenAddress: BONK, amountUsd: 40, sellAll: true });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    const proceeds = preview.data.sell?.proceedsUsd ?? 0;
    expect(proceeds).toBeGreaterThan(0);
    expect(preview.data.sell?.minProceedsUsd).toBeCloseTo(proceeds * 0.975, 6);
  });

  it("leaves a buy's preview without a sell block", async () => {
    const { agentId, userId } = await seedAgent(db, { config: { chains: ["solana"] } });
    asOwner(userId);
    const preview = await previewTrade({ agentId, chain: "solana", side: "buy", tokenAddress: BONK, amountUsd: 50 });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.data.sell).toBeNull();
    expect(preview.data.quoted).toBe(true);
  });
});

/**
 * What the owner reads when a manual order fails. The venue's own text stays on the
 * trade row; the action answers with a sentence that says whether anything moved.
 */
describe("a manual order that fails at the venue", () => {
  const RATE_LIMITED = "Jupiter Ultra /order failed (HTTP 429). Ultra is rate-limiting this app — set JUPITER_API_KEY. {}";

  it("answers a failed quote in the owner's words and keeps the raw text on the row", async () => {
    const { agentId } = await agentHoldingBonk();
    liveVenue({
      quote: async () => {
        throw jupiterError(RATE_LIMITED, { httpStatus: 429 });
      },
    });

    const result = await placeManualTrade({ agentId, chain: "solana", side: "sell", tokenAddress: BONK, amountUsd: 40, sellAll: true });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("Jupiter is busy. Nothing was sent. Try again in a few seconds.");

    const row = await lastTrade(agentId);
    expect(row.status).toBe("failed");
    expect(row.error).toBe(RATE_LIMITED);
  });

  it("answers an on-chain slippage failure with the limit the order ran under", async () => {
    const { agentId } = await agentHoldingBonk();
    const raw = "Jupiter execute: Slippage tolerance exceeded (code 6001).";
    liveVenue({
      execute: async (quote) => ({
        status: "failed",
        txHash: null,
        priceUsd: quote.priceUsd,
        amountToken: quote.amountToken,
        amountUsd: quote.amountUsd,
        feeUsd: 0,
        error: raw,
      }),
    });

    const result = await placeManualTrade({ agentId, chain: "solana", side: "sell", tokenAddress: BONK, amountUsd: 40, sellAll: true });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe(
      "The price moved more than this agent's 3% slippage limit while the order was landing, so it was cancelled on chain. Nothing was sold. Try again, or raise Slippage tolerance in Settings, Risk.",
    );
    expect((await lastTrade(agentId)).error).toBe(raw);

    // Widened for this one order, the sentence names the owner's number, not the agent's.
    const widened = await placeManualTrade({
      agentId,
      chain: "solana",
      side: "sell",
      tokenAddress: BONK,
      amountUsd: 40,
      sellAll: true,
      maxSlippageBps: 1_000,
    });
    expect(widened.ok).toBe(false);
    if (widened.ok) return;
    expect(widened.error).toContain("more than the 10% max slippage you set for this order");

    // Nothing was sold either time.
    const [position] = await db.select().from(schema.positions).where(eq(schema.positions.agentId, agentId));
    expect(Number(position?.amountToken)).toBeGreaterThan(0);
  });

  it("passes the settlement layer's own sentence through word for word", async () => {
    const { agentId } = await agentHoldingBonk();
    // No RPC to ask, so a signed order that threw has an unknown outcome at once.
    vi.stubEnv("SOLANA_RPC_URL", "");
    const signature = "4".repeat(64);
    liveVenue({
      execute: async (_quote, hooks) => {
        await hooks?.onSigned?.(signature);
        throw new Error("socket hang up");
      },
    });

    const result = await placeManualTrade({ agentId, chain: "solana", side: "sell", tokenAddress: BONK, amountUsd: 40, sellAll: true });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const row = await lastTrade(agentId);
    expect(row.error).toContain("outcome is unknown");
    // Exactly what was recorded: no prefix, no rewrite.
    expect(result.error).toBe(row.error);
  });
});

/**
 * One manual sell may run under a wider slippage tolerance than the agent's own. It is
 * the only place a person loosens a fill guard by hand, so the bounds are pinned here:
 * sells only, only wider, never past 15%, and the receipt records what was used.
 */
describe("max slippage for one manual sell", () => {
  const AGENT_BPS = DEFAULT_AGENT_CONFIG.risk.slippageBps;

  async function receiptOf(tradeId: string): Promise<schema.TradeReceiptData | undefined> {
    const [row] = await db.select().from(schema.tradeReceipts).where(eq(schema.tradeReceipts.tradeId, tradeId));
    return row?.data;
  }

  it("sends a wider tolerance to the venue and records it on the receipt", async () => {
    expect(AGENT_BPS).toBe(300);
    const { agentId } = await agentHoldingBonk();
    const { requests } = watchedVenue();

    const preview = await previewTrade({
      agentId,
      chain: "solana",
      side: "sell",
      tokenAddress: BONK,
      amountUsd: 40,
      sellAll: true,
      maxSlippageBps: 1_000,
    });
    expect(preview.ok).toBe(true);
    // The preview quotes under the tolerance the order will run under.
    expect(requests.at(-1)?.slippageBps).toBe(1_000);
    // And still reports the agent's own setting as the limit that can be widened from.
    if (preview.ok) expect(preview.data.slippageLimitBps).toBe(300);

    const sold = await placeManualTrade({
      agentId,
      chain: "solana",
      side: "sell",
      tokenAddress: BONK,
      amountUsd: 40,
      sellAll: true,
      maxSlippageBps: 1_000,
    });
    expect(sold.ok).toBe(true);
    if (!sold.ok) return;
    expect(requests.at(-1)?.side).toBe("sell");
    expect(requests.at(-1)?.slippageBps).toBe(1_000);
    expect(sold.data.receipt.slippageToleranceBps).toBe(1_000);
    expect((await receiptOf(sold.data.tradeId))?.slippageToleranceBps).toBe(1_000);

    // The agent's own setting is untouched, and the public note says nothing about it.
    const [agent] = await db.select().from(schema.agents).where(eq(schema.agents.id, agentId));
    expect(agent?.config.risk.slippageBps).toBe(300);
    const feed = await db
      .select()
      .from(schema.posts)
      .where(and(eq(schema.posts.agentId, agentId), eq(schema.posts.tradeId, sold.data.tradeId)));
    expect(feed[0]?.body).toBe("Manual trade by the owner.");
    expect(feed[0]?.body).not.toMatch(/slippage|bps|%/i);
  });

  it("is ignored on a buy", async () => {
    const { agentId, userId } = await seedAgent(db, { config: { chains: ["solana"] } });
    asOwner(userId);
    const { requests } = watchedVenue();

    const bought = await placeManualTrade({
      agentId,
      chain: "solana",
      side: "buy",
      tokenAddress: BONK,
      amountUsd: 40,
      maxSlippageBps: 1_000,
    });
    expect(bought.ok).toBe(true);
    if (!bought.ok) return;
    expect(requests.at(-1)?.slippageBps).toBe(300);
    expect(bought.data.receipt.slippageToleranceBps).toBe(300);
    expect((await receiptOf(bought.data.tradeId))?.slippageToleranceBps).toBe(300);
  });

  it("is ignored past 15%, and the sell goes ahead on the agent's setting", async () => {
    const { agentId } = await agentHoldingBonk();
    const { requests } = watchedVenue();

    const sold = await placeManualTrade({
      agentId,
      chain: "solana",
      side: "sell",
      tokenAddress: BONK,
      amountUsd: 40,
      sellAll: true,
      maxSlippageBps: 2_000,
    });
    // Ignored, not refused: a bad value here never blocks an exit.
    expect(sold.ok).toBe(true);
    if (!sold.ok) return;
    expect(requests.at(-1)?.slippageBps).toBe(300);
    expect(sold.data.receipt.slippageToleranceBps).toBe(300);
  });

  it("is ignored below the agent's setting: it can only widen", async () => {
    const { agentId } = await agentHoldingBonk();
    const { requests } = watchedVenue();

    const sold = await placeManualTrade({
      agentId,
      chain: "solana",
      side: "sell",
      tokenAddress: BONK,
      amountUsd: 40,
      sellAll: true,
      maxSlippageBps: 100,
    });
    expect(sold.ok).toBe(true);
    if (!sold.ok) return;
    expect(requests.at(-1)?.slippageBps).toBe(300);
    expect(sold.data.receipt.slippageToleranceBps).toBe(300);
  });

  it("is ignored when it is not a whole number of basis points", async () => {
    const { agentId } = await agentHoldingBonk();
    const { requests } = watchedVenue();

    const sold = await placeManualTrade({
      agentId,
      chain: "solana",
      side: "sell",
      tokenAddress: BONK,
      amountUsd: 20,
      // What a tampered request can carry: the type is only a promise.
      maxSlippageBps: "1000" as unknown as number,
    });
    expect(sold.ok).toBe(true);
    expect(requests.at(-1)?.slippageBps).toBe(300);

    const again = await placeManualTrade({
      agentId,
      chain: "solana",
      side: "sell",
      tokenAddress: BONK,
      amountUsd: 5,
      maxSlippageBps: 750.5,
    });
    expect(again.ok).toBe(true);
    expect(requests.at(-1)?.slippageBps).toBe(300);
  });
});
