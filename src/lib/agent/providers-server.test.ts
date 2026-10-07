/**
 * Every provider, down to the request it would send.
 *
 * The registry says where a key may go and what a run may send. This file is the proof
 * that the clients do it: for every row of the catalogue a model is built the way a run
 * builds it (`modelFor`), given a two-step conversation with one tool, and answered from
 * here in that provider's own wire format. `fetch` is replaced for the whole file, so
 * nothing leaves the machine, and the key is a stand-in made at run time.
 *
 * Four things are checked for each: every request went to the provider's own origin, the
 * key travelled in the one header it belongs in and nowhere else, the tool call in the
 * first answer was understood and its result went back in the second request, and the
 * temperature and output limit on the wire are the registry's.
 *
 * What this cannot show is that the provider accepts the request. The answers are written
 * from each API's documented shape (and for the Vercel gateway, from the shape its own
 * client passes through), not captured from a paid call.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { generateText, stepCountIs, tool, type LanguageModel } from "ai";
import { nanoid } from "nanoid";
import { z } from "zod";
import { REDACTED, redactSecrets } from "@/lib/security/redact";
import { CATALOGUE, CATALOGUE_IDS, PROVIDER_IDS, PROVIDER_UNSUPPORTED, requestTemperature, type CatalogueId } from "./providers";
import { EMPTY_KEY, NOT_A_MODEL, callOptionsFor, keyScrubber, modelFor, noScrub, sentenceInBody } from "./providers-server";

type Json = Record<string, unknown>;

/** Every time the Vercel gateway's client was built, and with what. The real factory still runs. */
const gatewayBuilt = vi.hoisted(() => [] as Array<{ apiKey?: unknown; baseURL?: unknown }>);

vi.mock("ai", async (importOriginal) => {
  const real = await importOriginal<typeof import("ai")>();
  return {
    ...real,
    createGateway: ((settings) => {
      gatewayBuilt.push({ apiKey: settings?.apiKey, baseURL: settings?.baseURL });
      return real.createGateway(settings);
    }) as typeof real.createGateway,
  };
});

interface Sent {
  url: URL;
  method: string;
  /** Header names lower-cased, as `Headers` gives them. */
  headers: Record<string, string>;
  body: string;
  json: Json;
  redirect: RequestRedirect | undefined;
}

const sent: Sent[] = [];
/** What the provider "says" to request number `n`. Set by each test. */
let answer: (n: number, request: Sent) => Response = () => new Response("{}", { status: 500 });
let realFetch: typeof fetch;
const envBefore: Record<string, string | undefined> = {};

/** Variables a client would read a host or a key from, if a builder ever stopped passing its own. */
const MOVABLE = [
  "OPENAI_BASE_URL",
  "ANTHROPIC_BASE_URL",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "OPENROUTER_API_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "XAI_API_KEY",
  "DEEPSEEK_API_KEY",
  "MISTRAL_API_KEY",
  "MOONSHOT_API_KEY",
  "ZAI_API_KEY",
  "GROQ_API_KEY",
  "CEREBRAS_API_KEY",
  "TOGETHER_API_KEY",
  "TOGETHER_AI_API_KEY",
  "FIREWORKS_API_KEY",
  "DEEPINFRA_API_KEY",
  "AI_GATEWAY_API_KEY",
] as const;

beforeAll(() => {
  // The clients say on the console when they leave a parameter out. Expected here, and noise.
  (globalThis as { AI_SDK_LOG_WARNINGS?: boolean }).AI_SDK_LOG_WARNINGS = false;
});

afterAll(() => {
  delete (globalThis as { AI_SDK_LOG_WARNINGS?: boolean }).AI_SDK_LOG_WARNINGS;
});

beforeEach(() => {
  sent.length = 0;
  gatewayBuilt.length = 0;
  realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, name) => {
      headers[name] = value;
    });
    const body = typeof init?.body === "string" ? init.body : "";
    const request: Sent = {
      url: new URL(input instanceof Request ? input.url : String(input)),
      method: (init?.method ?? "GET").toUpperCase(),
      headers,
      body,
      json: body ? (JSON.parse(body) as Json) : {},
      redirect: init?.redirect,
    };
    sent.push(request);
    return answer(sent.length - 1, request);
  }) as typeof fetch;
  // Somewhere a key must never go. If a builder read its host from the environment, the
  // origin check below would see this address.
  for (const name of MOVABLE) {
    envBefore[name] = process.env[name];
    process.env[name] = name.endsWith("_BASE_URL") ? "https://elsewhere.invalid/v1" : `operator-${nanoid(24)}`;
  }
});

afterEach(() => {
  globalThis.fetch = realFetch;
  for (const name of MOVABLE) {
    if (envBefore[name] === undefined) delete process.env[name];
    else process.env[name] = envBefore[name];
  }
});

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/**
 * A stand-in key, made here and now: the provider's own prefix where it has one, then
 * letters and digits. Nothing key-shaped is written in this file (`repo-secrets.test.ts`).
 */
function standInKey(id: CatalogueId): string {
  return `${CATALOGUE[id].keyPrefixes[0] ?? ""}${nanoid(24).replace(/[^A-Za-z0-9]/g, "x")}${nanoid(24).replace(/[^A-Za-z0-9]/g, "x")}`;
}

const PRICE = 187.25;
const tools = {
  get_price: tool({
    description: "The price of a token in US dollars.",
    inputSchema: z.object({ symbol: z.string() }),
    execute: async ({ symbol }) => ({ symbol, usd: PRICE }),
  }),
};

const CALL = { name: "get_price", args: { symbol: "SOL" } } as const;
const SAID = "SOL is at 187.25.";

/** The wire formats the catalogue's providers speak. */
type Format = "chat" | "anthropic" | "google" | "openai-responses" | "xai-responses" | "gateway";

