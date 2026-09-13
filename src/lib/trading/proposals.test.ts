/**
 * Approval mode, end to end: the runtime proposes instead of filling, the owner decides,
 * and nothing can be decided twice.
 *
 * Hermetic — in-memory PGlite, `LLM_MOCK=1` for the scripted model, a stubbed `fetch` so
 * the paper executor has a price without touching the network.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import type { Db } from "@/db";
import * as schema from "@/db/schema";
import { DEFAULT_AGENT_CONFIG } from "@/lib/agent/config";
import { runAgent } from "@/lib/agent/run";
import { seedAgent, setupTestDb } from "@/lib/agent/test-support";
import { seedKnownTokens } from "@/lib/trading/tokens";
import { decideProposal, expireProposals, proposalExpiresAt } from "./proposals";

let db: Db;

const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";

beforeAll(async () => {
  process.env.X402_MOCK = "1";
  process.env.LLM_MOCK = "1";
  db = await setupTestDb();
  await seedKnownTokens();
  // Generous: PGlite + drizzle-kit pushSchema can take well over the 10s default
  // hook timeout on a loaded machine.
}, 120_000);

/** Same stub as the run-loop tests: a routed Jupiter quote and a price, nothing else. */
function stubPricing(pricePerToken = 0.0000027): void {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/ultra/v1/order")) {
      const amount = Number(new URL(url).searchParams.get("amount"));
      const out = (amount / 1e6 / pricePerToken) * 10 ** 5; // BONK has 5 decimals
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
});

/** An agent that must have its trades approved. */
function approveConfig(overrides: Partial<schema.AgentConfig> = {}): Partial<schema.AgentConfig> {
  return {
    dataSources: ["sentimentalpha"],
    chains: ["solana"],
    execution: { mode: "approve", proposalTtlMinutes: 60 },
    ...overrides,
  };
}

async function proposeOnce(): Promise<{ agentId: string; userId: string; slug: string; tradeId: string }> {
  const seeded = await seedAgent(db, { config: approveConfig() });
  const result = await runAgent({ agentId: seeded.agentId, trigger: "manual" });
  expect(result.status).toBe("succeeded");
  const rows = await db.select().from(schema.trades).where(eq(schema.trades.agentId, seeded.agentId));
  expect(rows).toHaveLength(1);
  return { ...seeded, tradeId: rows[0]!.id };
}

describe("approval mode in the run loop", () => {
  it("proposes instead of trading, leaves the book untouched and tells the owner", async () => {
    const { agentId, userId } = await seedAgent(db, { config: approveConfig() });

    const result = await runAgent({ agentId, trigger: "manual" });
    expect(result.status).toBe("succeeded");

    const rows = await db.select().from(schema.trades).where(eq(schema.trades.agentId, agentId));
    expect(rows).toHaveLength(1);
    const proposal = rows[0]!;
    expect(proposal.status).toBe("proposed");
    expect(proposal.origin).toBe("agent");
    expect(Number(proposal.requestedUsd)).toBeCloseTo(50, 6);
    expect(Number(proposal.amountUsd)).toBeCloseTo(50, 6);
    // Nothing filled: no tokens, no fee, but a quote price so the owner can size it.
    expect(Number(proposal.amountToken)).toBe(0);
    expect(Number(proposal.feeUsd)).toBe(0);
    expect(Number(proposal.priceUsd)).toBeGreaterThan(0);
    expect(proposal.proposedAt).not.toBeNull();
    expect(proposal.decidedAt).toBeNull();
    expect(proposal.decidedBy).toBeNull();
    // The score is frozen at proposal time, exactly like a filled trade's.
    expect(proposal.scoreSnapshot?.total).toBeGreaterThan(0);
    expect(proposal.rationale).toBeTruthy();

    // The book is untouched.
    const held = await db.select().from(schema.positions).where(eq(schema.positions.agentId, agentId));
    expect(held).toHaveLength(0);

    // Nothing is public yet — a proposal is not a trade.
    const feed = await db
      .select()
      .from(schema.posts)
      .where(and(eq(schema.posts.agentId, agentId), eq(schema.posts.kind, "trade")));
    expect(feed).toHaveLength(0);

    // The owner is asked.
    const notes = await db.select().from(schema.notifications).where(eq(schema.notifications.userId, userId));
    const ask = notes.find((n) => n.kind === "proposal");
    expect(ask).toBeDefined();
    expect(ask?.title).toBe("Approve: buy $50 of BONK?");
    expect(ask?.body).toBe(proposal.rationale);
    expect(ask?.href).toBe(`/agents/${(await agentSlug(agentId))}?proposal=${proposal.id}`);
  });

  it("tells the model it is a proposal, not a fill", async () => {
    const { agentId } = await seedAgent(db, { config: approveConfig() });
    const result = await runAgent({ agentId, trigger: "manual" });

    const steps = await db
      .select()
      .from(schema.agentRunSteps)
      .where(and(eq(schema.agentRunSteps.runId, result.runId), eq(schema.agentRunSteps.kind, "tool_result")));
    const placed = steps.find((s) => s.toolName === "place_trade");
    const payload = JSON.stringify(placed?.payload);
    expect(payload).toContain("awaiting owner approval");
    expect(payload).toContain('"proposed":true');
  });
});

