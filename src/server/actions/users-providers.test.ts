/**
 * The key actions and the provider's own host: what leaves the server, and for where.
 *
 * `users-keys.test.ts` replaces the key check with a stand-in and looks at what is
 * stored. This file leaves the check, the workspace lookup and the model list real and
 * replaces only `fetch`, so every request the actions would make is on record: its
 * address, its headers, and how many there were. The rule under test is the one the
 * whole feature rests on. A key is sent to the provider it was added under and to
 * nobody else, and a key that is plainly another provider's is sent to nobody at all.
 *
 * Written against the providers that are switched on, so it covers Anthropic, OpenAI
 * and OpenRouter today and the rest the day they are enabled; the file beside it
 * (`users-providers.widened.test.ts`) rehearses all nineteen now.
 */
import { randomBytes } from "node:crypto";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { Db } from "@/db";
import * as schema from "@/db/schema";
import {
  CATALOGUE,
  CATALOGUE_IDS,
  KEY_UNSENDABLE,
  KEY_WRAPPED,
  PROVIDER_IDS,
  PROVIDER_UNSUPPORTED,
  type CatalogueId,
  type LlmProvider,
} from "@/lib/agent/providers";
import { setupTestDb } from "@/lib/agent/test-support";
import { limiter } from "@/lib/security/rate-limit";
import type { Session } from "@/server/types";

process.env.ENCRYPTION_KEY = randomBytes(32).toString("base64");

let session: Session | null = null;

vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));
vi.mock("@/lib/auth", () => ({
  getSession: async () => session,
  requireSession: async () => session,
}));

const { addLlmKey, listKeyModels, rotateLlmKey } = await import("./users");
const { encryptSecret, decryptSecret } = await import("@/lib/crypto");

let db: Db;

interface Sent {
  url: string;
  headers: Record<string, string>;
  redirect: RequestRedirect | undefined;
}
let sent: Sent[] = [];

/** Replaces `fetch`: records the request and answers with `status` and `body`. */
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
  // The buckets are process-wide; every case starts with a full allowance.
  limiter.reset();
  providerAnswers(200);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Stand-in keys, put together at run time: nothing key-shaped is written out in this file. */
const tail = () => `${nanoid(24)}${nanoid(24)}`.replace(/[^A-Za-z0-9]/g, "x");
/** A key as this provider issues them: its own prefix when it has one, a bare run of characters when it has none. */
const keyOf = (id: CatalogueId) => `${CATALOGUE[id].keyPrefixes[0] ?? ""}${tail()}`;

async function signedInUser(): Promise<string> {
  const userId = `did:privy:${nanoid(8)}`;
  await db.insert(schema.users).values({ id: userId, handle: `u${nanoid(8).toLowerCase().replace(/[^a-z0-9]/g, "x")}`, displayName: null });
  session = { userId, handle: "owner", displayName: null, avatarUrl: null, email: null };
  return userId;
}

const keysOf = (userId: string) => db.select().from(schema.llmKeys).where(eq(schema.llmKeys.userId, userId));

/** A saved key row, as an add would have left it, without asking anyone. */
async function savedKey(userId: string, provider: string, key: string): Promise<string> {
  const id = `key_${nanoid(10)}`;
  await db.insert(schema.llmKeys).values({ id, userId, provider: provider as LlmProvider, encryptedKey: encryptSecret(key), last4: key.slice(-4) });
  return id;
}

/** Every origin a provider's key is allowed to be sent to: its own, and the Hub for Hugging Face. */
const allowed = (id: CatalogueId) => [CATALOGUE[id].origin, CATALOGUE[id].keyCheckOrigin].filter(Boolean);

