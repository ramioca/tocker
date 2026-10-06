/**
 * The two actions that only write an audit row: the budget-change note and the manual-run
 * note. Neither moves anything, so what they must get right is the log itself. The
 * operator's dashboard prints every user's audit sentences, and a caller is whoever
 * holds a session, so the sentence may only ever be built from four fixed names and
 * numbers, and a run may only be noted when it happened.
 *
 * `getSession` and `next/cache` are mocked because these are server actions, and so is
 * everything else the module imports that would leave the process (the same set as
 * security.test.ts). Ownership, the audit rows and the limiter are the real code against
 * in-memory PGlite.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { Db } from "@/db";
import * as schema from "@/db/schema";
import { seedAgent, setupTestDb } from "@/lib/agent/test-support";
import type { Session } from "@/server/types";

let session: Session | null = null;

vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));
vi.mock("@/lib/auth", () => ({
  getSession: async () => session,
  requireSession: async () => session,
}));
vi.mock("@/lib/security/live-readiness", () => ({
  evaluateLiveReadiness: async () => ({ ready: true, steps: [] }),
  withFirstTradePreset: (config: unknown) => config,
}));
vi.mock("@/lib/security/mfa", () => ({
  secondFactorBlock: async () => null,
  getMfaStatus: async () => ({ available: false, appMethods: [], userMethods: [], enrolled: false }),
  rememberMfaStatus: async () => undefined,
  lastKnownMfaMethods: async () => [],
}));
vi.mock("@/lib/wallets", () => ({ withdrawFromAgent: async () => ({ txHash: null, actionId: null, status: "failed" }) }));
vi.mock("@/lib/agent/portfolio", () => ({
  getPortfolio: async () => ({}),
  snapshotEquity: async () => undefined,
}));

const { noteBudgetChangeAction, noteManualRunAction } = await import("./security");

let db: Db;

beforeAll(async () => {
  db = await setupTestDb();
}, 120_000);

beforeEach(() => {
  session = null;
});

const CAPS = { maxTradeUsd: 25, maxDailyTrades: 10, maxPositionPct: 20, maxDataSpendUsdPerRun: 0.25 };

/** A seeded agent, signed in as its owner. */
async function ownedAgent() {
  const seeded = await seedAgent(db);
  session = { userId: seeded.userId, handle: "owner", displayName: null, avatarUrl: null, email: null };
  return seeded;
}

function auditRows(userId: string, kind: "budget_change" | "manual_run") {
  return db
    .select()
    .from(schema.auditEvents)
    .where(and(eq(schema.auditEvents.userId, userId), eq(schema.auditEvents.kind, kind)));
}

/** The action as a stranger with a session can call it: any JSON at all. */
const sendBudgetNote = noteBudgetChangeAction as unknown as (input: unknown) => ReturnType<typeof noteBudgetChangeAction>;
const sendRunNote = noteManualRunAction as unknown as (agentId: unknown, runId: unknown) => ReturnType<typeof noteManualRunAction>;

