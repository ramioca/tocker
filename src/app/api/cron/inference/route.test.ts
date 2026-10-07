/**
 * The pay-per-use cron route: who may call it, what it runs, and what it says. The
 * ledger and the reconciler are the real code against in-memory PGlite; only the run
 * loop's hold re-check is stood in for, since this route must work with or without it.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import type { Db } from "@/db";
import { inferenceBudgetDays, inferenceControl, inferencePayments } from "@/db/schema";
import { setupTestDb } from "@/lib/agent/test-support";
import { createInferenceLedger } from "@/lib/x402/inference-ledger";
import { INFERENCE_GATEWAY } from "@/lib/x402/inference-types";

const SECRET = "s".repeat(64);
let db: Db;
let caller = 0;

/**
 * What the run loop's module exports in this test. `undefined` stands for a build that
 * does not have the export yet (a mocked module must name every key it is asked for).
 */
const WITHOUT_RECHECK: Record<string, unknown> = { recheckInferenceHolds: undefined };
let inferenceModule = WITHOUT_RECHECK;
let loaded: { from: Record<string, unknown>; route: typeof import("./route") } | null = null;

/** The route, imported afresh whenever `inferenceModule` has been replaced. */
async function route(): Promise<typeof import("./route")> {
  if (loaded?.from !== inferenceModule) {
    const from = inferenceModule;
    vi.resetModules();
    vi.doMock("@/lib/agent/inference-gate", () => from);
    loaded = { from, route: await import("./route") };
  }
  return loaded.route;
}

async function call(options: { secret?: string | null; ip?: string; headers?: Record<string, string> } = {}): Promise<Response> {
  const { GET } = await route();
  caller += 1;
  const headers: Record<string, string> = { "x-real-ip": options.ip ?? `10.0.0.${caller}`, ...options.headers };
  if (options.secret !== null) headers.authorization = `Bearer ${options.secret ?? SECRET}`;
  return GET(new NextRequest("http://localhost/api/cron/inference", { headers }));
}

let seeded = 0;

async function seedOpenPayment(): Promise<{ id: string; memo: string; payer: string }> {
  const ledger = createInferenceLedger();
  seeded += 1;
  const payer = "PayerAddressThatMustNotBePrinted11111111111";
  const memo = "5e".repeat(16);
  const reserved = await ledger.reserve({
    ownerId: "owner-secretive",
    agentId: "agent-secretive",
    runId: `run-secretive-${seeded}`,
    seq: 0,
    requestHash: "ab".repeat(32),
    chain: "solana",
    network: INFERENCE_GATEWAY.solana.network,
    host: INFERENCE_GATEWAY.solana.host,
    model: "google/gemini-2.5-flash",
    payerWalletId: "wallet-secretive",
    payerAddress: payer,
    payTo: INFERENCE_GATEWAY.solana.payTo[0],
    asset: INFERENCE_GATEWAY.solana.asset,
    quotedUsd: 0.01,
    caps: { stepUsd: 0.25, runUsd: 1, agentDayUsd: 5, ownerDayUsd: 25, platformDayUsd: 100, agentDayRequests: 600, maxRequestsPerRun: 21 },
    runSpentUsd: 0,
    now: new Date(Date.now() - 30 * 60_000),
  });
  if (!reserved.ok) throw new Error("reserve refused");
  await db
    .update(inferencePayments)
    .set({ status: "unconfirmed", memo, signedAt: new Date(Date.now() - 30 * 60_000) })
    .where(eq(inferencePayments.id, reserved.paymentId));
  return { id: reserved.paymentId, memo, payer };
}

beforeAll(async () => {
  db = await setupTestDb();
}, 120_000);