/** How a key arrives when it was copied from a shell profile, a `.env` file or a config file instead of the provider's page. */
const WRAPPINGS: readonly ((key: string) => string)[] = [
  (key) => `"${key}"`,
  (key) => `'${key}'`,
  (key) => `“${key}”`,
  (key) => `PROVIDER_API_KEY=${key}`,
  (key) => `api_key:"${key}"`,
  (key) => `export FOO="${key}"`,
  (key) => `Bearer ${key}`,
];
/** Wrapping no rule names: a flag, a header with no space, a commented line, markdown, a URL. A key that can be recognised inside is still found. */
const ODD_WRAPPINGS: readonly ((key: string) => string)[] = [
  (key) => `--api-key=${key}`,
  (key) => `x-api-key:${key}`,
  (key) => `PROVIDER-API-KEY=${key}`,
  (key) => `provider.api.key=${key}`,
  (key) => `$env:PROVIDER_API_KEY=${key}`,
  (key) => `#PROVIDER_API_KEY=${key}`,
  (key) => `**${key}**`,
  (key) => `|${key}|`,
  (key) => `https://example.test/v1/models?key=${key}`,
];
/** What no request header can carry, put in the middle of a key: a space, a line break, a non-breaking and a zero-width space, a curly quote, an accent. */
const UNSENDABLE = [" ", "\n", "\u00a0", "\u200b", "’", "é"];
const withInside = (key: string, odd: string) => `${key.slice(0, 20)}${odd}${key.slice(20)}`;

/** How a provider says "this key is not a key": a 401 for all of them but Google, which answers 400 with a reason. */
function refusalOf(id: CatalogueId): { status: number; body: unknown } {
  if (id === "google") return { status: 400, body: { error: { code: 400, message: "API key not valid.", details: [{ reason: "API_KEY_INVALID" }] } } };
  return { status: 401, body: { error: { message: "Incorrect API key provided" } } };
}