describe("noteBudgetChangeAction", () => {
  it("records a real change, naming only the caps that moved", async () => {
    const agent = await ownedAgent();
    const result = await noteBudgetChangeAction({
      agentId: agent.agentId,
      before: CAPS,
      after: { ...CAPS, maxTradeUsd: 50, maxDailyTrades: 4 },
    });
    expect(result).toEqual({ ok: true, data: undefined });

    const rows = await auditRows(agent.userId, "budget_change");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.summary).toBe("Changed Test Agent's spend caps: maxTradeUsd 25 → 50, maxDailyTrades 10 → 4.");
    expect(rows[0]?.metadata).toEqual({ before: CAPS, after: { ...CAPS, maxTradeUsd: 50, maxDailyTrades: 4 } });
  });

  it("writes nothing when nothing changed", async () => {
    const agent = await ownedAgent();
    expect(await noteBudgetChangeAction({ agentId: agent.agentId, before: CAPS, after: CAPS })).toEqual({ ok: true, data: undefined });
    expect(await auditRows(agent.userId, "budget_change")).toHaveLength(0);
  });

  it("refuses the caller's own keys, so their text never reaches the log", async () => {
    const agent = await ownedAgent();
    const fiction = "Withdrew 5000 USDC from the platform wallet";
    const result = await sendBudgetNote({
      agentId: agent.agentId,
      before: { [fiction]: "x" },
      after: { [fiction]: "y" },
    });
    expect(result).toEqual({ ok: false, error: "Nothing to record" });

    // And beside the four real caps, where the old code read every key of `after`.
    expect(
      await sendBudgetNote({
        agentId: agent.agentId,
        before: { ...CAPS, [fiction]: "x" },
        after: { ...CAPS, maxTradeUsd: 50, [fiction]: "y" },
      }),
    ).toEqual({ ok: false, error: "Nothing to record" });

    expect(await auditRows(agent.userId, "budget_change")).toHaveLength(0);
  });

  it("refuses values that are not finite numbers, whatever their size", async () => {
    const agent = await ownedAgent();
    const megabyte = "A".repeat(1_000_000);
    for (const bad of [megabyte, "50", null, Number.NaN, Number.POSITIVE_INFINITY, { toString: () => "50" }, [50]]) {
      const result = await sendBudgetNote({
        agentId: agent.agentId,
        before: CAPS,
        after: { ...CAPS, maxTradeUsd: bad },
      });
      expect(result, String(bad).slice(0, 20)).toEqual({ ok: false, error: "Nothing to record" });
    }
    expect(await auditRows(agent.userId, "budget_change")).toHaveLength(0);
  });

  it("refuses a missing cap, an extra top-level field and input that is not an object", async () => {
    const agent = await ownedAgent();
    const { maxPositionPct: _dropped, ...threeCaps } = CAPS;
    for (const input of [
      { agentId: agent.agentId, before: CAPS, after: threeCaps },
      { agentId: agent.agentId, before: CAPS, after: { ...CAPS, maxTradeUsd: 50 }, note: "anything" },
      { agentId: "x".repeat(65), before: CAPS, after: { ...CAPS, maxTradeUsd: 50 } },
      { agentId: 7, before: CAPS, after: { ...CAPS, maxTradeUsd: 50 } },
      null,
      "budget",
      undefined,
    ]) {
      expect(await sendBudgetNote(input)).toEqual({ ok: false, error: "Nothing to record" });
    }
    expect(await auditRows(agent.userId, "budget_change")).toHaveLength(0);
  });

  it("still refuses someone else's agent and a signed-out caller", async () => {
    const theirs = await seedAgent(db);
    const mine = await ownedAgent();
    const change = { before: CAPS, after: { ...CAPS, maxTradeUsd: 50 } };
    expect(await noteBudgetChangeAction({ agentId: theirs.agentId, ...change })).toEqual({ ok: false, error: "You do not own this agent" });
    expect(await auditRows(mine.userId, "budget_change")).toHaveLength(0);
    expect(await auditRows(theirs.userId, "budget_change")).toHaveLength(0);

    session = null;
    expect(await noteBudgetChangeAction({ agentId: mine.agentId, ...change })).toEqual({ ok: false, error: "Sign in first" });
  });

  it("stops a loop of notes from burying the rest of the log", async () => {
    const agent = await ownedAgent();
    const results = [];
    for (let i = 0; i < 25; i++) {
      results.push(await noteBudgetChangeAction({ agentId: agent.agentId, before: CAPS, after: { ...CAPS, maxTradeUsd: 26 + i } }));
    }
    expect(results.filter((r) => r.ok)).toHaveLength(20);
    expect(await auditRows(agent.userId, "budget_change")).toHaveLength(20);
  });
});

describe("noteManualRunAction", () => {
  async function seedRun(agentId: string, trigger: "manual" | "schedule" = "manual"): Promise<string> {
    const id = `run_${nanoid(10)}`;
    await db.insert(schema.agentRuns).values({ id, agentId, trigger, status: "running" });
    return id;
  }

  it("records a manual run of the caller's agent", async () => {
    const agent = await ownedAgent();
    const runId = await seedRun(agent.agentId);
    expect(await noteManualRunAction(agent.agentId, runId)).toEqual({ ok: true, data: undefined });

    const rows = await auditRows(agent.userId, "manual_run");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.summary).toBe("Triggered a run of Test Agent by hand in paper mode.");
    expect(rows[0]?.metadata).toEqual({ runId, mode: "paper" });
  });

  it("refuses a run that does not exist, however the id is shaped", async () => {
    const agent = await ownedAgent();
    for (const runId of ["no-such-run", "", "x".repeat(65), "A".repeat(1_000_000), 42, null, { id: "run" }]) {
      expect(await sendRunNote(agent.agentId, runId)).toEqual({ ok: false, error: "Run not found" });
    }
    expect(await auditRows(agent.userId, "manual_run")).toHaveLength(0);
  });

  it("refuses another agent's run, and a run the schedule started", async () => {
    const other = await seedAgent(db);
    const theirRun = await seedRun(other.agentId);
    const agent = await ownedAgent();
    const scheduled = await seedRun(agent.agentId, "schedule");

    expect(await noteManualRunAction(agent.agentId, theirRun)).toEqual({ ok: false, error: "Run not found" });
    expect(await noteManualRunAction(agent.agentId, scheduled)).toEqual({ ok: false, error: "Run not found" });
    expect(await noteManualRunAction(other.agentId, theirRun)).toEqual({ ok: false, error: "You do not own this agent" });
    expect(await auditRows(agent.userId, "manual_run")).toHaveLength(0);
    expect(await auditRows(other.userId, "manual_run")).toHaveLength(0);
  });
});
