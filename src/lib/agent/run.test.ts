import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, asc, eq } from "drizzle-orm";
import type { Db } from "@/db";
import * as schema from "@/db/schema";
import { seedKnownTokens } from "@/lib/trading/tokens";
import { ABANDONED_RUN_ERROR, reapStaleRuns, runAgent, startRun } from "./run";
import { seedAgent, setupTestDb } from "./test-support";
import { DEFAULT_AGENT_CONFIG, MIN_SCHEDULE_MINUTES, parseAgentConfig } from "./config";
import { RunLogger } from "./logger";
import { SCHEDULE_GRACE_MS, nextRunTime } from "./schedule";

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
    // The paid reading is quoted; the vendor it was bought from is not — the rationale is
    // public, and which sources an operator pays for is theirs.
    expect(trade?.rationale).toContain("X sentiment");
    expect(trade?.rationale).not.toContain("SentimentAlpha");

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

/**
 * `executeRun` runs a row as stored when its config no longer parses: the schema has
 * tightened since it was saved, and one field the schema now refuses must not stop the
 * agent. The schedule floor is the one rewrite the schema makes that scheduling
 * depends on, so it has to hold on that path too.
 */
describe("a stored config the schema no longer accepts", () => {
  it("still runs, and is never rescheduled sooner than the shortest schedule allows", async () => {
    const { agentId } = await seedAgent(db, {
      config: {
        dataSources: ["sentimentalpha"],
        chains: ["solana"],
        schedule: { intervalMinutes: 1 },
        // Text where a model id belongs: refused on write since the id became public.
        llm: { ...DEFAULT_AGENT_CONFIG.llm, model: "not a model id" },
      },
    });
    expect(() => parseAgentConfig({ ...DEFAULT_AGENT_CONFIG, llm: { ...DEFAULT_AGENT_CONFIG.llm, model: "not a model id" } })).toThrow();

    const began = Date.now();
    const result = await runAgent({ agentId, trigger: "schedule", invocationStartedAt: began });
    expect(result.status).toBe("succeeded");

    // One pass on, as for an agent set to the shortest schedule: never the one minute stored.
    const [agent] = await db.select().from(schema.agents).where(eq(schema.agents.id, agentId));
    expect(agent?.nextRunAt).toEqual(new Date(began + MIN_SCHEDULE_MINUTES * 60_000 - SCHEDULE_GRACE_MS));
  });
});

/**
 * An agent's next run is counted from when the invocation that ran it began (the cron
 * pass, or the request behind Run now), not from when the run finished. Counted from the
 * finish, every agent came due just after the pass it was set to run on and ran one pass
 * late, every time: three runs an hour for "every 15 min". The rule and the hour it is
 * proved on are in `schedule.test.ts` and `schedule-grid.test.ts`; this is the run loop
 * writing it, for the ways a key agent's run ends.
 */