interface Wire {
  format: Format;
  /** The path every request goes to, on the provider's origin. */
  path: (model: string) => string;
  /** The one header the key travels in, lower-cased. */
  header: "authorization" | "x-api-key" | "x-goog-api-key";
  /**
   * A model to test with when the default is one whose client leaves the temperature
   * out by itself, which would hide what the registry's rule sends.
   */
  model?: string;
}

const chat = (path: string): Wire => ({ format: "chat", path: () => path, header: "authorization" });

/** Where each provider's requests go and how its key travels, written out, not derived: this is the check. */
const WIRE: { readonly [Id in CatalogueId]: Wire } = {
  anthropic: { format: "anthropic", path: () => "/v1/messages", header: "x-api-key", model: "claude-haiku-4-5-20251001" },
  openai: { format: "openai-responses", path: () => "/v1/responses", header: "authorization", model: "gpt-4.1" },
  openrouter: chat("/api/v1/chat/completions"),
  google: { format: "google", path: (model) => `/v1beta/models/${model}:generateContent`, header: "x-goog-api-key" },
  xai: { format: "xai-responses", path: () => "/v1/responses", header: "authorization" },
  deepseek: chat("/chat/completions"),
  mistral: chat("/v1/chat/completions"),
  moonshot: chat("/v1/chat/completions"),
  zai: chat("/api/paas/v4/chat/completions"),
  groq: chat("/openai/v1/chat/completions"),
  cerebras: chat("/v1/chat/completions"),
  together: chat("/v1/chat/completions"),
  fireworks: chat("/inference/v1/chat/completions"),
  deepinfra: chat("/v1/openai/chat/completions"),
  vercel: { format: "gateway", path: () => "/v4/ai/language-model", header: "authorization" },
  venice: chat("/api/v1/chat/completions"),
  nebius: chat("/v1/chat/completions"),
  novita: chat("/openai/v1/chat/completions"),
  huggingface: chat("/v1/chat/completions"),
};

/** What each format answers with: first a call to the one tool, then a sentence. */
const ANSWERS: Record<Format, { call: (model: string) => Json; text: (model: string) => Json }> = {
  // OpenAI chat completions, which most of them serve.
  chat: {
    call: (model) => ({
      id: "chatcmpl-1",
      object: "chat.completion",
      created: 1_790_000_000,
      model,
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: null,
            tool_calls: [{ id: "call00001", type: "function", function: { name: CALL.name, arguments: JSON.stringify(CALL.args) } }],
          },
          finish_reason: "tool_calls",
        },
      ],
      usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
    }),
    text: (model) => ({
      id: "chatcmpl-2",
      object: "chat.completion",
      created: 1_790_000_001,
      model,
      choices: [{ index: 0, message: { role: "assistant", content: SAID }, finish_reason: "stop" }],
      usage: { prompt_tokens: 140, completion_tokens: 10, total_tokens: 150 },
    }),
  },
  // Anthropic's Messages API.
  anthropic: {
    call: (model) => ({
      id: "msg_1",
      type: "message",
      role: "assistant",
      model,
      content: [{ type: "tool_use", id: "toolu_1", name: CALL.name, input: CALL.args }],
      stop_reason: "tool_use",
      stop_sequence: null,
      usage: { input_tokens: 100, output_tokens: 20 },
    }),
    text: (model) => ({
      id: "msg_2",
      type: "message",
      role: "assistant",
      model,
      content: [{ type: "text", text: SAID }],
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 140, output_tokens: 10 },
    }),
  },
  // Gemini's generateContent. The signature is what Gemini 3 demands back with the call.
  google: {
    call: (model) => ({
      candidates: [
        {
          content: { role: "model", parts: [{ functionCall: { name: CALL.name, args: CALL.args }, thoughtSignature: "signature-of-step-one" }] },
          finishReason: "STOP",
          index: 0,
        },
      ],
      usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20, totalTokenCount: 120 },
      modelVersion: model,
    }),
    text: (model) => ({
      candidates: [{ content: { role: "model", parts: [{ text: SAID }] }, finishReason: "STOP", index: 0 }],
      usageMetadata: { promptTokenCount: 140, candidatesTokenCount: 10, totalTokenCount: 150 },
      modelVersion: model,
    }),
  },
  // OpenAI's Responses API.
  "openai-responses": {
    call: (model) => ({
      id: "resp_1",
      object: "response",
      created_at: 1_790_000_000,
      status: "completed",
      model,
      output: [{ type: "function_call", id: "fc_1", call_id: "call_1", name: CALL.name, arguments: JSON.stringify(CALL.args), status: "completed" }],
      usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 },
    }),
    text: (model) => ({
      id: "resp_2",
      object: "response",
      created_at: 1_790_000_001,
      status: "completed",
      model,
      output: [{ type: "message", id: "msg_2", role: "assistant", status: "completed", content: [{ type: "output_text", text: SAID, annotations: [] }] }],
      usage: { input_tokens: 140, output_tokens: 10, total_tokens: 150 },
    }),
  },
  // xAI's Responses API: the same family, with its own usage and item fields.
  "xai-responses": {
    call: (model) => ({
      id: "resp_1",
      object: "response",
      created_at: 1_790_000_000,
      status: "completed",
      model,
      output: [{ type: "function_call", id: "fc_1", call_id: "call_1", name: CALL.name, arguments: JSON.stringify(CALL.args) }],
      usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 },
    }),
    text: (model) => ({
      id: "resp_2",
      object: "response",
      created_at: 1_790_000_001,
      status: "completed",
      model,
      output: [{ type: "message", id: "msg_2", role: "assistant", status: "completed", content: [{ type: "output_text", text: SAID }] }],
      usage: { input_tokens: 140, output_tokens: 10, total_tokens: 150 },
    }),
  },
  // The Vercel gateway's own protocol: the AI SDK's result object, which its client hands
  // on as it arrives.
  gateway: {
    call: () => ({
      content: [{ type: "tool-call", toolCallId: "call_1", toolName: CALL.name, input: JSON.stringify(CALL.args) }],
      finishReason: { unified: "tool-calls", raw: "tool_calls" },
      usage: { inputTokens: { total: 100, noCache: 100, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 20, text: 20, reasoning: 0 } },
      warnings: [],
    }),
    text: () => ({
      content: [{ type: "text", text: SAID }],
      finishReason: { unified: "stop", raw: "stop" },
      usage: { inputTokens: { total: 140, noCache: 140, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 10, text: 10, reasoning: 0 } },
      warnings: [],
    }),
  },
};

