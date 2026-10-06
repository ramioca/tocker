/**
 * The ledger against a real (in-memory) Postgres: every move a payment row may make and
 * every one it may not, each cap alone and together, and the amount going back to the
 * right day exactly once.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { Db } from "@/db";
import { agentRuns, inferenceBudgetDays, inferenceControl, inferencePayments } from "@/db/schema";
import { seedAgent, setupTestDb } from "@/lib/agent/test-support";
import {
  INFERENCE_MOVES,
  InferenceLedgerError,
  applyInferenceBreakers,
  clearInferencePause,
  createInferenceLedger,
  dayUsage,
  haltInferenceOnce,
  noteManualRun,
  pauseInference,
  pauseInferenceUntil,
  readInferenceControl,
  releaseStaleReserved,
  resolveInferencePayment,
  runInferenceSpend,
  setInferenceHalt,
} from "./inference-ledger";
import {
  INFERENCE_GATEWAY,
  INFERENCE_PAYMENT_STATUSES,
  OWNER_DAY_MANUAL_RUNS,
  type InferenceCaps,
  type InferencePaymentStatus,
  type InferenceReserveInput,
} from "./inference-types";

const MINUTE = 60_000;
const NOON = new Date("2031-03-10T12:00:00.000Z");
const DAY = "2031-03-10";

const CAPS: InferenceCaps = {
  stepUsd: 0.25,
  runUsd: 1,
  agentDayUsd: 5,
  ownerDayUsd: 25,
  platformDayUsd: 100,
  agentDayRequests: 600,
  maxRequestsPerRun: 21,
};

let db: Db;
const ledger = createInferenceLedger();

function reserveInput(overrides: Partial<InferenceReserveInput> = {}): InferenceReserveInput {
  return {
    ownerId: "owner-1",
    agentId: "agent-1",
    runId: `run-${nanoid(8)}`,
    seq: 0,
    requestHash: "ab".repeat(32),
    chain: "solana",
    network: INFERENCE_GATEWAY.solana.network,
    host: INFERENCE_GATEWAY.solana.host,
    model: "google/gemini-2.5-flash",
    payerWalletId: "wallet-1",
    payerAddress: "PayerAddress1111111111111111111111111111111",
    payTo: INFERENCE_GATEWAY.solana.payTo[0],
    asset: INFERENCE_GATEWAY.solana.asset,
    quotedUsd: 0.01,
    caps: CAPS,
    runSpentUsd: 0,
    now: NOON,
    ...overrides,
  };
}

async function reserved(overrides: Partial<InferenceReserveInput> = {}): Promise<string> {
  const result = await ledger.reserve(reserveInput(overrides));
  if (!result.ok) throw new Error(`reserve refused: ${result.reason}`);
  return result.paymentId;
}

async function rowOf(paymentId: string) {
  const [row] = await db.select().from(inferencePayments).where(eq(inferencePayments.id, paymentId));
  return row;
}

async function counter(scope: string, scopeId: string, day = DAY): Promise<{ usd: number; requests: number } | null> {
  const [row] = await db
    .select()
    .from(inferenceBudgetDays)
    .where(and(eq(inferenceBudgetDays.scope, scope), eq(inferenceBudgetDays.scopeId, scopeId), eq(inferenceBudgetDays.day, day)));
  return row ? { usd: Number(row.usd), requests: row.requests } : null;
}

/** The three counters for the default owner and agent, as `[platform, owner, agent]` dollars. */
async function held(day = DAY, ownerId = "owner-1", agentId = "agent-1"): Promise<number[]> {
  const usage = await dayUsage({ ownerId, agentId, day });
  return [usage.platform.usd, usage.owner.usd, usage.agent.usd];
}

const SETTLED = {
  txHash: "TxHash111",
  settledUsd: 0.01,
  servedModel: "google/gemini-2.5-flash",
  httpStatus: 200,
  gatewayRequestId: "req-1",
  inputTokens: 1200,
  outputTokens: 300,
};
const SIGNED = { memo: "0f".repeat(16), blockhash: "Blockhash111", payerSignature: "PayerSig111" };

/** A fresh row brought to `status` through the ledger's own calls. */
async function rowIn(status: InferencePaymentStatus, overrides: Partial<InferenceReserveInput> = {}): Promise<string> {
  if (status === "simulated") return reserved({ ...overrides, simulated: true });
  const id = await reserved(overrides);
  if (status === "reserved") return id;
  if (status === "released") {
    await ledger.release(id, "gave up before signing");
    return id;
  }
  await ledger.markSigned(id, SIGNED);
  if (status === "signed") return id;
  if (status === "settled") await ledger.settle(id, SETTLED);
  if (status === "paid_no_answer") await ledger.markPaidNoAnswer(id, { txHash: "TxHash222", httpStatus: 502, detail: "no body" });
  if (status === "unconfirmed") await ledger.markUnconfirmed(id, { httpStatus: null, detail: "timed out" });
  if (status === "not_charged") await resolveInferencePayment(id, { charged: false, detail: "never landed" }, NOON);
  return id;
}

beforeAll(async () => {
  db = await setupTestDb();
});