describe("adding a key", () => {
  it("sends Anthropic, OpenAI and OpenRouter exactly the requests it always sent", async () => {
    await signedInUser();

    const anthropic = keyOf("anthropic");
    expect((await addLlmKey({ provider: "anthropic", key: anthropic })).ok).toBe(true);
    expect(sent).toEqual([
      // Does this key need a workspace named on every request?
      {
        url: "https://api.anthropic.com/v1/models?limit=1",
        headers: { "x-api-key": anthropic, "anthropic-version": "2023-06-01", accept: "application/json" },
        redirect: "error",
      },
      // Is it a key?
      { url: "https://api.anthropic.com/v1/models?limit=1", headers: { "x-api-key": anthropic, "anthropic-version": "2023-06-01" }, redirect: "error" },
    ]);

    sent = [];
    const openai = keyOf("openai");
    expect((await addLlmKey({ provider: "openai", key: openai })).ok).toBe(true);
    expect(sent).toEqual([{ url: "https://api.openai.com/v1/models", headers: { authorization: `Bearer ${openai}` }, redirect: "error" }]);

    sent = [];
    const openrouter = keyOf("openrouter");
    expect((await addLlmKey({ provider: "openrouter", key: openrouter })).ok).toBe(true);
    expect(sent).toEqual([{ url: "https://openrouter.ai/api/v1/key", headers: { authorization: `Bearer ${openrouter}` }, redirect: "error" }]);
  });

  it("sends a key to its own provider's origin and to no other, for every provider that is switched on", async () => {
    for (const id of PROVIDER_IDS) {
      const userId = await signedInUser();
      sent = [];
      const key = keyOf(id);

      const result = await addLlmKey({ provider: id, key });

      expect(result.ok, id).toBe(true);
      expect(sent.length, id).toBeGreaterThan(0);
      for (const request of sent) {
        expect(allowed(id), `${id} → ${request.url}`).toContain(new URL(request.url).origin);
        expect(request.url, id).not.toContain(key);
        expect(request.redirect, id).toBe("error");
      }
      const [row] = await keysOf(userId);
      expect(row?.provider, id).toBe(id);
      expect(decryptSecret(row!.encryptedKey), id).toBe(key);
      expect(JSON.stringify(result), id).not.toContain(key);
    }
  });

  it("saves nothing when the provider says the key is not a key, and says which provider", async () => {
    for (const id of PROVIDER_IDS) {
      const userId = await signedInUser();
      const refusal = refusalOf(id);
      providerAnswers(refusal.status, refusal.body);

      expect(await addLlmKey({ provider: id, key: keyOf(id) }), id).toEqual({
        ok: false,
        error: `${CATALOGUE[id].label} rejected this key — check you copied all of it`,
      });
      expect(await keysOf(userId), id).toEqual([]);
    }
  });

  it("saves the key and says it could not be checked when the provider cannot be asked", async () => {
    for (const id of PROVIDER_IDS) {
      await signedInUser();
      providerAnswers(503, { error: { message: "overloaded" } });
      const result = await addLlmKey({ provider: id, key: keyOf(id) });
      expect(result.ok && result.data.unverified, id).toBe(true);
    }
  });

  /** The rule that keeps one provider's credential from being handed to another. */
  it("refuses a key that is another provider's before anything is sent anywhere", async () => {
    const userId = await signedInUser();
    for (const owner of CATALOGUE_IDS) {
      for (const prefix of CATALOGUE[owner].keyPrefixes) {
        for (const chosen of PROVIDER_IDS.filter((id) => id !== owner)) {
          limiter.reset();
          const result = await addLlmKey({ provider: chosen, key: `${prefix}${tail()}` });
          expect(result.ok, `${prefix} under ${chosen}`).toBe(false);
          expect(result.ok ? "" : result.error, `${prefix} under ${chosen}`).toContain(
            `That looks like ${CATALOGUE[owner].article} ${CATALOGUE[owner].label} key, not ${CATALOGUE[chosen].article} ${CATALOGUE[chosen].label} one`,
          );
        }
      }
    }
    expect(sent).toHaveLength(0);
    expect(await keysOf(userId)).toEqual([]);
  });

  /** Before this, `"sk-ant-…"` in quotes under OpenAI was nobody's key by its first character, and went to OpenAI. */
  it("refuses a key pasted with quotes or a NAME= around it before anything is sent, whoever's key is inside", async () => {
    const userId = await signedInUser();
    for (const chosen of PROVIDER_IDS) {
      for (const wrap of WRAPPINGS) {
        for (const key of [keyOf("anthropic"), keyOf(chosen), tail()]) {
          limiter.reset();
          expect(await addLlmKey({ provider: chosen, key: wrap(key) }), `${wrap("…")} under ${chosen}`).toEqual({ ok: false, error: KEY_WRAPPED });
        }
      }
    }
    expect(sent).toHaveLength(0);
    expect(await keysOf(userId)).toEqual([]);
  });

  /** `--api-key=sk-ant-…` under OpenAI has no quotes and no NAME= a rule knows, and used to go to OpenAI whole. */
  it("refuses a recognisable key with anything else in front of it, under every provider, before anything is sent", async () => {
    const userId = await signedInUser();
    for (const chosen of PROVIDER_IDS) {
      for (const wrap of ODD_WRAPPINGS) {
        for (const owner of ["anthropic", "openrouter"] as const) {
          limiter.reset();
          expect(await addLlmKey({ provider: chosen, key: wrap(keyOf(owner)) }), `${wrap("…")} ${owner} under ${chosen}`).toEqual({
            ok: false,
            error: KEY_WRAPPED,
          });
        }
      }
    }
    expect(sent).toHaveLength(0);
    expect(await keysOf(userId)).toEqual([]);
  });

  /** Saved "unverified", such a key failed every run: the request that carries it cannot be built. */
  it("refuses a key with a character no request header can carry, and asks nobody", async () => {
    const userId = await signedInUser();
    for (const id of PROVIDER_IDS) {
      for (const odd of UNSENDABLE) {
        limiter.reset();
        expect(await addLlmKey({ provider: id, key: withInside(keyOf(id), odd) }), `${id} ${JSON.stringify(odd)}`).toEqual({
          ok: false,
          error: KEY_UNSENDABLE,
        });
      }
    }
    expect(sent).toHaveLength(0);
    expect(await keysOf(userId)).toEqual([]);
  });

  it("still takes a key with whitespace around it, and saves it without", async () => {
    const userId = await signedInUser();
    const key = keyOf("openai");
    expect((await addLlmKey({ provider: "openai", key: `\u00a0 ${key}\r\n` })).ok).toBe(true);
    expect(sent).toEqual([{ url: "https://api.openai.com/v1/models", headers: { authorization: `Bearer ${key}` }, redirect: "error" }]);
    const [row] = await keysOf(userId);
    expect(decryptSecret(row!.encryptedKey)).toBe(key);
  });

  it("says the sentence the form says, for the pairs people actually mix up", async () => {
    await signedInUser();
    expect(await addLlmKey({ provider: "openai", key: keyOf("anthropic") })).toEqual({
      ok: false,
      error: "That looks like an Anthropic key, not an OpenAI one — choose Anthropic as the provider",
    });
    expect(await addLlmKey({ provider: "anthropic", key: keyOf("openrouter") })).toEqual({
      ok: false,
      error: "That looks like an OpenRouter key, not an Anthropic one — choose OpenRouter as the provider",
    });
    const groq = await addLlmKey({ provider: "openai", key: keyOf("groq") });
    expect(groq.ok ? "" : groq.error).toContain("That looks like a Groq key, not an OpenAI one");
    expect(sent).toHaveLength(0);
  });

  it("refuses a provider that is not one, whatever the caller sends, and asks nobody", async () => {
    const userId = await signedInUser();
    for (const provider of ["cohere", "constructor", "__proto__", "toString", "", "Anthropic", "anthropic ", null, 7, {}, ["openai"]]) {
      limiter.reset();
      expect(await addLlmKey({ provider: provider as never, key: tail() }), JSON.stringify(provider)).toEqual({ ok: false, error: "Unknown provider" });
    }
    expect(sent).toHaveLength(0);
    expect(await keysOf(userId)).toEqual([]);
  });
});

