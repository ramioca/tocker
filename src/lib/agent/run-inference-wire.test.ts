/**
 * A pay-per-use run through the real provider client, down to the request it would send.
 *
 * `run-inference.test.ts` drives the run with the scripted model, which never builds a
 * request. Here `LLM_MOCK` is off: the run builds the OpenAI-compatible client pointed at
 * the gateway, and every step goes through the real paying fetch. That fetch is in mock
 * mode (`X402_MOCK=1`), so it guards the request, applies every limit and writes its
 * `simulated` row exactly as it would on the real path, and then answers from this file
 * instead of the network. Nothing is signed or sent anywhere.
 *
 * What only this can show: the URL and body the run would put on the wire, that the
 * step it is told to finish in really carries the forced tool choice, and that a stop
 * thrown inside the fetch comes back out through the provider as that stop.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, asc, eq } from "drizzle-orm";
import type { Db } from "@/db";
import * as schema from "@/db/schema";
import type { AgentConfig } from "@/db/schema";
import { seedKnownTokens } from "@/lib/trading/tokens";
import { holdUntil } from "@/lib/x402/inference-budget";
import {
  AGENT_DAY_REQUESTS,
  DEFAULT_PAY_PER_USE_MODEL,
  INFERENCE_GATEWAY,
  INFERENCE_MAX_OUTPUT_TOKENS,
  describeInferenceStop,
  utcDay,
  type InferencePayContext,
} from "@/lib/x402/inference-types";
import { DEFAULT_AGENT_CONFIG } from "./config";
import { INFERENCE_HOLD_NOTICE } from "./inference-gate";
import { runAgent } from "./run";
import { seedAgent, setupTestDb } from "./test-support";

type Body = Record<string, unknown>;
type Answer = (request: { seq: number; body: Body }) => unknown;

/** What the run sent, and what this file answers with. */
const wire = vi.hoisted(() => ({
  answer: null as null | ((request: { seq: number; body: Record<string, unknown> }) => unknown),
  bodies: [] as Array<Record<string, unknown>>,
  urls: [] as string[],
  methods: [] as string[],
}));

vi.mock("@/lib/x402/paidFetch", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/x402/paidFetch")>();
  return {
    ...real,
    createInferenceFetch: (ctx: InferencePayContext) => {
      const paying = real.createInferenceFetch(ctx, {
        mockAnswer: (request) => {
          wire.bodies.push(request.body);
          return wire.answer ? wire.answer(request) : undefined;
        },
      });
      return (async (input: RequestInfo | URL, init?: RequestInit) => {
        wire.urls.push(input instanceof Request ? input.url : String(input));
        wire.methods.push((init?.method ?? "GET").toUpperCase());
        return paying(input, init);
      }) as typeof fetch;
    },
  };
});

let db: Db;
const before = { llm: process.env.LLM_MOCK, x402: process.env.X402_MOCK, flag: process.env.INFERENCE_USDC };

