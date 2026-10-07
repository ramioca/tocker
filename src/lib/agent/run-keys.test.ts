/**
 * The run loop and the key it thinks on.
 *
 * What only the run loop can get wrong: using a key that is not the agent owner's,
 * sending a key to a provider other than the one it was saved for, and keeping what a
 * provider said when it refused one. A provider's 401 echoes the key (half masked, or
 * whole), and that sentence becomes the run's error, a transcript step and a
 * notification. This fails real runs on refused keys and looks for the key in all three.
 *
 * It also pins what a key agent's run hands the model call for the three providers the
 * app has always had, so that adding providers changes nothing for them.
 */
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { Db } from "@/db";
import * as schema from "@/db/schema";
import { encryptSecret } from "@/lib/crypto";
import { REDACTED, redactSecrets } from "@/lib/security/redact";
import { seedKnownTokens } from "@/lib/trading/tokens";
import { DEFAULT_AGENT_CONFIG } from "./config";
import { CATALOGUE, CATALOGUE_IDS, PROVIDER_IDS, PROVIDER_UNSUPPORTED, isProvider, type LlmProvider } from "./providers";
import { resolveModel, runAgent } from "./run";
import { seedAgent, setupTestDb } from "./test-support";

/** What each run handed `generateText`. The real function still runs. */
const asked = vi.hoisted(() => ({ options: [] as Array<Record<string, unknown>> }));

vi.mock("ai", async (importOriginal) => {
  const real = await importOriginal<typeof import("ai")>();
  return {
    ...real,
    generateText: ((options) => {
      asked.options.push(options as unknown as Record<string, unknown>);
      return real.generateText(options);
    }) as typeof real.generateText,
  };
});

let db: Db;
const before = { llm: process.env.LLM_MOCK, x402: process.env.X402_MOCK, key: process.env.ENCRYPTION_KEY };

beforeAll(async () => {
  process.env.X402_MOCK = "1";
  // The real provider path: the model is built from the stored key.
  process.env.LLM_MOCK = "0";
  process.env.ENCRYPTION_KEY = randomBytes(32).toString("base64");
  // The clients say on the console when they leave a parameter out. Expected here.
  (globalThis as { AI_SDK_LOG_WARNINGS?: boolean }).AI_SDK_LOG_WARNINGS = false;
  db = await setupTestDb();
  await seedKnownTokens();
}, 120_000);

