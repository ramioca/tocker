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
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import type { Db } from "@/db";
import * as schema from "@/db/schema";
import { DEFAULT_AGENT_CONFIG } from "@/lib/agent/config";
import { seedAgent, setupTestDb } from "@/lib/agent/test-support";
import { seedKnownTokens } from "@/lib/trading/tokens";
import type { Session } from "@/server/types";

const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";

let session: Session | null = null;

vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));
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
  session = null;
});

function asOwner(userId: string): void {
  session = { userId, handle: "owner", displayName: null, avatarUrl: null, email: null };
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