describe("decideProposal", () => {
  it("approve re-guards, fills, moves the position and publishes the post", async () => {
    const { agentId, userId, tradeId } = await proposeOnce();

    const decision = await decideProposal({ tradeId, ownerId: userId, decision: "approve" });
    expect(decision.ok).toBe(true);
    if (!decision.ok) return;
    expect(decision.status).toBe("filled");

    const [filled] = await db.select().from(schema.trades).where(eq(schema.trades.id, tradeId));
    expect(filled?.status).toBe("filled");
    expect(filled?.decidedBy).toBe("owner");
    expect(filled?.decidedAt).not.toBeNull();
    expect(filled?.filledAt).not.toBeNull();
    expect(Number(filled?.amountToken)).toBeGreaterThan(0);
    expect(Number(filled?.amountUsd)).toBeCloseTo(50, 6);
    expect(Number(filled?.feeUsd)).toBeCloseTo(0.15, 6);
    // The requested notional survives the fill, so the record shows what was asked for.
    expect(Number(filled?.requestedUsd)).toBeCloseTo(50, 6);

    const held = await db.select().from(schema.positions).where(eq(schema.positions.agentId, agentId));
    expect(held).toHaveLength(1);
    expect(Number(held[0]?.amountToken)).toBeGreaterThan(0);

    const feed = await db
      .select()
      .from(schema.posts)
      .where(and(eq(schema.posts.agentId, agentId), eq(schema.posts.kind, "trade")));
    expect(feed).toHaveLength(1);
    expect(feed[0]?.tradeId).toBe(tradeId);
    expect(feed[0]?.body).toBe(filled?.rationale);
  });

  it("notifies followers on approval, exactly as an automatic fill does", async () => {
    const { agentId, userId, tradeId } = await proposeOnce();
    const follower = `did:privy:f-${agentId.slice(0, 8)}`;
    await db.insert(schema.users).values({ id: follower, handle: `h${agentId.slice(0, 8)}` });
    await db.insert(schema.follows).values({ followerId: follower, targetType: "agent", targetId: agentId });

    await decideProposal({ tradeId, ownerId: userId, decision: "approve" });

    const notes = await db.select().from(schema.notifications).where(eq(schema.notifications.userId, follower));
    expect(notes).toHaveLength(1);
    expect(notes[0]?.kind).toBe("trade");
    expect(notes[0]?.title).toContain("BONK");
  });

  it("reject settles the row and publishes nothing", async () => {
    const { agentId, userId, tradeId } = await proposeOnce();

    const decision = await decideProposal({ tradeId, ownerId: userId, decision: "reject" });
    expect(decision.ok).toBe(true);

    const [row] = await db.select().from(schema.trades).where(eq(schema.trades.id, tradeId));
    expect(row?.status).toBe("rejected");
    expect(row?.decidedBy).toBe("owner");
    expect(row?.decidedAt).not.toBeNull();

    const held = await db.select().from(schema.positions).where(eq(schema.positions.agentId, agentId));
    expect(held).toHaveLength(0);
    const feed = await db
      .select()
      .from(schema.posts)
      .where(and(eq(schema.posts.agentId, agentId), eq(schema.posts.kind, "trade")));
    expect(feed).toHaveLength(0);
  });

  it("refuses somebody else's proposal", async () => {
    const { tradeId } = await proposeOnce();
    const stranger = await seedAgent(db);

    const decision = await decideProposal({ tradeId, ownerId: stranger.userId, decision: "approve" });
    expect(decision.ok).toBe(false);
    if (decision.ok) return;
    expect(decision.error).toContain("do not own");

    const [row] = await db.select().from(schema.trades).where(eq(schema.trades.id, tradeId));
    expect(row?.status).toBe("proposed");
  });

  it("rejects with decidedBy 'guard' when the trade no longer clears the risk guard", async () => {
    const { agentId, userId, tradeId } = await proposeOnce();

    // The operator blocklists the token between the proposal and the decision.
    const [agent] = await db.select().from(schema.agents).where(eq(schema.agents.id, agentId));
    await db
      .update(schema.agents)
      .set({
        config: {
          ...agent!.config,
          universe: {
            ...agent!.config.universe,
            blocklist: [{ chain: "solana", address: BONK, symbol: "BONK" }],
          },
        },
      })
      .where(eq(schema.agents.id, agentId));

    const decision = await decideProposal({ tradeId, ownerId: userId, decision: "approve" });
    expect(decision.ok).toBe(false);
    if (decision.ok) return;
    expect(decision.error).toContain("blocklist");

    const [row] = await db.select().from(schema.trades).where(eq(schema.trades.id, tradeId));
    expect(row?.status).toBe("rejected");
    expect(row?.decidedBy).toBe("guard");
    expect(row?.error).toContain("No longer allowed");

    const held = await db.select().from(schema.positions).where(eq(schema.positions.agentId, agentId));
    expect(held).toHaveLength(0);
  });

  it("fills once when the owner double-taps approve", async () => {
    const { agentId, userId, tradeId } = await proposeOnce();

    const [first, second] = await Promise.all([
      decideProposal({ tradeId, ownerId: userId, decision: "approve" }),
      decideProposal({ tradeId, ownerId: userId, decision: "approve" }),
    ]);

    const outcomes = [first, second];
    expect(outcomes.filter((r) => r.ok)).toHaveLength(1);
    const loser = outcomes.find((r) => !r.ok);
    expect(loser).toBeDefined();
    if (loser && !loser.ok) expect(loser.error).toMatch(/already/i);

    // One fill, one position, one post — the race cannot double-spend.
    const rows = await db.select().from(schema.trades).where(eq(schema.trades.agentId, agentId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("filled");
    const feed = await db
      .select()
      .from(schema.posts)
      .where(and(eq(schema.posts.agentId, agentId), eq(schema.posts.kind, "trade")));
    expect(feed).toHaveLength(1);
  });
});

describe("expireProposals", () => {
  it("expires anything past its TTL and leaves fresh proposals alone", async () => {
    const stale = await proposeOnce();
    const fresh = await proposeOnce();

    // Age the first proposal past its 60-minute TTL.
    const longAgo = new Date(Date.now() - 61 * 60_000);
    await db.update(schema.trades).set({ proposedAt: longAgo }).where(eq(schema.trades.id, stale.tradeId));

    const expired = await expireProposals();
    expect(expired).toBe(1);

    const [dead] = await db.select().from(schema.trades).where(eq(schema.trades.id, stale.tradeId));
    expect(dead?.status).toBe("expired");
    expect(dead?.decidedBy).toBe("expiry");
    expect(dead?.decidedAt).not.toBeNull();

    const [alive] = await db.select().from(schema.trades).where(eq(schema.trades.id, fresh.tradeId));
    expect(alive?.status).toBe("proposed");
  });

  it("refuses to approve an expired proposal and settles it as expired", async () => {
    const { userId, tradeId } = await proposeOnce();
    await db
      .update(schema.trades)
      .set({ proposedAt: new Date(Date.now() - 120 * 60_000) })
      .where(eq(schema.trades.id, tradeId));

    const decision = await decideProposal({ tradeId, ownerId: userId, decision: "approve" });
    expect(decision.ok).toBe(false);
    if (decision.ok) return;
    expect(decision.error).toMatch(/expired/i);

    const [row] = await db.select().from(schema.trades).where(eq(schema.trades.id, tradeId));
    expect(row?.status).toBe("expired");
    expect(row?.decidedBy).toBe("expiry");
  });

  it("honours the agent's own TTL", () => {
    const at = new Date("2026-01-01T00:00:00.000Z");
    const config = { ...DEFAULT_AGENT_CONFIG, execution: { mode: "approve" as const, proposalTtlMinutes: 15 } };
    expect(proposalExpiresAt(at, config).toISOString()).toBe("2026-01-01T00:15:00.000Z");
    // A missing or nonsense TTL falls back to an hour rather than expiring instantly.
    const broken = { ...DEFAULT_AGENT_CONFIG, execution: { mode: "approve" as const, proposalTtlMinutes: 0 } };
    expect(proposalExpiresAt(at, broken).toISOString()).toBe("2026-01-01T01:00:00.000Z");
  });
});

async function agentSlug(agentId: string): Promise<string> {
  const [row] = await db.select({ slug: schema.agents.slug }).from(schema.agents).where(eq(schema.agents.id, agentId));
  return row?.slug ?? "";
}
