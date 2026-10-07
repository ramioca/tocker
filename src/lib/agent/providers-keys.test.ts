/**
 * Where a key goes, what an answer about it means, and what a model list becomes.
 *
 * Nothing here reaches a provider: `fetch` is a stand-in that records the request and
 * answers with a body shaped like the one the provider really sends. The refusals were
 * captured on 2026-10-07 by asking each provider about the key "invalid"; the public
 * lists were read the same day with no key and cut down to a few rows.
 *
 * Every table below is keyed by all nineteen providers, so a row added to the registry
 * does not compile here until it says where its key is checked and how it is refused.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { REDACTED } from "@/lib/security/redact";
import { CATALOGUE, CATALOGUE_IDS, type CatalogueId } from "./providers";
import {
  checkKey,
  getPublicCatalog,
  keyCheckRequest,
  keyVerdict,
  listModels,
  parseModelList,
  probeOutcome,
  providerFetch,
  providerUrl,
  resetPublicCatalogs,
  withoutKey,
} from "./providers-keys";

/**
 * Stand-ins for real keys, put together at run time. Nothing key-shaped is written out
 * in this file: the repository is public and scanned for exactly that.
 */
const body = (length: number) => "Ab1cD2eF3gH4iJ5kL6mN7oP8qR9sT0uV".repeat(8).slice(0, length);
/** A key as this provider issues them: its own prefix when it has one, and no shape at all when it has none. */
const keyOf = (id: CatalogueId) => `${CATALOGUE[id].keyPrefixes[0] ?? ""}${body(48)}`;

interface Call {
  url: string;
  headers: Record<string, string>;
  init: RequestInit;
}

type Reply = { status: number; body?: unknown } | Error;

/** Replaces `fetch`. Answers each request with the next reply, and the last one for ever after. */
function answer(...replies: Reply[]): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init: RequestInit = {}) => {
    calls.push({ url: String(input), headers: { ...(init.headers as Record<string, string>) }, init });
    const reply = replies[Math.min(calls.length - 1, replies.length - 1)]!;
    if (reply instanceof Error) throw reply;
    return new Response(reply.body === undefined ? "" : JSON.stringify(reply.body), { status: reply.status });
  });
  return calls;
}

