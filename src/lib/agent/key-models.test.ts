import { afterEach, describe, expect, it, vi } from "vitest";
import { listModelsForKey, parseAnthropicModels, parseOpenAiModels } from "./key-models";

vi.mock("server-only", () => ({}));

const KEY = "sk-test-0000000000000000";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("parseAnthropicModels", () => {
  it("keeps the provider's ids and names in its own order, with the price we know", () => {
    const { models, nextAfterId } = parseAnthropicModels({
      data: [
        { type: "model", id: "claude-sonnet-5-5", display_name: "Claude Sonnet 5.5" },
        { type: "model", id: "claude-haiku-4-5-20251001", display_name: "Claude Haiku 4.5" },
        // Released after the built-in list was written: listed all the same, without a price.
        { type: "model", id: "claude-sonnet-6", display_name: "Claude Sonnet 6" },
      ],
      has_more: false,
      last_id: "claude-sonnet-6",
    });
    expect(models).toEqual([
      { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5", inputPerMTok: 2, outputPerMTok: 10 },
      { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5", inputPerMTok: 1, outputPerMTok: 5 },
      { id: "claude-sonnet-6", label: "Claude Sonnet 6" },
    ]);
    expect(nextAfterId).toBeNull();
  });

  it("says where the next page starts when there is one", () => {
    expect(parseAnthropicModels({ data: [], has_more: true, last_id: "claude-opus-4-6" }).nextAfterId).toBe("claude-opus-4-6");
    expect(parseAnthropicModels({ data: [], has_more: true }).nextAfterId).toBeNull();
  });

  it("drops anything that is not a model with a usable id", () => {
    for (const body of [null, "x", {}, { data: "x" }]) expect(parseAnthropicModels(body).models).toEqual([]);
    const { models } = parseAnthropicModels({
      data: [null, 4, {}, { id: 7 }, { id: "has spaces" }, { id: "<b>" }, { id: "claude-opus-5-5", display_name: "  " }],
    });
    expect(models).toEqual([{ id: "claude-opus-5-5", label: "Claude Opus 5.5", inputPerMTok: 4, outputPerMTok: 20 }]);
  });
});

describe("parseOpenAiModels", () => {
  it("keeps the chat models, newest first, and names the ones we know", () => {
    const models = parseOpenAiModels({
      data: [
        { id: "gpt-5", created: 100 },
        { id: "gpt-6.1-sol", created: 300 },
        { id: "o3", created: 200 },
        { id: "ft:gpt-5-mini:acme::abc123", created: 250 },
        { id: "gpt-7-preview", created: 400 },
      ],
    });
    expect(models.map((m) => m.id)).toEqual(["gpt-7-preview", "gpt-6.1-sol", "ft:gpt-5-mini:acme::abc123", "o3", "gpt-5"]);
    expect(models.find((m) => m.id === "gpt-6.1-sol")).toEqual({ id: "gpt-6.1-sol", label: "GPT-6.1 Sol", inputPerMTok: 2, outputPerMTok: 10 });
    // Not in the built-in list: shown by its id, with no price invented for it.
    expect(models.find((m) => m.id === "gpt-7-preview")).toEqual({ id: "gpt-7-preview", label: "gpt-7-preview" });
  });

  /** OpenAI lists everything the key can call; an agent cannot think on an embedding. */
  it("leaves out what an agent cannot run on", () => {
    const models = parseOpenAiModels({
      data: [
        "text-embedding-3-large",
        "whisper-1",
        "tts-1-hd",
        "gpt-4o-transcribe",
        "dall-e-3",
        "gpt-image-1",
        "sora-2",
        "omni-moderation-latest",
        "gpt-realtime",
        "gpt-audio-mini",
        "gpt-4o-search-preview",
        "gpt-3.5-turbo-instruct",
        "davinci-002",
        "babbage-002",
        "computer-use-preview",
        "gpt-5.4-mini",
      ].map((id, created) => ({ id, created })),
    });
    expect(models.map((m) => m.id)).toEqual(["gpt-5.4-mini"]);
  });

  it("survives a body that is not what it should be", () => {
    for (const body of [null, 3, {}, { data: {} }, { data: [null, { id: 1 }, { id: "bad id" }] }]) {
      expect(parseOpenAiModels(body)).toEqual([]);
    }
  });
});

describe("listModelsForKey", () => {
  type Call = { url: string; headers: Record<string, string> };

  function answer(pages: Array<{ status: number; body?: unknown }>): Call[] {
    const calls: Call[] = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), headers: Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>)) });
      const page = pages[Math.min(calls.length - 1, pages.length - 1)]!;
      return new Response(page.body === undefined ? "" : JSON.stringify(page.body), { status: page.status });
    });
    return calls;
  }

  it("asks Anthropic with the key and the workspace, and nothing else", async () => {
    const calls = answer([{ status: 200, body: { data: [{ id: "claude-sonnet-5-5", display_name: "Claude Sonnet 5.5" }], has_more: false } }]);

    const result = await listModelsForKey("anthropic", KEY, "wrkspc_1");

    expect(result).toEqual({ ok: true, models: [{ id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5", inputPerMTok: 2, outputPerMTok: 10 }] });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://api.anthropic.com/v1/models?limit=1000");
    expect(calls[0]?.headers).toEqual({ "x-api-key": KEY, "anthropic-version": "2023-06-01", "anthropic-workspace-id": "wrkspc_1" });
    // The key is in the request and nowhere in what comes back.
    expect(JSON.stringify(result)).not.toContain(KEY);
  });

  it("follows Anthropic's pages, and stops after a few", async () => {
    const page = (id: string, more: boolean) => ({ status: 200, body: { data: [{ id, display_name: id }], has_more: more, last_id: id } });
    const calls = answer([page("claude-a", true), page("claude-b", true), page("claude-c", true), page("claude-d", true)]);

    const result = await listModelsForKey("anthropic", KEY);

    expect(result.ok && result.models.map((m) => m.id)).toEqual(["claude-a", "claude-b", "claude-c"]);
    expect(calls.map((call) => call.url)).toEqual([
      "https://api.anthropic.com/v1/models?limit=1000",
      "https://api.anthropic.com/v1/models?limit=1000&after_id=claude-a",
      "https://api.anthropic.com/v1/models?limit=1000&after_id=claude-b",
    ]);
    expect(calls[0]?.headers).not.toHaveProperty("anthropic-workspace-id");
  });

  it("asks OpenAI with a bearer key", async () => {
    const calls = answer([{ status: 200, body: { data: [{ id: "gpt-6.1-sol", created: 2 }, { id: "whisper-1", created: 1 }] } }]);

    const result = await listModelsForKey("openai", KEY);

    expect(result.ok && result.models.map((m) => m.id)).toEqual(["gpt-6.1-sol"]);
    expect(calls[0]).toEqual({ url: "https://api.openai.com/v1/models", headers: { authorization: `Bearer ${KEY}` } });
  });

  it("tells a refused key from a provider it could not ask, and never throws", async () => {
    answer([{ status: 401, body: { error: { message: "invalid x-api-key" } } }]);
    expect(await listModelsForKey("anthropic", KEY)).toEqual({ ok: false, reason: "rejected" });

    for (const status of [403, 429, 500, 503]) {
      answer([{ status }]);
      expect(await listModelsForKey("openai", KEY), String(status)).toEqual({ ok: false, reason: "unreachable" });
    }

    // Reachable, but nothing usable in the answer.
    answer([{ status: 200, body: { data: [] } }]);
    expect(await listModelsForKey("anthropic", KEY)).toEqual({ ok: false, reason: "unreachable" });

    vi.stubGlobal("fetch", async () => {
      throw new Error(`network down for ${KEY}`);
    });
    const failed = await listModelsForKey("openai", KEY);
    expect(failed).toEqual({ ok: false, reason: "unreachable" });
    expect(JSON.stringify(failed)).not.toContain(KEY);
  });
});
