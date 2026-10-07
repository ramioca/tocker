/**
 * "Run one tick now" against the owner's kill switch.
 *
 * The scheduler skips a paused owner's agents and `place_trade` refuses their buys, but a
 * run started by hand used to start anyway and spend the owner's model tokens on a tick
 * that could open nothing. The session and the run loop are mocked; the ownership check,
 * the switch and the database are the real code against in-memory PGlite.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import type { Db } from "@/db";
import * as schema from "@/db/schema";
import { RUN_REFUSED_WHILE_PAUSED, RunRefusedError } from "@/lib/agent/run-gate";
import { seedAgent, setupTestDb } from "@/lib/agent/test-support";
import { setTradingPaused } from "@/lib/security/kill-switch";

let sessionUserId: string | null = null;
const startRun = vi.fn<(input: { agentId: string; trigger: string; invocationStartedAt?: number }) => Promise<{ runId: string }>>(
  async () => ({ runId: "run_test" }),
);

vi.mock("@/lib/auth", () => ({
  requireSession: async () => {
    if (!sessionUserId) throw new Error("no session");
    return { userId: sessionUserId, handle: "owner", displayName: null, avatarUrl: null, email: null };
  },
}));
vi.mock("@/lib/agent/run", () => ({
  startRun: (input: { agentId: string; trigger: string; invocationStartedAt?: number }) => startRun(input),
}));

const { POST } = await import("./route");

let db: Db;

beforeAll(async () => {
  db = await setupTestDb();
}, 120_000);

beforeEach(() => {
  sessionUserId = null;
  startRun.mockClear();
});

const run = (agentId: string) =>
  POST(new Request(`http://localhost/api/agents/${agentId}/run`, { method: "POST" }), {
    params: Promise.resolve({ id: agentId }),
  });

describe("POST /api/agents/[id]/run", () => {
  it("refuses while the owner has paused all trading, with the sentence the wizard shows", async () => {
    const agent = await seedAgent(db);
    sessionUserId = agent.userId;
    await setTradingPaused(agent.userId, true);

    const res = await run(agent.agentId);

    // 409 is the one status whose body the wizard prints as written.
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: RUN_REFUSED_WHILE_PAUSED });
    expect(startRun).not.toHaveBeenCalled();
    expect(await db.select().from(schema.agentRuns).where(eq(schema.agentRuns.agentId, agent.agentId))).toHaveLength(0);
  });

  it("starts the run when trading is not paused, and again once it is resumed", async () => {
    const agent = await seedAgent(db);
    sessionUserId = agent.userId;

    const first = await run(agent.agentId);
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ ok: true, runId: "run_test" });

    await setTradingPaused(agent.userId, true);
    expect((await run(agent.agentId)).status).toBe(409);
    await setTradingPaused(agent.userId, false);
    expect((await run(agent.agentId)).status).toBe(200);
    expect(startRun).toHaveBeenCalledTimes(2);
  });

  /** The switch is the owner's. It is read after ownership, so it tells a stranger nothing. */
  it("answers a stranger and a signed-out caller exactly as before", async () => {
    const agent = await seedAgent(db);
    await setTradingPaused(agent.userId, true);

    expect((await run(agent.agentId)).status).toBe(401);

    const stranger = await seedAgent(db);
    sessionUserId = stranger.userId;
    const res = await run(agent.agentId);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden" });
    expect(startRun).not.toHaveBeenCalled();
  });

  it("still refuses a draft first", async () => {
    const agent = await seedAgent(db);
    sessionUserId = agent.userId;
    await db.update(schema.agents).set({ status: "draft" }).where(eq(schema.agents.id, agent.agentId));
    await setTradingPaused(agent.userId, true);

    const res = await run(agent.agentId);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/draft/);
  });

  it("tells the run when this invocation began, taken before anything else", async () => {
    const agent = await seedAgent(db);
    sessionUserId = agent.userId;
    const before = Date.now();

    expect((await run(agent.agentId)).status).toBe(200);
    const [input] = startRun.mock.calls[0] ?? [];
    expect(input).toMatchObject({ agentId: agent.agentId, trigger: "manual" });
    expect(input?.invocationStartedAt).toBeGreaterThanOrEqual(before);
    expect(input?.invocationStartedAt).toBeLessThanOrEqual(Date.now());
  });

  /** An agent that pays for its own thinking and may not run: the sentence, as written, and no run. */
  it("answers 409 with the sentence when the run loop will not start a pay-per-use agent", async () => {
    const agent = await seedAgent(db);
    sessionUserId = agent.userId;
    const said = "This agent pays for its own thinking, and its Solana wallet does not hold enough USDC for a run.";
    startRun.mockRejectedValueOnce(new RunRefusedError(said, "needs_funds"));

    const res = await run(agent.agentId);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: said });
  });

  it("keeps anything else that goes wrong out of the body", async () => {
    const agent = await seedAgent(db);
    sessionUserId = agent.userId;
    startRun.mockRejectedValueOnce(new Error("relation agent_runs does not exist"));
    const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const res = await run(agent.agentId);
    quiet.mockRestore();
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("agent_runs");
  });
});