const list = (value: unknown): Json[] => (Array.isArray(value) ? (value as Json[]) : []);

/** The tool result as the second request carries it, in each format's own place for one. Null when it is not there. */
function toolResultSent(format: Format, body: Json): unknown {
  switch (format) {
    case "chat": {
      const asked = list(body.messages).find((message) => message.role === "assistant" && list(message.tool_calls).length > 0);
      const told = list(body.messages).find((message) => message.role === "tool");
      const callId = (list(asked?.tool_calls)[0] as { id?: unknown } | undefined)?.id;
      return told && callId !== undefined && told.tool_call_id === callId ? told.content : null;
    }
    case "anthropic": {
      const parts = list(body.messages).flatMap((message) => (message.role === "user" ? list(message.content) : []));
      const told = parts.find((part) => part.type === "tool_result");
      return told?.tool_use_id === "toolu_1" ? told.content : null;
    }
    case "google": {
      const parts = list(body.contents).flatMap((turn) => list(turn.parts));
      const told = parts.find((part) => part.functionResponse !== undefined)?.functionResponse as Json | undefined;
      return told?.name === CALL.name ? told.response : null;
    }
    case "openai-responses":
    case "xai-responses": {
      const told = list(body.input).find((item) => item.type === "function_call_output");
      return told?.call_id === "call_1" ? told.output : null;
    }
    case "gateway": {
      const parts = list(body.prompt).flatMap((message) => (message.role === "tool" ? list(message.content) : []));
      const told = parts.find((part) => part.type === "tool-result");
      return told?.toolCallId === "call_1" ? told.output : null;
    }
  }
}

/** The temperature and the output limit as the request states them, wherever the format keeps them. */
function samplingSent(format: Format, body: Json): { temperature: unknown; cap: unknown } {
  switch (format) {
    case "chat":
      // Cerebras's client renames the limit; every other host takes `max_tokens`.
      return { temperature: body.temperature, cap: body.max_tokens ?? body.max_completion_tokens };
    case "anthropic":
      return { temperature: body.temperature, cap: body.max_tokens };
    case "google": {
      const config = (body.generationConfig ?? {}) as Json;
      return { temperature: config.temperature, cap: config.maxOutputTokens };
    }
    case "openai-responses":
    case "xai-responses":
      return { temperature: body.temperature, cap: body.max_output_tokens };
    case "gateway":
      return { temperature: body.temperature, cap: body.maxOutputTokens };
  }
}

/** Two steps through `modelFor`, answered from this file. */
async function converse(id: CatalogueId, options: { model?: string; temperature?: number; workspaceId?: string | null } = {}) {
  const wire = WIRE[id];
  const model = options.model ?? wire.model ?? CATALOGUE[id].defaultModel;
  const key = standInKey(id);
  const config = { llm: { temperature: options.temperature ?? 0.7, model } };
  answer = (n) => json(n === 0 ? ANSWERS[wire.format].call(model) : ANSWERS[wire.format].text(model));

  const built: LanguageModel = await modelFor(id, { apiKey: key, modelId: model, workspaceId: options.workspaceId });
  const result = await generateText({
    model: built,
    system: "You are a trading agent.",
    prompt: "What is SOL worth?",
    tools,
    stopWhen: stepCountIs(2),
    maxRetries: 0,
    ...callOptionsFor(id, config),
  });
  return { key, model, config, wire, result };
}

describe.each(CATALOGUE_IDS)("%s on the wire", (id) => {
  const row = CATALOGUE[id];

  it("sends every request to its own origin, at the address its API documents", async () => {
    const { model, wire } = await converse(id);
    expect(sent).toHaveLength(2);
    for (const request of sent) {
      expect(request.url.origin).toBe(row.origin);
      expect(request.url.pathname).toBe(wire.path(model));
      expect(request.url.search).toBe("");
      expect(request.method).toBe("POST");
      // A redirect would take `x-api-key` and `x-goog-api-key` with it to wherever it led.
      expect(request.redirect).toBe("error");
    }
  });

  it("carries the key in its one header and nowhere else", async () => {
    const { key, wire } = await converse(id);
    for (const request of sent) {
      expect(request.headers[wire.header]).toBe(wire.header === "authorization" ? `Bearer ${key}` : key);
      for (const [name, value] of Object.entries(request.headers)) {
        if (name !== wire.header) expect(value, name).not.toContain(key);
      }
      expect(request.url.href).not.toContain(key);
      expect(request.body).not.toContain(key);
      // Nor a key of the operator's, which a client reaches for when it is handed none.
      expect(JSON.stringify([request.headers, request.url.href, request.body])).not.toContain("operator-");
    }
  });

  it("reads the tool call out of the first answer and sends its result back in the second request", async () => {
    const { wire, result } = await converse(id);
    const [first, second] = result.steps;
    expect(first?.toolCalls.map((call) => ({ name: call.toolName, input: call.input }))).toEqual([{ name: CALL.name, input: CALL.args }]);
    expect(first?.toolResults.map((told) => told.output)).toEqual([{ symbol: "SOL", usd: PRICE }]);
    expect(second?.text).toBe(SAID);
    expect(result.text).toBe(SAID);

    // The first request had no result to carry; the second carries this one.
    expect(toolResultSent(wire.format, sent[0].json)).toBeNull();
    expect(JSON.stringify(toolResultSent(wire.format, sent[1].json))).toContain(String(PRICE));
    // And the tool was offered by name both times.
    for (const request of sent) expect(request.body).toContain(`"${CALL.name}"`);
  });

  it("states the temperature and the output limit the registry gives it", async () => {
    const { model, wire } = await converse(id, { temperature: 0.7 });
    const expected = requestTemperature(id, 0.7, model);
    for (const request of sent) {
      const said = samplingSent(wire.format, request.json);
      expect(said.temperature).toBe(expected);
      // Anthropic's API requires a limit, so its client always states the model's own.
      if (id !== "anthropic") expect(said.cap).toBe(row.maxOutputTokens);
    }
  });
});

