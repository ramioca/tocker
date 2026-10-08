/**
 * A pay-per-use agent's run, end to end, with no money anywhere.
 *
 * `LLM_MOCK=1` and `X402_MOCK=1`: the scripted model thinks, every model step is put
 * through the real limits and the real ledger as a `simulated` row, and no network, no
 * wallet and no chain is touched. The database is in-memory PGlite. The one stand-in is
 * the ledger's `reserve`, which a case can make refuse a step with any named reason: that
 * is how a run is stopped part-way with each reason the pay path can give, without a
 * gateway to misbehave.
 *
 * What is proven here: a mock run leaves the rows it should; every stop ends the run the
 * way its kind says; a hold is said once; with the switch unset a pay-per-use agent is
 * never run; and a key agent's run is what it was before any of this existed.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { APICallError, ToolChoiceViolationError } from "ai";
import { and, asc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { Keypair } from "@solana/web3.js";
import type { Db } from "@/db";
import * as schema from "@/db/schema";
import type { AgentConfig } from "@/db/schema";
import { toNumeric } from "@/lib/money";
import { seedKnownTokens } from "@/lib/trading/tokens";
import { holdUntil } from "@/lib/x402/inference-budget";
import {
  DEFAULT_PAY_PER_USE_MODEL,
  PAY_PER_USE_MODELS,
  INFERENCE_GATEWAY,
  INFERENCE_STOPS,
  InferenceStop,
  describeInferenceStop,
  newPayCounters,
  utcDay,
  type InferencePayContext,
  type InferenceReserveInput,
  type InferenceReserveResult,
  type InferenceStopReason,
} from "@/lib/x402/inference-types";
import { getAgentRuns, getRun } from "@/server/queries/agents";
import { DEFAULT_AGENT_CONFIG } from "./config";
import { countsAsStrike } from "./inference";
import { INFERENCE_HOLD_NOTICE, applyInferenceHold } from "./inference-gate";
import { RUN_DEFERRED, RunRefusedError } from "./run-gate";
import { nextRunTime } from "./schedule";
import { ABANDONED_RUN_ERROR, paidStop, reapStaleRuns, resolveModel, runAgent, runSummary, startRun } from "./run";
import { findDueAgents, tickDueAgents } from "./scheduler";
import { seedAgent, setupTestDb } from "./test-support";

/** What the ledger stand-in refuses: every step from `atSeq` on, with `reason`. Null: nothing. */
const seam = vi.hoisted(() => ({ refuse: null as null | { atSeq: number; reason: string } }));

vi.mock("@/lib/x402/inference-ledger", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/x402/inference-ledger")>();
  return {
    ...real,
    createInferenceLedger: () => {
      const ledger = real.createInferenceLedger();
      return {
        ...ledger,
        reserve: async (input: InferenceReserveInput): Promise<InferenceReserveResult> =>
          seam.refuse && input.seq >= seam.refuse.atSeq
            ? { ok: false, reason: seam.refuse.reason as InferenceStopReason }
            : ledger.reserve(input),
      };
    },
  };
});

/** Every call the run loop makes to the SDK's `generateText`, as it was given. The call itself is the real one. */
const sdk = vi.hoisted(() => ({ calls: [] as Array<Record<string, unknown>> }));

/**
 * A staged clock, for the one case that needs a run to be long: the scripted model
 * answers in no time, so a run never gets near its time limits by itself. While `on`, the
 * model call is found to have been going for `alreadyMs` when its first step starts, and
 * each step then takes `stepMs`. `Date.now` is moved by `offsetMs` (the case spies on
 * it); real timers are untouched. `prepared` is what the run loop's step hook answered,
 * step by step.
 */
const clock = vi.hoisted(() => ({ on: false, offsetMs: 0, alreadyMs: 0, stepMs: 0, prepared: [] as unknown[] }));

vi.mock("ai", async (importOriginal) => {
  const real = await importOriginal<typeof import("ai")>();
  type Options = Parameters<typeof real.generateText>[0];
  type Hook = (input: unknown) => unknown;
  return {
    ...real,
    generateText: ((options: Options) => {
      sdk.calls.push(options as unknown as Record<string, unknown>);
      if (!clock.on) return real.generateText(options);
      const hooks = options as unknown as { prepareStep?: Hook; onStepFinish?: Hook };
      clock.offsetMs += clock.alreadyMs;
      return real.generateText({
        ...options,
        prepareStep: async (step: unknown) => {
          const told = (await hooks.prepareStep?.(step)) ?? {};
          clock.prepared.push(told);
          return told;
        },
        onStepFinish: async (step: unknown) => {
          await hooks.onStepFinish?.(step);
          clock.offsetMs += clock.stepMs;
        },
      } as unknown as Options);
    }) as typeof real.generateText,
  };
});

let db: Db;
const before = { llm: process.env.LLM_MOCK, x402: process.env.X402_MOCK, flag: process.env.INFERENCE_USDC };

beforeAll(async () => {
  process.env.X402_MOCK = "1";
  process.env.LLM_MOCK = "1";
  db = await setupTestDb();
  await seedKnownTokens();
}, 120_000);

