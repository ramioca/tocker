/**
 * The key actions with every provider in the registry switched on.
 *
 * The registry keeps a list of the providers a key can be added for, and today that list
 * is three. This file rehearses it at its full length, so what adding, replacing and
 * listing a Groq or a Hugging Face key does is proven before anyone can do it: each key
 * is sent to its own provider's origin and to no other, a refusal is read in that
 * provider's own way, and a key that is plainly another provider's is sent to nobody.
 *
 * The check, the workspace lookup and the model list are the real code; only `fetch`,
 * the session and the registry's list of enabled ids are stand-ins. The sentences that
 * name a provider as the fix are decided inside the registry and are not what is
 * rehearsed here: `providers.test.ts` pins those.
 */
import { randomBytes } from "node:crypto";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/agent/providers", async (original) => {
  const actual = await original<typeof import("@/lib/agent/providers")>();
  const order = actual.providersInOrder(actual.CATALOGUE_IDS);
  return {
    ...actual,
    PROVIDER_IDS: actual.CATALOGUE_IDS,
    PROVIDER_ORDER: order,
    isProvider: actual.isCatalogueId,
    filterProviders: (query: string) => actual.searchProviders(order, query),
  };
});
vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));
vi.mock("@/lib/auth", () => ({
  getSession: async () => session,
  requireSession: async () => session,
}));

import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { Db } from "@/db";
import * as schema from "@/db/schema";
import { CATALOGUE, CATALOGUE_IDS, PROVIDER_IDS, isProvider, type CatalogueId, type LlmProvider } from "@/lib/agent/providers";
import { keyCheckRequest } from "@/lib/agent/providers-keys";
import { setupTestDb } from "@/lib/agent/test-support";
import { limiter } from "@/lib/security/rate-limit";
import type { Session } from "@/server/types";

process.env.ENCRYPTION_KEY = randomBytes(32).toString("base64");

let session: Session | null = null;

const { addLlmKey, listKeyModels, rotateLlmKey } = await import("./users");
const { encryptSecret, decryptSecret } = await import("@/lib/crypto");

let db: Db;

interface Sent {
  url: string;
  headers: Record<string, string>;
  redirect: RequestRedirect | undefined;
}
let sent: Sent[] = [];

function providerAnswers(status: number, body: unknown = {}): void {
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init: RequestInit = {}) => {
    sent.push({ url: String(input), headers: { ...(init.headers as Record<string, string>) }, redirect: init.redirect });
    return new Response(JSON.stringify(body), { status });
  });
}

beforeAll(async () => {
  db = await setupTestDb();
}, 120_000);