describe("what keeps a key on its own provider's host", () => {
  it("has a builder for every row of the catalogue, and its base URL sits on the row's origin", async () => {
    for (const id of CATALOGUE_IDS) {
      const row = CATALOGUE[id];
      expect(new URL(row.baseUrl).origin, id).toBe(row.origin);
      expect(row.origin.startsWith("https://"), id).toBe(true);
      const model = await modelFor(id, { apiKey: standInKey(id), modelId: row.defaultModel });
      expect(typeof model === "string" ? model : model.modelId, id).toBe(row.defaultModel);
    }
    // Building a model sends nothing.
    expect(sent).toHaveLength(0);
  });

  it("refuses a provider that has no row, with the sentence for it, and builds nothing in its place", async () => {
    for (const id of ["perplexity", "cohere", "", "constructor", "__proto__", "toString", "Anthropic", "openai "]) {
      await expect(modelFor(id as CatalogueId, { apiKey: nanoid(40), modelId: "gpt-5" }), id).rejects.toThrow(PROVIDER_UNSUPPORTED);
    }
    expect(sent).toHaveLength(0);
  });

  it("refuses an empty key for every provider, before any client is built", async () => {
    for (const id of CATALOGUE_IDS) {
      for (const apiKey of ["", "   ", "\n", undefined as unknown as string, null as unknown as string]) {
        await expect(modelFor(id, { apiKey, modelId: CATALOGUE[id].defaultModel }), id).rejects.toThrow(EMPTY_KEY);
      }
    }
    // The gateway's client, handed no key, would use the deployment's own Vercel
    // identity and the run would be billed to Tocker. It was never built.
    expect(gatewayBuilt).toHaveLength(0);
    expect(sent).toHaveLength(0);
  });

  it("builds the gateway's client with the owner's key and the registry's base URL", async () => {
    const { key } = await converse("vercel");
    expect(gatewayBuilt).toEqual([{ apiKey: key, baseURL: CATALOGUE.vercel.baseUrl }]);
    // The key it authenticated with was that key, not the deployment's identity.
    for (const request of sent) expect(request.headers["ai-gateway-auth-method"]).toBe("api-key");
  });

  /**
   * On Vercel the gateway's client would add the deployment's ids to the request. It is
   * the owner's key and the owner's account; Tocker's deployment is not sent along.
   */
  it("tells the gateway nothing about the deployment the run is on", async () => {
    const names = ["VERCEL_DEPLOYMENT_ID", "VERCEL_ENV", "VERCEL_REGION", "VERCEL_PROJECT_ID"] as const;
    const was = names.map((name) => process.env[name]);
    const ids = names.map((name) => {
      process.env[name] = `tocker-${nanoid(10)}`;
      return process.env[name] as string;
    });
    try {
      const { key } = await converse("vercel");
      expect(sent).toHaveLength(2);
      for (const request of sent) {
        expect(Object.keys(request.headers).filter((name) => name.startsWith("ai-o11y-"))).toEqual([]);
        for (const id of ids) expect(JSON.stringify([request.headers, request.body, request.url.href])).not.toContain(id);
        // What the gateway needs is still there.
        expect(request.headers.authorization).toBe(`Bearer ${key}`);
        expect(request.headers["ai-language-model-id"]).toBe(CATALOGUE.vercel.defaultModel);
      }
    } finally {
      names.forEach((name, at) => {
        if (was[at] === undefined) delete process.env[name];
        else process.env[name] = was[at];
      });
    }
  });

  it("refuses a model id that could not be one, for every provider", async () => {
    for (const id of CATALOGUE_IDS) {
      for (const modelId of ["", "../../upload/v1beta/files", "gemini-3.8-flash/../../x", "a b", "x?key=1", "x#y", "/models/x", "x@evil.example", "m".repeat(101)]) {
        await expect(modelFor(id, { apiKey: standInKey(id), modelId }), `${id} ${modelId}`).rejects.toThrow(NOT_A_MODEL);
      }
    }
    expect(sent).toHaveLength(0);
  });

  /** Google's API takes the model id in the path. Whatever id passes, the request stays under /v1beta on Google's host. */
  it("keeps a Gemini request on Google's host and under its API path whatever the model id", async () => {
    for (const model of ["gemini-3.8-flash", "tunedModels/my-model", "a//b", "x:y", "models/gemini-3.8-flash"]) {
      sent.length = 0;
      await converse("google", { model });
      expect(sent).toHaveLength(2);
      for (const request of sent) {
        expect(request.url.origin).toBe(CATALOGUE.google.origin);
        expect(request.url.pathname.startsWith("/v1beta/")).toBe(true);
        expect(request.url.pathname.endsWith(":generateContent")).toBe(true);
      }
    }
  });

  /**
   * The base URL is a constant, so the only way to see the guard act is to move it. With
   * the registry's row pointed somewhere else, the request is refused where it is sent.
   */
  it("does not send a request that is addressed off the provider's origin", async () => {
    vi.resetModules();
    vi.doMock("./providers", async () => {
      const real = await vi.importActual<typeof import("./providers")>("./providers");
      return { ...real, providerRow: (id: CatalogueId) => ({ ...real.providerRow(id), baseUrl: "https://elsewhere.invalid/v1" }) };
    });
    try {
      const moved = await import("./providers-server");
      for (const id of ["anthropic", "google", "groq", "venice", "vercel"] as const) {
        const model = await moved.modelFor(id, { apiKey: standInKey(id), modelId: CATALOGUE[id].defaultModel });
        await expect(generateText({ model, prompt: "hello", maxRetries: 0 }), id).rejects.toThrow(/was not sent/);
      }
      expect(sent).toHaveLength(0);
    } finally {
      vi.doUnmock("./providers");
      vi.resetModules();
    }
  });
});