beforeEach(async () => {
  // One platform counter and one control row are shared by every test, so each starts clean.
  await db.delete(inferencePayments);
  await db.delete(inferenceBudgetDays);
  await db.delete(inferenceControl);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("reserve", () => {
  it("writes a reserved row and counts the amount against the platform, the owner and the agent", async () => {
    const input = reserveInput({ quotedUsd: 0.0123 });
    const result = await ledger.reserve(input);
    expect(result).toMatchObject({ ok: true, budgetDay: DAY });
    if (!result.ok) return;

    const row = await rowOf(result.paymentId);
    expect(row).toMatchObject({
      ownerId: "owner-1",
      agentId: "agent-1",
      runId: input.runId,
      seq: 0,
      status: "reserved",
      quotedUsd: "0.012300",
      budgetDay: DAY,
      payTo: INFERENCE_GATEWAY.solana.payTo[0],
      settledUsd: null,
      signedAt: null,
      resolvedAt: null,
    });
    expect(row.createdAt.toISOString()).toBe(NOON.toISOString());
    expect(await counter("platform", "all")).toEqual({ usd: 0.0123, requests: 1 });
    expect(await counter("owner", "owner-1")).toEqual({ usd: 0.0123, requests: 1 });
    expect(await counter("agent", "agent-1")).toEqual({ usd: 0.0123, requests: 1 });
  });

  it("rounds a fraction of a micro-dollar up, never down to nothing", async () => {
    const id = await reserved({ quotedUsd: 0.0000001 });
    expect((await rowOf(id)).quotedUsd).toBe("0.000001");
    const exact = await reserved({ quotedUsd: 0.001 });
    expect((await rowOf(exact)).quotedUsd).toBe("0.001000");
  });

  it("refuses an amount that is not a positive number, before anything is written", async () => {
    for (const quotedUsd of [0, -0.01, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(await ledger.reserve(reserveInput({ quotedUsd }))).toEqual({ ok: false, reason: "pin_mismatch" });
    }
    expect(await db.select().from(inferencePayments)).toHaveLength(0);
    expect(await db.select().from(inferenceBudgetDays)).toHaveLength(0);
  });

  it("rejects, rather than refuses, a call with no owner, agent or run", async () => {
    await expect(ledger.reserve(reserveInput({ ownerId: "" }))).rejects.toBeInstanceOf(InferenceLedgerError);
    await expect(ledger.reserve(reserveInput({ agentId: "" }))).rejects.toBeInstanceOf(InferenceLedgerError);
    await expect(ledger.reserve(reserveInput({ runId: "" }))).rejects.toBeInstanceOf(InferenceLedgerError);
    expect(await db.select().from(inferencePayments)).toHaveLength(0);
  });

  describe("each cap alone", () => {
    /** Refused with `reason`, and nothing at all changed. */
    async function expectRefused(input: InferenceReserveInput, reason: string, before: number[]) {
      const rows = (await db.select().from(inferencePayments)).length;
      expect(await ledger.reserve(input)).toEqual({ ok: false, reason });
      expect((await db.select().from(inferencePayments)).length).toBe(rows);
      expect(await held()).toEqual(before);
    }

    it("the hard ceiling on one request", async () => {
      await expectRefused(reserveInput({ quotedUsd: 0.2501 }), "step_cap", [0, 0, 0]);
      expect((await ledger.reserve(reserveInput({ quotedUsd: 0.25 }))).ok).toBe(true);
    });

    it("the requests one run may make", async () => {
      await expectRefused(reserveInput({ seq: 21 }), "step_limit", [0, 0, 0]);
      await expectRefused(reserveInput({ seq: -1 }), "step_limit", [0, 0, 0]);
      await expectRefused(reserveInput({ seq: 1.5 }), "step_limit", [0, 0, 0]);
      expect((await ledger.reserve(reserveInput({ seq: 20 }))).ok).toBe(true);
    });

    it("the run cap, from what the caller says the run has spent", async () => {
      await expectRefused(reserveInput({ runSpentUsd: 0.995, quotedUsd: 0.01 }), "run_cap", [0, 0, 0]);
      expect((await ledger.reserve(reserveInput({ runSpentUsd: 0.99, quotedUsd: 0.01 }))).ok).toBe(true);
    });

    it("the run cap, from the ledger's own rows when the caller's figure is behind", async () => {
      const runId = "run-behind";
      const caps = { ...CAPS, runUsd: 0.03 };
      await reserved({ runId, seq: 0, caps });
      const second = await reserved({ runId, seq: 1, caps });
      await ledger.markSigned(second, SIGNED);
      await ledger.settle(second, SETTLED);
      const third = await reserved({ runId, seq: 2, caps });
      // Three cents are held. A caller that still believes nothing was spent is not believed.
      await expectRefused(reserveInput({ runId, seq: 3, caps, runSpentUsd: 0 }), "run_cap", [0.03, 0.03, 0.03]);
      // A released step no longer counts toward the run.
      await ledger.release(third, "gave up");
      expect((await ledger.reserve(reserveInput({ runId, seq: 3, caps, runSpentUsd: 0 }))).ok).toBe(true);
    });

    it("the platform's day", async () => {
      const caps = { ...CAPS, platformDayUsd: 0.02 };
      await reserved({ caps, agentId: "agent-2", ownerId: "owner-2" });
      await reserved({ caps, agentId: "agent-3", ownerId: "owner-3" });
      // Someone else's spending fills the platform's day for everyone.
      await expectRefused(reserveInput({ caps }), "platform_day_cap", [0.02, 0, 0]);
    });

    it("a platform limit of zero refuses everything", async () => {
      await expectRefused(reserveInput({ caps: { ...CAPS, platformDayUsd: 0 } }), "platform_day_cap", [0, 0, 0]);
      await expectRefused(reserveInput({ caps: { ...CAPS, platformDayUsd: 0 }, quotedUsd: 0.000001 }), "platform_day_cap", [0, 0, 0]);
      await expectRefused(reserveInput({ caps: { ...CAPS, platformDayUsd: 0 }, simulated: true }), "platform_day_cap", [0, 0, 0]);
      await expectRefused(reserveInput({ caps: { ...CAPS, platformDayUsd: Number.NaN } }), "platform_day_cap", [0, 0, 0]);
    });

    it("the owner's day, across that owner's agents", async () => {
      const caps = { ...CAPS, ownerDayUsd: 0.02 };
      await reserved({ caps, agentId: "agent-2" });
      await reserved({ caps, agentId: "agent-3" });
      await expectRefused(reserveInput({ caps }), "owner_day_cap", [0.02, 0.02, 0]);
      // Another owner is not held to this one's spending.
      expect((await ledger.reserve(reserveInput({ caps, ownerId: "owner-9", agentId: "agent-9" }))).ok).toBe(true);
    });

    it("the agent's day", async () => {
      const caps = { ...CAPS, agentDayUsd: 0.02 };
      await reserved({ caps });
      await reserved({ caps });
      await expectRefused(reserveInput({ caps }), "agent_day_cap", [0.02, 0.02, 0.02]);
      // The owner's other agent has its own day.
      expect((await ledger.reserve(reserveInput({ caps, agentId: "agent-2" }))).ok).toBe(true);
    });

    it("the agent's requests in a day", async () => {
      const caps = { ...CAPS, agentDayRequests: 2 };
      await reserved({ caps });
      await reserved({ caps });
      await expectRefused(reserveInput({ caps }), "request_limit", [0.02, 0.02, 0.02]);
      expect((await ledger.reserve(reserveInput({ caps, agentId: "agent-2" }))).ok).toBe(true);
    });

    it("a limit that is not a number fits nothing", async () => {
      await expectRefused(reserveInput({ caps: { ...CAPS, runUsd: Number.NaN } }), "run_cap", [0, 0, 0]);
      await expectRefused(reserveInput({ caps: { ...CAPS, ownerDayUsd: Number.NaN } }), "owner_day_cap", [0, 0, 0]);
      await expectRefused(reserveInput({ caps: { ...CAPS, agentDayUsd: Number.POSITIVE_INFINITY } }), "agent_day_cap", [0, 0, 0]);
      await expectRefused(reserveInput({ caps: { ...CAPS, agentDayRequests: Number.NaN } }), "request_limit", [0, 0, 0]);
      await expectRefused(reserveInput({ caps: { ...CAPS, stepUsd: Number.NaN } }), "step_cap", [0, 0, 0]);
      await expectRefused(reserveInput({ caps: { ...CAPS, maxRequestsPerRun: Number.NaN } }), "step_limit", [0, 0, 0]);
    });
  });

  describe("the caps together", () => {
    it("lets a payment land exactly on every limit at once, and nothing after it", async () => {
      const caps: InferenceCaps = { ...CAPS, runUsd: 0.05, agentDayUsd: 0.05, ownerDayUsd: 0.05, platformDayUsd: 0.05, agentDayRequests: 1 };
      expect((await ledger.reserve(reserveInput({ caps, quotedUsd: 0.05 }))).ok).toBe(true);
      expect(await held()).toEqual([0.05, 0.05, 0.05]);
      expect(await ledger.reserve(reserveInput({ caps, quotedUsd: 0.000001 }))).toEqual({ ok: false, reason: "platform_day_cap" });
      expect(await held()).toEqual([0.05, 0.05, 0.05]);
    });

    it("gives back what the earlier counters took when a later limit refuses", async () => {
      // The platform and the owner both have room; the agent does not. Their counters
      // must read as if this reserve had never been tried.
      const caps = { ...CAPS, agentDayUsd: 0.015 };
      await reserved({ caps });
      expect(await ledger.reserve(reserveInput({ caps }))).toEqual({ ok: false, reason: "agent_day_cap" });
      expect(await counter("platform", "all")).toEqual({ usd: 0.01, requests: 1 });
      expect(await counter("owner", "owner-1")).toEqual({ usd: 0.01, requests: 1 });
      expect(await counter("agent", "agent-1")).toEqual({ usd: 0.01, requests: 1 });
    });

    it("names the reasons in a fixed order: switches, step, run, platform, owner, agent", async () => {
      const full: InferenceCaps = { ...CAPS, runUsd: 0.01, agentDayUsd: 0.01, ownerDayUsd: 0.01, platformDayUsd: 0.01, agentDayRequests: 1 };
      await reserved({ caps: full, runId: "run-order", seq: 0 });
      const next = { caps: full, runId: "run-order", seq: 1, runSpentUsd: 0.01 };
      await setInferenceHalt({ halted: true, reason: "drill", by: "admin" });
      // The step ceiling and the step count need no database, so they answer first.
      expect(await ledger.reserve(reserveInput({ ...next, quotedUsd: 0.26 }))).toEqual({ ok: false, reason: "step_cap" });
      expect(await ledger.reserve(reserveInput({ ...next, seq: 21 }))).toEqual({ ok: false, reason: "step_limit" });
      expect(await ledger.reserve(reserveInput(next))).toEqual({ ok: false, reason: "run_cap" });
      // With the run's own limit out of the way, the switch speaks before any counter.
      const otherRun = { caps: full, runSpentUsd: 0 };
      expect(await ledger.reserve(reserveInput(otherRun))).toEqual({ ok: false, reason: "halted" });
      await setInferenceHalt({ halted: false, reason: null, by: "admin" });
      expect(await ledger.reserve(reserveInput(otherRun))).toEqual({ ok: false, reason: "platform_day_cap" });
      expect(await ledger.reserve(reserveInput({ ...otherRun, caps: { ...full, platformDayUsd: 9 } }))).toEqual({ ok: false, reason: "owner_day_cap" });
      expect(await ledger.reserve(reserveInput({ ...otherRun, caps: { ...full, platformDayUsd: 9, ownerDayUsd: 9 } }))).toEqual({
        ok: false,
        reason: "request_limit",
      });
      expect(
        await ledger.reserve(reserveInput({ ...otherRun, caps: { ...full, platformDayUsd: 9, ownerDayUsd: 9, agentDayRequests: 9 } })),
      ).toEqual({ ok: false, reason: "agent_day_cap" });
      expect(await held()).toEqual([0.01, 0.01, 0.01]);
    });

    it("starts every counter again on the next UTC day", async () => {
      const caps = { ...CAPS, agentDayUsd: 0.01, ownerDayUsd: 0.01, platformDayUsd: 0.01 };
      await reserved({ caps, now: new Date("2031-03-10T23:59:59.000Z") });
      expect(await ledger.reserve(reserveInput({ caps, now: new Date("2031-03-10T23:59:59.900Z") }))).toEqual({ ok: false, reason: "platform_day_cap" });
      const tomorrow = await ledger.reserve(reserveInput({ caps, now: new Date("2031-03-11T00:00:00.000Z") }));
      expect(tomorrow).toMatchObject({ ok: true, budgetDay: "2031-03-11" });
      expect(await held("2031-03-10")).toEqual([0.01, 0.01, 0.01]);
      expect(await held("2031-03-11")).toEqual([0.01, 0.01, 0.01]);
    });
  });

  describe("one row per step of a run", () => {
    it("refuses a second reserve for the same run and seq, and counts nothing for it", async () => {
      const runId = "run-dup";
      const first = await reserved({ runId, seq: 4 });
      expect(await ledger.reserve(reserveInput({ runId, seq: 4, quotedUsd: 0.02 }))).toEqual({ ok: false, reason: "step_limit" });
      expect(await db.select().from(inferencePayments)).toHaveLength(1);
      expect(await held()).toEqual([0.01, 0.01, 0.01]);
      expect((await counter("agent", "agent-1"))?.requests).toBe(1);
      // Even once the first is released: the step's place in the run is used.
      await ledger.release(first, "gave up");
      expect(await ledger.reserve(reserveInput({ runId, seq: 4 }))).toEqual({ ok: false, reason: "step_limit" });
      expect(await held()).toEqual([0, 0, 0]);
    });

    it("lets the same seq exist in another run, and another seq in the same run", async () => {
      await reserved({ runId: "run-a", seq: 0 });
      expect((await ledger.reserve(reserveInput({ runId: "run-b", seq: 0 }))).ok).toBe(true);
      expect((await ledger.reserve(reserveInput({ runId: "run-a", seq: 1 }))).ok).toBe(true);
    });

    it("is enforced by the database itself, not only by reserve", async () => {
      const id = await reserved({ runId: "run-raw", seq: 0 });
      const copy = { ...(await rowOf(id)), id: "second" };
      await expect(db.insert(inferencePayments).values(copy)).rejects.toThrow();
    });
  });

  describe("halt and pause", () => {
    it("refuses everything while the admin halt is on, and resumes when it is cleared", async () => {
      await setInferenceHalt({ halted: true, reason: "checking a pay-to change", by: "admin-1" });
      expect(await ledger.reserve(reserveInput())).toEqual({ ok: false, reason: "halted" });
      expect(await ledger.reserve(reserveInput({ simulated: true }))).toEqual({ ok: false, reason: "halted" });
      expect(await db.select().from(inferencePayments)).toHaveLength(0);
      expect(await db.select().from(inferenceBudgetDays)).toHaveLength(0);
      await setInferenceHalt({ halted: false, reason: null, by: "admin-1" });
      expect((await ledger.reserve(reserveInput())).ok).toBe(true);
    });

    it("refuses while a pause is running, measured against the reserve's own clock", async () => {
      await pauseInferenceUntil(new Date(NOON.getTime() + 10 * MINUTE), "breaker drill");
      expect(await ledger.reserve(reserveInput())).toEqual({ ok: false, reason: "paused" });
      expect(await ledger.reserve(reserveInput({ now: new Date(NOON.getTime() + 9 * MINUTE) }))).toEqual({ ok: false, reason: "paused" });
      expect((await ledger.reserve(reserveInput({ now: new Date(NOON.getTime() + 10 * MINUTE) }))).ok).toBe(true);
    });

    it("reports the halt when both are on", async () => {
      await pauseInferenceUntil(new Date(NOON.getTime() + 10 * MINUTE), "breaker drill");
      await setInferenceHalt({ halted: true, reason: "drill", by: "admin-1" });
      expect(await ledger.reserve(reserveInput())).toEqual({ ok: false, reason: "halted" });
    });
  });

  it("rejects with a plain sentence when the database fails, and leaks none of its text", async () => {
    const broken = { transaction: () => Promise.reject(new Error("Failed query: insert into inference_payments ... params: owner-1,secret")) };
    const g = globalThis as unknown as { __tockerDb?: unknown };
    const real = g.__tockerDb;
    g.__tockerDb = broken;
    try {
      const failure = await ledger.reserve(reserveInput()).then(
        () => null,
        (err: unknown) => err,
      );
      expect(failure).toBeInstanceOf(InferenceLedgerError);
      expect((failure as Error).message).toBe("The pay-per-use ledger could not be written. Nothing was reserved and nothing may be signed.");
    } finally {
      g.__tockerDb = real;
    }
    const logged = vi.mocked(console.error).mock.calls.flat().join(" ");
    expect(logged).toContain("query failed");
    expect(logged).not.toContain("secret");
  });
});

describe("the lifecycle", () => {
  it("allows exactly the moves the contract describes", () => {
    expect(INFERENCE_MOVES).toEqual({
      reserved: ["released", "signed"],
      signed: ["settled", "paid_no_answer", "unconfirmed", "not_charged"],
      unconfirmed: ["paid_no_answer", "not_charged"],
      released: [],
      settled: [],
      paid_no_answer: [],
      not_charged: [],
      simulated: [],
    });
    expect(Object.keys(INFERENCE_MOVES).sort()).toEqual([...INFERENCE_PAYMENT_STATUSES].sort());
  });

  describe("the moves that are allowed", () => {
    it("reserved to released: the caps get the amount back", async () => {
      const id = await reserved();
      await ledger.release(id, "the wallet did not sign");
      expect(await rowOf(id)).toMatchObject({ status: "released", detail: "the wallet did not sign" });
      expect((await rowOf(id)).resolvedAt).toBeInstanceOf(Date);
      expect(await counter("platform", "all")).toEqual({ usd: 0, requests: 0 });
      expect(await counter("owner", "owner-1")).toEqual({ usd: 0, requests: 0 });
      expect(await counter("agent", "agent-1")).toEqual({ usd: 0, requests: 0 });
    });

    it("reserved to signed: the memo, blockhash and signature are kept, the caps still hold", async () => {
      const id = await reserved();
      await ledger.markSigned(id, SIGNED);
      const row = await rowOf(id);
      expect(row).toMatchObject({ status: "signed", memo: SIGNED.memo, blockhash: SIGNED.blockhash, payerSignature: SIGNED.payerSignature });
      expect(row.signedAt).toBeInstanceOf(Date);
      expect(await held()).toEqual([0.01, 0.01, 0.01]);
    });

    it("signed to settled: the answer's figures are kept, the caps still hold", async () => {
      const id = await rowIn("signed");
      await ledger.settle(id, SETTLED);
      expect(await rowOf(id)).toMatchObject({
        status: "settled",
        answered: true,
        txHash: "TxHash111",
        settledUsd: "0.010000",
        servedModel: "google/gemini-2.5-flash",
        httpStatus: 200,
        gatewayRequestId: "req-1",
        inputTokens: 1200,
        outputTokens: 300,
      });
      expect(await held()).toEqual([0.01, 0.01, 0.01]);
    });

    it("signed to paid_no_answer, and signed to unconfirmed: both stay counted", async () => {
      const paid = await rowIn("signed");
      await ledger.markPaidNoAnswer(paid, { txHash: "TxHash222", httpStatus: 502, detail: "empty body" });
      expect(await rowOf(paid)).toMatchObject({ status: "paid_no_answer", answered: false, txHash: "TxHash222", httpStatus: 502, detail: "empty body" });

      const unknown = await rowIn("signed");
      await ledger.markUnconfirmed(unknown, { httpStatus: null, detail: "timed out" });
      expect(await rowOf(unknown)).toMatchObject({ status: "unconfirmed", answered: false, httpStatus: null, detail: "timed out", resolvedAt: null });
      expect(await held()).toEqual([0.02, 0.02, 0.02]);
    });

    it("unconfirmed to paid_no_answer, by the gateway's receipt or by the reconciler", async () => {
      const byReceipt = await rowIn("unconfirmed");
      await ledger.markPaidNoAnswer(byReceipt, { txHash: "TxHash333", httpStatus: null, detail: "receipt said settled" });
      expect((await rowOf(byReceipt)).status).toBe("paid_no_answer");

      const byChain = await rowIn("unconfirmed");
      expect(await resolveInferencePayment(byChain, { charged: true, txHash: "TxHash444", detail: "found on chain" }, NOON)).toBe(true);
      expect(await rowOf(byChain)).toMatchObject({ status: "paid_no_answer", txHash: "TxHash444", detail: "found on chain" });
      expect(await held()).toEqual([0.02, 0.02, 0.02]);
    });

    it("signed or unconfirmed to not_charged: the caps get the amount back", async () => {
      const left = await rowIn("signed");
      const failed = await rowIn("unconfirmed");
      expect(await held()).toEqual([0.02, 0.02, 0.02]);
      expect(await resolveInferencePayment(left, { charged: false, detail: "blockhash expired" }, NOON)).toBe(true);
      expect(await resolveInferencePayment(failed, { charged: false, detail: "blockhash expired" }, NOON)).toBe(true);
      expect(await rowOf(left)).toMatchObject({ status: "not_charged", answered: false, detail: "blockhash expired" });
      expect((await rowOf(failed)).status).toBe("not_charged");
      expect(await held()).toEqual([0, 0, 0]);
      expect((await counter("agent", "agent-1"))?.requests).toBe(0);
    });
  });

  describe("the moves that are refused", () => {
    const everyStatus = [...INFERENCE_PAYMENT_STATUSES];

    it("markSigned rejects on anything but a reserved row, so nothing is sent on it", async () => {
      for (const status of everyStatus.filter((s) => s !== "reserved" && s !== "simulated")) {
        const id = await rowIn(status);
        const before = await rowOf(id);
        await expect(ledger.markSigned(id, { memo: "other", blockhash: "other", payerSignature: "other" })).rejects.toBeInstanceOf(InferenceLedgerError);
        // Nothing about the row changed: not its status, and not the memo it is found by.
        expect(await rowOf(id)).toEqual(before);
      }
      await expect(ledger.markSigned("no-such-row", SIGNED)).rejects.toThrow(/Nothing may be sent/);
    });

    it("release changes nothing on a row that is past reserved, and gives nothing back", async () => {
      for (const status of everyStatus.filter((s) => s !== "reserved")) {
        await db.delete(inferencePayments);
        await db.delete(inferenceBudgetDays);
        const id = await rowIn(status);
        const before = await rowOf(id);
        const counters = await held();
        await ledger.release(id, "late release");
        expect(await rowOf(id)).toEqual(before);
        expect(await held()).toEqual(counters);
      }
      await expect(ledger.release("no-such-row", "nothing")).resolves.toBeUndefined();
    });

    it("a resolved row is never resolved again, by anyone", async () => {
      for (const status of ["settled", "paid_no_answer", "not_charged", "released"] as const) {
        await db.delete(inferencePayments);
        await db.delete(inferenceBudgetDays);
        await db.delete(inferenceControl);
        const id = await rowIn(status);
        const before = await rowOf(id);
        const counters = await held();
        expect(await resolveInferencePayment(id, { charged: true, txHash: "Other", detail: "again" }, NOON)).toBe(false);
        expect(await resolveInferencePayment(id, { charged: false, detail: "again" }, NOON)).toBe(false);
        expect(await rowOf(id)).toEqual(before);
        expect(await held()).toEqual(counters);
      }
    });

    it("the reconciler cannot touch a row that was never signed", async () => {
      const id = await reserved();
      expect(await resolveInferencePayment(id, { charged: false, detail: "no" }, NOON)).toBe(false);
      expect(await resolveInferencePayment(id, { charged: true, txHash: null, detail: "no" }, NOON)).toBe(false);
      expect((await rowOf(id)).status).toBe("reserved");
      expect(await held()).toEqual([0.01, 0.01, 0.01]);
    });

    it("an answer or a failure reported again changes nothing on a row already counted as charged", async () => {
      for (const status of ["settled", "paid_no_answer", "unconfirmed"] as const) {
        const id = await rowIn(status);
        const before = await rowOf(id);
        await ledger.settle(id, { ...SETTLED, txHash: "Different" });
        await ledger.markUnconfirmed(id, { httpStatus: 500, detail: "different" });
        if (status !== "unconfirmed") await ledger.markPaidNoAnswer(id, { txHash: "Different", httpStatus: 500, detail: "different" });
        expect(await rowOf(id)).toEqual(before);
      }
      expect((await readInferenceControl()).halted).toBe(false);
    });

    it("an answer on a row that was never marked signed is counted as charged, and the caller is told", async () => {
      for (const call of [
        (id: string) => ledger.settle(id, SETTLED),
        (id: string) => ledger.markPaidNoAnswer(id, { txHash: null, httpStatus: 500, detail: "x" }),
        (id: string) => ledger.markUnconfirmed(id, { httpStatus: null, detail: "x" }),
      ]) {
        await db.delete(inferencePayments);
        await db.delete(inferenceBudgetDays);
        const id = await reserved();
        await expect(call(id)).rejects.toBeInstanceOf(InferenceLedgerError);
        // Walked forward through the lifecycle, so the stale-row sweep can never hand its amount back.
        expect((await rowOf(id)).status).toBe("unconfirmed");
        expect(await held()).toEqual([0.01, 0.01, 0.01]);
        expect(await releaseStaleReserved(new Date(NOON.getTime() + 60 * MINUTE), 50, NOON)).toBe(0);
      }
    });

    it("an answer on a row whose amount was already given back halts pay-per-use", async () => {
      for (const status of ["released", "not_charged"] as const) {
        await db.delete(inferenceControl);
        const id = await rowIn(status);
        const before = await rowOf(id);
        await expect(ledger.settle(id, SETTLED)).rejects.toThrow(/halted/);
        expect(await rowOf(id)).toEqual(before);
        const control = await readInferenceControl();
        expect(control.halted).toBe(true);
        expect(control.haltReason).toContain(id);
        expect(control.updatedBy).toBe("ledger");
      }
    });

    it("rejects an answer for a row that does not exist", async () => {
      await expect(ledger.settle("no-such-row", SETTLED)).rejects.toThrow(/no such payment/);
      await expect(ledger.markUnconfirmed("no-such-row", { httpStatus: null, detail: "x" })).rejects.toThrow(/no such payment/);
      await expect(ledger.markPaidNoAnswer("no-such-row", { txHash: null, httpStatus: null, detail: "x" })).rejects.toThrow(/no such payment/);
    });
  });

  describe("every call on every status", () => {
    const COUNTED: readonly string[] = ["reserved", "signed", "settled", "paid_no_answer", "unconfirmed", "simulated"];

    /** Every status a row may ever reach from `from`, by the table of allowed moves. */
    function reachable(from: InferencePaymentStatus): Set<InferencePaymentStatus> {
      const seen = new Set<InferencePaymentStatus>([from]);
      const queue = [from];
      while (queue.length > 0) {
        for (const next of INFERENCE_MOVES[queue.pop() as InferencePaymentStatus]) {
          if (!seen.has(next)) {
            seen.add(next);
            queue.push(next);
          }
        }
      }
      return seen;
    }

    const calls: Record<string, (id: string) => Promise<unknown>> = {
      release: (id) => ledger.release(id, "release"),
      markSigned: (id) => ledger.markSigned(id, SIGNED),
      settle: (id) => ledger.settle(id, SETTLED),
      markPaidNoAnswer: (id) => ledger.markPaidNoAnswer(id, { txHash: "Tx", httpStatus: 502, detail: "x" }),
      markUnconfirmed: (id) => ledger.markUnconfirmed(id, { httpStatus: null, detail: "x" }),
      "reconciler: charged": (id) => resolveInferencePayment(id, { charged: true, txHash: "Tx", detail: "x" }, NOON),
      "reconciler: not charged": (id) => resolveInferencePayment(id, { charged: false, detail: "x" }, NOON),
      "reconciler: stale sweep": () => releaseStaleReserved(new Date(NOON.getTime() + 60 * MINUTE), 50, NOON),
    };

    it("leaves the row where it was or moves it along the lifecycle, and the counters always equal what the rows hold", async () => {
      for (const status of INFERENCE_PAYMENT_STATUSES) {
        for (const [name, call] of Object.entries(calls)) {
          await db.delete(inferencePayments);
          await db.delete(inferenceBudgetDays);
          await db.delete(inferenceControl);
          // A settled neighbour, so a counter that is wrongly emptied or doubled shows.
          await rowIn("settled", { quotedUsd: 0.05 });
          const id = await rowIn(status, { quotedUsd: 0.02 });
          await db.delete(inferenceControl);

          // Twice: whatever a call does, doing it again must not do it again.
          await call(id).catch(() => {});
          await call(id).catch(() => {});

          const after = (await rowOf(id)).status as InferencePaymentStatus;
          expect(reachable(status).has(after), `${name} on ${status} left the row ${after}`).toBe(true);

          const rows = await db.select().from(inferencePayments);
          const heldRows = rows.filter((row) => COUNTED.includes(row.status));
          const heldMicros = heldRows.reduce((sum, row) => sum + Math.round(Number(row.quotedUsd) * 1_000_000), 0);
          for (const [scope, scopeId] of [
            ["platform", "all"],
            ["owner", "owner-1"],
            ["agent", "agent-1"],
          ]) {
            const counted = await counter(scope, scopeId);
            expect(Math.round((counted?.usd ?? 0) * 1_000_000), `${name} on ${status}: ${scope} dollars`).toBe(heldMicros);
            expect(counted?.requests ?? 0, `${name} on ${status}: ${scope} requests`).toBe(heldRows.length);
          }
        }
      }
    });
  });

  describe("giving the amount back exactly once", () => {
    it("a second release returns nothing more", async () => {
      await reserved({ quotedUsd: 0.05 });
      const id = await reserved({ quotedUsd: 0.02 });
      await ledger.release(id, "first");
      await ledger.release(id, "second");
      await ledger.release(id, "third");
      expect(await held()).toEqual([0.05, 0.05, 0.05]);
      expect((await counter("agent", "agent-1"))?.requests).toBe(1);
      expect((await rowOf(id)).detail).toBe("first");
    });

    it("ten releases at once return the amount once", async () => {
      await reserved({ quotedUsd: 0.05 });
      const id = await reserved({ quotedUsd: 0.02 });
      await Promise.all(Array.from({ length: 10 }, (_, n) => ledger.release(id, `release ${n}`)));
      expect(await held()).toEqual([0.05, 0.05, 0.05]);
      expect((await counter("platform", "all"))?.requests).toBe(1);
    });

    it("two verdicts at once, one each way, apply one and only one", async () => {
      await reserved({ quotedUsd: 0.05 });
      const id = await rowIn("unconfirmed", { quotedUsd: 0.02 });
      const [charged, notCharged] = await Promise.all([
        resolveInferencePayment(id, { charged: true, txHash: "Tx", detail: "found" }, NOON),
        resolveInferencePayment(id, { charged: false, detail: "not found" }, NOON),
      ]);
      expect([charged, notCharged].filter(Boolean)).toHaveLength(1);
      const status = (await rowOf(id)).status;
      expect(status).toBe(charged ? "paid_no_answer" : "not_charged");
      expect(await held()).toEqual(charged ? [0.07, 0.07, 0.07] : [0.05, 0.05, 0.05]);
    });

    it("never takes a counter below zero", async () => {
      const id = await reserved({ quotedUsd: 0.02 });
      // Someone reset the day's counters by hand while the row was open.
      await db.update(inferenceBudgetDays).set({ usd: "0.005000", requests: 0 });
      await ledger.release(id, "gave up");
      expect(await counter("platform", "all")).toEqual({ usd: 0, requests: 0 });
      expect(await counter("agent", "agent-1")).toEqual({ usd: 0, requests: 0 });
    });
  });

  describe("across midnight UTC", () => {
    const BEFORE = new Date("2031-03-10T23:59:50.000Z");
    const AFTER = new Date("2031-03-11T00:00:10.000Z");

    it("a release after midnight returns the amount to the day it was reserved on", async () => {
      const id = await reserved({ now: BEFORE, quotedUsd: 0.04 });
      const today = await reserved({ now: AFTER, quotedUsd: 0.03 });
      expect((await rowOf(id)).budgetDay).toBe("2031-03-10");
      expect((await rowOf(today)).budgetDay).toBe("2031-03-11");

      // The ledger's own clock is past midnight when the release happens.
      vi.useFakeTimers({ now: AFTER, toFake: ["Date"] });
      try {
        await ledger.release(id, "the wallet did not sign");
      } finally {
        vi.useRealTimers();
      }
      expect(await held("2031-03-10")).toEqual([0, 0, 0]);
      expect((await counter("agent", "agent-1", "2031-03-10"))?.requests).toBe(0);
      // The new day's counters are not touched by yesterday's release.
      expect(await held("2031-03-11")).toEqual([0.03, 0.03, 0.03]);
      expect((await counter("agent", "agent-1", "2031-03-11"))?.requests).toBe(1);
    });

    it("a not-charged verdict the next day does the same", async () => {
      const id = await rowIn("unconfirmed", { now: BEFORE, quotedUsd: 0.04 });
      await reserved({ now: AFTER, quotedUsd: 0.03 });
      expect(await resolveInferencePayment(id, { charged: false, detail: "never landed" }, new Date("2031-03-11T00:07:00.000Z"))).toBe(true);
      expect(await held("2031-03-10")).toEqual([0, 0, 0]);
      expect(await held("2031-03-11")).toEqual([0.03, 0.03, 0.03]);
    });

    it("a charged verdict the next day leaves both days as they were", async () => {
      const id = await rowIn("unconfirmed", { now: BEFORE, quotedUsd: 0.04 });
      await resolveInferencePayment(id, { charged: true, txHash: "Tx", detail: "found" }, AFTER);
      expect(await held("2031-03-10")).toEqual([0.04, 0.04, 0.04]);
      expect(await counter("platform", "all", "2031-03-11")).toBeNull();
    });
  });

  describe("simulated rows", () => {
    it("are written whole, count against every cap, and never move", async () => {
      const caps = { ...CAPS, agentDayUsd: 0.02 };
      const id = await reserved({ simulated: true, caps });
      expect(await rowOf(id)).toMatchObject({ status: "simulated", quotedUsd: "0.010000" });
      expect(await held()).toEqual([0.01, 0.01, 0.01]);

      await ledger.markSigned(id, SIGNED);
      await ledger.release(id, "late");
      await ledger.markUnconfirmed(id, { httpStatus: null, detail: "x" });
      await ledger.markPaidNoAnswer(id, { txHash: null, httpStatus: null, detail: "x" });
      expect(await resolveInferencePayment(id, { charged: false, detail: "x" }, NOON)).toBe(false);
      expect(await rowOf(id)).toMatchObject({ status: "simulated", memo: null, txHash: null });
      expect(await held()).toEqual([0.01, 0.01, 0.01]);

      // Caps and limits apply to simulated spend exactly as to real spend.
      await reserved({ simulated: true, caps });
      expect(await ledger.reserve(reserveInput({ simulated: true, caps }))).toEqual({ ok: false, reason: "agent_day_cap" });
    });

    it("keep the answer's figures for the screens, without changing status", async () => {
      const id = await reserved({ simulated: true });
      await ledger.settle(id, SETTLED);
      expect(await rowOf(id)).toMatchObject({ status: "simulated", answered: true, inputTokens: 1200, outputTokens: 300, servedModel: "google/gemini-2.5-flash" });
    });
  });

  it("stores outside text redacted and bounded, wherever it arrives", async () => {
    // Built at run time: nothing shaped like a key is written in this file.
    const key = `sk-${"A1b2".repeat(6)}`;
    const released = await reserved();
    await ledger.release(released, `Privy said: invalid key ${key}`);
    expect((await rowOf(released)).detail).toBe("Privy said: invalid key [redacted]");

    const settled = await rowIn("signed");
    await ledger.settle(settled, { ...SETTLED, servedModel: `model ${key}`, gatewayRequestId: `Bearer ${key}`, txHash: "x".repeat(900) });
    const row = await rowOf(settled);
    expect(row.servedModel).not.toContain(key);
    expect(row.gatewayRequestId).not.toContain(key);
    expect(row.txHash?.length).toBe(200);

    const failed = await rowIn("signed");
    await ledger.markUnconfirmed(failed, { httpStatus: 502, detail: `${"y".repeat(700)} ${key}` });
    expect((await rowOf(failed)).detail?.length).toBe(500);

    const paid = await rowIn("signed");
    await ledger.markPaidNoAnswer(paid, { txHash: null, httpStatus: 200, detail: `upstream: api_key=${key}` });
    expect((await rowOf(paid)).detail).not.toContain(key);
  });

  it("drops answer figures that are not counts", async () => {
    const id = await rowIn("signed");
    await ledger.settle(id, { ...SETTLED, settledUsd: Number.NaN, inputTokens: -5, outputTokens: 1.5, httpStatus: 200 });
    expect(await rowOf(id)).toMatchObject({ status: "settled", settledUsd: null, inputTokens: null, outputTokens: null });
  });
});

describe("releaseStaleReserved", () => {
  it("releases rows left reserved from before the cut-off, once, and only those", async () => {
    const old = await reserved({ now: new Date(NOON.getTime() - 30 * MINUTE) });
    const fresh = await reserved({ now: new Date(NOON.getTime() - 2 * MINUTE) });
    const signedOld = await rowIn("signed", { now: new Date(NOON.getTime() - 30 * MINUTE) });
    const cutOff = new Date(NOON.getTime() - 10 * MINUTE);

    expect(await releaseStaleReserved(cutOff, 50, NOON)).toBe(1);
    expect(await releaseStaleReserved(cutOff, 50, NOON)).toBe(0);
    expect((await rowOf(old)).status).toBe("released");
    expect((await rowOf(fresh)).status).toBe("reserved");
    expect((await rowOf(signedOld)).status).toBe("signed");
    expect(await held()).toEqual([0.02, 0.02, 0.02]);
  });

  it("does a bounded amount of work per call", async () => {
    for (let seq = 0; seq < 5; seq += 1) await reserved({ runId: "run-stale", seq, now: new Date(NOON.getTime() - 30 * MINUTE) });
    expect(await releaseStaleReserved(NOON, 2, NOON)).toBe(2);
    expect(await releaseStaleReserved(NOON, 2, NOON)).toBe(2);
    expect(await releaseStaleReserved(NOON, 2, NOON)).toBe(1);
    expect(await held()).toEqual([0, 0, 0]);
  });
});

describe("runInferenceSpend", () => {
  it("sums what counts as spent, plus simulated rows, and counts the requests", async () => {
    const runId = "run-sum";
    const row = (seq: number, quotedUsd: number) => ({ runId, seq, quotedUsd });
    const settled = await rowIn("signed", row(0, 0.01));
    // Settled for less than quoted: the settled amount is what was charged.
    await ledger.settle(settled, { ...SETTLED, settledUsd: 0.008 });
    await rowIn("signed", row(1, 0.02));
    await rowIn("paid_no_answer", row(2, 0.03));
    await rowIn("unconfirmed", row(3, 0.04));
    await rowIn("simulated", row(4, 0.05));
    // Not spent: still only reserved, released, and proven never to have landed.
    await rowIn("reserved", row(5, 0.1));
    await rowIn("released", row(6, 0.1));
    await rowIn("not_charged", row(7, 0.1));
    // Another run's rows are not this run's.
    await rowIn("settled", { runId: "run-other", seq: 0, quotedUsd: 0.2 });

    const spend = await runInferenceSpend(runId);
    expect(spend.usd).toBeCloseTo(0.008 + 0.02 + 0.03 + 0.04 + 0.05, 9);
    expect(spend.requests).toBe(5);
    expect(await runInferenceSpend("run-with-no-rows")).toEqual({ usd: 0, requests: 0 });
  });
});

describe("dayUsage", () => {
  it("reads the three counters for a day, zero where nothing was spent", async () => {
    expect(await dayUsage({ ownerId: "owner-1", agentId: "agent-1", day: DAY })).toEqual({
      day: DAY,
      platform: { usd: 0, requests: 0 },
      owner: { usd: 0, requests: 0, manualRuns: 0 },
      agent: { usd: 0, requests: 0 },
    });
    await reserved({ quotedUsd: 0.03 });
    await reserved({ quotedUsd: 0.02, agentId: "agent-2" });
    await reserved({ quotedUsd: 0.07, ownerId: "owner-2", agentId: "agent-3" });
    await noteManualRun("owner-1", NOON);

    expect(await dayUsage({ ownerId: "owner-1", agentId: "agent-1", day: NOON })).toEqual({
      day: DAY,
      platform: { usd: 0.12, requests: 3 },
      owner: { usd: 0.05, requests: 2, manualRuns: 1 },
      agent: { usd: 0.03, requests: 1 },
    });
    expect((await dayUsage({ ownerId: "owner-1", agentId: "agent-1", day: "2031-03-11" })).platform.usd).toBe(0);
  });
});

describe("noteManualRun", () => {
  it("allows the daily number of manual runs and refuses the next, per owner, per UTC day", async () => {
    for (let n = 0; n < OWNER_DAY_MANUAL_RUNS; n += 1) expect(await noteManualRun("owner-1", NOON)).toBe(true);
    expect(await noteManualRun("owner-1", NOON)).toBe(false);
    expect(await noteManualRun("owner-1", new Date("2031-03-10T23:59:59.999Z"))).toBe(false);
    expect((await dayUsage({ ownerId: "owner-1", agentId: "agent-1", day: DAY })).owner.manualRuns).toBe(OWNER_DAY_MANUAL_RUNS);
    // Another owner, and the same owner tomorrow, start from zero.
    expect(await noteManualRun("owner-2", NOON)).toBe(true);
    expect(await noteManualRun("owner-1", new Date("2031-03-11T00:00:00.000Z"))).toBe(true);
  });

  it("counts every one of a burst at once, and no more than the limit", async () => {
    const results = await Promise.all(Array.from({ length: OWNER_DAY_MANUAL_RUNS + 10 }, () => noteManualRun("owner-1", NOON)));
    expect(results.filter(Boolean)).toHaveLength(OWNER_DAY_MANUAL_RUNS);
  });

  it("does not disturb the spending counters on the same row, nor they it", async () => {
    await reserved({ quotedUsd: 0.03 });
    expect(await noteManualRun("owner-1", NOON)).toBe(true);
    const id = await reserved({ quotedUsd: 0.02 });
    await ledger.release(id, "gave up");
    const usage = await dayUsage({ ownerId: "owner-1", agentId: "agent-1", day: DAY });
    expect(usage.owner).toEqual({ usd: 0.03, requests: 1, manualRuns: 1 });
  });

  it("refuses when there is no owner to count against", async () => {
    expect(await noteManualRun("", NOON)).toBe(false);
  });
});

describe("the switches", () => {
  it("reads as all clear before anything was ever written", async () => {
    expect(await readInferenceControl()).toEqual({
      halted: false,
      haltReason: null,
      haltClearedAt: null,
      pausedUntil: null,
      pauseReason: null,
      updatedBy: null,
      updatedAt: null,
    });
  });

  it("records who threw the halt and why, and forgets the reason when it is cleared", async () => {
    await setInferenceHalt({ halted: true, reason: "BlockRun changed its pay-to address", by: "admin-1" });
    expect(await readInferenceControl()).toMatchObject({ halted: true, haltReason: "BlockRun changed its pay-to address", updatedBy: "admin-1" });
    expect((await readInferenceControl()).haltClearedAt).toBeNull();
    const before = Date.now();
    await setInferenceHalt({ halted: false, reason: "checked", by: "admin-2" });
    const cleared = await readInferenceControl();
    expect(cleared).toMatchObject({ halted: false, haltReason: null, updatedBy: "admin-2" });
    // When it was cleared is kept: it is what tells the reconciler the evidence was looked at.
    expect(cleared.haltClearedAt!.getTime()).toBeGreaterThanOrEqual(before);
    expect(cleared.haltClearedAt!.getTime()).toBeLessThanOrEqual(Date.now());
    expect(await db.select().from(inferenceControl)).toHaveLength(1);
    // Thrown again, the old clearing is no longer the latest word.
    await setInferenceHalt({ halted: true, reason: "again", by: "admin-1" });
    expect(await readInferenceControl()).toMatchObject({ halted: true, haltReason: "again", haltClearedAt: null });
  });

  it("keeps a pause in place when the halt is thrown and cleared", async () => {
    const until = await pauseInference(30, "breaker", NOON);
    await setInferenceHalt({ halted: true, reason: "drill", by: "admin-1" });
    await setInferenceHalt({ halted: false, reason: null, by: "admin-1" });
    expect((await readInferenceControl()).pausedUntil?.getTime()).toBe(until.getTime());
  });

  it("an automatic halt keeps the first reason, and never overrides one already on", async () => {
    expect(await haltInferenceOnce("first evidence", "reconciler")).toBe(true);
    expect(await haltInferenceOnce("second evidence", "reconciler")).toBe(false);
    expect(await readInferenceControl()).toMatchObject({ halted: true, haltReason: "first evidence", updatedBy: "reconciler" });
    // Once an admin clears it, new evidence halts again.
    await setInferenceHalt({ halted: false, reason: null, by: "admin-1" });
    expect(await haltInferenceOnce("third evidence", "reconciler")).toBe(true);
    expect((await readInferenceControl()).haltReason).toBe("third evidence");
  });

  it("only ever lengthens a pause, and keeps the reason of the one in force", async () => {
    const first = await pauseInference(30, "three unanswered steps", NOON);
    expect(first.getTime()).toBe(NOON.getTime() + 30 * MINUTE);
    const shorter = await pauseInference(15, "five gateway failures", NOON);
    expect(shorter.getTime()).toBe(first.getTime());
    expect(await readInferenceControl()).toMatchObject({ pauseReason: "three unanswered steps" });
    const longer = await pauseInference(45, "a pin mismatch", NOON);
    expect(longer.getTime()).toBe(NOON.getTime() + 45 * MINUTE);
    expect(await readInferenceControl()).toMatchObject({ pauseReason: "a pin mismatch", halted: false });
  });

  it("bounds a pause to a day and reads nonsense minutes as none", async () => {
    expect((await pauseInference(100_000, "too long", NOON)).getTime()).toBe(NOON.getTime() + 1440 * MINUTE);
    await db.delete(inferenceControl);
    expect((await pauseInference(Number.NaN, "nonsense", NOON)).getTime()).toBe(NOON.getTime());
  });

  it("ends a pause on request", async () => {
    await pauseInference(30, "breaker", NOON);
    await clearInferencePause("admin-1", new Date(NOON.getTime() + MINUTE));
    const control = await readInferenceControl();
    expect(control.pauseReason).toBeNull();
    expect(control.updatedBy).toBe("admin-1");
    expect((await ledger.reserve(reserveInput({ now: new Date(NOON.getTime() + 2 * MINUTE) }))).ok).toBe(true);
  });
});

describe("applyInferenceBreakers", () => {
  /** A signed row whose signature time is `minutesAgo` before `now`, left unconfirmed. */
  async function unanswered(agentId: string, at: Date, status: "unconfirmed" | "paid_no_answer" = "unconfirmed"): Promise<string> {
    const id = await reserved({ agentId, now: at });
    // Written directly: the ledger's own calls would evaluate the breakers on the way.
    await db.update(inferencePayments).set({ status, signedAt: at, memo: nanoid() }).where(eq(inferencePayments.id, id));
    return id;
  }

  async function stoppedRun(agentId: string, stopReason: string, at: Date): Promise<void> {
    await db.insert(agentRuns).values({ id: nanoid(), agentId, trigger: "schedule", status: "failed", stopReason, createdAt: at, finishedAt: at });
  }

  const now = new Date("2031-03-10T12:30:00.000Z");
  const ago = (minutes: number) => new Date(now.getTime() - minutes * MINUTE);

  it("writes nothing when nothing ended badly", async () => {
    await rowIn("settled");
    expect(await applyInferenceBreakers(now)).toEqual({ tripped: null, pausedUntil: null });
    expect(await db.select().from(inferenceControl)).toHaveLength(0);
  });

  it("pauses 30 minutes from the last of 3 unanswered steps across 2 agents", async () => {
    await unanswered("agent-1", ago(12));
    await unanswered("agent-1", ago(6), "paid_no_answer");
    expect((await applyInferenceBreakers(now)).tripped).toBeNull();
    await unanswered("agent-2", ago(3));
    const result = await applyInferenceBreakers(now);
    expect(result.tripped).toBe("unanswered");
    expect(result.pausedUntil?.getTime()).toBe(ago(3).getTime() + 30 * MINUTE);
    const control = await readInferenceControl();
    expect(control.pausedUntil?.getTime()).toBe(ago(3).getTime() + 30 * MINUTE);
    expect(control.updatedBy).toBe("breaker");
    expect(await ledger.reserve(reserveInput({ now }))).toEqual({ ok: false, reason: "paused" });
  });

  it("does not pause for 3 unanswered steps from one agent", async () => {
    for (const minutes of [9, 6, 3]) await unanswered("agent-1", ago(minutes));
    expect((await applyInferenceBreakers(now)).tripped).toBeNull();
  });

  it("stops counting a step the reconciler proved was never charged", async () => {
    const first = await unanswered("agent-1", ago(9));
    await unanswered("agent-1", ago(6));
    await unanswered("agent-2", ago(3));
    await resolveInferencePayment(first, { charged: false, detail: "never landed" }, now);
    expect((await applyInferenceBreakers(now)).tripped).toBeNull();
  });

  it("is evaluated by the ledger itself when a paid step ends without an answer", async () => {
    // Real clock here: the ledger stamps the signature time itself.
    const real = new Date();
    for (const agentId of ["agent-1", "agent-1", "agent-2"]) {
      const id = await rowIn("signed", { agentId, now: real });
      await ledger.markUnconfirmed(id, { httpStatus: null, detail: "timed out" });
    }
    const control = await readInferenceControl();
    expect(control.pausedUntil).not.toBeNull();
    expect(control.pausedUntil!.getTime()).toBeGreaterThan(Date.now() + 29 * MINUTE);
    expect(await ledger.reserve(reserveInput({ now: new Date() }))).toEqual({ ok: false, reason: "paused" });
  });

  it("pauses 15 minutes on 5 runs stopped by the gateway, and on 5 stopped by the wallet", async () => {
    const { agentId } = await seedAgent(db);
    await db.delete(agentRuns);
    for (const minutes of [8, 6, 4, 2]) await stoppedRun(agentId, minutes % 4 === 0 ? "quote_failed" : "gateway_error", ago(minutes));
    expect((await applyInferenceBreakers(now)).tripped).toBeNull();
    await stoppedRun(agentId, "quote_failed", ago(1));
    const gateway = await applyInferenceBreakers(now);
    expect(gateway.tripped).toBe("gateway");
    expect(gateway.pausedUntil?.getTime()).toBe(ago(1).getTime() + 15 * MINUTE);

    await db.delete(agentRuns);
    await db.delete(inferenceControl);
    for (const minutes of [9, 7, 5, 3, 2]) await stoppedRun(agentId, "signature_failed", ago(minutes));
    const signature = await applyInferenceBreakers(now);
    expect(signature.tripped).toBe("signature");
    expect(signature.pausedUntil?.getTime()).toBe(ago(2).getTime() + 15 * MINUTE);
  });

  it("pauses 30 minutes on any pin mismatch, and reads the run's finish time", async () => {
    const { agentId } = await seedAgent(db);
    await db.delete(agentRuns);
    await db.insert(agentRuns).values({ id: nanoid(), agentId, trigger: "manual", status: "failed", stopReason: "pin_mismatch", createdAt: ago(9), finishedAt: ago(5) });
    const result = await applyInferenceBreakers(now);
    expect(result.tripped).toBe("pin_mismatch");
    expect(result.pausedUntil?.getTime()).toBe(ago(5).getTime() + 30 * MINUTE);
  });

  it("ignores runs that stopped for an ordinary reason, or for none", async () => {
    const { agentId } = await seedAgent(db);
    await db.delete(agentRuns);
    for (const reason of ["run_cap", "needs_funds", "agent_day_cap", "paid_no_answer", "rerouted"]) {
      for (const minutes of [1, 2, 3, 4, 5, 6]) await stoppedRun(agentId, reason, ago(minutes));
    }
    await db.insert(agentRuns).values({ id: nanoid(), agentId, trigger: "schedule", status: "failed", error: "pin_mismatch in the text only", createdAt: ago(1) });
    expect((await applyInferenceBreakers(now)).tripped).toBeNull();
    expect(await db.select().from(inferenceControl)).toHaveLength(0);
  });

  it("names the same end when asked again, and does not pause again for evidence an admin has cleared", async () => {
    const { agentId } = await seedAgent(db);
    await db.delete(agentRuns);
    await stoppedRun(agentId, "pin_mismatch", ago(5));
    const first = await applyInferenceBreakers(now);
    const again = await applyInferenceBreakers(new Date(now.getTime() + 5 * MINUTE));
    expect(again.pausedUntil?.getTime()).toBe(first.pausedUntil?.getTime());

    await clearInferencePause("admin-1", new Date(now.getTime() + 6 * MINUTE));
    expect(await applyInferenceBreakers(new Date(now.getTime() + 7 * MINUTE))).toEqual({ tripped: null, pausedUntil: null });
    expect(controlStopNow(await readInferenceControl(), new Date(now.getTime() + 7 * MINUTE))).toBe(false);

    // A mismatch after the clear is new evidence.
    await stoppedRun(agentId, "pin_mismatch", new Date(now.getTime() + 8 * MINUTE));
    expect((await applyInferenceBreakers(new Date(now.getTime() + 9 * MINUTE))).tripped).toBe("pin_mismatch");
  });
});

function controlStopNow(control: { halted: boolean; pausedUntil: Date | null }, at: Date): boolean {
  return control.halted || (control.pausedUntil !== null && control.pausedUntil.getTime() > at.getTime());
}

describe("20 reserves at once against one cap", () => {
  // PGlite is one connection: these twenty transactions are queued and run one after
  // another, so this proves the arithmetic and the roll-back, not the row locking. The
  // same scenario against a real Postgres is in inference-ledger.concurrency.test.ts.
  it("never lets the total pass the agent's day, whatever order they land in", async () => {
    const caps = { ...CAPS, agentDayUsd: 0.07, runUsd: 5 };
    const results = await Promise.all(Array.from({ length: 20 }, (_, n) => ledger.reserve(reserveInput({ caps, runId: `run-c-${n}`, quotedUsd: 0.01 }))));
    const won = results.filter((result) => result.ok);
    expect(won).toHaveLength(7);
    expect(results.filter((result) => !result.ok).every((result) => !result.ok && result.reason === "agent_day_cap")).toBe(true);
    expect(await held()).toEqual([0.07, 0.07, 0.07]);
    expect((await db.select().from(inferencePayments)).length).toBe(7);
    expect((await counter("platform", "all"))?.requests).toBe(7);
  });

  it("never lets the total pass the platform's day across many owners", async () => {
    const caps = { ...CAPS, platformDayUsd: 0.05 };
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, n) => ledger.reserve(reserveInput({ caps, ownerId: `owner-${n % 4}`, agentId: `agent-${n}`, quotedUsd: 0.01 }))),
    );
    expect(results.filter((result) => result.ok)).toHaveLength(5);
    expect((await counter("platform", "all"))?.usd).toBe(0.05);
    const rows = await db.select().from(inferencePayments);
    expect(rows.reduce((sum, row) => sum + Number(row.quotedUsd), 0)).toBeCloseTo(0.05, 9);
  });

  it("never lets one run pass its own cap when its steps are reserved together", async () => {
    const caps = { ...CAPS, runUsd: 0.03 };
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, seq) => ledger.reserve(reserveInput({ caps, runId: "run-together", seq, quotedUsd: 0.01, runSpentUsd: 0 }))),
    );
    expect(results.filter((result) => result.ok)).toHaveLength(3);
    expect(results.filter((result) => !result.ok).every((result) => !result.ok && result.reason === "run_cap")).toBe(true);
    expect(await db.select().from(inferencePayments).where(eq(inferencePayments.runId, "run-together"))).toHaveLength(3);
    expect(await held()).toEqual([0.03, 0.03, 0.03]);
  });

  it("gives one winner when twenty try to reserve the same step", async () => {
    const results = await Promise.all(Array.from({ length: 20 }, () => ledger.reserve(reserveInput({ runId: "run-same", seq: 0 }))));
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(await held()).toEqual([0.01, 0.01, 0.01]);
  });
});