beforeEach(async () => {
  await db.delete(inferencePayments);
  await db.delete(inferenceBudgetDays);
  await db.delete(inferenceControl);
  inferenceModule = WITHOUT_RECHECK;
  vi.stubEnv("CRON_SECRET", SECRET);
  // Mock mode, as in local dev and CI: the reconciler must not reach for a chain.
  vi.stubEnv("X402_MOCK", "1");
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("GET /api/cron/inference", () => {
  describe("who may call it", () => {
    it("refuses a caller with no bearer, a wrong one, or the cron header alone, and does no work", async () => {
      const recheck = vi.fn(async () => ({ checked: 1 }));
      inferenceModule = { recheckInferenceHolds: recheck };
      const stale = await seedOpenPayment();
      await db.update(inferencePayments).set({ status: "reserved" }).where(eq(inferencePayments.id, stale.id));

      const refused = [
        await call({ secret: null }),
        await call({ secret: "w".repeat(64) }),
        await call({ secret: "" }),
        // Anyone can send this header. It is not a credential.
        await call({ secret: null, headers: { "x-vercel-cron": "1" } }),
      ];
      for (const res of refused) {
        expect(res.status).toBe(401);
        expect(await res.json()).toEqual({ error: "unauthorized" });
      }
      expect(recheck).not.toHaveBeenCalled();
      // The stale row would have been released by a pass that ran.
      const [row] = await db.select().from(inferencePayments).where(eq(inferencePayments.id, stale.id));
      expect(row.status).toBe("reserved");
    });

    it("answers 503, not 401, when the deployment has no secret or one too short to be one", async () => {
      vi.stubEnv("CRON_SECRET", "");
      expect((await call()).status).toBe(503);
      vi.stubEnv("CRON_SECRET", "test");
      const res = await call({ secret: "test" });
      expect(res.status).toBe(503);
      expect((await res.json()).error).toMatch(/too short/);
    });

    it("rate limits before it checks the secret", async () => {
      const ip = "10.9.9.9";
      let last: Response | null = null;
      for (let n = 0; n < 31; n += 1) last = await call({ secret: "w".repeat(64), ip });
      expect(last!.status).toBe(429);
      expect(await last!.json()).toEqual({ error: "rate limited" });
      expect(last!.headers.get("retry-after")).not.toBeNull();
    });
  });

  it("with pay-per-use never used: finds nothing to do, writes nothing, and says so in counts", async () => {
    vi.stubEnv("INFERENCE_USDC", "");
    const fetched = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("the network must not be touched"));
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      reconcile: {
        skipped: "mock",
        staleReleased: 0,
        gaveUp: 0,
        examined: 0,
        charged: 0,
        confirmed: 0,
        notCharged: 0,
        runsResynced: 0,
        waiting: 0,
        stuck: 0,
        unproven: 0,
        unknownTransfers: 0,
        strayTransfers: 0,
        heldAgents: 0,
        decoys: 0,
        mismatches: 0,
        unchecked: 0,
        rpcCalls: 0,
        rpcErrors: 0,
        halted: false,
      },
      breakers: { tripped: null, pausedUntil: null },
      holds: null,
      failed: [],
    });
    expect(fetched).not.toHaveBeenCalled();
    expect(await db.select().from(inferenceControl)).toHaveLength(0);
    expect(await db.select().from(inferenceBudgetDays)).toHaveLength(0);
    expect(await db.select().from(inferencePayments)).toHaveLength(0);
  });

  it("answers with counts and fixed words only, whatever the reconciler counts", async () => {
    const body = await (await call()).json();
    // Every figure the pass reports is a number, a flag, or the one fixed word for why it did not look.
    for (const [key, value] of Object.entries(body.reconcile as Record<string, unknown>)) {
      expect(key === "skipped" ? [null, "mock", "no_rpc"].includes(value as string | null) : typeof value === "number" || typeof value === "boolean").toBe(true);
    }
  });

  it("runs the reconciler: a row never signed and long abandoned is released", async () => {
    const stale = await seedOpenPayment();
    await db.update(inferencePayments).set({ status: "reserved", memo: null, signedAt: null }).where(eq(inferencePayments.id, stale.id));
    const body = await (await call()).json();
    expect(body.reconcile.staleReleased).toBe(1);
    const [row] = await db.select().from(inferencePayments).where(eq(inferencePayments.id, stale.id));
    expect(row.status).toBe("released");
  });

  it("re-checks holds when the run loop offers that, and reports its counts only", async () => {
    const recheck = vi.fn(async () => ({ checked: 4, cleared: 1, extended: 3, agents: ["agent-a", "agent-b"], note: "agent-a was funded", done: true }));
    inferenceModule = { recheckInferenceHolds: recheck };
    const res = await call();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(recheck).toHaveBeenCalledTimes(1);
    // Numbers and flags pass; a list becomes its length; text is dropped.
    expect(body.holds).toEqual({ checked: 4, cleared: 1, extended: 3, agents: 2, done: true });
    expect(JSON.stringify(body)).not.toContain("agent-a");
  });

  it("accepts a bare count or a list from the re-check", async () => {
    inferenceModule = { recheckInferenceHolds: async () => 7 };
    expect((await (await call()).json()).holds).toBe(7);
    inferenceModule = { recheckInferenceHolds: async () => ["agent-a", "agent-b", "agent-c"] };
    expect((await (await call()).json()).holds).toBe(3);
    inferenceModule = { recheckInferenceHolds: async () => "three agents cleared" };
    expect((await (await call()).json()).holds).toBeNull();
  });

  it("never puts a payment row's contents in the answer", async () => {
    const open = await seedOpenPayment();
    const res = await call();
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(JSON.parse(text).reconcile.stuck).toBe(0);
    for (const secretive of [open.id, open.memo, open.payer, "owner-secretive", "agent-secretive", "run-secretive", "wallet-secretive"]) {
      expect(text).not.toContain(secretive);
    }
  });

  it("still runs the other jobs when one fails, answers 500, and does not echo the error", async () => {
    const recheck = vi.fn(async () => {
      throw new Error("Failed query: select * from agents where id = $1 params: agent-secretive");
    });
    inferenceModule = { recheckInferenceHolds: recheck };
    const stale = await seedOpenPayment();
    await db.update(inferencePayments).set({ status: "reserved", memo: null, signedAt: null }).where(eq(inferencePayments.id, stale.id));

    const res = await call();
    expect(res.status).toBe(500);
    const text = await res.text();
    const body = JSON.parse(text);
    expect(body).toMatchObject({ ok: false, failed: ["holds"], holds: null, breakers: { tripped: null } });
    // The reconciler ran and its work stands.
    expect(body.reconcile.staleReleased).toBe(1);
    expect(text).not.toContain("agent-secretive");
    expect(text).not.toContain("Failed query");
    const logged = vi.mocked(console.error).mock.calls.flat().join(" ");
    expect(logged).toContain("holds failed");
    expect(logged).not.toContain("agent-secretive");
  });

  /** A step paid (or maybe paid) a minute ago with no answer, by this agent of this account. */
  async function unanswered(ownerId: string, agentId: string, at: Date): Promise<void> {
    const open = await seedOpenPayment();
    await db
      .update(inferencePayments)
      .set({ ownerId, agentId, runId: `run-${agentId}-${open.id}`, signedAt: at, createdAt: at })
      .where(eq(inferencePayments.id, open.id));
  }

  it("reports a breaker that tripped, by its rule and its end", async () => {
    const real = new Date();
    const at = new Date(real.getTime() - 60_000);
    // Three unanswered steps from two accounts.
    await unanswered("owner-a", "agent-1", at);
    await unanswered("owner-a", "agent-1", at);
    await unanswered("owner-b", "agent-2", at);
    const body = await (await call()).json();
    expect(body.breakers.tripped).toBe("unanswered");
    expect(new Date(body.breakers.pausedUntil).getTime()).toBeGreaterThan(real.getTime() + 28 * 60_000);
    expect(await db.select().from(inferenceControl)).toHaveLength(1);
  });

  it("does not pause everyone over one account's unanswered steps, however many agents it has", async () => {
    const at = new Date(Date.now() - 60_000);
    for (const agentId of ["agent-1", "agent-1", "agent-2", "agent-3"]) await unanswered("owner-a", agentId, at);
    const body = await (await call()).json();
    expect(body.breakers).toEqual({ tripped: null, pausedUntil: null });
    expect(await db.select().from(inferenceControl)).toHaveLength(0);
  });

  it("answers POST the same way", async () => {
    const { POST } = await route();
    const res = await POST(new NextRequest("http://localhost/api/cron/inference", { method: "POST", headers: { authorization: `Bearer ${SECRET}`, "x-real-ip": "10.8.8.8" } }));
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });
});