describe("what a run sends with each step", () => {
  const config = (temperature: number, model: string) => ({ llm: { temperature, model } });

  it("sends Anthropic's cache control to Anthropic and to nobody else", () => {
    for (const id of CATALOGUE_IDS) {
      const options = callOptionsFor(id, config(0.4, CATALOGUE[id].defaultModel));
      if (id === "anthropic") expect(options.providerOptions).toEqual({ anthropic: { cacheControl: { type: "ephemeral" } } });
      else expect(options.providerOptions?.anthropic, id).toBeUndefined();
      // Three providers have options at all.
      if (id !== "anthropic" && id !== "venice" && id !== "xai") expect("providerOptions" in options, id).toBe(false);
    }
  });

  it("tells xAI not to keep what a step said, and tells nobody else", async () => {
    expect(callOptionsFor("xai", config(0.4, CATALOGUE.xai.defaultModel)).providerOptions).toEqual({ xai: { store: false } });
    for (const id of CATALOGUE_IDS) {
      if (id !== "xai") expect(callOptionsFor(id, config(0.4, CATALOGUE[id].defaultModel)).providerOptions?.xai, id).toBeUndefined();
    }
    // The installed client reads it: both steps say so in the request itself, and ask
    // for the reasoning back in a form the next request can carry.
    await converse("xai");
    expect(sent).toHaveLength(2);
    for (const request of sent) {
      expect(request.json.store).toBe(false);
      expect(request.json.include).toContain("reasoning.encrypted_content");
      expect("previous_response_id" in request.json).toBe(false);
    }
    // OpenAI's Responses API has a `store` of its own, and is not sent this one.
    sent.length = 0;
    await converse("openai");
    for (const request of sent) expect(request.json.store).not.toBe(false);
  });

  it("tells Venice to leave its own system prompt out", async () => {
    expect(callOptionsFor("venice", config(0.4, CATALOGUE.venice.defaultModel)).providerOptions).toEqual({
      venice: { venice_parameters: { include_venice_system_prompt: false } },
    });
    await converse("venice");
    for (const request of sent) expect(request.json.venice_parameters).toEqual({ include_venice_system_prompt: false });
    // And only Venice is sent it.
    sent.length = 0;
    await converse("nebius");
    for (const request of sent) expect("venice_parameters" in request.json).toBe(false);
  });

  it("sends no temperature where the registry says to send none", async () => {
    for (const id of ["google", "deepseek", "moonshot", "vercel"] as const) {
      expect("temperature" in callOptionsFor(id, config(0.4, CATALOGUE[id].defaultModel)), id).toBe(false);
      sent.length = 0;
      const { wire } = await converse(id, { temperature: 0.4 });
      for (const request of sent) expect(samplingSent(wire.format, request.json).temperature, id).toBeUndefined();
    }
  });

  it("caps the temperature for the two providers that refuse a higher one", async () => {
    for (const [id, max] of [
      ["mistral", 1.5],
      ["zai", 1],
    ] as const) {
      expect(callOptionsFor(id, config(2, CATALOGUE[id].defaultModel)).temperature, id).toBe(max);
      expect(callOptionsFor(id, config(0.3, CATALOGUE[id].defaultModel)).temperature, id).toBe(0.3);
      sent.length = 0;
      const { wire } = await converse(id, { temperature: 2 });
      for (const request of sent) expect(samplingSent(wire.format, request.json).temperature, id).toBe(max);
    }
  });

  it("leaves Kimi's sampling alone on the hosts that serve it", async () => {
    expect("temperature" in callOptionsFor("together", config(0.4, "moonshotai/Kimi-K3"))).toBe(false);
    const { wire } = await converse("together", { model: "moonshotai/Kimi-K3", temperature: 0.4 });
    for (const request of sent) expect(samplingSent(wire.format, request.json).temperature).toBeUndefined();
    // The same host still sends it for a model that takes one.
    expect(callOptionsFor("together", config(0.4, "zai-org/GLM-5.3")).temperature).toBe(0.4);
  });

  it("states an output limit for Cerebras and Novita and for no one else", async () => {
    for (const id of CATALOGUE_IDS) {
      const options = callOptionsFor(id, config(0.4, CATALOGUE[id].defaultModel));
      if (id === "cerebras" || id === "novita") expect(options.maxOutputTokens, id).toBe(8192);
      else expect("maxOutputTokens" in options, id).toBe(false);
    }
    // Cerebras's limiter reads `max_completion_tokens`; its client renames the limit.
    await converse("cerebras");
    for (const request of sent) {
      expect(request.json.max_completion_tokens).toBe(8192);
      expect("max_tokens" in request.json).toBe(false);
    }
  });
});

/**
 * Nothing changes for the three providers the app already had. Their models used to be
 * built in `run.ts` with only a key, and every step was sent the same two options. Both
 * are written out here as they stand on main, and the requests they produce are compared
 * with the ones the registry's builders produce, byte for byte.
 */
