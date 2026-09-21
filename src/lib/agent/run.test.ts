import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, asc, eq } from "drizzle-orm";
import type { Db } from "@/db";
import * as schema from "@/db/schema";
import { seedKnownTokens } from "@/lib/trading/tokens";
import { ABANDONED_RUN_ERROR, reapStaleRuns, runAgent, startRun } from "./run";
import { seedAgent, setupTestDb } from "./test-support";
import { DEFAULT_AGENT_CONFIG } from "./config";

let db: Db;

beforeAll(async () => {
  process.env.X402_MOCK = "1";
  process.env.LLM_MOCK = "1";
  db = await setupTestDb();
  await seedKnownTokens();
});

/** The paper executor needs a price; keep every test offline and deterministic. */
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
      return new Response(
        JSON.stringify({ DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263: { usdPrice: pricePerToken } }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}

beforeEach(() => {
  stubPricing();
});

describe("runAgent with the scripted mock model", () => {
  it("runs the full loop: portfolio → discover → deep score (paid) → trade → post → finish", async () => {
    const { agentId, userId } = await seedAgent(db, {
      config: { dataSources: ["sentimentalpha"], chains: ["solana"] },
    });

    const result = await runAgent({ agentId, trigger: "manual" });
    expect(result.status).toBe("succeeded");
    expect(result.summary).toMatch(/bonk/i); // Jupiter reports the symbol as "Bonk"

    const runs = await db.select().from(schema.agentRuns).where(eq(schema.agentRuns.id, result.runId));
    expect(runs[0]?.status).toBe("succeeded");
    expect(runs[0]?.startedAt).not.toBeNull();
    expect(runs[0]?.finishedAt).not.toBeNull();
    // $0.01 of sentiment on the deep score, plus $0.012 for the SolEnrich launch radar
    // that every discovery sweep now buys.
    expect(Number(runs[0]?.dataSpendUsd)).toBeCloseTo(0.022, 6);
    expect(runs[0]?.inputTokens).toBeGreaterThan(0);

    // Step log: a tool_call/tool_result pair per tool, with durations on the results.
    const steps = await db
      .select()
      .from(schema.agentRunSteps)
      .where(eq(schema.agentRunSteps.runId, result.runId))
      .orderBy(asc(schema.agentRunSteps.seq));
    // `review_positions` is in the mock script but only fires once it is registered in
    // buildTools (the exit-engine workstream ships the tool; registration is a merge
    // step), and a `guardian` step only appears when an exit actually fired. Both are
    // filtered out so this assertion is about the core loop.
    const calls = steps
      .filter((s) => s.kind === "tool_call")
      .map((s) => s.toolName)
      .filter((name) => name !== "review_positions");
    // The core loop, then `finish` — once, or twice when the runtime sent the model back
    // for the fresh candidates it did not score (the script scores one, so it is sent
    // back once and finishes again, as a real model does).
    expect(calls.slice(0, 4)).toEqual(["get_portfolio", "discover_tokens", "score_token", "place_trade"]);
    expect(calls.slice(4).length).toBeGreaterThanOrEqual(1);
    expect(calls.slice(4).every((name) => name === "finish")).toBe(true);
    const results = steps.filter(
      (s) => s.kind === "tool_result" && s.toolName !== "review_positions" && s.toolName !== "guardian",
    );
    expect(results).toHaveLength(calls.length);
    expect(results.every((s) => typeof s.durationMs === "number")).toBe(true);
    expect(steps.some((s) => s.kind === "message")).toBe(true);
    expect(steps.map((s) => s.seq)).toEqual(steps.map((_, i) => i));

    // x402: two simulated payments recorded against the run — the SolEnrich launch
    // radar every sweep buys, and the sentiment read on the deep score.
    const payments = await db.select().from(schema.x402Payments).where(eq(schema.x402Payments.agentId, agentId));
    expect(payments).toHaveLength(2);
    expect(payments.every((p) => p.simulated)).toBe(true);
    expect(payments.every((p) => p.runId === result.runId)).toBe(true);

    // Trade: filled, paper, linked to the run.
    const trades = await db.select().from(schema.trades).where(eq(schema.trades.agentId, agentId));
    expect(trades).toHaveLength(1);
    const trade = trades[0];
    expect(trade?.status).toBe("filled");
    expect(trade?.isPaper).toBe(true);
    expect(trade?.side).toBe("buy");
    expect(trade?.runId).toBe(result.runId);
    expect(trade?.filledAt).not.toBeNull();
    expect(Number(trade?.amountUsd)).toBeCloseTo(50, 6);
    expect(Number(trade?.amountToken)).toBeGreaterThan(0);
    expect(Number(trade?.feeUsd)).toBeCloseTo(0.15, 6);
    expect(trade?.rationale).toContain("SentimentAlpha");

    // Position + cash.
    const held = await db.select().from(schema.positions).where(eq(schema.positions.agentId, agentId));
    expect(held).toHaveLength(1);
    expect(Number(held[0]?.amountToken)).toBeGreaterThan(0);

    // Feed post carrying the rationale, authored by the owner.
    const feed = await db.select().from(schema.posts).where(eq(schema.posts.agentId, agentId));
    expect(feed).toHaveLength(1);
    expect(feed[0]?.kind).toBe("trade");
    expect(feed[0]?.authorId).toBe(userId);
    expect(feed[0]?.tradeId).toBe(trade?.id);
    expect(feed[0]?.body).toBe(trade?.rationale);

    // Equity snapshot at the end of the run.
    const snapshots = await db
      .select()
      .from(schema.equitySnapshots)
      .where(eq(schema.equitySnapshots.agentId, agentId));
    expect(snapshots).toHaveLength(1);
    // $50 ticket, 0.3% paper venue fee, and the flat $0.10 platform fee (W5). The last
    // term is the point: a paper agent pays the Tocker fee too, so paper cash and paper
    // PnL feel exactly what the same strategy would feel live.
    expect(Number(snapshots[0]?.cashUsd)).toBeCloseTo(10_000 - 50 - 0.15 - 0.1, 4);

    // Schedule advanced.
    const agents = await db.select().from(schema.agents).where(eq(schema.agents.id, agentId));
    expect(agents[0]?.lastRunAt).not.toBeNull();
    expect(agents[0]?.nextRunAt).not.toBeNull();
  });

  it("notifies followers of the agent when it trades", async () => {
    const { agentId } = await seedAgent(db, { config: { dataSources: ["sentimentalpha"], chains: ["solana"] } });
    const follower = `did:privy:follower-${agentId.slice(0, 6)}`;
    await db.insert(schema.users).values({ id: follower, handle: `f${agentId.slice(0, 8)}` });
    await db.insert(schema.follows).values({ followerId: follower, targetType: "agent", targetId: agentId });

    await runAgent({ agentId, trigger: "schedule" });

    const notes = await db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.userId, follower));
    expect(notes).toHaveLength(1);
    expect(notes[0]?.kind).toBe("trade");
    expect(notes[0]?.title).toContain("BONK");
  });

  it("rejects the trade through the risk guard when the token is on the blocklist", async () => {
    const { agentId } = await seedAgent(db, {
      config: {
        dataSources: ["sentimentalpha"],
        chains: ["solana"],
        universe: {
          ...DEFAULT_AGENT_CONFIG.universe,
          blocklist: [{ chain: "solana", address: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", symbol: "BONK" }],
        },
      },
    });

    const result = await runAgent({ agentId, trigger: "manual" });
    expect(result.status).toBe("succeeded");

    const trades = await db.select().from(schema.trades).where(eq(schema.trades.agentId, agentId));
    expect(trades).toHaveLength(0);
    const feed = await db.select().from(schema.posts).where(eq(schema.posts.agentId, agentId));
    expect(feed).toHaveLength(0);

    const steps = await db
      .select()
      .from(schema.agentRunSteps)
      .where(and(eq(schema.agentRunSteps.runId, result.runId), eq(schema.agentRunSteps.kind, "tool_result")));
    const placed = steps.find((s) => s.toolName === "place_trade");
    expect(JSON.stringify(placed?.payload)).toContain("blocklist");
  });

  it("refuses to run a live agent whose wallets are paper placeholders", async () => {
    const { agentId } = await seedAgent(db, { mode: "live", config: { chains: ["solana"] } });

    const result = await runAgent({ agentId, trigger: "manual" });
    expect(result.status).toBe("failed");
    expect(result.error).toContain("Privy server wallets");

    const runs = await db.select().from(schema.agentRuns).where(eq(schema.agentRuns.id, result.runId));
    expect(runs[0]?.status).toBe("failed");

    // The owner is told.
    const notes = await db.select().from(schema.notifications);
    expect(notes.some((n) => n.kind === "run_failed")).toBe(true);
  });

  it("fails cleanly when the agent does not exist", async () => {
    const result = await runAgent({ agentId: "nope", trigger: "manual" });
    expect(result.status).toBe("failed");
    expect(result.error).toBe("Agent not found");
  });

  it("skips a concurrent run for the same agent", async () => {
    const { agentId } = await seedAgent(db, { config: { dataSources: ["sentimentalpha"], chains: ["solana"] } });

    // Simulate an in-flight run by leaving a `running` row behind.
    await db.insert(schema.agentRuns).values({
      id: `inflight-${agentId}`,
      agentId,
      trigger: "schedule",
      status: "running",
      startedAt: new Date(),
    });

    const result = await runAgent({ agentId, trigger: "manual" });
    expect(result.status).toBe("skipped");

    const runs = await db.select().from(schema.agentRuns).where(eq(schema.agentRuns.id, result.runId));
    expect(runs[0]?.status).toBe("cancelled");
    const trades = await db.select().from(schema.trades).where(eq(schema.trades.agentId, agentId));
    expect(trades).toHaveLength(0);
  });
});

describe("startRun", () => {
  it("returns the run id straight away and finishes in the background", async () => {
    const { agentId } = await seedAgent(db, { config: { dataSources: ["sentimentalpha"], chains: ["solana"] } });

    const { runId } = await startRun({ agentId, trigger: "manual" });
    expect(runId).toBeTruthy();

    const started = await db.select().from(schema.agentRuns).where(eq(schema.agentRuns.id, runId));
    expect(started).toHaveLength(1);

    // Give the background work a moment, then assert it landed.
    for (let i = 0; i < 60; i += 1) {
      const rows = await db.select().from(schema.agentRuns).where(eq(schema.agentRuns.id, runId));
      if (rows[0]?.status === "succeeded" || rows[0]?.status === "failed") break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const finished = await db.select().from(schema.agentRuns).where(eq(schema.agentRuns.id, runId));
    expect(finished[0]?.status).toBe("succeeded");
  });
});

/**
 * W7 B3. On Vercel the invocation is frozen the moment the response is flushed, so a run
 * continued on a detached promise dies mid-tick and leaves its row `running`. Nothing
 * read that row back, and `claimRun`'s `NOT EXISTS` then cancelled every future run for
 * that agent — permanently. These are the tests that would have caught it.
 */
describe("stale run reaping", () => {
  const staleDate = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000);

  it("marks a running row older than ten minutes as failed", async () => {
    const { agentId } = await seedAgent(db);
    await db.insert(schema.agentRuns).values({
      id: `dead-${agentId}`,
      agentId,
      trigger: "schedule",
      status: "running",
      startedAt: staleDate(11),
    });

    expect(await reapStaleRuns(agentId)).toBe(1);

    const [row] = await db.select().from(schema.agentRuns).where(eq(schema.agentRuns.id, `dead-${agentId}`));
    expect(row?.status).toBe("failed");
    expect(row?.error).toBe(ABANDONED_RUN_ERROR);
    expect(row?.finishedAt).not.toBeNull();
  });

  it("reaps a queued row that never started, dated from createdAt", async () => {
    const { agentId } = await seedAgent(db);
    await db.insert(schema.agentRuns).values({
      id: `queued-${agentId}`,
      agentId,
      trigger: "schedule",
      status: "queued",
      startedAt: null,
      createdAt: staleDate(30),
    });

    expect(await reapStaleRuns(agentId)).toBe(1);
    const [row] = await db.select().from(schema.agentRuns).where(eq(schema.agentRuns.id, `queued-${agentId}`));
    expect(row?.status).toBe("failed");
  });

  it("leaves a run that is still inside the window alone", async () => {
    const { agentId } = await seedAgent(db);
    await db.insert(schema.agentRuns).values({
      id: `live-${agentId}`,
      agentId,
      trigger: "schedule",
      status: "running",
      startedAt: staleDate(9),
    });

    expect(await reapStaleRuns(agentId)).toBe(0);
    const [row] = await db.select().from(schema.agentRuns).where(eq(schema.agentRuns.id, `live-${agentId}`));
    expect(row?.status).toBe("running");
  });

  it("never touches a finished row", async () => {
    const { agentId } = await seedAgent(db);
    await db.insert(schema.agentRuns).values({
      id: `done-${agentId}`,
      agentId,
      trigger: "schedule",
      status: "succeeded",
      startedAt: staleDate(600),
      finishedAt: staleDate(599),
    });

    expect(await reapStaleRuns(agentId)).toBe(0);
    const [row] = await db.select().from(schema.agentRuns).where(eq(schema.agentRuns.id, `done-${agentId}`));
    expect(row?.status).toBe("succeeded");
  });

  it("only reaps the agent it was asked about", async () => {
    const a = await seedAgent(db);
    const b = await seedAgent(db);
    for (const { agentId } of [a, b]) {
      await db.insert(schema.agentRuns).values({
        id: `stale-${agentId}`,
        agentId,
        trigger: "schedule",
        status: "running",
        startedAt: staleDate(20),
      });
    }

    expect(await reapStaleRuns(a.agentId)).toBe(1);
    const [other] = await db.select().from(schema.agentRuns).where(eq(schema.agentRuns.id, `stale-${b.agentId}`));
    expect(other?.status).toBe("running");
    // No agent filter: the cron sweep takes whatever is left.
    expect(await reapStaleRuns()).toBe(1);
  });

  it("lets a new run claim the agent once the abandoned one is reaped", async () => {
    const { agentId } = await seedAgent(db, { config: { dataSources: ["sentimentalpha"], chains: ["solana"] } });
    await db.insert(schema.agentRuns).values({
      id: `abandoned-${agentId}`,
      agentId,
      trigger: "manual",
      status: "running",
      startedAt: staleDate(12),
    });

    // Before B3 this returned `skipped` — "Another run is already in progress" — and
    // went on doing so for the rest of the agent's life.
    const result = await runAgent({ agentId, trigger: "manual" });
    expect(result.status).toBe("succeeded");

    const [abandoned] = await db
      .select()
      .from(schema.agentRuns)
      .where(eq(schema.agentRuns.id, `abandoned-${agentId}`));
    expect(abandoned?.status).toBe("failed");
    expect(abandoned?.error).toBe(ABANDONED_RUN_ERROR);
  });
});