afterAll(() => {
  delete (globalThis as { AI_SDK_LOG_WARNINGS?: boolean }).AI_SDK_LOG_WARNINGS;
  for (const [name, value] of [
    ["LLM_MOCK", before.llm],
    ["X402_MOCK", before.x402],
    ["ENCRYPTION_KEY", before.key],
  ] as const) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

beforeEach(() => {
  asked.options.length = 0;
});

/** Stand-ins put together at run time (see `repo-secrets.test.ts`). */
const plaintext = () => `sk-proj-${nanoid(40)}${nanoid(40)}`;
const masked = (key: string) => `${key.slice(0, 12)}${"*".repeat(40)}${key.slice(-4)}`;
/** A key with nothing to know it by: letters and digits, the way most of the newer providers issue them. */
const shapeless = () => `${nanoid(24)}${nanoid(24)}`.replace(/[^A-Za-z0-9]/g, "x");

async function attachKey(
  userId: string,
  agentId: string,
  key: string,
  provider: LlmProvider = "openai",
  model = "gpt-5",
  configProvider: LlmProvider = provider,
): Promise<string> {
  const id = `key_${nanoid(8)}`;
  await db.insert(schema.llmKeys).values({ id, userId, provider, encryptedKey: encryptSecret(key), last4: key.slice(-4) });
  await db
    .update(schema.agents)
    .set({ llmKeyId: id, config: { ...DEFAULT_AGENT_CONFIG, llm: { ...DEFAULT_AGENT_CONFIG.llm, provider: configProvider, model } } })
    .where(eq(schema.agents.id, agentId));
  return id;
}

interface Call {
  url: string;
  headers: Record<string, string>;
  body: string;
}

/**
 * Replaces `fetch` for one run. A request to a host in `refuse` is answered 401 with
 * that host's sentence; everything else (prices, feeds) gets an empty list. Returns
 * every request that was made.
 */
async function withFetch<T>(refuse: Record<string, string>, run: () => Promise<T>): Promise<{ value: T; calls: Call[] }> {
  const calls: Call[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, name) => {
      headers[name] = value;
    });
    calls.push({ url, headers, body: typeof init?.body === "string" ? init.body : "" });
    const host = new URL(url).host;
    if (host in refuse) {
      return new Response(JSON.stringify({ type: "error", error: { message: refuse[host], type: "invalid_request_error", param: null, code: "invalid_api_key" } }), {
        status: 401,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try {
    return { value: await run(), calls };
  } finally {
    globalThis.fetch = realFetch;
  }
}

async function everythingKept(runId: string, userId: string) {
  const [runs, steps, notices] = await Promise.all([
    db.select().from(schema.agentRuns).where(eq(schema.agentRuns.id, runId)),
    db.select().from(schema.agentRunSteps).where(eq(schema.agentRunSteps.runId, runId)),
    db.select().from(schema.notifications).where(eq(schema.notifications.userId, userId)),
  ]);
  return { runs, steps, notices };
}

describe("resolveModel", () => {
  it("builds the model from the owner's own key, and hands back the way to take that key out of text", async () => {
    const { userId, agentId } = await seedAgent(db);
    const key = plaintext();
    const llmKeyId = await attachKey(userId, agentId, key);
    // The agent is set to the provider its key is for, as every save now makes sure.
    const config = { ...DEFAULT_AGENT_CONFIG, llm: { ...DEFAULT_AGENT_CONFIG.llm, provider: "openai" as const, model: "gpt-5" } };
    const { model, provider, scrub } = await resolveModel({ ownerId: userId, llmKeyId, config });
    expect(typeof model === "string" ? model : model.modelId).toBe("gpt-5");
    expect(provider).toBe("openai");
    expect(scrub(`refused ${key} here`)).toBe(`refused ${REDACTED} here`);
  });

  /** Attaching a key checks whose it is. This is the same check at the moment of use. */
  it("will not think on a key that belongs to another account", async () => {
    const owner = await seedAgent(db);
    const llmKeyId = await attachKey(owner.userId, owner.agentId, plaintext());
    const other = await seedAgent(db);

    await expect(resolveModel({ ownerId: other.userId, llmKeyId, config: DEFAULT_AGENT_CONFIG })).rejects.toThrow(
      "The LLM API key attached to this agent no longer exists.",
    );
  });

  /**
   * The key decides the host and the settings decide the model id. When they name
   * different providers the key is never carried to the provider the settings name, and
   * the model id is never sent to a host it means nothing to: the run is refused with a
   * sentence, before anything is sent.
   */
  it("refuses a key for one provider on an agent set to another, and sends nothing", async () => {
    const { userId, agentId } = await seedAgent(db);
    const llmKeyId = await attachKey(userId, agentId, plaintext(), "openai", "gpt-5", "anthropic");
    const config = { ...DEFAULT_AGENT_CONFIG, llm: { ...DEFAULT_AGENT_CONFIG.llm, provider: "anthropic" as const, model: "gpt-5" } };
    let requests = 0;
    const real = globalThis.fetch;
    globalThis.fetch = (async () => {
      requests += 1;
      return new Response("{}", { status: 500 });
    }) as typeof fetch;
    try {
      await expect(resolveModel({ ownerId: userId, llmKeyId, config })).rejects.toThrow(
        "This agent's key is an OpenAI key, but its settings name Anthropic.",
      );
    } finally {
      globalThis.fetch = real;
    }
    expect(requests).toBe(0);
  });

  /** The column is plain text now. A provider that was dropped is still in old rows. */
  it("refuses a key whose provider has no row any more, before the key is decrypted", async () => {
    const { userId, agentId } = await seedAgent(db);
    const id = `key_${nanoid(8)}`;
    // Not a ciphertext: decrypting it would throw something else entirely.
    await db.insert(schema.llmKeys).values({ id, userId, provider: "retired-provider" as LlmProvider, encryptedKey: "not-a-real-ciphertext", last4: "0000" });
    await db.update(schema.agents).set({ llmKeyId: id }).where(eq(schema.agents.id, agentId));

    await expect(resolveModel({ ownerId: userId, llmKeyId: id, config: DEFAULT_AGENT_CONFIG })).rejects.toThrow(PROVIDER_UNSUPPORTED);
  });

  it("refuses a key for a provider that has a row but is not switched on", async () => {
    const off = CATALOGUE_IDS.find((id) => !isProvider(id));
    // Every provider is on: there is no such key to refuse.
    if (!off) return;
    const { userId, agentId } = await seedAgent(db);
    const id = `key_${nanoid(8)}`;
    await db.insert(schema.llmKeys).values({ id, userId, provider: off as LlmProvider, encryptedKey: encryptSecret(shapeless()), last4: "0000" });
    await db.update(schema.agents).set({ llmKeyId: id }).where(eq(schema.agents.id, agentId));

    const refused = await withFetch({}, () =>
      resolveModel({ ownerId: userId, llmKeyId: id, config: DEFAULT_AGENT_CONFIG }).then(
        () => null,
        (err: Error) => err.message,
      ),
    );
    expect(refused.value).toBe(PROVIDER_UNSUPPORTED);
    expect(refused.calls).toHaveLength(0);
  });
});

describe("a run the provider refuses", () => {
  it("stores, shows and notifies the reason without the key the provider echoed", async () => {
    const { userId, agentId } = await seedAgent(db);
    const key = plaintext();
    await attachKey(userId, agentId, key);

    const said = `Incorrect API key provided: ${masked(key)}. You can find your API key at https://platform.openai.com/account/api-keys.`;
    const { value: result } = await withFetch({ "api.openai.com": said }, () => runAgent({ agentId, trigger: "manual" }));

    expect(result.status).toBe("failed");
    // The sentence survives, so the owner knows what to fix. It is word for word what
    // was stored before a run took its own key out first.
    expect(result.error).toBe(redactSecrets(said));
    expect(result.error).toBe(`Incorrect API key provided: ${REDACTED}. You can find your API key at https://platform.openai.com/account/api-keys.`);

    const kept = await everythingKept(result.runId, userId);
    expect(kept.runs[0].status).toBe("failed");
    expect(kept.runs[0].error).toBe(result.error);
    expect(kept.notices.some((notice) => notice.kind === "run_failed")).toBe(true);

    const everything = JSON.stringify({ result, ...kept });
    for (const piece of [key, masked(key), key.slice(0, 12), key.slice(-12)]) {
      expect(everything).not.toContain(piece);
    }
  });

  /**
   * Most of the newer providers' keys are a run of letters and digits. Pattern redaction
   * cannot tell one from any other word, so only the run, which holds the key, can take
   * it out of what the provider said.
   */
  it("stores, shows and notifies the reason without a key that has no shape to recognise", async () => {
    const { userId, agentId } = await seedAgent(db);
    const key = shapeless();
    await attachKey(userId, agentId, key);

    const said = `The credential ${key} was not accepted. It was sent as ${key.slice(0, 10)}${"*".repeat(20)}${key.slice(-8)} and logged at /keys/${encodeURIComponent(key)}.`;
    // The reason this test exists: redaction by shape leaves every one of them in.
    expect(redactSecrets(said)).toBe(said);

    const { value: result, calls } = await withFetch({ "api.openai.com": said }, () => runAgent({ agentId, trigger: "manual" }));

    // The key did go to its provider, in its header: the refusal below is about a real request.
    expect(calls.some((call) => call.url.startsWith("https://api.openai.com/") && call.headers.authorization === `Bearer ${key}`)).toBe(true);

    expect(result.status).toBe("failed");
    expect(result.error).toBe(`The credential ${REDACTED} was not accepted. It was sent as ${REDACTED} and logged at /keys/${REDACTED}.`);

    const kept = await everythingKept(result.runId, userId);
    expect(kept.runs[0]).toMatchObject({ status: "failed", error: result.error });
    const failure = kept.steps.find((step) => step.kind === "error");
    expect(JSON.stringify(failure?.payload)).toContain(REDACTED);
    const notice = kept.notices.find((row) => row.kind === "run_failed");
    expect(notice?.body).toBe(result.error);

    const everything = JSON.stringify({ result, ...kept });
    for (const piece of [key, key.slice(0, 10), key.slice(-8), key.slice(8, 24)]) {
      expect(everything).not.toContain(piece);
    }
  });
});

/**
 * Every provider that is switched on, through a whole run: the key goes to that
 * provider's host and to no other, and a refusal that repeats it is kept without it.
 * The list is the registry's, so a provider switched on later is covered the same day.
 */
describe.each(PROVIDER_IDS)("a run on a %s key", (provider) => {
  it("sends the key to its own provider only, and keeps nothing of it when it is refused", async () => {
    const row = CATALOGUE[provider];
    const { userId, agentId } = await seedAgent(db);
    const key = `${row.keyPrefixes[0] ?? ""}${shapeless()}`;
    await attachKey(userId, agentId, key, provider, row.defaultModel);

    const host = new URL(row.origin).host;
    // Whole, and then the way a refusal usually shows it: the start, a mask, the end.
    const start = key.slice(0, (row.keyPrefixes[0]?.length ?? 0) + 10);
    const said = `Rejected ${key} (${start}${"*".repeat(12)}${key.slice(-8)})`;
    const { value: result, calls } = await withFetch({ [host]: said }, () => runAgent({ agentId, trigger: "manual" }));

    expect(result.status).toBe("failed");
    const carrying = calls.filter((call) => JSON.stringify(call).includes(key));
    // It was sent: this is a refusal of a real request, not a run that never called out.
    expect(carrying.length).toBeGreaterThan(0);
    for (const call of carrying) {
      expect(new URL(call.url).origin).toBe(row.origin);
      // In a header, never in the address or the body.
      expect(call.url).not.toContain(key);
      expect(call.body).not.toContain(key);
    }

    // The provider's client was handed the run's real tools, and every one of them is in
    // the request it wrote: none was dropped for a schema the client could not express.
    const offered = Object.keys(asked.options[0]?.tools as object);
    expect(offered).toContain("finish");
    expect(offered).toContain("query_data_source");
    const stepRequest = carrying.find((call) => call.body.includes('"finish"'));
    for (const name of offered) expect(stepRequest?.body, name).toContain(`"${name}"`);

    const kept = await everythingKept(result.runId, userId);
    const everything = JSON.stringify({ result, ...kept });
    for (const piece of [key, start, key.slice(-8)]) expect(everything).not.toContain(piece);
  });
});

describe("a key whose provider is no longer one", () => {
  it("fails the run with the sentence for it, and sends the key nowhere", async () => {
    const { userId, agentId } = await seedAgent(db);
    const key = shapeless();
    const id = `key_${nanoid(8)}`;
    await db.insert(schema.llmKeys).values({ id, userId, provider: "retired-provider" as LlmProvider, encryptedKey: encryptSecret(key), last4: key.slice(-4) });
    await db.update(schema.agents).set({ llmKeyId: id }).where(eq(schema.agents.id, agentId));

    const { value: result, calls } = await withFetch({}, () => runAgent({ agentId, trigger: "manual" }));

    // A run that failed and said why, not one that threw.
    expect(result).toMatchObject({ status: "failed", error: PROVIDER_UNSUPPORTED });
    const kept = await everythingKept(result.runId, userId);
    expect(kept.runs[0]).toMatchObject({ status: "failed", error: PROVIDER_UNSUPPORTED });
    expect(kept.notices.find((row) => row.kind === "run_failed")?.body).toBe(PROVIDER_UNSUPPORTED);

    // No model was called, and nothing that left carried the key.
    expect(asked.options).toHaveLength(0);
    expect(JSON.stringify(calls)).not.toContain(key);
    for (const provider of CATALOGUE_IDS) {
      expect(calls.some((call) => call.url.startsWith(CATALOGUE[provider].origin))).toBe(false);
    }
  });
});

/**
 * What `generateText` is given beside the prompt and the tools. On main every run was
 * given the same two things: the agent's temperature, and Anthropic's cache control
 * under Anthropic's name. Now a key agent's come from its key's provider. For the three
 * providers that existed, that is what it was, less the Anthropic option for the two
 * that are not Anthropic (their clients never read it).
 */
describe("what a run gives the model call", () => {
  const CACHE = { anthropic: { cacheControl: { type: "ephemeral" } } };
  /** Every option a key agent's run passed on main. */
  const ON_MAIN = ["abortSignal", "model", "onStepFinish", "prompt", "providerOptions", "stopWhen", "system", "temperature", "tools"];

  async function optionsOfRunOn(provider: LlmProvider, temperature: number): Promise<Record<string, unknown>> {
    const { userId, agentId } = await seedAgent(db);
    const key = `${CATALOGUE[provider].keyPrefixes[0] ?? ""}${shapeless()}`;
    await attachKey(userId, agentId, key, provider, CATALOGUE[provider].defaultModel);
    const [row] = await db.select().from(schema.agents).where(eq(schema.agents.id, agentId));
    await db
      .update(schema.agents)
      .set({ config: { ...row.config, llm: { ...row.config.llm, temperature } } })
      .where(eq(schema.agents.id, agentId));

    const host = new URL(CATALOGUE[provider].origin).host;
    const { value: result, calls } = await withFetch({ [host]: "Invalid API Key" }, () => runAgent({ agentId, trigger: "manual" }));
    expect(result.status).toBe("failed");
    // The key went to its own provider and to no other.
    for (const call of calls) {
      if (JSON.stringify(call.headers).includes(key)) expect(call.url.startsWith(`${CATALOGUE[provider].origin}/`)).toBe(true);
    }
    expect(asked.options).toHaveLength(1);
    return asked.options[0];
  }

  it("Anthropic: exactly what it was given on main", async () => {
    const options = await optionsOfRunOn("anthropic", 0.4);
    expect(Object.keys(options).sort()).toEqual(ON_MAIN);
    expect(options.temperature).toBe(0.4);
    expect(options.providerOptions).toEqual(CACHE);
    expect(options.abortSignal).toBeInstanceOf(AbortSignal);
    expect(options.stopWhen).toHaveLength(2);
  });

  it.each(["openai", "openrouter"] as const)("%s: what it was given on main, without the option that was Anthropic's", async (provider) => {
    const options = await optionsOfRunOn(provider, 0.9);
    expect(Object.keys(options).sort()).toEqual(ON_MAIN.filter((name) => name !== "providerOptions"));
    expect(options.temperature).toBe(0.9);
    expect(options.abortSignal).toBeInstanceOf(AbortSignal);
    expect(options.stopWhen).toHaveLength(2);
  });

  /** The same branch serves pay-per-use: a run with no key is given what it always was. */
  it("a run that thinks on no key: exactly what it was given on main", async () => {
    const { agentId } = await seedAgent(db);
    process.env.LLM_MOCK = "1";
    try {
      const { value: result } = await withFetch({}, () => runAgent({ agentId, trigger: "manual" }));
      expect(result.status).toBe("succeeded");
    } finally {
      process.env.LLM_MOCK = "0";
    }
    expect(asked.options).toHaveLength(1);
    const [options] = asked.options;
    expect(Object.keys(options).sort()).toEqual(ON_MAIN);
    expect(options.temperature).toBe(DEFAULT_AGENT_CONFIG.llm.temperature);
    expect(options.providerOptions).toEqual(CACHE);
  });
});