describe("the three providers that were here before", () => {
  const THREE = ["anthropic", "openai", "openrouter"] as const;

  /** `resolveModel`'s switch on main. */
  const builtOnMain = {
    anthropic: async (apiKey: string, modelId: string, workspaceId: string | null) => {
      const { createAnthropic } = await import("@ai-sdk/anthropic");
      const headers = workspaceId ? { "anthropic-workspace-id": workspaceId } : undefined;
      return createAnthropic({ apiKey, ...(headers ? { headers } : {}) })(modelId);
    },
    openai: async (apiKey: string, modelId: string) => {
      const { createOpenAI } = await import("@ai-sdk/openai");
      return createOpenAI({ apiKey })(modelId);
    },
    openrouter: async (apiKey: string, modelId: string) => {
      const { createOpenRouter } = await import("@openrouter/ai-sdk-provider");
      return createOpenRouter({ apiKey })(modelId);
    },
  } as const;

  /** What `generateText` was given on main beside the prompt and the tools, for every provider. */
  const optionsOnMain = (temperature: number) => ({ temperature, providerOptions: { anthropic: { cacheControl: { type: "ephemeral" as const } } } });

  it("is still the three the registry has switched on first, in that order", () => {
    expect(PROVIDER_IDS.slice(0, 3)).toEqual(THREE);
  });

  it("gives each step the options it had, less the Anthropic one for the two that are not Anthropic", () => {
    for (const temperature of [0, 0.4, 1, 2]) {
      const config = { llm: { temperature, model: "any-model" } };
      expect(callOptionsFor("anthropic", config)).toStrictEqual(optionsOnMain(temperature));
      expect(callOptionsFor("openai", config)).toStrictEqual({ temperature });
      expect(callOptionsFor("openrouter", config)).toStrictEqual({ temperature });
    }
  });

  async function twoSteps(id: (typeof THREE)[number], model: LanguageModel, modelId: string, options: object): Promise<Sent[]> {
    sent.length = 0;
    const format = WIRE[id].format;
    answer = (n) => json(n === 0 ? ANSWERS[format].call(modelId) : ANSWERS[format].text(modelId));
    await generateText({ model, system: "You are a trading agent.", prompt: "What is SOL worth?", tools, stopWhen: stepCountIs(2), maxRetries: 0, ...options });
    return sent.map((request) => ({ ...request }));
  }

  it.each(THREE)("%s: puts the same requests on the wire as main does", async (id) => {
    for (const modelId of [CATALOGUE[id].defaultModel, WIRE[id].model ?? CATALOGUE[id].models[1].id]) {
      for (const workspaceId of id === "anthropic" ? [null, `wrkspc_${nanoid(12).replace(/[^A-Za-z0-9]/g, "x")}`] : [null]) {
        const key = standInKey(id);
        const config = { llm: { temperature: 0.4, model: modelId } };

        // Main, on a deployment that sets no base URL of its own.
        const moved = { openai: process.env.OPENAI_BASE_URL, anthropic: process.env.ANTHROPIC_BASE_URL };
        delete process.env.OPENAI_BASE_URL;
        delete process.env.ANTHROPIC_BASE_URL;
        const before = await twoSteps(id, await builtOnMain[id](key, modelId, workspaceId), modelId, optionsOnMain(0.4));
        process.env.OPENAI_BASE_URL = moved.openai;
        process.env.ANTHROPIC_BASE_URL = moved.anthropic;

        // Now, with those variables pointing somewhere else: they no longer matter.
        const after = await twoSteps(id, await modelFor(id, { apiKey: key, modelId, workspaceId }), modelId, callOptionsFor(id, config));

        expect(after).toHaveLength(2);
        expect(after.map((request) => request.url.href)).toEqual(before.map((request) => request.url.href));
        expect(after.map((request) => request.method)).toEqual(before.map((request) => request.method));
        expect(after.map((request) => request.headers)).toEqual(before.map((request) => request.headers));
        // The whole body: model, messages, tools, temperature, cache control, everything.
        expect(after.map((request) => request.body)).toEqual(before.map((request) => request.body));
        // The one difference, and it is not on the wire: a redirect is no longer followed.
        expect(before.map((request) => request.redirect)).toEqual([undefined, undefined]);
        expect(after.map((request) => request.redirect)).toEqual(["error", "error"]);

        if (workspaceId) for (const request of after) expect(request.headers["anthropic-workspace-id"]).toBe(workspaceId);
        else for (const request of after) expect("anthropic-workspace-id" in request.headers).toBe(false);
      }
    }
  });

  it("still asks Anthropic to cache the prompt, and asks nobody else", async () => {
    await converse("anthropic", { model: CATALOGUE.anthropic.defaultModel });
    for (const request of sent) expect(request.json.cache_control).toEqual({ type: "ephemeral" });
    for (const id of CATALOGUE_IDS) {
      if (id === "anthropic") continue;
      sent.length = 0;
      await converse(id);
      for (const request of sent) expect(request.body, id).not.toContain("ephemeral");
    }
  });

  /** On main a base URL in the environment moved an OpenAI or Anthropic key to that address. */
  it("is not moved by a base URL in the environment", async () => {
    expect(process.env.OPENAI_BASE_URL).toContain("elsewhere.invalid");
    expect(process.env.ANTHROPIC_BASE_URL).toContain("elsewhere.invalid");
    for (const id of THREE) {
      sent.length = 0;
      await converse(id);
      for (const request of sent) expect(request.url.origin).toBe(CATALOGUE[id].origin);
    }
  });
});

/**
 * A second step only works if the first step's reasoning goes back with it. Each of
 * these providers refuses the request otherwise, and each client does it differently.
 */