describe("replacing a key", () => {
  it("checks the new secret with the provider of the saved row, and nobody else", async () => {
    for (const id of PROVIDER_IDS) {
      const userId = await signedInUser();
      const keyId = await savedKey(userId, id, keyOf(id));
      const next = keyOf(id);

      const result = await rotateLlmKey({ id: keyId, key: next });

      expect(result.ok, id).toBe(true);
      expect(sent.length, id).toBeGreaterThan(0);
      for (const request of sent) expect(allowed(id), `${id} → ${request.url}`).toContain(new URL(request.url).origin);
      const [row] = await keysOf(userId);
      expect(decryptSecret(row!.encryptedKey), id).toBe(next);
      sent = [];
    }
  });

  it("refuses another provider's key before anything is sent, and keeps the old secret", async () => {
    const userId = await signedInUser();
    const old = keyOf("anthropic");
    const keyId = await savedKey(userId, "anthropic", old);

    expect(await rotateLlmKey({ id: keyId, key: keyOf("openai") })).toEqual({
      ok: false,
      error: "That looks like an OpenAI key; this is an Anthropic key — add it as a new key instead",
    });
    const groq = await rotateLlmKey({ id: keyId, key: keyOf("groq") });
    expect(groq.ok ? "" : groq.error).toContain("That looks like a Groq key; this is an Anthropic key");

    expect(sent).toHaveLength(0);
    const [row] = await keysOf(userId);
    expect(decryptSecret(row!.encryptedKey)).toBe(old);
  });

  it("refuses a wrapped key, and one no header can carry, before anything is sent, and keeps the old secret", async () => {
    const userId = await signedInUser();
    const old = keyOf("openai");
    const keyId = await savedKey(userId, "openai", old);

    for (const wrap of WRAPPINGS) {
      for (const key of [keyOf("anthropic"), keyOf("openai"), tail()]) {
        limiter.reset();
        expect(await rotateLlmKey({ id: keyId, key: wrap(key) }), wrap("…")).toEqual({ ok: false, error: KEY_WRAPPED });
      }
    }
    for (const wrap of ODD_WRAPPINGS) {
      limiter.reset();
      expect(await rotateLlmKey({ id: keyId, key: wrap(keyOf("anthropic")) }), wrap("…")).toEqual({ ok: false, error: KEY_WRAPPED });
    }
    for (const odd of UNSENDABLE) {
      limiter.reset();
      expect(await rotateLlmKey({ id: keyId, key: withInside(keyOf("openai"), odd) }), JSON.stringify(odd)).toEqual({
        ok: false,
        error: KEY_UNSENDABLE,
      });
    }

    expect(sent).toHaveLength(0);
    const [row] = await keysOf(userId);
    expect(decryptSecret(row!.encryptedKey)).toBe(old);
  });

  /** The column is plain text now. A row whose provider has been dropped is refused in words, not sent somewhere. */
  it("refuses a saved key whose provider is no longer one, with a sentence, and asks nobody", async () => {
    const userId = await signedInUser();
    const old = tail();
    const keyId = await savedKey(userId, "cohere", old);

    expect(await rotateLlmKey({ id: keyId, key: tail() })).toEqual({ ok: false, error: PROVIDER_UNSUPPORTED });
    expect(await listKeyModels(keyId)).toEqual({ ok: false, error: PROVIDER_UNSUPPORTED });

    expect(sent).toHaveLength(0);
    const [row] = await keysOf(userId);
    expect(decryptSecret(row!.encryptedKey)).toBe(old);
  });
});