afterAll(() => {
  for (const [name, value] of [
    ["LLM_MOCK", before.llm],
    ["X402_MOCK", before.x402],
    ["INFERENCE_USDC", before.flag],
  ] as const) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

/** The paper executor needs a price; keep every test offline and deterministic. */
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
      return new Response(
        JSON.stringify({ DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263: { usdPrice: pricePerToken } }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}

beforeEach(async () => {
  stubPricing();
  seam.refuse = null;
  sdk.calls.length = 0;
  process.env.INFERENCE_USDC = "on";
  // The control row and the platform's day counter are shared by every agent here.
  await db.delete(schema.inferenceControl);
  await db.delete(schema.inferenceBudgetDays);
  // So are the breakers: a run that stopped on the gateway in one case would count toward
  // pausing everyone in the next. Earlier cases' stops are taken out of their sight.
  await db.update(schema.agentRuns).set({ stopReason: null });
});

type Usdc = NonNullable<AgentConfig["llm"]["usdc"]>;

async function payingAgent(usdc: Partial<Usdc> = {}, llm: Partial<AgentConfig["llm"]> = {}) {
  return seedAgent(db, {
    config: {
      dataSources: ["sentimentalpha"],
      chains: ["solana"],
      llm: {
        ...DEFAULT_AGENT_CONFIG.llm,
        ...llm,
        source: "usdc",
        usdc: { model: DEFAULT_PAY_PER_USE_MODEL, maxUsdPerRun: 0.3, maxUsdPerDay: 3, ...usdc },
      },
    },
  });
}

const keyAgent = () => seedAgent(db, { config: { dataSources: ["sentimentalpha"], chains: ["solana"] } });

async function agentRow(agentId: string) {
  const [row] = await db.select().from(schema.agents).where(eq(schema.agents.id, agentId)).limit(1);
  if (!row) throw new Error("agent row missing");
  return row;
}
const runsOf = (agentId: string) => db.select().from(schema.agentRuns).where(eq(schema.agentRuns.agentId, agentId)).orderBy(asc(schema.agentRuns.createdAt));
const paymentsOf = (agentId: string) =>
  db.select().from(schema.inferencePayments).where(eq(schema.inferencePayments.agentId, agentId)).orderBy(asc(schema.inferencePayments.seq));
const noticesOf = (userId: string) => db.select().from(schema.notifications).where(eq(schema.notifications.userId, userId));
/** The notices about a hold. A run that trades also tells its owner about the fill, which is not one. */
const holdNoticesOf = async (userId: string) => (await noticesOf(userId)).filter((notice) => notice.kind === INFERENCE_HOLD_NOTICE);
const stepsOf = (runId: string) => db.select().from(schema.agentRunSteps).where(eq(schema.agentRunSteps.runId, runId)).orderBy(asc(schema.agentRunSteps.seq));
const sum = (rows: Array<{ quotedUsd: string }>) => rows.reduce((total, row) => total + Number(row.quotedUsd), 0);

describe("a pay-per-use agent's run in mock mode", () => {
  it("thinks on the scripted model, writes a simulated row per step, and puts the spend on the run", async () => {
    const agent = await payingAgent({ model: "openai/gpt-4o-mini" });

    const result = await runAgent({ agentId: agent.agentId, trigger: "schedule" });
    expect(result.status).toBe("succeeded");
    expect(result.stopReason).toBeUndefined();
    expect(result.summary).toMatch(/bonk/i);

    const [run] = await runsOf(agent.agentId);
    expect(run?.status).toBe("succeeded");
    expect(run?.llmSource).toBe("usdc");
    expect(run?.model).toBe("openai/gpt-4o-mini");
    expect(run?.stopReason).toBeNull();
    expect(run?.error).toBeNull();

    // One row per model step, in order, all simulated, all this run's and this agent's wallet.
    const payments = await paymentsOf(agent.agentId);
    const modelSteps = (await stepsOf(result.runId)).filter((step) => step.kind === "tool_call").length;
    expect(payments.length).toBe(modelSteps);
    expect(payments.length).toBeGreaterThanOrEqual(5);
    expect(payments.map((row) => row.seq)).toEqual(payments.map((_, index) => index));
    expect(payments.every((row) => row.status === "simulated")).toBe(true);
    expect(payments.every((row) => row.runId === result.runId && row.ownerId === agent.userId)).toBe(true);
    expect(payments.every((row) => row.model === "openai/gpt-4o-mini" && row.host === INFERENCE_GATEWAY.solana.host)).toBe(true);
    expect(payments.every((row) => row.payerWalletId === `paper_${agent.agentId}_solana`)).toBe(true);
    // Nothing was signed, sent or settled on a chain.
    expect(payments.every((row) => row.txHash === null && row.payerSignature === null && row.memo === null)).toBe(true);

    // The run row says what the ledger says, to the micro-dollar.
    expect(Number(run?.inferenceSpendUsd)).toBeGreaterThan(0);
    expect(Number(run?.inferenceSpendUsd)).toBeCloseTo(sum(payments), 6);

    // Simulated rows count against the day like any other.
    const [counter] = await db
      .select()
      .from(schema.inferenceBudgetDays)
      .where(and(eq(schema.inferenceBudgetDays.scope, "agent"), eq(schema.inferenceBudgetDays.scopeId, agent.agentId)));
    expect(Number(counter?.usd)).toBeCloseTo(sum(payments), 6);
    expect(counter?.requests).toBe(payments.length);
    expect(counter?.day).toBe(utcDay(new Date()));

    // The rest of the tick is what it always was: paid data from the platform's ledger,
    // a paper fill, a post.
    expect(Number(run?.dataSpendUsd)).toBeCloseTo(0.022, 6);
    expect(await db.select().from(schema.x402Payments).where(eq(schema.x402Payments.agentId, agent.agentId))).toHaveLength(2);
    expect(await db.select().from(schema.trades).where(eq(schema.trades.agentId, agent.agentId))).toHaveLength(1);

    // And nobody was notified of anything going wrong.
    expect((await noticesOf(agent.userId)).filter((notice) => notice.kind === "run_failed" || notice.kind === INFERENCE_HOLD_NOTICE)).toHaveLength(0);
    expect((await agentRow(agent.agentId)).nextRunAt).not.toBeNull();
  });

  it("clears the hold and the strikes it had, once it has run", async () => {
    const agent = await payingAgent();
    // Held twice, and the second hold's time has come.
    const long = new Date(Date.now() - 3 * 3_600_000);
    await applyInferenceHold(agent.agentId, "quote_failed", long);
    await applyInferenceHold(agent.agentId, "quote_failed", new Date(long.getTime() + 20 * 60_000));
    expect(await agentRow(agent.agentId)).toMatchObject({ inferenceHold: "quote_failed", inferenceStrikes: 2 });

    const result = await runAgent({ agentId: agent.agentId, trigger: "schedule" });
    expect(result.status).toBe("succeeded");
    expect(await agentRow(agent.agentId)).toMatchObject({
      inferenceHold: null,
      inferenceHoldSince: null,
      inferenceHoldUntil: null,
      inferenceStrikes: 0,
      inferenceNotifiedAt: null,
    });
  });

  it("counts a run started by hand against the owner's day, and not a scheduled one", async () => {
    const agent = await payingAgent();
    await runAgent({ agentId: agent.agentId, trigger: "schedule" });
    await runAgent({ agentId: agent.agentId, trigger: "manual" });
    const [owner] = await db
      .select()
      .from(schema.inferenceBudgetDays)
      .where(and(eq(schema.inferenceBudgetDays.scope, "owner"), eq(schema.inferenceBudgetDays.scopeId, agent.userId)));
    expect(owner?.manualRuns).toBe(1);
  });

  it("never looks for a key, even with one named on its row", async () => {
    const agent = await payingAgent();
    // A key id that names no key: a key agent's run fails on it ("no longer exists").
    await db.insert(schema.llmKeys).values({ id: "key_gone", userId: agent.userId, provider: "anthropic", encryptedKey: "not-a-real-ciphertext", last4: "0000" });
    await db.update(schema.agents).set({ llmKeyId: "key_gone" }).where(eq(schema.agents.id, agent.agentId));
    await db.delete(schema.llmKeys).where(eq(schema.llmKeys.id, "key_gone"));
    expect((await runAgent({ agentId: agent.agentId, trigger: "schedule" })).status).toBe("succeeded");
  });
});

describe("what the model call is given", () => {
  it("a key agent's is what it always was: no retry setting, no answer cap, no step hook", async () => {
    const agent = await keyAgent();
    expect((await runAgent({ agentId: agent.agentId, trigger: "schedule" })).status).toBe("succeeded");

    expect(sdk.calls).toHaveLength(1);
    const [options] = sdk.calls;
    // Not set to anything, not even to undefined: the SDK's defaults are the key agent's.
    for (const name of ["maxRetries", "maxOutputTokens", "prepareStep", "toolChoice"]) {
      expect(name in (options ?? {})).toBe(false);
    }
    // Two reasons to stop, as before: its step count, and an accepted `finish`.
    expect(options?.stopWhen).toHaveLength(2);
    expect(options?.temperature).toBe(DEFAULT_AGENT_CONFIG.llm.temperature);
    expect(options?.abortSignal).toBeInstanceOf(AbortSignal);
    expect(options?.providerOptions).toEqual({ anthropic: { cacheControl: { type: "ephemeral" } } });
  });

  it("a pay-per-use agent's takes no retries, caps the answer, and has the hook that wraps it up", async () => {
    const agent = await payingAgent();
    expect((await runAgent({ agentId: agent.agentId, trigger: "schedule" })).status).toBe("succeeded");

    expect(sdk.calls).toHaveLength(1);
    const [options] = sdk.calls;
    // A retry would be a second payment for the same step.
    expect(options?.maxRetries).toBe(0);
    // The gateway prices a request on the answer it is allowed to give.
    expect(options?.maxOutputTokens).toBe(2048);
    expect(typeof options?.prepareStep).toBe("function");
    // A third reason to stop: no new request once the run has thought for too long.
    expect(options?.stopWhen).toHaveLength(3);
    expect(options?.abortSignal).toBeInstanceOf(AbortSignal);
    // The default model takes a temperature, so it is given the agent's own.
    expect(options?.temperature).toBe(DEFAULT_AGENT_CONFIG.llm.temperature);
  });

  /** A request the provider refuses after payment is a step paid for and not answered. */
  it("sends no temperature to a pay-per-use model that refuses one, and the agent's own to every other", async () => {
    const refusing = PAY_PER_USE_MODELS.filter((model) => model.omitTemperature);
    expect(refusing.length).toBeGreaterThan(0);

    for (const model of [refusing[0], PAY_PER_USE_MODELS.find((candidate) => !candidate.omitTemperature)!]) {
      sdk.calls.length = 0;
      // Limits wide enough for the dearest model's simulated run.
      const agent = await payingAgent({ model: model.id, maxUsdPerRun: 2, maxUsdPerDay: 50 });
      expect((await runAgent({ agentId: agent.agentId, trigger: "schedule" })).status, model.id).toBe("succeeded");
      expect(sdk.calls).toHaveLength(1);
      expect(sdk.calls[0]?.temperature, model.id).toBe(model.omitTemperature ? undefined : DEFAULT_AGENT_CONFIG.llm.temperature);
    }
  });
});

describe("resolveModel for an agent that pays per use", () => {
  const config: AgentConfig = {
    ...DEFAULT_AGENT_CONFIG,
    llm: { ...DEFAULT_AGENT_CONFIG.llm, source: "usdc", usdc: { model: DEFAULT_PAY_PER_USE_MODEL, maxUsdPerRun: 0.3, maxUsdPerDay: 3 } },
  };

  it("refuses to build a model without the run's payment limits, and does not fall back to a key", async () => {
    const realLlm = process.env.LLM_MOCK;
    process.env.LLM_MOCK = "0";
    try {
      await expect(resolveModel({ ownerId: "u", llmKeyId: "key_that_exists_nowhere", config })).rejects.toThrow(/without its payment limits/);
    } finally {
      process.env.LLM_MOCK = realLlm;
    }
  });
});

describe("with INFERENCE_USDC unset", () => {
  beforeEach(() => {
    delete process.env.INFERENCE_USDC;
  });

  it("never runs a pay-per-use agent: no run row, no ledger row, a hold, and one notice", async () => {
    const agent = await payingAgent();

    const first = await runAgent({ agentId: agent.agentId, trigger: "schedule" });
    expect(first).toMatchObject({ runId: "", status: "skipped", stopReason: "flag_off", error: describeInferenceStop("flag_off").detail });
    // A second pass, and a run started by hand, change nothing.
    expect((await runAgent({ agentId: agent.agentId, trigger: "schedule" })).status).toBe("skipped");
    expect((await runAgent({ agentId: agent.agentId, trigger: "manual" })).status).toBe("skipped");

    expect(await runsOf(agent.agentId)).toHaveLength(0);
    expect(await paymentsOf(agent.agentId)).toHaveLength(0);
    expect(await db.select().from(schema.inferenceBudgetDays)).toHaveLength(0);
    // Held, and not counted against it: the switch being off is nobody's fault.
    expect(await agentRow(agent.agentId)).toMatchObject({ inferenceHold: "flag_off", inferenceStrikes: 0 });
    const notices = await noticesOf(agent.userId);
    expect(notices).toHaveLength(1);
    expect(notices[0]?.kind).toBe(INFERENCE_HOLD_NOTICE);
  });

  it("is not picked by the scheduler again while its hold runs, and the key agents beside it run as ever", async () => {
    const paying = await payingAgent();
    const key = await keyAgent();
    const due = new Date(Date.now() - 60_000);
    await db.update(schema.agents).set({ nextRunAt: due }).where(eq(schema.agents.id, paying.agentId));
    await db.update(schema.agents).set({ nextRunAt: due }).where(eq(schema.agents.id, key.agentId));

    const tick = await tickDueAgents(50);
    const byAgent = new Map(tick.results.map((result) => [result.agentId, result]));
    expect(byAgent.get(paying.agentId)).toMatchObject({ status: "skipped", stopReason: "flag_off" });
    expect(byAgent.get(key.agentId)?.status).toBe("succeeded");
    expect(await runsOf(paying.agentId)).toHaveLength(0);

    // Held now, so the next pass does not even pick it.
    expect(await findDueAgents(50)).not.toContain(paying.agentId);
    const again = await tickDueAgents(50);
    expect(again.results.some((result) => result.agentId === paying.agentId)).toBe(false);
    expect(await noticesOf(paying.userId)).toHaveLength(1);
  });

  it("refuses a run started by hand with the sentence for it, before any row exists", async () => {
    const agent = await payingAgent();
    await expect(startRun({ agentId: agent.agentId, trigger: "manual" })).rejects.toThrow(RunRefusedError);
    await expect(startRun({ agentId: agent.agentId, trigger: "manual" })).rejects.toMatchObject({
      reason: "flag_off",
      message: describeInferenceStop("flag_off").detail,
    });
    expect(await runsOf(agent.agentId)).toHaveLength(0);
  });
});

describe("a key agent's run", () => {
  /** Everything a run leaves behind that does not depend on when it ran or on a random id. */
  async function footprint(agentId: string, userId: string, runId: string) {
    const [run] = await db.select().from(schema.agentRuns).where(eq(schema.agentRuns.id, runId));
    const steps = await stepsOf(runId);
    const agent = await agentRow(agentId);
    return {
      run: {
        trigger: run?.trigger,
        status: run?.status,
        summary: run?.summary,
        error: run?.error,
        dataSpendUsd: run?.dataSpendUsd,
        inputTokens: run?.inputTokens,
        outputTokens: run?.outputTokens,
        started: run?.startedAt !== null,
        finished: run?.finishedAt !== null,
      },
      steps: steps.map((step) => `${step.seq}:${step.kind}:${step.toolName ?? ""}`),
      dataPayments: (await db.select().from(schema.x402Payments).where(eq(schema.x402Payments.agentId, agentId))).length,
      trades: (await db.select().from(schema.trades).where(eq(schema.trades.agentId, agentId))).map((trade) => `${trade.side}:${trade.status}:${trade.amountUsd}`),
      posts: (await db.select().from(schema.posts).where(eq(schema.posts.agentId, agentId))).length,
      snapshots: (await db.select().from(schema.equitySnapshots).where(eq(schema.equitySnapshots.agentId, agentId))).length,
      notices: (await noticesOf(userId)).map((notice) => notice.kind).sort(),
      rescheduled: agent.nextRunAt !== null && agent.lastRunAt !== null,
    };
  }

  it("leaves exactly the rows it left before, plus the source and the model on its run row", async () => {
    delete process.env.INFERENCE_USDC;
    const agent = await keyAgent();
    const result = await runAgent({ agentId: agent.agentId, trigger: "manual" });
    expect(result.status).toBe("succeeded");
    expect(result.stopReason).toBeUndefined();

    const [run] = await runsOf(agent.agentId);
    // The two new columns.
    expect(run?.llmSource).toBe("key");
    expect(run?.model).toBe(DEFAULT_AGENT_CONFIG.llm.model);
    // The other two stay at their defaults: a key run has no thinking spend and no stop.
    expect(run?.inferenceSpendUsd).toBe("0.000000");
    expect(run?.stopReason).toBeNull();

    // Nothing of pay-per-use was read into being: no ledger row, no counter, no control
    // row, no hold, and the manual run was not counted anywhere.
    expect(await paymentsOf(agent.agentId)).toHaveLength(0);
    expect(await db.select().from(schema.inferenceBudgetDays)).toHaveLength(0);
    expect(await db.select().from(schema.inferenceControl)).toHaveLength(0);
    expect(await agentRow(agent.agentId)).toMatchObject({
      inferenceHold: null,
      inferenceHoldSince: null,
      inferenceHoldUntil: null,
      inferenceStrikes: 0,
      inferenceNotifiedAt: null,
    });

    // The run itself. `run.test.ts` pins its figures against a database nothing else has
    // used; here other runs came first and what they bought is cached, so the figures
    // are only asked to be there.
    const shape = await footprint(agent.agentId, agent.userId, result.runId);
    expect(shape.run).toMatchObject({ trigger: "manual", status: "succeeded", error: null, started: true, finished: true });
    expect(Number(shape.run.dataSpendUsd)).toBeGreaterThan(0);
    expect(shape.run.inputTokens).toBeGreaterThan(0);
    expect(shape.dataPayments).toBeGreaterThanOrEqual(1);
    expect(shape.trades).toHaveLength(1);
    expect(shape.posts).toBe(1);
    expect(shape.notices.filter((kind) => kind === "run_failed" || kind === INFERENCE_HOLD_NOTICE)).toEqual([]);
  });

  it("is the same run whether the switch is unset, on, or pay-per-use is halted", async () => {
    const shapes = [];
    for (const setting of ["unset", "on", "halted"] as const) {
      if (setting === "unset") delete process.env.INFERENCE_USDC;
      else process.env.INFERENCE_USDC = "on";
      if (setting === "halted") {
        await db.insert(schema.inferenceControl).values({ id: "global", halted: true, haltReason: "drill", updatedBy: "test" });
      }
      const agent = await keyAgent();
      const result = await runAgent({ agentId: agent.agentId, trigger: "schedule" });
      expect(result.status).toBe("succeeded");
      const [run] = await runsOf(agent.agentId);
      expect(run).toMatchObject({ llmSource: "key", model: DEFAULT_AGENT_CONFIG.llm.model, inferenceSpendUsd: "0.000000", stopReason: null });
      expect(await paymentsOf(agent.agentId)).toHaveLength(0);
      shapes.push(await footprint(agent.agentId, agent.userId, result.runId));
    }
    expect(shapes[1]).toEqual(shapes[0]);
    expect(shapes[2]).toEqual(shapes[0]);
  });

  it("still fails the old way, with the generic notice and no hold", async () => {
    // Outside the scripted model a key agent with no key fails inside the run, as it always has.
    process.env.LLM_MOCK = "0";
    try {
      const agent = await keyAgent();
      const result = await runAgent({ agentId: agent.agentId, trigger: "schedule" });
      expect(result.status).toBe("failed");
      expect(result.error).toContain("no LLM API key attached");
      expect(result.stopReason).toBeUndefined();

      const [run] = await runsOf(agent.agentId);
      expect(run).toMatchObject({ status: "failed", llmSource: "key", model: DEFAULT_AGENT_CONFIG.llm.model, stopReason: null, inferenceSpendUsd: "0.000000" });
      expect((await noticesOf(agent.userId)).map((notice) => notice.kind)).toEqual(["run_failed"]);
      expect((await agentRow(agent.agentId)).inferenceHold).toBeNull();
    } finally {
      process.env.LLM_MOCK = "1";
    }
  });
});

describe("how each stop ends the run", () => {
  const LIMITS = ["run_cap", "deadline", "step_limit"] as const;
  // Every reason that is not the run's own limit. `manual_limit` is decided before a run
  // exists and cannot come from inside one.
  const FAILING = (Object.keys(INFERENCE_STOPS) as InferenceStopReason[]).filter(
    (reason) => INFERENCE_STOPS[reason] !== "limit" && reason !== "manual_limit",
  );

  it.each(LIMITS)("%s: a normal end, as far as the run got, with no hold and no notice", async (reason) => {
    const agent = await payingAgent();
    // Something to clear: a limit reached is still a run that thought and paid.
    await applyInferenceHold(agent.agentId, "quote_failed", new Date(Date.now() - 3_600_000));
    seam.refuse = { atSeq: 2, reason };

    const began = Date.now();
    const result = await runAgent({ agentId: agent.agentId, trigger: "schedule", invocationStartedAt: began });
    // The sentence with no figure in it: a summary is public, the limits are the owner's.
    const said = describeInferenceStop(reason);
    expect(said.detail).not.toContain("$");
    expect(result).toMatchObject({ status: "succeeded", stopReason: reason, summary: said.detail });
    expect(result.error).toBeUndefined();

    const [run] = await runsOf(agent.agentId);
    expect(run).toMatchObject({ status: "succeeded", stopReason: reason, summary: said.detail, error: null, llmSource: "usdc" });
    expect(run?.summary).not.toContain("$");
    expect(run?.finishedAt).not.toBeNull();

    // The two steps it took are paid for and on the row; the refused third is not.
    const payments = await paymentsOf(agent.agentId);
    expect(payments).toHaveLength(2);
    expect(Number(run?.inferenceSpendUsd)).toBeCloseTo(sum(payments), 6);

    const row = await agentRow(agent.agentId);
    expect(row).toMatchObject({ inferenceHold: null, inferenceStrikes: 0, inferenceNotifiedAt: null });
    // Due again on its ordinary schedule: one interval from when its invocation began.
    expect(row.nextRunAt).toEqual(nextRunTime(row.config.schedule.intervalMinutes, began));
    // The one notice is the earlier hold's. This run added none, of either kind.
    const notices = await noticesOf(agent.userId);
    expect(notices.map((notice) => notice.kind)).toEqual([INFERENCE_HOLD_NOTICE]);
    // And an equity point was written, as at the end of any run that succeeded.
    expect(await db.select().from(schema.equitySnapshots).where(eq(schema.equitySnapshots.agentId, agent.agentId))).toHaveLength(1);
  });

  it.each(FAILING)("%s: the run fails with its sentence, the agent is held, and the owner is told once", async (reason) => {
    const agent = await payingAgent();
    seam.refuse = { atSeq: 1, reason };

    const started = Date.now();
    const result = await runAgent({ agentId: agent.agentId, trigger: "schedule", invocationStartedAt: started });
    const said = describeInferenceStop(reason, { runCapUsd: 0.3, dayCapUsd: 3, model: DEFAULT_PAY_PER_USE_MODEL });
    expect(result).toMatchObject({ status: "failed", stopReason: reason, error: said.detail });

    const [run] = await runsOf(agent.agentId);
    expect(run).toMatchObject({ status: "failed", stopReason: reason, error: said.detail, llmSource: "usdc", model: DEFAULT_PAY_PER_USE_MODEL });
    // The step it did take is on the row.
    const payments = await paymentsOf(agent.agentId);
    expect(payments).toHaveLength(1);
    expect(Number(run?.inferenceSpendUsd)).toBeCloseTo(sum(payments), 6);
    expect(Number(run?.inferenceSpendUsd)).toBeGreaterThan(0);

    // Held, for this reason, until the time the rule for it gives. A stop that is nobody's
    // fault (a halt, a pause, the switch, the platform's day) is not counted against it.
    const row = await agentRow(agent.agentId);
    expect(row.inferenceHold).toBe(reason);
    expect(row.inferenceStrikes).toBe(countsAsStrike(reason) ? 1 : 0);
    const finished = run?.finishedAt as Date;
    expect(finished.getTime()).toBeGreaterThanOrEqual(started);
    expect(row.inferenceHoldUntil).toEqual(holdUntil(reason, 1, finished));
    expect(row.inferenceHoldSince).toEqual(finished);

    // Told once, in the words for this reason. Never the generic failure.
    const notices = await noticesOf(agent.userId);
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({ kind: INFERENCE_HOLD_NOTICE, title: `Test Agent: ${said.title}`, body: said.detail, href: `/agents/${agent.slug}` });

    // The transcript's error step is the owner's sentence, and it is the scheduler's
    // ordinary time that the agent is next due at; the hold is what keeps it from running.
    const steps = await stepsOf(result.runId);
    const error = steps.find((step) => step.kind === "error");
    expect(error?.payload).toMatchObject({ error: said.detail, reason });
    expect(row.nextRunAt).toEqual(nextRunTime(row.config.schedule.intervalMinutes, started));
    expect(await findDueAgents(50, new Date(Date.now() + 60_000))).not.toContain(agent.agentId);
  });

  /**
   * The owner's limit for one run is theirs alone (`AgentDetail.config` is null for
   * anyone else), and a run's summary is public. A run that stopped on that limit used to
   * be summarised WITH the figure, so the run list and the run page showed every visitor
   * what the owner had set. Each limit is tried, with a limit the form allows.
   */
  it.each(LIMITS)("%s: a visitor's view of the run carries no dollar figure, in the list or on the run page", async (reason) => {
    const agent = await payingAgent({ maxUsdPerRun: 0.05, maxUsdPerDay: 0.75 });
    seam.refuse = { atSeq: 2, reason };
    const result = await runAgent({ agentId: agent.agentId, trigger: "schedule" });
    expect(result).toMatchObject({ status: "succeeded", stopReason: reason });

    // A signed-out visitor, and another account: neither is the owner.
    for (const viewer of [null, "did:privy:someone-else"]) {
      const listed = (await getAgentRuns(agent.agentId, null, viewer)).items.find((run) => run.id === result.runId);
      const opened = await getRun(result.runId, viewer);
      for (const view of [listed, opened]) {
        expect(view?.status).toBe("succeeded");
        expect(view?.summary).toBe(describeInferenceStop(reason).detail);
        // Nowhere in what a visitor is sent, and neither limit in the words they read.
        expect(JSON.stringify(view)).not.toContain("$");
        expect(`${view?.summary} ${view?.error}`).not.toMatch(/0\.05|0\.75/);
      }
    }
    // The stored row itself has none either: whoever reads it next cannot leak one.
    const [run] = await runsOf(agent.agentId);
    expect(run?.summary).not.toMatch(/\$|0\.05|0\.75/);
  });

  /**
   * The one other sentence the run loop writes with one of the owner's figures in it: the
   * daily limit, in the `error` of a run that failed on it. That is the right place for
   * it, because a run's error is the owner's alone and everyone else reads a fixed line.
   * This is the proof that it stays there: the owner reads the figure, a visitor reads
   * no figure and no reason, in the list or on the run page.
   */
  it("agent_day_cap: the daily limit is in the owner's own view of the run and nowhere in a visitor's", async () => {
    const agent = await payingAgent({ maxUsdPerRun: 0.05, maxUsdPerDay: 0.75 });
    seam.refuse = { atSeq: 1, reason: "agent_day_cap" };
    const result = await runAgent({ agentId: agent.agentId, trigger: "schedule" });
    expect(result).toMatchObject({ status: "failed", stopReason: "agent_day_cap" });

    const said = describeInferenceStop("agent_day_cap", { dayCapUsd: 0.75 }).detail;
    expect(said).toContain("$0.75");
    expect((await getRun(result.runId, agent.userId))?.error).toBe(said);
    expect((await getAgentRuns(agent.agentId, null, agent.userId)).items.find((run) => run.id === result.runId)?.error).toBe(said);

    for (const viewer of [null, "did:privy:someone-else"]) {
      const listed = (await getAgentRuns(agent.agentId, null, viewer)).items.find((run) => run.id === result.runId);
      const opened = await getRun(result.runId, viewer);
      for (const view of [listed, opened]) {
        // The failure is public; what explains it is not.
        expect(view?.status).toBe("failed");
        expect(view?.summary).toBeNull();
        expect(view?.error).not.toBe(said);
        expect(JSON.stringify(view)).not.toContain("$");
        expect(`${view?.summary} ${view?.error}`).not.toMatch(/0\.05|0\.75|daily|limit/i);
        // Neither what it spent on thinking nor why it stopped is in a visitor's row.
        expect(view && "thinking" in view).toBe(false);
      }
      expect(opened?.steps).toEqual([]);
    }
  });

  it("says nothing the second time, waits longer, and starts afresh after a run that works", async () => {
    const agent = await payingAgent();
    seam.refuse = { atSeq: 1, reason: "quote_failed" };

    expect((await runAgent({ agentId: agent.agentId, trigger: "schedule" })).status).toBe("failed");
    const first = await agentRow(agent.agentId);
    expect(first.inferenceStrikes).toBe(1);

    // Its time comes; the check before the run passes (it cannot see the gateway), and
    // the run stops the same way.
    await db.update(schema.agents).set({ inferenceHoldUntil: new Date(Date.now() - 1_000) }).where(eq(schema.agents.id, agent.agentId));
    const second = await runAgent({ agentId: agent.agentId, trigger: "schedule" });
    expect(second).toMatchObject({ status: "failed", stopReason: "quote_failed" });

    const again = await agentRow(agent.agentId);
    expect(again.inferenceStrikes).toBe(2);
    const [, secondRun] = await runsOf(agent.agentId);
    expect(again.inferenceHoldUntil).toEqual(holdUntil("quote_failed", 2, secondRun?.finishedAt as Date));
    expect(await noticesOf(agent.userId)).toHaveLength(1);

    // The gateway is back.
    seam.refuse = null;
    expect((await runAgent({ agentId: agent.agentId, trigger: "manual" })).status).toBe("succeeded");
    expect(await agentRow(agent.agentId)).toMatchObject({ inferenceHold: null, inferenceStrikes: 0, inferenceNotifiedAt: null });
    expect(await holdNoticesOf(agent.userId)).toHaveLength(1);
    expect((await noticesOf(agent.userId)).some((notice) => notice.kind === "run_failed")).toBe(false);
  });

  it("does not run a held agent on its schedule before the hold's time, and writes no run row for trying", async () => {
    const agent = await payingAgent();
    seam.refuse = { atSeq: 0, reason: "signature_failed" };
    await runAgent({ agentId: agent.agentId, trigger: "schedule" });
    seam.refuse = null;

    const held = await runAgent({ agentId: agent.agentId, trigger: "schedule" });
    expect(held).toMatchObject({ runId: "", status: "skipped", stopReason: "signature_failed" });
    expect(await runsOf(agent.agentId)).toHaveLength(1);
    expect((await agentRow(agent.agentId)).inferenceStrikes).toBe(1);
  });

  it("pauses pay-per-use for everyone when enough runs stop on the gateway, at once", async () => {
    seam.refuse = { atSeq: 0, reason: "quote_failed" };
    for (let i = 0; i < 5; i += 1) {
      const agent = await payingAgent();
      await runAgent({ agentId: agent.agentId, trigger: "schedule" });
    }
    seam.refuse = null;
    const [control] = await db.select().from(schema.inferenceControl);
    expect(control?.pausedUntil).not.toBeNull();
    expect((control?.pausedUntil as Date).getTime()).toBeGreaterThan(Date.now());

    // The next agent is not started at all: the check before its run sees the pause.
    const next = await payingAgent();
    expect(await runAgent({ agentId: next.agentId, trigger: "schedule" })).toMatchObject({ status: "skipped", stopReason: "paused" });
    expect(await runsOf(next.agentId)).toHaveLength(0);
  });
});

describe("a run that is told to wrap up", () => {
  /** How many model steps the scripted run takes, and at which one it first calls `finish`. */
  async function scriptShape(): Promise<{ steps: number; firstFinish: number }> {
    const agent = await payingAgent();
    const result = await runAgent({ agentId: agent.agentId, trigger: "schedule" });
    const calls = (await stepsOf(result.runId)).filter((step) => step.kind === "tool_call").map((step) => step.toolName);
    return { steps: calls.length, firstFinish: calls.indexOf("finish") };
  }

  it("ends at its step limit as a run that succeeded, when the model does not finish when told", async () => {
    // Two ordinary steps. The third is the one it is told to finish in, and the script
    // calls something else: the run ends there, on its limit, not as a failure.
    const agent = await payingAgent({}, { maxSteps: 2 });
    const result = await runAgent({ agentId: agent.agentId, trigger: "schedule" });
    expect(result).toMatchObject({ status: "succeeded", stopReason: "step_limit", summary: describeInferenceStop("step_limit").detail });

    const [run] = await runsOf(agent.agentId);
    expect(run).toMatchObject({ status: "succeeded", stopReason: "step_limit", error: null });
    // Three requests were made and paid for: the two steps and the one that wraps up.
    expect(await paymentsOf(agent.agentId)).toHaveLength(3);
    expect((await noticesOf(agent.userId)).filter((notice) => notice.kind === "run_failed" || notice.kind === INFERENCE_HOLD_NOTICE)).toHaveLength(0);
    expect((await agentRow(agent.agentId)).inferenceHold).toBeNull();
  });

  it("takes the model's own summary when the step it is told to finish in is its finish", async () => {
    const { firstFinish } = await scriptShape();
    expect(firstFinish).toBeGreaterThan(1);
    // The wrap-up step lands exactly on the script's first `finish`. The tool may send a
    // model back once for more research; a run being wrapped up has no steps for that,
    // so what the model wrote is its summary either way.
    const agent = await payingAgent({}, { maxSteps: firstFinish });
    const result = await runAgent({ agentId: agent.agentId, trigger: "schedule" });
    expect(result).toMatchObject({ status: "succeeded", stopReason: "step_limit" });
    expect(result.summary).toMatch(/bonk/i);
    expect(result.summary).not.toBe(describeInferenceStop("step_limit").detail);
    expect(await paymentsOf(agent.agentId)).toHaveLength(firstFinish + 1);
  });

  it("ends at its thinking limit when the money left would not cover the steps ahead", async () => {
    // A limit below what the settings form allows, written straight to the row, so that
    // one step leaves less than two and a half more.
    const agent = await payingAgent();
    const config = (await agentRow(agent.agentId)).config;
    const usdc = { model: DEFAULT_PAY_PER_USE_MODEL, maxUsdPerRun: 0.012, maxUsdPerDay: 3 };
    await db.update(schema.agents).set({ config: { ...config, llm: { ...config.llm, usdc } } }).where(eq(schema.agents.id, agent.agentId));

    const result = await runAgent({ agentId: agent.agentId, trigger: "schedule" });
    expect(result).toMatchObject({ status: "succeeded", stopReason: "run_cap" });
    const payments = await paymentsOf(agent.agentId);
    // It never spent past the limit, and stopped well short of the script's length.
    expect(sum(payments)).toBeLessThanOrEqual(0.012 + 1e-9);
    expect(payments.length).toBeLessThan(5);
    const [run] = await runsOf(agent.agentId);
    expect(run?.stopReason).toBe("run_cap");
    expect(Number(run?.inferenceSpendUsd)).toBeCloseTo(sum(payments), 6);
  });

  /**
   * The run starts no new step once it has been thinking for 150 seconds, and ends there.
   * The wrap-up used to be measured to the deadline alone (240 s, less the 75 s a
   * signature needs), so for steps of a few seconds it could not come before that
   * moment: the run paid for its steps and was cut with no `finish`. The run loop now
   * hands the wrap-up the very moment it stops at, and this is that hand-over, through
   * the real loop on a staged clock.
   */
  describe("when its time is nearly up", () => {
    const FINISH = { toolChoice: { type: "tool", toolName: "finish" } };

    /** One scripted run in which the model call has already lasted `alreadyMs` at its first step, and each step takes `stepMs`. */
    async function runOnClock(alreadyMs: number, stepMs: number) {
      const agent = await payingAgent();
      const realNow = Date.now.bind(Date);
      Object.assign(clock, { on: true, offsetMs: 0, alreadyMs, stepMs, prepared: [] });
      const spy = vi.spyOn(Date, "now").mockImplementation(() => realNow() + clock.offsetMs);
      try {
        const result = await runAgent({ agentId: agent.agentId, trigger: "schedule" });
        return { agent, result, told: [...clock.prepared] };
      } finally {
        spy.mockRestore();
        Object.assign(clock, { on: false, offsetMs: 0, alreadyMs: 0, stepMs: 0, prepared: [] });
      }
    }

    it("is told to finish at the last step that can start before the run stops starting steps", async () => {
      // 130 s gone at the first step, eight seconds a step. The second step starts at
      // 138 s: twelve seconds before the run stops starting steps, less than two steps'
      // worth, and still 27 s inside what the deadline alone would have allowed.
      const { agent, result, told } = await runOnClock(130_000, 8_000);

      expect(told).toEqual([{}, FINISH]);
      // The script does not finish when told, so the run ends on its time limit, in order:
      // a run that succeeded as far as it got, with nothing held and nobody alarmed.
      expect(result).toMatchObject({ status: "succeeded", stopReason: "deadline", summary: describeInferenceStop("deadline").detail });
      const [run] = await runsOf(agent.agentId);
      expect(run).toMatchObject({ status: "succeeded", stopReason: "deadline", error: null });
      // Two steps were paid for: the one before, and the one it was told to finish in.
      expect(await paymentsOf(agent.agentId)).toHaveLength(2);
      expect((await agentRow(agent.agentId)).inferenceHold).toBeNull();
      expect((await noticesOf(agent.userId)).filter((notice) => notice.kind === "run_failed" || notice.kind === INFERENCE_HOLD_NOTICE)).toHaveLength(0);
    });

    it("is left to finish by itself when there is time: no step of an ordinary run is told to", async () => {
      const { result, told } = await runOnClock(0, 8_000);

      expect(told.length).toBeGreaterThanOrEqual(5);
      expect(told.every((answer) => JSON.stringify(answer) === "{}")).toBe(true);
      expect(result.status).toBe("succeeded");
      expect(result.stopReason).toBeUndefined();
      expect(result.summary).toMatch(/bonk/i);
    });
  });
});

/**
 * The check before a run, on the real path for once: not the scripted model's, which
 * has no wallet to read. The node is the stand-in (it answers nothing), and the agent has
 * what the real check asks for: a wallet that is not a placeholder, and a wallet policy.
 * No run can start here, so nothing is thought on and nothing could be paid.
 */
describe("a scheduled run whose wallet balance the chain could not give", () => {
  const RPC = "https://rpc.test.invalid";

  /** A pay-per-use agent the real check would let in, due a minute ago. */
  async function fundedLookingAgent() {
    const agent = await payingAgent();
    const due = new Date(Date.now() - 60_000);
    await db.delete(schema.wallets).where(and(eq(schema.wallets.agentId, agent.agentId), eq(schema.wallets.chain, "solana")));
    await db.insert(schema.wallets).values({
      id: `wal_${nanoid(12)}`,
      kind: "agent_server",
      chain: "solana",
      address: Keypair.generate().publicKey.toBase58(),
      userId: agent.userId,
      agentId: agent.agentId,
    });
    await db
      .update(schema.agents)
      .set({ walletBudget: { perTxUsd: 100, policyIds: { solana: `pol_${nanoid(8)}` } }, nextRunAt: due })
      .where(eq(schema.agents.id, agent.agentId));
    return { ...agent, due };
  }

  /** Runs `body` with mock mode off and a node that does not answer. Gives back every address it was asked at. */
  async function withDeadNode(body: () => Promise<void>): Promise<string[]> {
    const asked: string[] = [];
    const prior = { llm: process.env.LLM_MOCK, x402: process.env.X402_MOCK, rpc: process.env.SOLANA_RPC_URL, fetch: globalThis.fetch };
    process.env.LLM_MOCK = "0";
    process.env.X402_MOCK = "0";
    process.env.SOLANA_RPC_URL = RPC;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      asked.push(String(input));
      throw new Error("the node did not answer");
    }) as typeof fetch;
    try {
      await body();
    } finally {
      for (const [name, value] of [
        ["LLM_MOCK", prior.llm],
        ["X402_MOCK", prior.x402],
        ["SOLANA_RPC_URL", prior.rpc],
      ] as const) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
      globalThis.fetch = prior.fetch;
    }
    return asked;
  }

  it("is put off, not held: no run row, no hold, no notice, and the agent is still due for the next pass", async () => {
    const agent = await fundedLookingAgent();

    const asked = await withDeadNode(async () => {
      expect(await runAgent({ agentId: agent.agentId, trigger: "schedule" })).toEqual({ runId: "", status: "skipped", error: RUN_DEFERRED });
      // The scheduler still finds it: the next pass, five minutes on, looks again.
      expect(await findDueAgents(50)).toContain(agent.agentId);
    });
    // Our own node was asked, twice, and nothing else was.
    expect(asked).toEqual([RPC, RPC]);

    expect(await runsOf(agent.agentId)).toHaveLength(0);
    expect(await paymentsOf(agent.agentId)).toHaveLength(0);
    const row = await agentRow(agent.agentId);
    expect(row).toMatchObject({ inferenceHold: null, inferenceHoldUntil: null, inferenceStrikes: 0, inferenceNotifiedAt: null });
    expect(row.nextRunAt).toEqual(agent.due);
    expect(await noticesOf(agent.userId)).toHaveLength(0);
  });

  it("becomes a hold, said once, only when the node has still not answered ten minutes on", async () => {
    const agent = await fundedLookingAgent();

    await withDeadNode(async () => {
      expect((await runAgent({ agentId: agent.agentId, trigger: "schedule" })).error).toBe(RUN_DEFERRED);
      // Eleven minutes pass with the node still down: the first failure is that old now.
      await db.update(schema.agents).set({ inferenceHoldSince: new Date(Date.now() - 11 * 60_000) }).where(eq(schema.agents.id, agent.agentId));

      const said = describeInferenceStop("no_rpc");
      expect(await runAgent({ agentId: agent.agentId, trigger: "schedule" })).toEqual({ runId: "", status: "skipped", error: said.detail, stopReason: "no_rpc" });
      expect(await findDueAgents(50)).not.toContain(agent.agentId);
      // A third try while it waits changes nothing and says nothing.
      expect((await runAgent({ agentId: agent.agentId, trigger: "schedule" })).stopReason).toBe("no_rpc");
    });

    expect(await runsOf(agent.agentId)).toHaveLength(0);
    expect(await agentRow(agent.agentId)).toMatchObject({ inferenceHold: "no_rpc", inferenceStrikes: 1 });
    const notices = await holdNoticesOf(agent.userId);
    expect(notices).toHaveLength(1);
    expect(notices[0]?.title).toBe(`Test Agent: ${describeInferenceStop("no_rpc").title}`);
  });
});

describe("the invocation's time", () => {
  it("does not start a run that would not fit, leaves the agent due, and holds nothing", async () => {
    const agent = await payingAgent();
    const due = new Date(Date.now() - 60_000);
    await db.update(schema.agents).set({ nextRunAt: due }).where(eq(schema.agents.id, agent.agentId));

    // A second batch of a cron pass, a minute into its invocation.
    const result = await runAgent({ agentId: agent.agentId, trigger: "schedule", invocationStartedAt: Date.now() - 60_000 });
    expect(result).toEqual({ runId: "", status: "skipped", error: RUN_DEFERRED });

    expect(await runsOf(agent.agentId)).toHaveLength(0);
    expect(await paymentsOf(agent.agentId)).toHaveLength(0);
    const row = await agentRow(agent.agentId);
    expect(row.inferenceHold).toBeNull();
    expect(row.nextRunAt).toEqual(due);
    expect(await noticesOf(agent.userId)).toHaveLength(0);
    expect(await findDueAgents(50)).toContain(agent.agentId);

    // The next pass, from its start, runs it.
    expect((await runAgent({ agentId: agent.agentId, trigger: "schedule", invocationStartedAt: Date.now() })).status).toBe("succeeded");
  });

  it("starts a key agent's run however late in the invocation it is", async () => {
    const agent = await keyAgent();
    const result = await runAgent({ agentId: agent.agentId, trigger: "schedule", invocationStartedAt: Date.now() - 200_000 });
    expect(result.status).toBe("succeeded");
  });

  it("hands the cron's start time to every run of the pass, and runs pay-per-use agents first", async () => {
    const key = await keyAgent();
    const paying = await payingAgent();
    // The key agent has been due longer, so by age alone it would go first.
    await db.update(schema.agents).set({ nextRunAt: new Date(Date.now() - 600_000) }).where(eq(schema.agents.id, key.agentId));
    await db.update(schema.agents).set({ nextRunAt: new Date(Date.now() - 60_000) }).where(eq(schema.agents.id, paying.agentId));

    // A pass that began two minutes ago: the pay-per-use run does not fit, the key run does.
    const late = await tickDueAgents(50, new Date(), { invocationStartedAt: Date.now() - 120_000 });
    const ours = late.results.filter((result) => result.agentId === key.agentId || result.agentId === paying.agentId);
    expect(ours.map((result) => result.agentId)).toEqual([paying.agentId, key.agentId]);
    expect(ours[0]).toMatchObject({ status: "skipped", error: RUN_DEFERRED });
    expect(ours[1]?.status).toBe("succeeded");
    expect((await agentRow(paying.agentId)).inferenceHold).toBeNull();

    // A pass from its start runs it.
    const fresh = await tickDueAgents(50, new Date(), { invocationStartedAt: Date.now() });
    expect(fresh.results.find((result) => result.agentId === paying.agentId)?.status).toBe("succeeded");
  });
});

describe("the scheduler and a held agent", () => {
  it("skips it while the hold runs, and picks it up once its time has come", async () => {
    const held = await payingAgent();
    const free = await payingAgent();
    const due = new Date(Date.now() - 60_000);
    for (const agent of [held, free]) await db.update(schema.agents).set({ nextRunAt: due }).where(eq(schema.agents.id, agent.agentId));
    await applyInferenceHold(held.agentId, "needs_funds", new Date());

    // Due by its schedule, but waiting: no slot, no run, no second notice.
    expect(await findDueAgents(50)).toContain(free.agentId);
    expect(await findDueAgents(50)).not.toContain(held.agentId);
    const first = await tickDueAgents(50);
    expect(first.results.some((result) => result.agentId === held.agentId)).toBe(false);
    expect(first.results.find((result) => result.agentId === free.agentId)?.status).toBe("succeeded");
    expect(await runsOf(held.agentId)).toHaveLength(0);
    expect(first.holdsCleared).toBe(0);

    // Fifteen minutes on. In mock mode there is no wallet to be short, so the look passes:
    // the hold is lifted before the pass picks, and the agent runs in that same pass.
    const later = new Date(Date.now() + 16 * 60_000);
    expect(await findDueAgents(50, later)).toContain(held.agentId);
    await db.update(schema.agents).set({ inferenceHoldUntil: new Date(Date.now() - 1_000) }).where(eq(schema.agents.id, held.agentId));
    const second = await tickDueAgents(50);
    expect(second.holdsCleared).toBeGreaterThanOrEqual(1);
    expect(second.results.find((result) => result.agentId === held.agentId)?.status).toBe("succeeded");
    expect(await agentRow(held.agentId)).toMatchObject({ inferenceHold: null, inferenceStrikes: 0 });
    expect(await holdNoticesOf(held.userId)).toHaveLength(1);
  });

  it("keeps an agent held when the look says it is still stopped, later each time", async () => {
    const agent = await payingAgent();
    await db.update(schema.agents).set({ nextRunAt: new Date(Date.now() - 60_000) }).where(eq(schema.agents.id, agent.agentId));
    delete process.env.INFERENCE_USDC;
    await runAgent({ agentId: agent.agentId, trigger: "schedule" });
    // Sixteen minutes on: the hold began then, and its first wait has run out.
    await db
      .update(schema.agents)
      .set({ inferenceHoldSince: new Date(Date.now() - 16 * 60_000), inferenceHoldUntil: new Date(Date.now() - 1_000) })
      .where(eq(schema.agents.id, agent.agentId));

    const tick = await tickDueAgents(50);
    expect(tick.results.some((result) => result.agentId === agent.agentId)).toBe(false);
    const row = await agentRow(agent.agentId);
    // Still held and looked at later than last time, with nothing counted against it:
    // the switch being off is not the agent's doing.
    expect(row).toMatchObject({ inferenceHold: "flag_off", inferenceStrikes: 0 });
    expect((row.inferenceHoldUntil as Date).getTime()).toBeGreaterThan(Date.now() + 29 * 60_000);
    expect(await runsOf(agent.agentId)).toHaveLength(0);
    expect(await noticesOf(agent.userId)).toHaveLength(1);
  });
});

describe("a pay-per-use run the platform froze", () => {
  it("is reaped with what the ledger says it spent", async () => {
    const agent = await payingAgent();
    const runId = nanoid();
    const frozen = new Date(Date.now() - 11 * 60_000);
    await db.insert(schema.agentRuns).values({ id: runId, agentId: agent.agentId, trigger: "schedule", status: "running", startedAt: frozen, createdAt: frozen, llmSource: "usdc", model: DEFAULT_PAY_PER_USE_MODEL });
    const payment = (seq: number, status: string, quoted: number, settled: number | null) => ({
      id: nanoid(),
      ownerId: agent.userId,
      agentId: agent.agentId,
      runId,
      seq,
      requestHash: "0".repeat(64),
      chain: "solana",
      network: INFERENCE_GATEWAY.solana.network,
      host: INFERENCE_GATEWAY.solana.host,
      model: DEFAULT_PAY_PER_USE_MODEL,
      payerWalletId: `paper_${agent.agentId}_solana`,
      payerAddress: "PaperSol",
      payTo: INFERENCE_GATEWAY.solana.payTo[0],
      asset: INFERENCE_GATEWAY.solana.asset,
      quotedUsd: toNumeric(quoted, 6),
      settledUsd: settled === null ? null : toNumeric(settled, 6),
      status,
      budgetDay: utcDay(frozen),
    });
    await db.insert(schema.inferencePayments).values([
      payment(0, "settled", 0.004, 0.0035),
      payment(1, "unconfirmed", 0.005, null),
      // Given back before any signature: not spent.
      payment(2, "released", 0.006, null),
    ]);

    expect(await reapStaleRuns(agent.agentId)).toBe(1);
    const [run] = await runsOf(agent.agentId);
    expect(run).toMatchObject({ status: "failed", error: ABANDONED_RUN_ERROR, llmSource: "usdc" });
    expect(Number(run?.inferenceSpendUsd)).toBeCloseTo(0.0085, 6);
  });

  it("is reaped as before when it was a key run", async () => {
    const agent = await keyAgent();
    const frozen = new Date(Date.now() - 11 * 60_000);
    await db.insert(schema.agentRuns).values({ id: nanoid(), agentId: agent.agentId, trigger: "schedule", status: "running", startedAt: frozen, createdAt: frozen });
    expect(await reapStaleRuns(agent.agentId)).toBe(1);
    const [run] = await runsOf(agent.agentId);
    expect(run).toMatchObject({ status: "failed", error: ABANDONED_RUN_ERROR, inferenceSpendUsd: "0.000000", llmSource: null });
  });
});

/**
 * Which named reason, if any, a pay-per-use run stopped for. The run's own clock firing
 * cannot be staged in a test without waiting minutes for it, so the rule is tested here.
 */
describe("paidStop: naming why a pay-per-use run stopped", () => {
  const context = (stop: InferencePayContext["stop"] = null): InferencePayContext => ({
    ownerId: "o",
    agentId: "a",
    runId: "r",
    model: DEFAULT_PAY_PER_USE_MODEL,
    chain: "solana",
    payer: { walletId: "w", address: "x" },
    caps: { stepUsd: 0.25, runUsd: 0.3, agentDayUsd: 3, ownerDayUsd: 25, platformDayUsd: 2, agentDayRequests: 600, maxRequestsPerRun: 21 },
    deadlineAt: Date.now() + 240_000,
    ledger: {} as InferencePayContext["ledger"],
    ...newPayCounters(),
    stop,
  });
  const started = { wrapUp: null, modelCallStarted: true, aborted: false };
  const timeout = () => Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
  const violation = () =>
    new ToolChoiceViolationError({ toolChoice: { type: "tool", toolName: "finish" }, finishReason: "stop", provider: "p", modelId: "m", content: [] });

  it("is what the pay path wrote on the context, whatever was thrown", () => {
    const stop = { reason: "paid_no_answer" as const, detail: "the gateway answered 502 after the payment left" };
    // The class does not survive the trip out, so the error itself may be anything.
    expect(paidStop(context(stop), new Error("fetch failed"), started)).toEqual(stop);
    expect(paidStop(context(stop), new InferenceStop("paid_no_answer"), started)).toEqual(stop);
    expect(paidStop(context(stop), timeout(), { ...started, aborted: true })).toEqual(stop);
    // Even before the model call: the pay path spoke, and it is believed.
    expect(paidStop(context(stop), new Error("x"), { ...started, modelCallStarted: false })).toEqual(stop);
  });

  it("is the run's time limit when its own clock fired between steps", () => {
    expect(paidStop(context(), timeout(), { ...started, aborted: true })?.reason).toBe("deadline");
    const abort = Object.assign(new Error("This operation was aborted"), { name: "AbortError" });
    expect(paidStop(context(), abort, { ...started, aborted: true })?.reason).toBe("deadline");
  });

  it("is not the time limit for a timeout that was not the run's own clock", () => {
    // Some call inside a tool timed out and threw; the run's signal never fired.
    expect(paidStop(context(), timeout(), started)).toBeNull();
  });

  it("is the limit that had the model told to finish, when it did not", () => {
    expect(paidStop(context(), violation(), { ...started, wrapUp: "run_cap" })?.reason).toBe("run_cap");
    expect(paidStop(context(), violation(), { ...started, wrapUp: "step_limit" })?.reason).toBe("step_limit");
  });

  it("is the provider's side when the model call failed in the SDK with no stop named", () => {
    const unreadable = new APICallError({ message: "Invalid JSON response", url: INFERENCE_GATEWAY.solana.url, requestBodyValues: {}, statusCode: 200, isRetryable: false });
    expect(paidStop(context(), unreadable, started)?.reason).toBe("gateway_error");
    // A forced-finish violation with nothing forcing it cannot happen; if it did it is the same.
    expect(paidStop(context(), violation(), started)?.reason).toBe("gateway_error");
  });

  it("has no name for anything else: the ordinary failure applies", () => {
    expect(paidStop(context(), new Error("relation agents does not exist"), started)).toBeNull();
    expect(paidStop(context(), "a string was thrown", started)).toBeNull();
    // Before the model call began nothing was asked of the provider, so nothing is blamed on it.
    const early = new APICallError({ message: "x", url: "https://example.test", requestBodyValues: {}, isRetryable: false });
    expect(paidStop(context(), early, { ...started, modelCallStarted: false })).toBeNull();
    expect(paidStop(context(), timeout(), { wrapUp: null, modelCallStarted: false, aborted: true })).toBeNull();
  });
});

describe("runSummary: what a finished run is summarised as", () => {
  const cutShort = describeInferenceStop("deadline").detail;

  it("is the summary `finish` accepted, whenever there is one", () => {
    expect(runSummary("Bought one position.", "and then I thought", null)).toBe("Bought one position.");
    expect(runSummary("Bought one position.", "and then I thought", cutShort)).toBe("Bought one position.");
  });

  it("is the model's last words for a run that simply ended, bounded like a summary", () => {
    expect(runSummary(null, "  Nothing cleared the bar this tick.  ", null)).toBe("Nothing cleared the bar this tick.");
    expect(runSummary(null, "x".repeat(5_000), null)).toHaveLength(1000);
    expect(runSummary(null, "   ", null)).toBeNull();
  });

  it("is the sentence for the limit when a pay-per-use run was cut short, not a remark made mid-thought", () => {
    expect(runSummary(null, "Scoring the strongest name on that table.", cutShort)).toBe(cutShort);
    expect(runSummary(null, "", cutShort)).toBe(cutShort);
  });
});