describe("what a thinking model needs back on the second step", () => {
  const withMessage = (extra: Json) => (model: string) => {
    const body = ANSWERS.chat.call(model) as { choices: Array<{ message: Json }> };
    Object.assign(body.choices[0].message, extra);
    return body as unknown as Json;
  };
  const assistantTurn = (body: Json) => list(body.messages).find((message) => message.role === "assistant");

  async function chatWith(id: CatalogueId, model: string, first: (model: string) => Json): Promise<void> {
    answer = (n) => json(n === 0 ? first(model) : ANSWERS.chat.text(model));
    await generateText({
      model: await modelFor(id, { apiKey: standInKey(id), modelId: model }),
      prompt: "What is SOL worth?",
      tools,
      stopWhen: stepCountIs(2),
      maxRetries: 0,
      ...callOptionsFor(id, { llm: { temperature: 0.4, model } }),
    });
  }

  it("DeepSeek: sends the reasoning back, and an empty one for a turn that had none", async () => {
    // The current model's id. The client version this app pins is the first that knows it.
    await chatWith("deepseek", "deepseek-flash", withMessage({ reasoning_content: "Look the price up first." }));
    expect(assistantTurn(sent[1].json)?.reasoning_content).toBe("Look the price up first.");

    sent.length = 0;
    await chatWith("deepseek", "deepseek-flash", withMessage({}));
    // DeepSeek answers 400 when the field is missing from a turn in a request with tools.
    expect(assistantTurn(sent[1].json)?.reasoning_content).toBe("");
  });

  it("Kimi, on Moonshot and on Together: sends the reasoning back", async () => {
    for (const [id, model] of [
      ["moonshot", "kimi-k3"],
      ["together", "moonshotai/Kimi-K3"],
    ] as const) {
      sent.length = 0;
      await chatWith(id, model, withMessage({ reasoning_content: "Look the price up first." }));
      expect(assistantTurn(sent[1].json)?.reasoning_content, id).toBe("Look the price up first.");
    }
  });

  it("Gemini: sends the thought signature back on the call it came with", async () => {
    await converse("google");
    const parts = list(sent[1].json.contents).flatMap((turn) => (turn.role === "model" ? list(turn.parts) : []));
    const called = parts.find((part) => part.functionCall !== undefined);
    // The client adds an id of its own to the call it replays.
    expect(called?.functionCall).toMatchObject({ name: CALL.name, args: CALL.args });
    expect(called?.thoughtSignature).toBe("signature-of-step-one");
  });

  it("Grok: sends its reasoning item back with the call", async () => {
    const model = CATALOGUE.xai.defaultModel;
    answer = (n) => {
      if (n > 0) return json(ANSWERS["xai-responses"].text(model));
      const body = ANSWERS["xai-responses"].call(model) as { output: Json[] };
      body.output.unshift({ type: "reasoning", id: "rs_1", summary: [], status: "completed", encrypted_content: "sealed-reasoning" });
      return json(body);
    };
    await generateText({
      model: await modelFor("xai", { apiKey: standInKey("xai"), modelId: model }),
      prompt: "What is SOL worth?",
      tools,
      stopWhen: stepCountIs(2),
      maxRetries: 0,
      ...callOptionsFor("xai", { llm: { temperature: 0.4, model } }),
    });
    const input = list(sent[1].json.input);
    expect(input.some((item) => item.type === "function_call" && item.call_id === "call_1")).toBe(true);
    expect(JSON.stringify(input.find((item) => item.type === "reasoning"))).toContain("sealed-reasoning");
  });
});

describe("keyScrubber", () => {
  /**
   * Fixed, so a failure reads the same twice, and with no stretch that repeats within a
   * key's length. Not key-shaped without a prefix in front of it.
   */
  const LETTERS = ["Ab1cD2eF3gH4iJ5kL6mN7oP8qR9sT0uV", "wX3yZ4aB5cD6eF7gH8iJ9kL0mN1oP2qR", "sT3uV4wX5yZ6Ba7Dc8Fe9Hg0Ji1Lk2Nm", "Po3Rq4Ts5Vu6Xw7Zy8"].join("");
  const body = (length: number, from = 0) => LETTERS.repeat(4).slice(from, from + length);
  const keyOf = (id: CatalogueId) => `${CATALOGUE[id].keyPrefixes[0] ?? ""}${body(48)}`;

  it("takes the exact key out of a sentence, however often it is there, and keeps the sentence", () => {
    for (const id of CATALOGUE_IDS) {
      const key = keyOf(id);
      const scrub = keyScrubber(key);
      expect(scrub(`The credential ${key} was not accepted (${key}).`), id).toBe(`The credential ${REDACTED} was not accepted (${REDACTED}).`);
      expect(scrub(key), id).toBe(REDACTED);
    }
  });

  /** Why it exists: a key with no prefix has no shape, and pattern redaction walks past it. */
  it("removes what redactSecrets cannot recognise", () => {
    const shapeless = CATALOGUE_IDS.filter((id) => CATALOGUE[id].keyPrefixes.length === 0);
    expect(shapeless.length).toBeGreaterThan(5);
    for (const id of shapeless) {
      const key = keyOf(id);
      const said = `The credential ${key} was not accepted.`;
      expect(redactSecrets(said, {}), id).toContain(key);
      expect(redactSecrets(keyScrubber(key)(said), {}), id).toBe(`The credential ${REDACTED} was not accepted.`);
    }
  });

  it("returns text that has no part of the key exactly as it came", () => {
    const scrub = keyScrubber(keyOf("mistral"));
    for (const said of [
      "",
      "Invalid API Key",
      "Rate limit reached for model `openai/gpt-oss-120b`. Please try again in 7.66s.",
      "This request requires the anthropic-workspace-id header.",
      "Incorrect API key provided. You can find your API key at https://platform.openai.com/account/api-keys.",
      `Authentication Fails, Your api key: ****${body(4, 44)} is invalid`,
    ]) {
      expect(scrub(said)).toBe(said);
    }
    // A provider's own prefix, written in a sentence, is not this key.
    expect(keyScrubber(keyOf("anthropic"))("Anthropic keys start with sk-ant-api03 and are made in the Console.")).toBe(
      "Anthropic keys start with sk-ant-api03 and are made in the Console.",
    );
    expect(keyScrubber(keyOf("openai"))("A project key starts with sk-proj- and a service key with sk-svcacct-.")).toBe(
      "A project key starts with sk-proj- and a service key with sk-svcacct-.",
    );
  });

  it("removes the key as a URL or a JSON string would write it", () => {
    const key = `${body(20)}+/${body(20, 20)}=="${body(6, 30)}`;
    const scrub = keyScrubber(key);
    expect(scrub(`GET https://host.example/v1/models?k=${encodeURIComponent(key)} failed`)).toBe(`GET https://host.example/v1/models?k=${REDACTED} failed`);
    expect(scrub(`{"sent":${JSON.stringify(key)}}`)).toBe(`{"sent":"${REDACTED}"}`);
  });

  it("removes a half-masked echo of the key: its start or its end, with the run it is part of", () => {
    const key = keyOf("together");
    const scrub = keyScrubber(key);
    const head = key.slice(0, 10);
    const tail = key.slice(-8);
    for (const echo of [`${head}${"*".repeat(30)}${tail}`, `${head}${"*".repeat(30)}`, `${"*".repeat(30)}${tail}`, `${head}...${tail}`, key.slice(0, 30), key.slice(-30)]) {
      const shown = scrub(`Incorrect API key provided: ${echo}. Check it.`);
      expect(shown, echo).not.toContain(head);
      expect(shown, echo).not.toContain(tail);
      expect(shown.startsWith(`Incorrect API key provided: ${REDACTED}`), echo).toBe(true);
      expect(shown.endsWith(" Check it."), echo).toBe(true);
    }
    // The last four are on the owner's own settings page. Four characters are left alone.
    expect(scrub(`key ending ${key.slice(-4)}`)).toBe(`key ending ${key.slice(-4)}`);
  });

  /** A key whose start comes round again inside it: the middle must not be what is left behind. */
  it("removes the whole run even when the key repeats itself", () => {
    const key = `${body(16)}${body(16)}${body(16, 40)}`;
    const shown = keyScrubber(key)(`Rejected: ${key.slice(-34)}. Check it.`);
    expect(shown).toBe(`Rejected: ${REDACTED}. Check it.`);
  });

  /** For the three providers the app already had, the stored text is what it was. */
  it("leaves the stored sentence for an OpenAI, Anthropic or OpenRouter refusal exactly as redactSecrets alone made it", () => {
    for (const id of ["anthropic", "openai", "openrouter"] as const) {
      const key = `${CATALOGUE[id].keyPrefixes[0]}${body(90)}`;
      for (const echo of [
        key,
        `${key.slice(0, 12)}${"*".repeat(40)}${key.slice(-4)}`,
        `${key.slice(0, 20)}${"*".repeat(40)}${key.slice(-4)}`,
        `${key.slice(0, 8)}...${key.slice(-4)}`,
        // A key with more written straight after it: the pattern takes the whole run, and so does this.
        `${key}-and-more`,
        `${key}***`,
      ]) {
        const said = `Incorrect API key provided: ${echo}. You can find your API key at the dashboard.`;
        expect(redactSecrets(keyScrubber(key)(said), {}), `${id} ${echo.length}`).toBe(redactSecrets(said, {}));
      }
    }
    // An old-style OpenAI key, a bare `sk-` with nothing after it that names OpenAI.
    const legacy = ["sk", body(48)].join("-");
    const said = `Incorrect API key provided: ${legacy.slice(0, 8)}${"*".repeat(40)}${legacy.slice(-4)}. You can find your API key at the dashboard.`;
    expect(redactSecrets(keyScrubber(legacy)(said), {})).toBe(redactSecrets(said, {}));
  });

  /** Too short to have two ends worth looking for; the key itself is still found. */
  it("removes a short key by its exact value", () => {
    const key = body(12);
    expect(keyScrubber(key)(`sent ${key}, refused`)).toBe(`sent ${REDACTED}, refused`);
    expect(keyScrubber(key)(`sent ${key.slice(0, 8)}, refused`)).toBe(`sent ${key.slice(0, 8)}, refused`);
  });

  it("does nothing when there is no key", () => {
    expect(keyScrubber("")).toBe(noScrub);
    expect(noScrub("anything at all")).toBe("anything at all");
    expect(keyScrubber(undefined as unknown as string)("anything")).toBe("anything");
  });
});