describe("listing a key's models", () => {
  it("asks Anthropic and OpenAI exactly as before", async () => {
    const userId = await signedInUser();

    const anthropic = keyOf("anthropic");
    providerAnswers(200, { data: [{ id: "claude-sonnet-5-5", display_name: "Claude Sonnet 5.5" }], has_more: false });
    expect(await listKeyModels(await savedKey(userId, "anthropic", anthropic))).toEqual({
      ok: true,
      data: { provider: "anthropic", models: [{ id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5", inputPerMTok: 2, outputPerMTok: 10 }] },
    });
    expect(sent).toEqual([
      { url: "https://api.anthropic.com/v1/models?limit=1000", headers: { "x-api-key": anthropic, "anthropic-version": "2023-06-01" }, redirect: "error" },
    ]);

    sent = [];
    const openai = keyOf("openai");
    providerAnswers(200, { data: [{ id: "gpt-6.1-sol", created: 2 }, { id: "whisper-1", created: 1 }] });
    expect(await listKeyModels(await savedKey(userId, "openai", openai))).toEqual({
      ok: true,
      data: { provider: "openai", models: [{ id: "gpt-6.1-sol", label: "GPT-6.1 Sol", inputPerMTok: 2, outputPerMTok: 10 }] },
    });
    expect(sent).toEqual([{ url: "https://api.openai.com/v1/models", headers: { authorization: `Bearer ${openai}` }, redirect: "error" }]);
  });

  /** Before the registry, any key that was not OpenAI's was sent to Anthropic from here. */
  it("sends a key nowhere for a provider that is not asked by key", async () => {
    const userId = await signedInUser();
    for (const id of PROVIDER_IDS.filter((id) => CATALOGUE[id].modelList !== "by-key")) {
      const result = await listKeyModels(await savedKey(userId, id, keyOf(id)));
      expect(result, id).toEqual({ ok: false, error: `${CATALOGUE[id].label}'s list does not depend on the key` });
    }
    expect(sent).toHaveLength(0);
  });

  it("asks each provider that is asked by key on its own origin, and nowhere else", async () => {
    for (const id of PROVIDER_IDS.filter((id) => CATALOGUE[id].modelList === "by-key")) {
      const userId = await signedInUser();
      sent = [];
      await listKeyModels(await savedKey(userId, id, keyOf(id)));
      expect(sent.length, id).toBeGreaterThan(0);
      for (const request of sent) expect(new URL(request.url).origin, id).toBe(CATALOGUE[id].origin);
    }
  });

  /** A name is the provider's own text. A key with no shape can only be found by the code that holds it. */
  it("takes the key out of a name the provider wrote, before it reaches the browser or the cache", async () => {
    const userId = await signedInUser();
    // No prefix, no shape: nothing a pattern could recognise.
    const key = tail();
    const keyId = await savedKey(userId, "openai", key);
    providerAnswers(200, { data: [{ id: "gpt-5", created: 2 }, { id: `ft:gpt-5:${key}`, created: 1 }] });

    const first = await listKeyModels(keyId);
    const cached = await listKeyModels(keyId);

    for (const result of [first, cached]) {
      expect(result.ok).toBe(true);
      expect(JSON.stringify(result)).not.toContain(key);
      expect(result.ok && result.data.models.map((model) => model.id)).toEqual(["gpt-5"]);
    }
    expect(sent).toHaveLength(1);
  });
});