beforeEach(() => {
  session = null;
  sent = [];
  limiter.reset();
  providerAnswers(200);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Stand-in keys, put together at run time: nothing key-shaped is written out in this file. */
const tail = () => `${nanoid(24)}${nanoid(24)}`.replace(/[^A-Za-z0-9]/g, "x");
const keyOf = (id: CatalogueId) => `${CATALOGUE[id].keyPrefixes[0] ?? ""}${tail()}`;
/** Here every catalogue id is an enabled provider; this says so to the compiler. */
const enabled = (id: CatalogueId) => id as LlmProvider;

async function signedInUser(): Promise<string> {
  const userId = `did:privy:${nanoid(8)}`;
  await db.insert(schema.users).values({ id: userId, handle: `u${nanoid(8).toLowerCase().replace(/[^a-z0-9]/g, "x")}`, displayName: null });
  session = { userId, handle: "owner", displayName: null, avatarUrl: null, email: null };
  return userId;
}

const keysOf = (userId: string) => db.select().from(schema.llmKeys).where(eq(schema.llmKeys.userId, userId));

async function savedKey(userId: string, provider: CatalogueId, key: string): Promise<string> {
  const id = `key_${nanoid(10)}`;
  await db.insert(schema.llmKeys).values({ id, userId, provider: enabled(provider), encryptedKey: encryptSecret(key), last4: key.slice(-4) });
  return id;
}

/** Every origin a provider's key may be sent to: its own, and the Hub for Hugging Face. */
const allowed = (id: CatalogueId) => [CATALOGUE[id].origin, CATALOGUE[id].keyCheckOrigin].filter(Boolean);

/** How each provider says "this key is not a key": a 400 with a reason, a 400 with a sentence, or a 401. */
function refusalOf(id: CatalogueId): { status: number; body: unknown } {
  if (id === "google") return { status: 400, body: { error: { code: 400, message: "API key not valid. Please pass a valid API key.", details: [{ reason: "API_KEY_INVALID" }] } } };
  if (id === "xai") return { status: 400, body: { code: "invalid-argument", error: "Incorrect API key provided. You can obtain an API key from https://console.x.ai." } };
  return { status: 401, body: { detail: "Invalid API Key" } };
}

describe("with all nineteen providers switched on", () => {
  it("is rehearsing all nineteen", () => {
    expect(PROVIDER_IDS).toHaveLength(19);
    expect(CATALOGUE_IDS.every((id) => isProvider(id))).toBe(true);
    expect(isProvider("cohere")).toBe(false);
  });

  it("adds a key for every provider, sending it to that provider's own origin and to no other", async () => {
    for (const id of CATALOGUE_IDS) {
      const userId = await signedInUser();
      sent = [];
      const key = keyOf(id);

      const result = await addLlmKey({ provider: enabled(id), key });

      expect(result.ok, `${id}: ${result.ok ? "" : result.error}`).toBe(true);
      // Anthropic is asked twice (does the key need a workspace, then is it a key); everyone else once.
      expect(sent, id).toHaveLength(id === "anthropic" ? 2 : 1);
      for (const request of sent) {
        expect(allowed(id), `${id} → ${request.url}`).toContain(new URL(request.url).origin);
        expect(request.url, id).not.toContain(key);
        expect(request.redirect, id).toBe("error");
      }
      // The last request is the key check, at the endpoint and with the header that provider takes.
      expect({ url: sent.at(-1)?.url, headers: sent.at(-1)?.headers }, id).toEqual(keyCheckRequest(id, key));

      const [row] = await keysOf(userId);
      expect(row?.provider, id).toBe(id);
      expect(decryptSecret(row!.encryptedKey), id).toBe(key);
      expect(JSON.stringify(result), id).not.toContain(key);
      const [audit] = await db.select().from(schema.auditEvents).where(eq(schema.auditEvents.userId, userId));
      expect(audit?.summary, id).toBe(`Added ${CATALOGUE[id].article} ${CATALOGUE[id].label} API key ending ${key.slice(-4)}.`);
      expect(JSON.stringify(audit), id).not.toContain(key);
    }
  });

  it("checks a Hugging Face token on the Hub and nowhere else", async () => {
    await signedInUser();
    const token = keyOf("huggingface");
    await addLlmKey({ provider: enabled("huggingface"), key: token });
    expect(sent).toEqual([{ url: "https://huggingface.co/api/whoami-v2", headers: { authorization: `Bearer ${token}` }, redirect: "error" }]);
  });

  it("saves nothing when the provider refuses the key, in whichever way that provider refuses", async () => {
    for (const id of CATALOGUE_IDS) {
      const userId = await signedInUser();
      const refusal = refusalOf(id);
      providerAnswers(refusal.status, refusal.body);

      expect(await addLlmKey({ provider: enabled(id), key: keyOf(id) }), id).toEqual({
        ok: false,
        error: `${CATALOGUE[id].label} rejected this key — check you copied all of it`,
      });
      expect(await keysOf(userId), id).toEqual([]);
    }
  });

  it("saves the key as unchecked when the answer is not about the key", async () => {
    for (const id of CATALOGUE_IDS) {
      for (const [status, body] of [
        [503, { error: { message: "overloaded" } }],
        [429, { error: { message: "slow down" } }],
        // Groq's refusal of a network, and what the others say when a caller may not use an endpoint.
        [403, { error: { message: "Access denied. Please check your network settings." } }],
      ] as const) {
        await signedInUser();
        providerAnswers(status, body);
        const result = await addLlmKey({ provider: enabled(id), key: keyOf(id) });
        expect(result.ok && result.data.unverified, `${id} ${status}`).toBe(true);
      }
    }
  });

  /** Sixteen more providers is sixteen more places a mis-pasted key could be sent. It is sent to none. */
  it("refuses a key that starts the way another provider's keys do, under all nineteen, before any request", async () => {
    const userId = await signedInUser();
    let refused = 0;
    for (const owner of CATALOGUE_IDS) {
      for (const prefix of CATALOGUE[owner].keyPrefixes) {
        for (const chosen of CATALOGUE_IDS.filter((id) => id !== owner)) {
          limiter.reset();
          const result = await addLlmKey({ provider: enabled(chosen), key: `${prefix}${tail()}` });
          expect(result.ok ? "" : result.error, `${prefix} under ${chosen}`).toContain(
            `That looks like ${CATALOGUE[owner].article} ${CATALOGUE[owner].label} key, not ${CATALOGUE[chosen].article} ${CATALOGUE[chosen].label} one`,
          );
          refused += 1;
        }
      }
    }
    expect(refused).toBeGreaterThan(200);
    expect(sent).toHaveLength(0);
    expect(await keysOf(userId)).toEqual([]);
  });

  it("refuses a key without the prefix Cerebras and Novita document, before any request", async () => {
    await signedInUser();
    expect(await addLlmKey({ provider: enabled("cerebras"), key: tail() })).toEqual({
      ok: false,
      error: "Cerebras keys start with csk- — check you copied all of it, or choose the provider this key is from",
    });
    const novita = await addLlmKey({ provider: enabled("novita"), key: `sk-${tail()}` });
    expect(novita.ok ? "" : novita.error).toContain("Novita AI keys start with sk_");
    expect(sent).toHaveLength(0);
  });

  it("replaces a key for every provider by asking only the provider of the saved row", async () => {
    for (const id of CATALOGUE_IDS) {
      const userId = await signedInUser();
      const keyId = await savedKey(userId, id, keyOf(id));
      sent = [];
      const next = keyOf(id);

      expect((await rotateLlmKey({ id: keyId, key: next })).ok, id).toBe(true);

      expect(sent.map((request) => ({ url: request.url, headers: request.headers })), id).toEqual([keyCheckRequest(id, next)]);
      const [row] = await keysOf(userId);
      expect(decryptSecret(row!.encryptedKey), id).toBe(next);

      // A refused replacement leaves the working secret where it was.
      const refusal = refusalOf(id);
      providerAnswers(refusal.status, refusal.body);
      limiter.reset();
      expect((await rotateLlmKey({ id: keyId, key: keyOf(id) })).ok, id).toBe(false);
      const [kept] = await keysOf(userId);
      expect(decryptSecret(kept!.encryptedKey), id).toBe(next);
      providerAnswers(200);
    }
  });

  it("will not replace a key with another provider's, under any provider, and asks nobody", async () => {
    const userId = await signedInUser();
    for (const id of CATALOGUE_IDS) {
      const old = keyOf(id);
      const keyId = await savedKey(userId, id, old);
      const other = id === "groq" ? "xai" : "groq";
      limiter.reset();
      const result = await rotateLlmKey({ id: keyId, key: keyOf(other) });
      expect(result.ok ? "" : result.error, id).toContain(`That looks like ${CATALOGUE[other].article} ${CATALOGUE[other].label} key; this is`);
    }
    expect(sent).toHaveLength(0);
  });

  /** One good answer per provider that is asked by key, as small as that provider's filter will keep. */
  const ONE_MODEL: Partial<Record<CatalogueId, unknown>> = {
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

  it("lists a saved key's models from its own provider, for every provider that is asked by key", async () => {
    const byKey = CATALOGUE_IDS.filter((id) => CATALOGUE[id].modelList === "by-key");
    expect(byKey.every((id) => ONE_MODEL[id] !== undefined)).toBe(true);
    for (const id of byKey) {
      const userId = await signedInUser();
      const key = keyOf(id);
      const keyId = await savedKey(userId, id, key);
      sent = [];
      providerAnswers(200, ONE_MODEL[id]);

      const result = await listKeyModels(keyId);

      expect(result.ok, `${id}: ${result.ok ? "" : result.error}`).toBe(true);
      expect(result.ok && result.data.provider, id).toBe(id);
      expect(result.ok && result.data.models.map((model) => model.id), id).toEqual([CATALOGUE[id].defaultModel]);
      expect(sent, id).toHaveLength(1);
      expect(new URL(sent[0]!.url).origin, id).toBe(CATALOGUE[id].origin);
      expect(sent[0]?.headers, id).toEqual(keyCheckRequest(id, key).headers);
      expect(JSON.stringify(result), id).not.toContain(key);
    }
  });

  it("sends a saved key nowhere when its provider's list is public or built in", async () => {
    const userId = await signedInUser();
    for (const id of CATALOGUE_IDS.filter((id) => CATALOGUE[id].modelList !== "by-key")) {
      limiter.reset();
      expect(await listKeyModels(await savedKey(userId, id, keyOf(id))), id).toEqual({
        ok: false,
        error: `${CATALOGUE[id].label}'s list does not depend on the key`,
      });
    }
    expect(sent).toHaveLength(0);
  });

  it("says in words which provider refused a saved key, or could not be asked", async () => {
    for (const id of CATALOGUE_IDS.filter((id) => CATALOGUE[id].modelList === "by-key")) {
      const userId = await signedInUser();
      const keyId = await savedKey(userId, id, keyOf(id));
      const refusal = refusalOf(id);
      providerAnswers(refusal.status, refusal.body);
      // Fireworks's list is its shared catalogue; a refusal there is not a verdict on the key.
      expect(await listKeyModels(keyId), id).toEqual({
        ok: false,
        error:
          id === "fireworks"
            ? "Couldn't get the model list from Fireworks AI just now."
            : `${CATALOGUE[id].label} no longer accepts this key. Replace it under Settings, LLM API keys.`,
      });
      providerAnswers(503);
      expect(await listKeyModels(keyId), id).toEqual({ ok: false, error: `Couldn't get the model list from ${CATALOGUE[id].label} just now.` });
    }
  });
});