beforeAll(async () => {
  process.env.X402_MOCK = "1";
  // The real provider path: the model is the gateway client, not the script.
  process.env.LLM_MOCK = "0";
  process.env.INFERENCE_USDC = "on";
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

beforeEach(async () => {
  wire.answer = null;
  wire.bodies.length = 0;
  wire.urls.length = 0;
  wire.methods.length = 0;
  await db.delete(schema.inferenceControl);
  await db.delete(schema.inferenceBudgetDays);
  await db.update(schema.agentRuns).set({ stopReason: null });
  // Tools that reach for a price or a feed get an empty answer; nothing here trades.
  globalThis.fetch = (async () => new Response("[]", { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;
});

async function payingAgent(llm: Partial<AgentConfig["llm"]> = {}, model = DEFAULT_PAY_PER_USE_MODEL) {
  return seedAgent(db, {
    config: {
      dataSources: [],
      chains: ["solana"],
      llm: { ...DEFAULT_AGENT_CONFIG.llm, ...llm, source: "usdc", usdc: { model, maxUsdPerRun: 0.3, maxUsdPerDay: 3 } },
    },
  });
}

/** A chat completion that calls one tool, the way the gateway would return it. */
function toolCall(seq: number, name: string, args: Record<string, unknown>, text: string | null = null): Body {
  return {
    id: `chatcmpl-${seq}`,
    object: "chat.completion",
    created: 1_790_000_000,
    model: DEFAULT_PAY_PER_USE_MODEL,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: text,
          tool_calls: [{ id: `call_${seq}`, type: "function", function: { name, arguments: JSON.stringify(args) } }],
        },
        finish_reason: "tool_calls",
      },
    ],
    usage: { prompt_tokens: 1200, completion_tokens: 40, total_tokens: 1240 },
  };
}

const runsOf = (agentId: string) => db.select().from(schema.agentRuns).where(eq(schema.agentRuns.agentId, agentId));
const paymentsOf = (agentId: string) =>
  db.select().from(schema.inferencePayments).where(eq(schema.inferencePayments.agentId, agentId)).orderBy(asc(schema.inferencePayments.seq));
const noticesOf = (userId: string) => db.select().from(schema.notifications).where(eq(schema.notifications.userId, userId));

describe("what a pay-per-use run puts on the wire", () => {
  it("posts chat completions to the pinned gateway, for the agent's model, with the answer capped and no stream", async () => {
    const agent = await payingAgent({ temperature: 0.4 }, "openai/gpt-4o-mini");

    // No scripted answer: the fetch's own canned reply, plain text with no tool call.
    const result = await runAgent({ agentId: agent.agentId, trigger: "schedule" });
    expect(result.status).toBe("succeeded");
    expect(result.stopReason).toBeUndefined();
    expect(result.summary).toMatch(/Mock mode/);

    // One request, to exactly the pinned URL. Not /responses, which the gateway does not serve.
    expect(wire.urls).toEqual([INFERENCE_GATEWAY.solana.url]);
    expect(wire.methods).toEqual(["POST"]);
    const [body] = wire.bodies;
    expect(body?.model).toBe("openai/gpt-4o-mini");
    expect(body?.max_tokens).toBe(INFERENCE_MAX_OUTPUT_TOKENS);
    expect(body?.max_completion_tokens).toBeUndefined();
    expect(body?.stream === undefined || body?.stream === false).toBe(true);
    expect(body?.temperature).toBe(0.4);
    // The run's tools went with it, `finish` among them, and no tool was forced.
    const tools = (body?.tools as Array<{ function: { name: string } }>).map((tool) => tool.function.name);
    expect(tools).toContain("finish");
    expect(tools).toContain("place_trade");
    expect(body?.tool_choice === undefined || body?.tool_choice === "auto").toBe(true);

    const [run] = await runsOf(agent.agentId);
    expect(run).toMatchObject({ status: "succeeded", llmSource: "usdc", model: "openai/gpt-4o-mini", stopReason: null });
    const payments = await paymentsOf(agent.agentId);
    expect(payments).toHaveLength(1);
    expect(payments[0]).toMatchObject({ status: "simulated", seq: 0, model: "openai/gpt-4o-mini" });
    expect(Number(run?.inferenceSpendUsd)).toBeCloseTo(Number(payments[0]?.quotedUsd), 6);
    // The token counts are the gateway's own, summed over the run's steps.
    expect(run?.inputTokens).toBeGreaterThan(0);
  });

  it("runs the model's tools step by step and ends on the summary it gives `finish`", async () => {
    const agent = await payingAgent();
    const script: Answer = ({ seq }) =>
      seq === 0 ? toolCall(seq, "get_portfolio", {}, "Checking the book.") : toolCall(seq, "finish", { summary: "Looked at the book and held. Nothing traded this tick." });
    wire.answer = script;

    const result = await runAgent({ agentId: agent.agentId, trigger: "schedule" });
    expect(result).toMatchObject({ status: "succeeded", summary: "Looked at the book and held. Nothing traded this tick." });
    expect(result.stopReason).toBeUndefined();

    expect(wire.bodies).toHaveLength(2);
    // The second request carries the first step's answer and its tool result back.
    const roles = (wire.bodies[1]?.messages as Array<{ role: string }>).map((message) => message.role);
    expect(roles).toContain("assistant");
    expect(roles).toContain("tool");

    const payments = await paymentsOf(agent.agentId);
    expect(payments.map((row) => row.seq)).toEqual([0, 1]);
    const [run] = await runsOf(agent.agentId);
    expect(Number(run?.inferenceSpendUsd)).toBeCloseTo(payments.reduce((total, row) => total + Number(row.quotedUsd), 0), 6);
    // Both steps' tokens, as the gateway reported them.
    expect(run?.inputTokens).toBe(2400);
    expect(run?.outputTokens).toBe(80);
  });

  it("forces `finish` on the step after its last ordinary one, and takes the summary given there", async () => {
    // Two ordinary steps, then the one that wraps up.
    const agent = await payingAgent({ maxSteps: 2 });
    wire.answer = ({ seq, body }) => {
      // A model does what the request tells it: when one tool is forced, it calls that tool.
      const forced = body.tool_choice as { type?: string; function?: { name?: string } } | string | undefined;
      if (typeof forced === "object" && forced?.function?.name === "finish") {
        return toolCall(seq, "finish", { summary: "Out of steps: reviewed the book and found nothing to act on." });
      }
      return toolCall(seq, "get_portfolio", {});
    };

    const result = await runAgent({ agentId: agent.agentId, trigger: "schedule" });
    expect(result).toMatchObject({
      status: "succeeded",
      stopReason: "step_limit",
      summary: "Out of steps: reviewed the book and found nothing to act on.",
    });

    // Three requests: steps 0 and 1 free to choose, step 2 told to finish.
    expect(wire.bodies).toHaveLength(3);
    expect(wire.bodies[0]?.tool_choice === undefined || wire.bodies[0]?.tool_choice === "auto").toBe(true);
    expect(wire.bodies[1]?.tool_choice === undefined || wire.bodies[1]?.tool_choice === "auto").toBe(true);
    expect(wire.bodies[2]?.tool_choice).toEqual({ type: "function", function: { name: "finish" } });

    const [run] = await runsOf(agent.agentId);
    expect(run).toMatchObject({ status: "succeeded", stopReason: "step_limit", error: null });
    expect(await paymentsOf(agent.agentId)).toHaveLength(3);
    expect(await noticesOf(agent.userId)).toHaveLength(0);
  });

  it("ends on its limit, not as a failure, when the model ignores the forced `finish`", async () => {
    const agent = await payingAgent({ maxSteps: 2 });
    // It keeps calling the same tool whatever it is told.
    wire.answer = ({ seq }) => toolCall(seq, "get_portfolio", {});

    const result = await runAgent({ agentId: agent.agentId, trigger: "schedule" });
    expect(result).toMatchObject({ status: "succeeded", stopReason: "step_limit", summary: describeInferenceStop("step_limit").detail });
    // It was not given a fourth request to ignore.
    expect(wire.bodies).toHaveLength(3);
    expect(await noticesOf(agent.userId)).toHaveLength(0);
    const [row] = await db.select().from(schema.agents).where(eq(schema.agents.id, agent.agentId));
    expect(row?.inferenceHold).toBeNull();
  });
});

describe("a stop thrown inside the paying fetch", () => {
  it("comes out through the provider as that stop: the run fails with its sentence and the agent is held", async () => {
    const agent = await payingAgent();
    // One request left in the agent's day. The check before the run passes; the first
    // step takes the last one; the ledger refuses the second inside the fetch.
    await db
      .insert(schema.inferenceBudgetDays)
      .values({ scope: "agent", scopeId: agent.agentId, day: utcDay(new Date()), requests: AGENT_DAY_REQUESTS - 1 });
    wire.answer = ({ seq }) => toolCall(seq, "get_portfolio", {});

    const result = await runAgent({ agentId: agent.agentId, trigger: "schedule" });
    const said = describeInferenceStop("request_limit");
    expect(result).toMatchObject({ status: "failed", stopReason: "request_limit", error: said.detail });

    // The second request was never answered: the refusal came before anything was "sent".
    expect(wire.bodies).toHaveLength(1);
    const payments = await paymentsOf(agent.agentId);
    expect(payments).toHaveLength(1);

    const [run] = await runsOf(agent.agentId);
    expect(run).toMatchObject({ status: "failed", stopReason: "request_limit", error: said.detail, llmSource: "usdc" });
    expect(Number(run?.inferenceSpendUsd)).toBeCloseTo(Number(payments[0]?.quotedUsd), 6);
    // The one step that was answered is counted, though the run has no result to read it from.
    expect(run?.inputTokens).toBe(1200);

    const [row] = await db.select().from(schema.agents).where(eq(schema.agents.id, agent.agentId));
    expect(row?.inferenceHold).toBe("request_limit");
    // A day limit waits for the next UTC day.
    expect(row?.inferenceHoldUntil).toEqual(holdUntil("request_limit", 1, run?.finishedAt as Date));

    const notices = await noticesOf(agent.userId);
    expect(notices.map((notice) => notice.kind)).toEqual([INFERENCE_HOLD_NOTICE]);
    // Nothing the provider or the fetch said about the failure reached the owner but the sentence.
    expect(notices[0]?.body).toBe(said.detail);
  });

  it("ends a run at its thinking limit as a run that succeeded", async () => {
    const agent = await payingAgent();
    // A run limit below one step of this size, written straight to the row: the first
    // request is refused by the fetch's own check before anything is reserved.
    const [row] = await db.select().from(schema.agents).where(eq(schema.agents.id, agent.agentId));
    const config = row?.config as AgentConfig;
    await db
      .update(schema.agents)
      .set({ config: { ...config, llm: { ...config.llm, usdc: { model: DEFAULT_PAY_PER_USE_MODEL, maxUsdPerRun: 0.0045, maxUsdPerDay: 3 } } } })
      .where(eq(schema.agents.id, agent.agentId));
    wire.answer = ({ seq }) => toolCall(seq, "get_portfolio", {});

    const result = await runAgent({ agentId: agent.agentId, trigger: "schedule" });
    expect(result.status).toBe("succeeded");
    expect(result.stopReason).toBe("run_cap");
    const payments = await paymentsOf(agent.agentId);
    expect(payments.reduce((total, payment) => total + Number(payment.quotedUsd), 0)).toBeLessThanOrEqual(0.0045 + 1e-9);
    expect(await noticesOf(agent.userId)).toHaveLength(0);
    const [after] = await db.select().from(schema.agents).where(and(eq(schema.agents.id, agent.agentId)));
    expect(after?.inferenceHold).toBeNull();
  });

  it("holds the agent, without the generic failure, when the gateway's answer cannot be used", async () => {
    const agent = await payingAgent();
    // Paid for, and not a chat completion the client can read.
    wire.answer = () => ({ id: "x", object: "chat.completion", choices: "none" });

    const result = await runAgent({ agentId: agent.agentId, trigger: "schedule" });
    expect(result.status).toBe("failed");
    expect(result.stopReason).toBe("gateway_error");
    expect(result.error).toBe(describeInferenceStop("gateway_error").detail);

    const [run] = await runsOf(agent.agentId);
    expect(run).toMatchObject({ status: "failed", stopReason: "gateway_error" });
    expect(Number(run?.inferenceSpendUsd)).toBeGreaterThan(0);
    const [row] = await db.select().from(schema.agents).where(eq(schema.agents.id, agent.agentId));
    expect(row?.inferenceHold).toBe("gateway_error");
    expect((await noticesOf(agent.userId)).map((notice) => notice.kind)).toEqual([INFERENCE_HOLD_NOTICE]);
  });
});