beforeEach(() => {
  resetPublicCatalogs();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** The origin a provider's key check is allowed to reach: its own, or the Hub for Hugging Face. */
const checkOrigin = (id: CatalogueId) => CATALOGUE[id].keyCheckOrigin ?? CATALOGUE[id].origin;

/** Written out a second time on purpose: this is where each provider's key is sent to be checked. */
const CHECK_URL: Record<CatalogueId, string> = {
  anthropic: "https://api.anthropic.com/v1/models?limit=1",
  openai: "https://api.openai.com/v1/models",
  openrouter: "https://openrouter.ai/api/v1/key",
  google: "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1",
  xai: "https://api.x.ai/v1/language-models",
  deepseek: "https://api.deepseek.com/models",
  mistral: "https://api.mistral.ai/v1/models",
  moonshot: "https://api.moonshot.ai/v1/models",
  zai: "https://api.z.ai/api/paas/v4/models",
  groq: "https://api.groq.com/openai/v1/models",
  cerebras: "https://api.cerebras.ai/v1/models",
  together: "https://api.together.ai/v1/models",
  fireworks: "https://api.fireworks.ai/inference/v1/models",
  deepinfra: "https://api.deepinfra.com/v1/openai/models",
  vercel: "https://ai-gateway.vercel.sh/v1/credits",
  venice: "https://api.venice.ai/api/v1/api_keys/rate_limits",
  nebius: "https://api.tokenfactory.nebius.com/v1/models",
  novita: "https://api.novita.ai/openapi/v1/billing/balance/detail",
  huggingface: "https://huggingface.co/api/whoami-v2",
};

/** What each provider answered to a key it does not know. */
const REFUSAL: Record<CatalogueId, { status: number; body: unknown }> = {
  anthropic: { status: 401, body: { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } } },
  openai: { status: 401, body: { error: { message: "Incorrect API key provided.", type: "invalid_request_error", code: "invalid_api_key" } } },
  openrouter: { status: 401, body: { error: { message: "No auth credentials found", code: 401 } } },
  google: {
    status: 400,
    body: {
      error: {
        code: 400,
        message: "API key not valid. Please pass a valid API key.",
        status: "INVALID_ARGUMENT",
        details: [
          {
            "@type": "type.googleapis.com/google.rpc.ErrorInfo",
            reason: "API_KEY_INVALID",
            domain: "googleapis.com",
            metadata: { service: "generativelanguage.googleapis.com" },
          },
          { "@type": "type.googleapis.com/google.rpc.LocalizedMessage", locale: "en-US", message: "API key not valid. Please pass a valid API key." },
        ],
      },
    },
  },
  xai: { status: 400, body: { code: "invalid-argument", error: "Incorrect API key provided. You can obtain an API key from https://console.x.ai." } },
  deepseek: {
    status: 401,
    body: { error: { message: "Authentication Fails, Your api key: ****alid is invalid", type: "authentication_error", param: null, code: "invalid_request_error" } },
  },
  mistral: { status: 401, body: { detail: "Invalid API Key" } },
  moonshot: { status: 401, body: { error: { message: "Invalid Authentication", type: "invalid_authentication_error" } } },
  zai: { status: 401, body: { error: { code: "401", message: "token expired or incorrect" } } },
  groq: { status: 401, body: { error: { message: "Invalid API Key", type: "invalid_request_error", code: "invalid_api_key" } } },
  cerebras: { status: 401, body: { message: "Wrong API Key", type: "invalid_request_error", param: "api_key", code: "wrong_api_key" } },
  together: { status: 401, body: { error: { message: "Unauthorized" } } },
  fireworks: { status: 401, body: { error: { message: "The API key you provided is invalid.", param: null, code: "UNAUTHORIZED", type: "error" }, request_id: "r1" } },
  deepinfra: { status: 401, body: { detail: "User is not authorized to access this resource" } },
  vercel: { status: 401, body: { error: { message: "Authentication failed. Create an API key and set in AI_GATEWAY_API_KEY environment variable.", type: "authentication_error" } } },
  venice: { status: 401, body: { error: "Authentication failed" } },
  nebius: { status: 401, body: { detail: "Couldn't authenticate. Reason: Unable authenticate" } },
  novita: { status: 401, body: { code: 401, reason: "UNAUTHORIZED", message: "key not found", metadata: {} } },
  huggingface: { status: 401, body: { error: "Invalid username or password." } },
};

describe("the registry and this file agree", () => {
  it("has a key check for every provider, and a list for every provider that is not built-in", () => {
    for (const id of CATALOGUE_IDS) {
      expect(() => keyCheckRequest(id, keyOf(id)), id).not.toThrow();
      const hasList = parseModelList(id, {}) !== null;
      expect(hasList, id).toBe(CATALOGUE[id].modelList !== "built-in");
    }
  });

  it("gives only Hugging Face a second host, and only its own Hub", () => {
    const withOne = CATALOGUE_IDS.filter((id) => CATALOGUE[id].keyCheckOrigin !== undefined);
    expect(withOne).toEqual(["huggingface"]);
    expect(CATALOGUE.huggingface.keyCheckOrigin).toBe("https://huggingface.co");
  });
});

describe("the guarded fetch", () => {
  it("builds every address on the provider's own https origin", () => {
    for (const id of CATALOGUE_IDS) {
      const url = providerUrl(id, "/v1/models?limit=1");
      expect(url.origin, id).toBe(CATALOGUE[id].origin);
      expect(url.protocol).toBe("https:");
      expect(url.pathname + url.search).toBe("/v1/models?limit=1");
    }
  });

  it("refuses a path that names another host, in every way a path can", () => {
    const elsewhere = [
      "https://evil.example/v1/models",
      "http://api.openai.com/v1/models",
      "//evil.example/v1/models",
      "/\\evil.example/v1/models",
      "\\\\evil.example/v1/models",
      "v1/models",
      "@evil.example/v1/models",
      "/v1/models\n",
      " /v1/models",
      "",
    ];
    for (const path of elsewhere) {
      expect(() => providerUrl("openai", path), JSON.stringify(path)).toThrow(/not to OpenAI's own host/);
    }
    // Dots stay on the origin: the address is normalised and still OpenAI's.
    expect(providerUrl("openai", "/v1/../../x").href).toBe("https://api.openai.com/x");
  });

  it("refuses the key-check host for a provider that has none, and an id that has no row", () => {
    for (const id of CATALOGUE_IDS.filter((id) => id !== "huggingface")) {
      expect(() => providerUrl(id, "/api/whoami-v2", "key-check"), id).toThrow();
    }
    expect(providerUrl("huggingface", "/api/whoami-v2", "key-check").href).toBe("https://huggingface.co/api/whoami-v2");
    expect(() => providerUrl("constructor" as CatalogueId, "/v1/models")).toThrow();
    expect(() => providerUrl("cohere" as CatalogueId, "/v1/models")).toThrow();
  });

  it("sends nothing at all when the address is refused", async () => {
    const calls = answer({ status: 200, body: {} });
    await expect(providerFetch("openai", "//evil.example/v1/models", { headers: { authorization: "Bearer x" } })).rejects.toThrow();
    await expect(providerFetch("anthropic", "https://evil.example/", { headers: { "x-api-key": "x" } })).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  it("never follows a redirect, never caches, and gives up after a while", async () => {
    const calls = answer({ status: 200, body: {} });
    await providerFetch("groq", "/openai/v1/models", { headers: { authorization: "Bearer x" } });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://api.groq.com/openai/v1/models");
    expect(calls[0]?.init.redirect).toBe("error");
    expect(calls[0]?.init.cache).toBe("no-store");
    expect(calls[0]?.init.signal).toBeInstanceOf(AbortSignal);
    expect(calls[0]?.init.method ?? "GET").toBe("GET");
  });

  /**
   * `fetch` forwards `x-api-key` and `x-goog-api-key` across a redirect. This stand-in
   * does what `fetch` does: told not to follow one it fails, and otherwise it would have
   * made a second request, to somewhere else, with the key still on it.
   */
  it("treats a provider that redirects as one it could not ask, and makes no second request", async () => {
    const followed: string[] = [];
    const calls: Call[] = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init: RequestInit = {}) => {
      calls.push({ url: String(input), headers: { ...(init.headers as Record<string, string>) }, init });
      if (init.redirect === "error") throw new TypeError("fetch failed: unexpected redirect");
      followed.push("https://elsewhere.example/collect");
      return new Response("{}", { status: 200 });
    });

    for (const id of ["anthropic", "google", "mistral"] as const) {
      expect(await checkKey(id, keyOf(id)), id).toBe("unreachable");
      expect(await listModels(id, keyOf(id)), id).toEqual({ ok: false, reason: "unreachable" });
    }
    expect(calls).toHaveLength(6);
    expect(followed).toEqual([]);
    for (const call of calls) expect(call.init.redirect).toBe("error");
  });

  it("refuses an answer that says it was redirected, should a fetch ever follow one anyway", async () => {
    vi.stubGlobal("fetch", async () => {
      const res = new Response("{}", { status: 200 });
      Object.defineProperty(res, "redirected", { value: true });
      return res;
    });
    await expect(providerFetch("openai", "/v1/models")).rejects.toThrow(/redirected/);
    expect(await checkKey("openai", keyOf("openai"))).toBe("unreachable");
  });
});

describe("checking a key", () => {
  it("asks each provider at its own endpoint, on its own origin, with the key in a header and nowhere else", async () => {
    for (const id of CATALOGUE_IDS) {
      const key = keyOf(id);
      const calls = answer({ status: 200, body: {} });

      expect(await checkKey(id, key), id).toBe("ok");

      expect(calls, id).toHaveLength(1);
      expect(calls[0]?.url, id).toBe(CHECK_URL[id]);
      expect(new URL(calls[0]!.url).origin, id).toBe(checkOrigin(id));
      expect(calls[0]?.url, id).not.toContain(key);
      expect(calls[0]?.init.redirect, id).toBe("error");
      // Exactly one header carries the key.
      const carrying = Object.entries(calls[0]!.headers).filter(([, value]) => value.includes(key));
      expect(carrying.map(([name]) => name), id).toEqual([id === "anthropic" ? "x-api-key" : id === "google" ? "x-goog-api-key" : "authorization"]);
      expect(keyCheckRequest(id, key)).toEqual({ url: calls[0]?.url, headers: calls[0]?.headers });
    }
  });

  it("sends Anthropic, OpenAI and OpenRouter exactly what it always sent", () => {
    const key = body(40);
    expect(keyCheckRequest("anthropic", key)).toEqual({
      url: "https://api.anthropic.com/v1/models?limit=1",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01" },
    });
    expect(keyCheckRequest("anthropic", key, "wrkspc_1")).toEqual({
      url: "https://api.anthropic.com/v1/models?limit=1",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "anthropic-workspace-id": "wrkspc_1" },
    });
    expect(keyCheckRequest("openai", key)).toEqual({ url: "https://api.openai.com/v1/models", headers: { authorization: `Bearer ${key}` } });
    expect(keyCheckRequest("openrouter", key)).toEqual({ url: "https://openrouter.ai/api/v1/key", headers: { authorization: `Bearer ${key}` } });
    // The workspace is Anthropic's alone: nobody else is sent it.
    for (const id of CATALOGUE_IDS.filter((id) => id !== "anthropic")) {
      expect(JSON.stringify(keyCheckRequest(id, key, "wrkspc_1")), id).not.toContain("wrkspc_1");
    }
  });

  it("refuses the key when the provider says it is not a key, in that provider's own words", async () => {
    for (const id of CATALOGUE_IDS) {
      const refusal = REFUSAL[id];
      expect(keyVerdict(id, refusal.status, refusal.body), id).toBe("rejected");
      const calls = answer(refusal);
      expect(await checkKey(id, keyOf(id)), id).toBe("rejected");
      expect(calls, id).toHaveLength(1);
    }
  });

  it("says it could not tell, for every provider, when the answer is not about the key", async () => {
    for (const id of CATALOGUE_IDS) {
      for (const status of [403, 404, 408, 429, 500, 502, 503]) {
        answer({ status, body: { error: { message: "try later" } } });
        expect(await checkKey(id, keyOf(id)), `${id} ${status}`).toBe("unreachable");
      }
      // No body at all, a body that is not JSON, and no answer.
      answer({ status: 503 });
      expect(await checkKey(id, keyOf(id)), id).toBe("unreachable");
      answer(new TypeError("fetch failed"));
      expect(await checkKey(id, keyOf(id)), id).toBe("unreachable");
      answer(new DOMException("The operation was aborted due to timeout", "TimeoutError"));
      expect(await checkKey(id, keyOf(id)), id).toBe("unreachable");
    }
  });

  it("takes a bare 401 as a refusal everywhere but Google, which says it with a 400", () => {
    for (const id of CATALOGUE_IDS) {
      expect(keyVerdict(id, 401, null), id).toBe(id === "google" ? "unreachable" : "rejected");
      expect(keyVerdict(id, 200, null), id).toBe("ok");
      expect(keyVerdict(id, 204, null), id).toBe("ok");
    }
  });

  /** Google: 400 with reason API_KEY_INVALID is the key; its other refusals are not. */
  it("reads Google's reason, not its status", () => {
    expect(keyVerdict("google", 400, REFUSAL.google.body)).toBe("rejected");
    // The same sentence without the details block.
    expect(keyVerdict("google", 400, { error: { code: 400, message: "API key not valid. Please pass a valid API key." } })).toBe("rejected");
    // An expired key carries the same reason.
    expect(
      keyVerdict("google", 400, { error: { code: 400, message: "API key expired. Please renew the API key.", details: [{ reason: "API_KEY_INVALID" }] } }),
    ).toBe("rejected");
    // No key at all, an API that is not switched on, a region Google does not serve.
    expect(keyVerdict("google", 403, { error: { code: 403, status: "PERMISSION_DENIED", message: "Method doesn't allow unregistered callers." } })).toBe("unreachable");
    expect(keyVerdict("google", 400, { error: { code: 400, status: "FAILED_PRECONDITION", message: "User location is not supported for the API use." } })).toBe("unreachable");
    expect(keyVerdict("google", 401, { error: { code: 401, status: "UNAUTHENTICATED", details: [{ reason: "ACCESS_TOKEN_TYPE_UNSUPPORTED" }] } })).toBe("unreachable");
    expect(keyVerdict("google", 400, "not json")).toBe("unreachable");
  });

  /** xAI: 400 "Incorrect API key" is the key, and so is the 401 its own error table names. */
  it("reads xAI's flat error, and does not take every 400 for a bad key", () => {
    expect(keyVerdict("xai", 400, REFUSAL.xai.body)).toBe("rejected");
    expect(keyVerdict("xai", 401, { code: "unauthenticated:no-credentials", error: "No credentials presented." })).toBe("rejected");
    expect(keyVerdict("xai", 400, { code: "invalid-argument", error: "Unknown query parameter." })).toBe("unreachable");
    expect(keyVerdict("xai", 400, null)).toBe("unreachable");
    expect(keyVerdict("xai", 403, { code: "permission-denied", error: "Team is blocked." })).toBe("unreachable");
  });

  /** Groq turns some networks away before it looks at the key. That must never read as a bad key. */
  it("calls Groq's network refusal unreachable, never rejected", async () => {
    const refusal = { status: 403, body: { error: { message: "Access denied. Please check your network settings." } } };
    expect(keyVerdict("groq", refusal.status, refusal.body)).toBe("unreachable");
    answer(refusal);
    expect(await checkKey("groq", keyOf("groq"))).toBe("unreachable");
  });

  it("does not take Cerebras's 403 for a missing header as a verdict on the key", () => {
    expect(keyVerdict("cerebras", 403, { detail: "Not authenticated" })).toBe("unreachable");
  });

  /** The public-list providers answer 200 to any key on their list, so they are asked somewhere that cares. */
  it("checks the public-list providers on an endpoint that needs the key, not on the list itself", () => {
    const publicIds = CATALOGUE_IDS.filter((id) => CATALOGUE[id].modelList === "public");
    expect(publicIds).toEqual(["openrouter", "cerebras", "deepinfra", "vercel", "venice", "novita", "huggingface"]);
    expect(CHECK_URL.venice).toMatch(/\/api_keys\/rate_limits$/);
    expect(CHECK_URL.novita).toMatch(/\/billing\/balance\/detail$/);
    expect(CHECK_URL.huggingface).toMatch(/\/api\/whoami-v2$/);
    expect(CHECK_URL.vercel).toMatch(/\/v1\/credits$/);
    expect(CHECK_URL.openrouter).toMatch(/\/api\/v1\/key$/);
    // Cerebras has a keyed list beside its public one; DeepInfra's public list refuses a bad key.
    expect(CHECK_URL.cerebras).not.toContain("/public/");
    expect(CHECK_URL.deepinfra).toMatch(/\/v1\/openai\/models$/);
  });

  it("keeps OpenAI's exception: a restricted key that may not list models is still a key", async () => {
    const restricted = { error: { message: "You have insufficient permissions for this operation. Missing scopes: api.model.read." } };
    expect(probeOutcome(401, restricted.error.message)).toBe("ok");
    expect(keyVerdict("openai", 401, restricted)).toBe("ok");
    answer({ status: 401, body: restricted });
    expect(await checkKey("openai", keyOf("openai"))).toBe("ok");
  });

  it("never answers with the key, whatever the provider echoed back", async () => {
    for (const id of CATALOGUE_IDS) {
      const key = keyOf(id);
      answer({ status: 401, body: { error: { message: `Incorrect API key provided: ${key}` }, detail: key, message: key } });
      expect(JSON.stringify(await checkKey(id, key)), id).not.toContain(key);
      answer(new Error(`connect ECONNREFUSED while sending ${key}`));
      expect(JSON.stringify(await checkKey(id, key)), id).not.toContain(key);
    }
  });
});

describe("a key that belongs to another provider", () => {
  it("is refused before any request, under every provider it is not from", async () => {
    const calls = answer({ status: 200, body: { data: [{ id: "x" }] } });
    for (const owner of CATALOGUE_IDS) {
      for (const prefix of CATALOGUE[owner].keyPrefixes) {
        const key = `${prefix}${body(48)}`;
        for (const chosen of CATALOGUE_IDS.filter((id) => id !== owner)) {
          expect(await checkKey(chosen, key), `${prefix} under ${chosen}`).toBe("rejected");
          if (CATALOGUE[chosen].modelList === "by-key") {
            expect(await listModels(chosen, key), `${prefix} under ${chosen}`).toEqual({ ok: false, reason: "rejected" });
          }
        }
      }
    }
    expect(calls).toHaveLength(0);
  });

  it("is refused before any request where the provider documents a prefix and the key has none", async () => {
    const calls = answer({ status: 200, body: {} });
    expect(CATALOGUE_IDS.filter((id) => CATALOGUE[id].requiresPrefix)).toEqual(["cerebras", "novita"]);
    for (const id of ["cerebras", "novita"] as const) {
      expect(await checkKey(id, body(48)), id).toBe("rejected");
      expect(await checkKey(id, `sk-${body(48)}`), id).toBe("rejected");
    }
    expect(await checkKey("openai", "")).toBe("rejected");
    expect(await checkKey("constructor" as CatalogueId, body(48))).toBe("rejected");
    expect(calls).toHaveLength(0);
  });
});

describe("listing models by key", () => {
  const byKey = ["anthropic", "openai", "google", "xai", "deepseek", "mistral", "moonshot", "groq", "fireworks", "nebius"] as const;
  type ByKey = (typeof byKey)[number];
  const notByKey = CATALOGUE_IDS.filter((id) => CATALOGUE[id].modelList !== "by-key");

  it("is the ten providers whose list depends on the key", () => {
    expect(CATALOGUE_IDS.filter((id) => CATALOGUE[id].modelList === "by-key")).toEqual([...byKey]);
  });

  /**
   * The hazard this file was written to close: the old code sent any key that was not
   * OpenAI's to Anthropic. A provider that is not asked by key is now not asked at all.
   */
  it("sends no key anywhere for a provider whose list is public or built in", async () => {
    const calls = answer({ status: 200, body: { data: [{ id: "claude-sonnet-5-5" }] } });
    for (const id of notByKey) {
      expect(await listModels(id, keyOf(id)), id).toEqual({ ok: false, reason: "unreachable" });
    }
    expect(await listModels("cohere" as CatalogueId, body(48))).toEqual({ ok: false, reason: "unreachable" });
    expect(calls).toHaveLength(0);
  });

  /** One good answer per provider, as small as it can be and still be kept by that provider's filter. */
  const ONE_MODEL: Record<ByKey, unknown> = {
    anthropic: { data: [{ id: "claude-sonnet-5-5", display_name: "Claude Sonnet 5.5" }], has_more: false },
    openai: { data: [{ id: "gpt-5", created: 1 }] },
    google: { models: [{ name: "models/gemini-3.8-flash", displayName: "Gemini 3.8 Flash", supportedGenerationMethods: ["generateContent"] }] },
    xai: { models: [{ id: "grok-4.7", output_modalities: ["text"] }] },
    deepseek: { data: [{ id: "deepseek-flash", name: "DeepSeek-V4.1-Flash" }] },
    mistral: { data: [{ id: "mistral-medium-latest", capabilities: { completion_chat: true, function_calling: true } }] },
    moonshot: { data: [{ id: "kimi-k3" }] },
    groq: { data: [{ id: "openai/gpt-oss-120b", active: true }] },
    fireworks: { models: [{ name: "accounts/fireworks/models/glm-5p3", supportsTools: true, supportsServerless: true }] },
    nebius: { data: [{ id: "zai-org/GLM-5.3", supported_features: ["tools"] }] },
  };

  const LIST_URL: Record<ByKey, string> = {
    anthropic: "https://api.anthropic.com/v1/models?limit=1000",
    openai: "https://api.openai.com/v1/models",
    google: "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000",
    xai: "https://api.x.ai/v1/language-models",
    deepseek: "https://api.deepseek.com/models",
    mistral: "https://api.mistral.ai/v1/models",
    moonshot: "https://api.moonshot.ai/v1/models",
    groq: "https://api.groq.com/openai/v1/models",
    fireworks: "https://api.fireworks.ai/v1/accounts/fireworks/models?filter=supports_serverless%3Dtrue&pageSize=200",
    nebius: "https://api.tokenfactory.nebius.com/v1/models?verbose=true",
  };

  it("asks each provider on its own origin with the key in its own header, and returns only models", async () => {
    for (const id of byKey) {
      const key = keyOf(id);
      const calls = answer({ status: 200, body: ONE_MODEL[id] });

      const result = await listModels(id, key);

      expect(result.ok, id).toBe(true);
      expect(calls, id).toHaveLength(1);
      expect(calls[0]?.url, id).toBe(LIST_URL[id]);
      expect(new URL(calls[0]!.url).origin, id).toBe(CATALOGUE[id].origin);
      expect(calls[0]?.url, id).not.toContain(key);
      expect(calls[0]?.headers, id).toEqual(keyCheckRequest(id, key).headers);
      expect(calls[0]?.init.redirect, id).toBe("error");
      expect(JSON.stringify(result), id).not.toContain(key);
      // Each stand-in answer lists the provider's default model, and that is all that comes back.
      expect(result.ok && result.models.map((model) => model.id), id).toEqual([CATALOGUE[id].defaultModel]);
    }
  });

  it("tells a refused key from a provider it could not ask", async () => {
    for (const id of byKey) {
      answer(REFUSAL[id]);
      // Fireworks's list is the shared account's catalogue, not the endpoint its keys are judged on.
      expect(await listModels(id, keyOf(id)), id).toEqual({ ok: false, reason: id === "fireworks" ? "unreachable" : "rejected" });
      for (const status of [403, 429, 500]) {
        answer({ status });
        expect(await listModels(id, keyOf(id)), `${id} ${status}`).toEqual({ ok: false, reason: "unreachable" });
      }
      answer({ status: 200, body: {} });
      expect(await listModels(id, keyOf(id)), id).toEqual({ ok: false, reason: "unreachable" });
      answer(new Error(`network down for ${keyOf(id)}`));
      const failed = await listModels(id, keyOf(id));
      expect(failed, id).toEqual({ ok: false, reason: "unreachable" });
    }
  });

  it("follows Google's and Fireworks's pages on the same origin, and stops after three", async () => {
    const googlePage = (id: string, token: string | null) => ({
      status: 200,
      body: { models: [{ name: `models/${id}`, supportedGenerationMethods: ["generateContent"] }], ...(token ? { nextPageToken: token } : {}) },
    });
    let calls = answer(googlePage("gemini-a", "t 1/&"), googlePage("gemini-b", null));
    let result = await listModels("google", keyOf("google"));
    expect(result.ok && result.models.map((m) => m.id)).toEqual(["gemini-a", "gemini-b"]);
    expect(calls.map((call) => call.url)).toEqual([
      "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000",
      "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000&pageToken=t%201%2F%26",
    ]);

    const fireworksPage = (slug: string) => ({
      status: 200,
      body: { models: [{ name: `accounts/fireworks/models/${slug}`, supportsTools: true, supportsServerless: true }], nextPageToken: `after-${slug}` },
    });
    calls = answer(fireworksPage("a"), fireworksPage("b"), fireworksPage("c"), fireworksPage("d"));
    result = await listModels("fireworks", keyOf("fireworks"));
    expect(result.ok && result.models.map((m) => m.id)).toEqual(["a", "b", "c"].map((slug) => `accounts/fireworks/models/${slug}`));
    expect(calls).toHaveLength(3);
    expect(calls[1]?.url).toBe(`${LIST_URL.fireworks}&pageToken=after-a`);
    for (const call of calls) expect(new URL(call.url).origin).toBe("https://api.fireworks.ai");

    // A page token that tries to be an address stays a query value.
    calls = answer(googlePage("gemini-a", "https://evil.example/?x="), googlePage("gemini-b", null));
    await listModels("google", keyOf("google"));
    expect(new URL(calls[1]!.url).origin).toBe("https://generativelanguage.googleapis.com");
  });

  /**
   * Most of the newer providers' keys are a plain run of letters and digits. No pattern
   * can find one in a sentence, so it is taken out by value.
   */
  it("takes the exact key out of a name a provider wrote, and drops a row whose id is the key", async () => {
    for (const id of ["deepseek", "mistral", "moonshot", "nebius", "anthropic"] as const) {
      const key = keyOf(id);
      const echoed: Record<typeof id, unknown> = {
        deepseek: { data: [{ id: "deepseek-next", name: `for ${key} only` }, { id: key, name: "x" }] },
        mistral: { data: [{ id: key, capabilities: { completion_chat: true, function_calling: true } }, { id: "mistral-next", capabilities: { completion_chat: true, function_calling: true } }] },
        moonshot: { data: [{ id: key }, { id: "kimi-next" }] },
        nebius: { data: [{ id: "org/next", name: `n ${key}`, supported_features: ["tools"] }, { id: key, supported_features: ["tools"] }] },
        anthropic: { data: [{ id: "claude-next", display_name: `Claude (${key})` }, { id: key, display_name: "x" }], has_more: false },
      };
      answer({ status: 200, body: echoed[id] });

      const result = await listModels(id, key);

      expect(result.ok, id).toBe(true);
      expect(JSON.stringify(result), id).not.toContain(key);
      expect(JSON.stringify(result), id).not.toContain(key.slice(0, 24));
      if (result.ok) expect(result.models, id).toHaveLength(1);
    }
  });

  it("puts the registry's own rows first for the newer providers, and leaves Anthropic's and OpenAI's order alone", async () => {
    answer({ status: 200, body: { data: [{ id: "kimi-new" }, { id: "kimi-k2.6" }, { id: "kimi-k3" }] } });
    const moonshot = await listModels("moonshot", keyOf("moonshot"));
    expect(moonshot.ok && moonshot.models.map((m) => m.id)).toEqual(["kimi-k3", "kimi-k2.6", "kimi-new"]);

    answer({ status: 200, body: { data: [{ id: "claude-new" }, { id: "claude-opus-5-5" }, { id: "claude-sonnet-5-5" }], has_more: false } });
    const anthropic = await listModels("anthropic", keyOf("anthropic"));
    expect(anthropic.ok && anthropic.models.map((m) => m.id)).toEqual(["claude-new", "claude-opus-5-5", "claude-sonnet-5-5"]);
  });
});

describe("the list parsers", () => {
  const ids = (id: CatalogueId, listBody: unknown) => parseModelList(id, listBody)?.models.map((model) => model.id);

  it("survive a body that is not what it should be, for every provider", () => {
    for (const id of CATALOGUE_IDS.filter((id) => CATALOGUE[id].modelList !== "built-in")) {
      for (const bad of [null, undefined, "nope", 7, [], {}, { data: "x" }, { data: [null, 3, "id", {}, { id: 7 }, { id: "has spaces" }, { id: "<b>" }] }, { models: [null, {}, { name: 4 }] }]) {
        expect(parseModelList(id, bad)?.models, `${id} ${JSON.stringify(bad)}`).toEqual([]);
      }
    }
    for (const id of ["zai", "together"] as const) expect(parseModelList(id, { data: [{ id: "glm-5.3" }] })).toBeNull();
  });

  it("Google: chat models by method and name, the id without its models/ prefix, prices from the registry", () => {
    const page = parseModelList("google", {
      models: [
        { name: "models/gemini-3.8-flash", displayName: "Gemini 3.8 Flash", supportedGenerationMethods: ["generateContent", "countTokens"], inputTokenLimit: 1048576 },
        { name: "models/gemini-9-pro", displayName: "Gemini 9 Pro", supportedGenerationMethods: ["generateContent"] },
        { name: "models/gemini-embedding-001", supportedGenerationMethods: ["embedContent"] },
        { name: "models/gemini-3.8-flash-preview-tts", supportedGenerationMethods: ["generateContent"] },
        { name: "models/gemini-3-pro-image-preview", supportedGenerationMethods: ["generateContent"] },
        { name: "models/gemini-3.8-flash-live", supportedGenerationMethods: ["generateContent", "bidiGenerateContent"] },
        { name: "models/gemini-robotics-er-2", supportedGenerationMethods: ["generateContent"] },
        { name: "models/deep-research-pro-preview", supportedGenerationMethods: ["generateContent"] },
        { name: "models/gemma-4-31b-it", supportedGenerationMethods: ["generateContent"] },
        { name: "models/aqa", supportedGenerationMethods: ["generateAnswer"] },
        { name: "models/../../v1/secrets", supportedGenerationMethods: ["generateContent"] },
      ],
      nextPageToken: "next",
    });
    expect(page).toEqual({
      models: [
        { id: "gemini-3.8-flash", label: "Gemini 3.8 Flash", inputPerMTok: 0.75, outputPerMTok: 3.75 },
        // Newer than the registry: listed by Google's own name, with no price invented.
        { id: "gemini-9-pro", label: "Gemini 9 Pro" },
      ],
      next: "next",
    });
  });

  it("xAI: text models, its own prices in cents per hundred million tokens, and no multi-agent model", () => {
    const page = parseModelList("xai", {
      models: [
        { id: "grok-4.7", output_modalities: ["text"], prompt_text_token_price: 20000, completion_text_token_price: 60000 },
        { id: "grok-4.3", output_modalities: ["text"], prompt_text_token_price: 12500, completion_text_token_price: 25000 },
        { id: "grok-4.20-multi-agent-0309", output_modalities: ["text"], prompt_text_token_price: 20000, completion_text_token_price: 60000 },
        { id: "grok-imagine", output_modalities: ["image"] },
        { id: "grok-9", output_modalities: ["text"] },
      ],
    });
    expect(page?.models).toEqual([
      { id: "grok-4.7", label: "Grok 4.7", inputPerMTok: 2, outputPerMTok: 6 },
      { id: "grok-4.3", label: "Grok 4.3", inputPerMTok: 1.25, outputPerMTok: 2.5 },
      { id: "grok-9", label: "grok-9" },
    ]);
  });

  it("DeepSeek: every model it lists, named and priced by the registry where it knows them", () => {
    expect(
      parseModelList("deepseek", {
        object: "list",
        data: [
          { id: "deepseek-flash", object: "model", owned_by: "deepseek", name: "DeepSeek-V4.1-Flash" },
          { id: "deepseek-v4-pro", object: "model", owned_by: "deepseek" },
          { id: "deepseek-v5", object: "model", name: "DeepSeek-V5" },
        ],
      })?.models,
    ).toEqual([
      { id: "deepseek-flash", label: "DeepSeek V4.1 Flash", inputPerMTok: 0.3, outputPerMTok: 1.2 },
      { id: "deepseek-v4-pro", label: "DeepSeek V4 Pro", inputPerMTok: 1.32, outputPerMTok: 3.96 },
      { id: "deepseek-v5", label: "DeepSeek-V5" },
    ]);
  });

  it("Mistral: only models it says can chat and call tools, and none with a retirement date", () => {
    const caps = (chat: boolean, tools: boolean) => ({ completion_chat: chat, function_calling: tools, completion_fim: false, vision: false });
    expect(
      ids("mistral", {
        object: "list",
        data: [
          { id: "mistral-medium-latest", capabilities: caps(true, true), deprecation: null, type: "base" },
          { id: "mistral-large-4", capabilities: caps(true, true) },
          { id: "mistral-embed", capabilities: caps(false, false) },
          { id: "mistral-ocr-latest", capabilities: caps(false, false) },
          { id: "codestral-chat-only", capabilities: caps(true, false) },
          { id: "mistral-small-2409", capabilities: caps(true, true), deprecation: "2026-11-30T12:00:00Z" },
          { id: "no-capabilities" },
        ],
      }),
    ).toEqual(["mistral-medium-latest", "mistral-large-4"]);
  });

  it("Groq: its chat models, without speech, guard models or anything switched off", () => {
    expect(
      ids("groq", {
        object: "list",
        data: [
          { id: "openai/gpt-oss-120b", active: true, context_window: 131072 },
          { id: "qwen/qwen3.8-27b", active: true },
          { id: "openai/gpt-oss-20b" },
          { id: "whisper-large-v3-turbo", active: true },
          { id: "canopylabs/orpheus-v1-english", active: true },
          { id: "meta-llama/llama-prompt-guard-2-86m", active: true },
          { id: "openai/gpt-oss-safeguard-20b", active: true },
          { id: "retired/model", active: false },
        ],
      }),
    ).toEqual(["openai/gpt-oss-120b", "qwen/qwen3.8-27b", "openai/gpt-oss-20b"]);
  });

  it("Moonshot: what it lists, with the registry's prices", () => {
    expect(parseModelList("moonshot", { object: "list", data: [{ id: "kimi-k3", object: "model", owned_by: "moonshot" }, { id: "kimi-k9" }] })?.models).toEqual([
      { id: "kimi-k3", label: "Kimi K3", inputPerMTok: 3, outputPerMTok: 15 },
      { id: "kimi-k9", label: "kimi-k9" },
    ]);
  });

  it("Fireworks: serverless models flagged for tools, by their long name, and the next page", () => {
    const page = parseModelList("fireworks", {
      models: [
        { name: "accounts/fireworks/models/glm-5p3", displayName: "GLM 5.3", kind: "HF_BASE_MODEL", supportsTools: true, supportsServerless: true },
        { name: "accounts/fireworks/models/new-model", displayName: "New Model", supportsTools: true, supportsServerless: true },
        { name: "accounts/fireworks/models/no-tools", supportsTools: false, supportsServerless: true },
        { name: "accounts/fireworks/models/dedicated-only", supportsTools: true, supportsServerless: false },
        { name: "accounts/fireworks/models/flux-image", kind: "FLUMINA_BASE_MODEL", supportsServerless: true },
      ],
      nextPageToken: "abc",
      totalSize: 5,
    });
    expect(page).toEqual({
      models: [
        { id: "accounts/fireworks/models/glm-5p3", label: "GLM 5.3", inputPerMTok: 1.4, outputPerMTok: 4.4 },
        { id: "accounts/fireworks/models/new-model", label: "New Model" },
      ],
      next: "abc",
    });
  });

  it("Nebius: the models that name tools, with the list's own prices", () => {
    expect(
      parseModelList("nebius", {
        object: "list",
        data: [
          { id: "zai-org/GLM-5.3", name: "zai-org/GLM-5.3", architecture: { modality: "text->text" }, pricing: { prompt: "0.0000014", completion: "0.0000044" }, supported_features: ["tools", "json_mode"] },
          { id: "some-org/New-Model", name: "New Model", architecture: { modality: "text+image->text" }, pricing: { prompt: "0.000001", completion: "0.000002" }, supported_features: ["function_calling"] },
          { id: "some-org/No-Tools", pricing: { prompt: "0.000001", completion: "0.000002" }, supported_features: ["json_mode"] },
          { id: "BAAI/bge-embed", architecture: { modality: "text->embedding" }, supported_features: ["tools"] },
        ],
      })?.models,
    ).toEqual([
      { id: "zai-org/GLM-5.3", label: "GLM-5.3", inputPerMTok: 1.4, outputPerMTok: 4.4 },
      { id: "some-org/New-Model", label: "New Model", inputPerMTok: 1, outputPerMTok: 2 },
    ]);
  });

  /** Which words Nebius uses for tool support was not seen with a real key. No word must not mean no model. */
  it("Nebius: falls back to the registry's rows the key can see when the list names no tools at all", () => {
    const plain = parseModelList("nebius", { data: [{ id: "zai-org/GLM-5.3" }, { id: "MiniMaxAI/MiniMax-M3" }, { id: "some-org/Unknown" }] });
    expect(plain?.models.map((model) => model.id)).toEqual(["zai-org/GLM-5.3", "MiniMaxAI/MiniMax-M3"]);
    expect(plain?.models[0]).toEqual({ id: "zai-org/GLM-5.3", label: "GLM-5.3", inputPerMTok: 1.4, outputPerMTok: 4.4 });
    // Nothing of the registry's in the list: the built-in rows as they are.
    expect(parseModelList("nebius", { data: [{ id: "some-org/Unknown" }] })?.models).toEqual([...CATALOGUE.nebius.models]);
    // Nothing usable in the answer at all is not turned into a list.
    expect(parseModelList("nebius", { data: [] })?.models).toEqual([]);
  });

  it("Cerebras: the public list, per-token prices made per-million, tools flag required", () => {
    expect(
      parseModelList("cerebras", {
        object: "list",
        data: [
          {
            id: "gpt-oss-120b",
            object: "model",
            name: "OpenAI GPT OSS",
            pricing: { prompt: "0.00000035", completion: "0.00000075" },
            capabilities: { streaming: true, function_calling: true, tools: true, parallel_tool_calls: false },
            deprecated: false,
            preview: false,
          },
          { id: "new-model", name: "New Model", pricing: { prompt: "0.000001", completion: "0.000002" }, capabilities: { tools: true }, deprecated: false },
          { id: "no-tools", name: "No Tools", pricing: { prompt: "0.000001", completion: "0.000002" }, capabilities: { tools: false, function_calling: false } },
          { id: "old-model", name: "Old", capabilities: { tools: true }, deprecated: true },
        ],
      })?.models,
    ).toEqual([
      { id: "gpt-oss-120b", label: "GPT OSS 120B", inputPerMTok: 0.35, outputPerMTok: 0.75 },
      { id: "new-model", label: "New Model", inputPerMTok: 1, outputPerMTok: 2 },
    ]);
  });

  it("DeepInfra: a bare array; text models with the tools tag that are not retired, cents per token made dollars per million", () => {
    const tokens = (input: number, output: number) => ({ type: "tokens", cents_per_input_token: input, cents_per_output_token: output });
    expect(
      parseModelList("deepinfra", [
        { model_name: "zai-org/GLM-5.3", type: "text-generation", tags: ["openai", "cc-native", "tools", "json"], pricing: tokens(9e-5, 0.0004), deprecated: null, replaced_by: null },
        { model_name: "openai/gpt-oss-120b", type: "text-generation", tags: ["openai", "tools", "reasoning"], pricing: tokens(3.7e-6, 1.7e-5), deprecated: null },
        { model_name: "some-org/New-Model", type: "text-generation", tags: ["tools"], pricing: tokens(2.9999999999999997e-5, 1e-4), deprecated: null },
        { model_name: "moonshotai/Kimi-K2.5", type: "text-generation", tags: ["tools"], pricing: tokens(1e-5, 1e-5), deprecated: 1788824437, replaced_by: "moonshotai/Kimi-K2.6" },
        { model_name: "some-org/No-Tools", type: "text-generation", tags: ["openai"], pricing: tokens(1e-5, 1e-5), deprecated: null },
        { model_name: "black-forest-labs/FLUX-2", type: "text-to-image", tags: ["tools"], deprecated: null },
        { model_name: "BAAI/bge-m3", type: "embeddings", tags: [], deprecated: null },
      ])?.models,
    ).toEqual([
      { id: "zai-org/GLM-5.3", label: "GLM-5.3", inputPerMTok: 0.9, outputPerMTok: 4 },
      { id: "openai/gpt-oss-120b", label: "GPT-OSS 120B", inputPerMTok: 0.037, outputPerMTok: 0.17 },
      { id: "some-org/New-Model", label: "New-Model", inputPerMTok: 0.3, outputPerMTok: 1 },
    ]);
  });

  it("Vercel AI Gateway: language models tagged tool-use, per-token prices made per-million", () => {
    expect(
      parseModelList("vercel", {
        object: "list",
        data: [
          { id: "anthropic/claude-sonnet-5.5", name: "Claude Sonnet 5.5", type: "language", tags: ["reasoning", "tool-use", "vision"], temperature: false, pricing: { input: "0.000002", output: "0.00001", input_cache_read: "0.0000002" } },
          { id: "alibaba/qwen-3-14b", name: "Qwen3-14B", type: "language", tags: ["reasoning", "tool-use"], pricing: { input: "0.00000012", output: "0.00000024" } },
          { id: "some/no-tools", name: "No Tools", type: "language", tags: ["reasoning"], pricing: { input: "0.000001", output: "0.000001" } },
          { id: "openai/text-embedding-3-small", name: "Embedding", type: "embedding", tags: ["tool-use"], pricing: { input: "0.00000002" } },
          { id: "google/veo-3", name: "Veo 3", type: "video", tags: [] },
        ],
      })?.models,
    ).toEqual([
      { id: "anthropic/claude-sonnet-5.5", label: "Claude Sonnet 5.5", inputPerMTok: 2, outputPerMTok: 10 },
      { id: "alibaba/qwen-3-14b", label: "Qwen3-14B", inputPerMTok: 0.12, outputPerMTok: 0.24 },
    ]);
  });

  it("Venice: models that are up and flagged for function calling, priced in dollars per million already", () => {
    const spec = (name: string, tools: boolean, offline = false) => ({
      name,
      offline,
      pricing: { input: { usd: 0.9375, diem: 0.9375 }, output: { usd: 4.6875, diem: 4.6875 } },
      capabilities: { supportsFunctionCalling: tools, supportsReasoning: true, supportsVision: true },
      traits: [],
    });
    expect(
      parseModelList("venice", {
        object: "list",
        type: "text",
        data: [
          { id: "gemini-3-6-flash", object: "model", type: "text", model_spec: spec("Gemini 3.6 Flash", true) },
          { id: "zai-org-glm-5-2", object: "model", type: "text", model_spec: { ...spec("GLM 5.2", true), pricing: { input: { usd: 1.4 }, output: { usd: 4.4 } } } },
          { id: "venice-uncensored", model_spec: spec("Venice Uncensored", false) },
          { id: "down-for-now", model_spec: spec("Down", true, true) },
          { id: "no-spec" },
        ],
      })?.models,
    ).toEqual([
      { id: "gemini-3-6-flash", label: "Gemini 3.6 Flash", inputPerMTok: 0.9375, outputPerMTok: 4.6875 },
      { id: "zai-org-glm-5-2", label: "GLM 5.2", inputPerMTok: 1.4, outputPerMTok: 4.4 },
    ]);
  });

  it("Novita: chat models with function-calling that answer in text, priced from its decimal field", () => {
    const priced = (input: string, output: string) => ({ prompt: { price_per_m: 1, price_per_m_decimal: input }, completion: { price_per_m: 1, price_per_m_decimal: output } });
    expect(
      parseModelList("novita", {
        data: [
          { id: "zai-org/glm-5.3-flash", display_name: "GLM 5.3 Flash", title: "zai-org/glm-5.3-flash", model_type: "chat", status: 1, features: ["function-calling", "structured-outputs", "serverless"], output_modalities: ["text"], input_token_price_per_m: 1500, output_token_price_per_m: 5000, pricing: priced("0.15", "0.5") },
          { id: "new/model", display_name: "New Model", model_type: "chat", status: 1, features: ["function-calling"], output_modalities: ["text"], input_token_price_per_m: 2500, output_token_price_per_m: 10000 },
          { id: "no/tools", display_name: "No Tools", model_type: "chat", status: 1, features: ["serverless"], output_modalities: ["text"] },
          { id: "ming-image-0.1-design", display_name: "Ming", model_type: "chat", status: 1, features: ["function-calling"], output_modalities: ["text", "image", "video", "audio"] },
          { id: "off/model", display_name: "Off", model_type: "chat", status: 0, features: ["function-calling"], output_modalities: ["text"] },
        ],
      })?.models,
    ).toEqual([
      { id: "zai-org/glm-5.3-flash", label: "GLM 5.3 Flash", inputPerMTok: 0.15, outputPerMTok: 0.5 },
      { id: "new/model", label: "New Model", inputPerMTok: 0.25, outputPerMTok: 1 },
    ]);
  });

  /** A plain model id leaves the choice of provider to the router, so none it could pick may be without tools. */
  it("Hugging Face: models a live provider serves with tools and none serves without, at the highest of their prices", () => {
    const provider = (name: string, tools: boolean | undefined, pricing?: { input: number; output: number }, status = "live") => ({
      provider: name,
      status,
      ...(pricing ? { pricing } : {}),
      ...(tools === undefined ? {} : { supports_tools: tools }),
      is_model_author: false,
    });
    expect(
      parseModelList("huggingface", {
        object: "list",
        data: [
          {
            id: "Qwen/Qwen3.8-27B",
            object: "model",
            architecture: { input_modalities: ["text", "image"], output_modalities: ["text"] },
            providers: [
              provider("novita", true, { input: 0.42, output: 3 }),
              provider("cerebras", true, { input: 0.99, output: 1.49 }),
              provider("ovhcloud", true, { input: 0.47, output: 3.19 }),
              // Not live, so the router cannot pick it: neither its answer on tools nor its price counts.
              provider("staging-inc", false, { input: 9, output: 9 }, "staging"),
            ],
          },
          { id: "zai-org/GLM-5.3", providers: [provider("deepinfra", true, { input: 0.9, output: 4 }), provider("together", true)] },
          // One fast provider without tools is enough: the router may send the run there.
          { id: "some-org/One-Without", providers: [provider("slow", true, { input: 1, output: 1 }), provider("fast", false, { input: 1, output: 1 })] },
          // A provider that says nothing is left out of the question: the model is kept on the other's word.
          { id: "some-org/One-Silent", providers: [provider("x", true, { input: 1, output: 1 }), provider("featherless-ai", undefined)] },
          // But nobody saying yes is not a yes.
          { id: "some-org/All-Silent", providers: [provider("featherless-ai", undefined)] },
          { id: "some-org/No-Tools", providers: [provider("featherless-ai", undefined), provider("x", false, { input: 1, output: 1 })] },
          { id: "some-org/Not-Live", providers: [provider("x", true, { input: 1, output: 1 }, "staging")] },
          { id: "some-org/Nobody", providers: [] },
          { id: "some-org/Unpriced", providers: [provider("x", true)] },
        ],
      })?.models,
    ).toEqual([
      { id: "Qwen/Qwen3.8-27B", label: "Qwen3.8-27B", inputPerMTok: 0.99, outputPerMTok: 3.19 },
      { id: "zai-org/GLM-5.3", label: "GLM-5.3", inputPerMTok: 0.9, outputPerMTok: 4 },
      { id: "some-org/One-Silent", label: "One-Silent", inputPerMTok: 1, outputPerMTok: 1 },
      // No price in the list and none in the registry: listed without one.
      { id: "some-org/Unpriced", label: "Unpriced" },
    ]);
  });
});

describe("the public lists", () => {
  const publicIds = ["openrouter", "cerebras", "deepinfra", "vercel", "venice", "novita", "huggingface"] as const;
  type Public = (typeof publicIds)[number];

  it("are the seven providers that publish their list", () => {
    expect(CATALOGUE_IDS.filter((id) => CATALOGUE[id].modelList === "public")).toEqual([...publicIds]);
  });

  const PUBLIC_URL: Record<Public, string> = {
    openrouter: "https://openrouter.ai/api/v1/models",
    cerebras: "https://api.cerebras.ai/public/v1/models",
    deepinfra: "https://api.deepinfra.com/models/list",
    vercel: "https://ai-gateway.vercel.sh/v1/models",
    venice: "https://api.venice.ai/api/v1/models",
    novita: "https://api.novita.ai/openai/v1/models",
    huggingface: "https://router.huggingface.co/v1/models",
  };

  /** One row each provider's filter keeps. */
  const ONE_PUBLIC: Record<Public, unknown> = {
    openrouter: { data: [{ id: "vendor/model-a", name: "Vendor: Model A", created: 1, pricing: { prompt: "0.000002", completion: "0.00001" }, supported_parameters: ["tools"], architecture: { output_modalities: ["text"] } }] },
    cerebras: { data: [{ id: "model-a", name: "Model A", capabilities: { tools: true }, pricing: { prompt: "0.000001", completion: "0.000002" } }] },
    deepinfra: [{ model_name: "org/model-a", type: "text-generation", tags: ["tools"], deprecated: null, pricing: { cents_per_input_token: 1e-4, cents_per_output_token: 2e-4 } }],
    vercel: { data: [{ id: "org/model-a", name: "Model A", type: "language", tags: ["tool-use"], pricing: { input: "0.000001", output: "0.000002" } }] },
    venice: { data: [{ id: "model-a", model_spec: { name: "Model A", offline: false, capabilities: { supportsFunctionCalling: true }, pricing: { input: { usd: 1 }, output: { usd: 2 } } } }] },
    novita: { data: [{ id: "org/model-a", display_name: "Model A", model_type: "chat", status: 1, features: ["function-calling"], output_modalities: ["text"], pricing: { prompt: { price_per_m_decimal: "1" }, completion: { price_per_m_decimal: "2" } } }] },
    huggingface: { data: [{ id: "org/model-a", providers: [{ provider: "p", status: "live", supports_tools: true, pricing: { input: 1, output: 2 } }] }] },
  };

  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  it("reads each on the provider's own origin with no key and no credential of any kind", async () => {
    for (const id of publicIds) {
      const calls = answer({ status: 200, body: ONE_PUBLIC[id] });

      const catalog = await getPublicCatalog(id, 0);

      expect(catalog?.live, id).toBe(true);
      expect(catalog?.models.map((model) => model.id), id).toHaveLength(1);
      expect(calls, id).toHaveLength(1);
      expect(calls[0]?.url, id).toBe(PUBLIC_URL[id]);
      expect(new URL(calls[0]!.url).origin, id).toBe(CATALOGUE[id].origin);
      expect(calls[0]?.headers, id).toEqual({ accept: "application/json" });
      expect(calls[0]?.init.redirect, id).toBe("error");
    }
  });

  it("serves a fetched list for an hour, each provider's apart from the others'", async () => {
    for (const id of publicIds) {
      const calls = answer({ status: 200, body: ONE_PUBLIC[id] });
      await getPublicCatalog(id, 0);
      await getPublicCatalog(id, 59 * 60_000);
      expect(calls, id).toHaveLength(1);
      await getPublicCatalog(id, 61 * 60_000);
      expect(calls, id).toHaveLength(2);
    }
  });

  it("falls back to the provider's own built-in rows, and says so, when it cannot be reached", async () => {
    for (const id of publicIds) {
      for (const reply of [new Error("network down"), { status: 500, body: { error: "nope" } }, { status: 200, body: { data: [] } }, { status: 200 }] as Reply[]) {
        resetPublicCatalogs();
        answer(reply);
        expect(await getPublicCatalog(id, 0), id).toEqual({ models: [...CATALOGUE[id].models], live: false });
      }
    }
  });

  it("keeps serving the last good list when a later fetch fails", async () => {
    answer({ status: 200, body: ONE_PUBLIC.venice });
    await getPublicCatalog("venice", 0);
    answer(new Error("network down"));
    const later = await getPublicCatalog("venice", 2 * 60 * 60_000);
    expect(later).toEqual({ models: [{ id: "model-a", label: "Model A", inputPerMTok: 1, outputPerMTok: 2 }], live: true });
  });

  it("has nothing to say, and asks nobody, for a provider whose list is not public", async () => {
    const calls = answer({ status: 200, body: { data: [] } });
    for (const id of CATALOGUE_IDS.filter((id) => CATALOGUE[id].modelList !== "public")) {
      expect(await getPublicCatalog(id), id).toBeNull();
    }
    expect(await getPublicCatalog("constructor" as CatalogueId)).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("puts the registry's rows first, and removes anything key-shaped from a name", async () => {
    const shaped = `gsk_${body(40)}`;
    answer({
      status: 200,
      body: {
        data: [
          { id: "newest-model", model_spec: { name: `New ${shaped}`, capabilities: { supportsFunctionCalling: true }, pricing: { input: { usd: 1 }, output: { usd: 2 } } } },
          { id: "kimi-k3", model_spec: { name: "Kimi K3", capabilities: { supportsFunctionCalling: true }, pricing: { input: { usd: 3.75 }, output: { usd: 18.75 } } } },
          { id: "zai-org-glm-5-2", model_spec: { name: "GLM 5.2", capabilities: { supportsFunctionCalling: true }, pricing: { input: { usd: 1.4 }, output: { usd: 4.4 } } } },
        ],
      },
    });
    const catalog = await getPublicCatalog("venice", 0);
    expect(catalog?.models.map((model) => model.id)).toEqual(["zai-org-glm-5-2", "kimi-k3", "newest-model"]);
    expect(catalog?.models[2]?.label).toBe(`New ${REDACTED}`);
  });
});

describe("withoutKey", () => {
  it("takes a key with no shape out of a sentence, and anything key-shaped with it", () => {
    const key = body(40);
    // Another credential altogether, with nothing of the first key in it.
    const other = `gsk_${"Zz9yX8wV7u".repeat(4)}`;
    const clean = withoutKey(key);
    expect(clean(`Invalid key ${key}. Try again.`)).toBe(`Invalid key ${REDACTED}. Try again.`);
    expect(clean(`got ${other} and ${key}`)).toBe(`got ${REDACTED} and ${REDACTED}`);
    expect(clean("Claude Sonnet 5.5")).toBe("Claude Sonnet 5.5");
    expect(clean("accounts/fireworks/models/glm-5p3")).toBe("accounts/fireworks/models/glm-5p3");
    expect(clean("")).toBe("");
  });
});