describe("sentenceInBody: a request the provider could not validate", () => {
  it("reads the first two entries of a list, each with the field it is about", () => {
    const detail = [
      { type: "missing", loc: ["body", "model"], msg: "Field required" },
      { type: "less_than_equal", loc: ["body", "messages", 0, "content"], msg: "Input should be\n a valid string" },
      { type: "extra", loc: ["body", "third"], msg: "Never shown" },
    ];
    expect(sentenceInBody(JSON.stringify({ detail }))).toBe("Field required (model); Input should be a valid string (messages.0.content)");
    // No path, or one too long to be worth a line: the message alone.
    expect(sentenceInBody(JSON.stringify({ detail: [{ msg: "Bad request" }] }))).toBe("Bad request");
    expect(sentenceInBody(JSON.stringify({ detail: [{ msg: "Bad", loc: ["body", "x".repeat(80)] }] }))).toBe("Bad");
    // Entries with nothing to read are passed over, not counted.
    expect(sentenceInBody(JSON.stringify({ detail: [{ loc: ["body"] }, { msg: "Too long", loc: ["query", "limit"] }] }))).toBe("Too long (query.limit)");
  });
});

describe("sentenceInBody: the reason in a refusal's body", () => {
  it("finds the sentence wherever a provider puts it", () => {
    expect(sentenceInBody(JSON.stringify({ error: { message: "Incorrect API key provided.", type: "invalid_request_error" } }))).toBe("Incorrect API key provided.");
    expect(sentenceInBody(JSON.stringify({ code: "Some requested entity was not found", error: "Incorrect API key." }))).toBe("Incorrect API key.");
    expect(sentenceInBody(JSON.stringify({ message: "Wrong API Key", code: "wrong_api_key" }))).toBe("Wrong API Key");
    expect(sentenceInBody(JSON.stringify({ detail: "Authentication failed" }))).toBe("Authentication failed");
  });

  it("puts a sentence that runs over several lines on one", () => {
    expect(sentenceInBody(JSON.stringify({ message: "  Invalid key.\n\n  Check   your account. " }))).toBe("Invalid key. Check your account.");
  });

  it("reads nothing out of a body that is not a JSON object with a sentence in it", () => {
    for (const body of [
      "<html><body><h1>502 Bad Gateway</h1></body></html>",
      "Unauthorized",
      "",
      "   ",
      "[]",
      '"a string"',
      "null",
      JSON.stringify({ detail: [{ loc: ["body", "model"] }, "field required", null] }),
      JSON.stringify({ detail: [] }),
      JSON.stringify({ error: { code: 401 } }),
      undefined,
      401,
    ]) {
      expect(sentenceInBody(body), String(body)).toBe("");
    }
  });
});