describe("when the agent is due again", () => {
  const MINUTE = 60_000;
  const agentRow = async (agentId: string) => (await db.select().from(schema.agents).where(eq(schema.agents.id, agentId)))[0];
  /** The default schedule: every 15 minutes. */
  const dueAfter = (began: number) => new Date(began + DEFAULT_AGENT_CONFIG.schedule.intervalMinutes * MINUTE - SCHEDULE_GRACE_MS);

  it("is one interval, less the grace, after the pass that ran it began: a run that worked", async () => {
    const { agentId } = await seedAgent(db, { config: { dataSources: [], chains: ["solana"] } });
    // The pass began a little before this agent's turn came.
    const began = Date.now() - 30_000;
    expect((await runAgent({ agentId, trigger: "schedule", invocationStartedAt: began })).status).toBe("succeeded");

    const row = await agentRow(agentId);
    expect(row?.nextRunAt).toEqual(dueAfter(began));
    // When it finished is still what `lastRunAt` says, and plays no part.
    expect(row?.lastRunAt?.getTime()).toBeGreaterThan(began + 30_000 - 1);
  });

  it("is the same for a run that failed", async () => {
    const { agentId } = await seedAgent(db, { mode: "live", config: { chains: ["solana"] } });
    const began = Date.now();
    expect((await runAgent({ agentId, trigger: "schedule", invocationStartedAt: began })).status).toBe("failed");
    expect((await agentRow(agentId))?.nextRunAt).toEqual(dueAfter(began));
  });

  it("is counted from the request for a run started by hand", async () => {
    const { agentId } = await seedAgent(db, { config: { dataSources: [], chains: ["solana"] } });
    const began = Date.now();
    expect((await runAgent({ agentId, trigger: "manual", invocationStartedAt: began })).status).toBe("succeeded");
    expect((await agentRow(agentId))?.nextRunAt).toEqual(dueAfter(began));
  });

  /** Believed, a start an hour old would leave the agent due at once, after every run. */
  it("is counted from the run's own start when the invocation's start it was handed cannot be true", async () => {
    const { agentId } = await seedAgent(db, { config: { dataSources: [], chains: ["solana"] } });
    const before = Date.now();
    expect((await runAgent({ agentId, trigger: "schedule", invocationStartedAt: before - 3_600_000 })).status).toBe("succeeded");
    const next = (await agentRow(agentId))?.nextRunAt?.getTime() ?? 0;
    expect(next).toBeGreaterThanOrEqual(dueAfter(before).getTime());
    expect(next).toBeLessThanOrEqual(dueAfter(Date.now()).getTime());
  });

  it("is never, for an agent that only runs by hand", async () => {
    const { agentId } = await seedAgent(db, { config: { dataSources: [], chains: ["solana"], schedule: { intervalMinutes: 0 } } });
    expect((await runAgent({ agentId, trigger: "manual" })).status).toBe("succeeded");
    const row = await agentRow(agentId);
    expect(row?.nextRunAt).toBeNull();
    expect(row?.lastRunAt).not.toBeNull();
  });

  it("is not moved by a run that was refused because another was in flight", async () => {
    const { agentId } = await seedAgent(db, { config: { dataSources: [], chains: ["solana"] } });
    const due = new Date(Date.now() - MINUTE);
    await db.update(schema.agents).set({ nextRunAt: due }).where(eq(schema.agents.id, agentId));
    await db.insert(schema.agentRuns).values({ id: `flying-${agentId}`, agentId, trigger: "schedule", status: "running", startedAt: new Date() });

    // Due, with a run in flight: the pass picks it, the claim is refused, nothing starts.
    expect((await runAgent({ agentId, trigger: "schedule" })).status).toBe("skipped");
    const row = await agentRow(agentId);
    expect(row?.nextRunAt).toEqual(due);
    expect(row?.lastRunAt).toBeNull();
    const rows = await db.select().from(schema.agentRuns).where(eq(schema.agentRuns.agentId, agentId));
    expect(rows.map((run) => run.status).sort()).toEqual(["cancelled", "running"]);
  });

  /**
   * A run reads its config when it starts. Its end used to write the next run from that
   * config, so a schedule its owner saved while it was in flight was put back: and since
   * a save only moves the next run when the schedule changes, saving again did not mend
   * it. The interval is now read when the run ends.
   *
   * Each case saves where a run flushes its transcript, which every run does once before
   * it writes its end, and saves what `updateAgent` saves: the config, and the next run
   * counted from the save.
   */
  describe("with a schedule saved while the run was in flight", () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    /** Has the next run of `agentId` save `change` on the agent's row before it ends. */
    function saveMidRun(agentId: string, change: (config: schema.AgentConfig) => Partial<typeof schema.agents.$inferInsert>): void {
      const flush = RunLogger.prototype.flush;
      let saved = false;
      vi.spyOn(RunLogger.prototype, "flush").mockImplementation(async function (this: RunLogger) {
        if (!saved) {
          saved = true;
          const row = await agentRow(agentId);
          if (row) await db.update(schema.agents).set(change(row.config)).where(eq(schema.agents.id, agentId));
        }
        return flush.call(this);
      });
    }

    /** The save `updateAgent` makes when the interval changes. */
    const interval = (intervalMinutes: number) => (config: schema.AgentConfig) => ({
      config: { ...config, schedule: { intervalMinutes } },
      nextRunAt: nextRunTime(intervalMinutes, Date.now()),
    });
    const seedOn = (intervalMinutes: number) => seedAgent(db, { config: { dataSources: [], chains: ["solana"], schedule: { intervalMinutes } } });

    /** It used to end with no next run at all, under "Runs every 15 min". */
    it("keeps the schedule given to an agent that ran by hand only", async () => {
      const { agentId } = await seedOn(0);
      saveMidRun(agentId, interval(15));

      const began = Date.now();
      expect((await runAgent({ agentId, trigger: "manual", invocationStartedAt: began })).status).toBe("succeeded");
      const row = await agentRow(agentId);
      expect(row?.config.schedule.intervalMinutes).toBe(15);
      expect(row?.nextRunAt).toEqual(new Date(began + 15 * MINUTE - SCHEDULE_GRACE_MS));
    });

    /** It used to be put back on its five minutes for one more run, paid for. */
    it("takes no further run once the agent was set to run by hand only", async () => {
      const { agentId } = await seedOn(5);
      saveMidRun(agentId, interval(0));

      expect((await runAgent({ agentId, trigger: "schedule", invocationStartedAt: Date.now() })).status).toBe("succeeded");
      const row = await agentRow(agentId);
      expect(row?.nextRunAt).toBeNull();
      expect(row?.lastRunAt).not.toBeNull();
    });

    /** It used to wait a day for its next run. */
    it("is due on the new interval when a daily agent was set to every 15 minutes", async () => {
      const { agentId } = await seedOn(1_440);
      saveMidRun(agentId, interval(15));

      const began = Date.now();
      expect((await runAgent({ agentId, trigger: "schedule", invocationStartedAt: began })).status).toBe("succeeded");
      expect((await agentRow(agentId))?.nextRunAt).toEqual(new Date(began + 15 * MINUTE - SCHEDULE_GRACE_MS));
    });

    it("is the same for a run that failed", async () => {
      const { agentId } = await seedAgent(db, { mode: "live", config: { chains: ["solana"], schedule: { intervalMinutes: 60 } } });
      saveMidRun(agentId, interval(0));

      expect((await runAgent({ agentId, trigger: "schedule", invocationStartedAt: Date.now() })).status).toBe("failed");
      expect((await agentRow(agentId))?.nextRunAt).toBeNull();
    });

    /** The end of a run must not fail, or leave the agent unscheduled, over a row it cannot read a schedule from. */
    it("counts on the interval the run started with when the row no longer holds one", async () => {
      const { agentId } = await seedOn(60);
      saveMidRun(agentId, (config) => ({
        // Refused by the schema (the model), and with no schedule on it at all.
        config: { ...config, llm: { ...config.llm, model: "not a model id" }, schedule: undefined } as unknown as schema.AgentConfig,
      }));

      const began = Date.now();
      expect((await runAgent({ agentId, trigger: "schedule", invocationStartedAt: began })).status).toBe("succeeded");
      expect((await agentRow(agentId))?.nextRunAt).toEqual(new Date(began + 60 * MINUTE - SCHEDULE_GRACE_MS));
    });
  });
});
