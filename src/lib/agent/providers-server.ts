/**
 * How a provider's model is built from its owner's key, and what a run sends with it.
 *
 * `providers.ts` is the list: who the providers are, where a key may go, what a run may
 * send. This file is the part of each row that cannot live there, because it loads the
 * provider's client and is handed a plaintext key: one builder per row, whether or not
 * the row is switched on yet.
 *
 * Three things hold for every builder, so that a key only ever reaches its own provider:
 *
 *  - The base URL is the registry's constant, passed every time. Several clients read
 *    one from the environment when none is given (`OPENAI_BASE_URL`,
 *    `ANTHROPIC_BASE_URL`), and a variable set on the deployment must not be able to
 *    move a user's key to another host.
 *  - Every request the client makes goes through {@link onlyTo}, which refuses any
 *    address off the provider's origin and does not follow a redirect: `fetch` drops
 *    `Authorization` when a redirect leaves the origin, but forwards `x-api-key` and
 *    `x-goog-api-key`.
 *  - The key is never empty. Handed none, most clients fall back to a key of the
 *    operator's from the environment, and the Vercel gateway's falls back to the
 *    deployment's own identity, so Tocker would pay for the run.
 *
 * Nothing here decrypts, logs, stores or returns a key. The run loop decrypts
 * (`resolveModel`) and hands the plaintext in.
 */
import "server-only";
import type { JSONValue, LanguageModel } from "ai";
import { REDACTED } from "@/lib/security/redact";
import { isModelId } from "./models";
import { CATALOGUE, CATALOGUE_IDS, PROVIDER_UNSUPPORTED, providerRow, requestTemperature, type CatalogueId } from "./providers";

/** What a model is built from. `workspaceId` is Anthropic's, and ignored by everyone else. */
export interface ModelKey {
  apiKey: string;
  modelId: string;
  workspaceId?: string | null;
}

/** Said when a saved key decrypts to nothing. No request is made with it. */
export const EMPTY_KEY = "The LLM API key attached to this agent is empty. Add the key again in Settings and re-select it on the agent.";

/** Said when what is stored as the agent's model could not be a model id. Nothing is sent. */
export const NOT_A_MODEL = "This agent's model is not a model id a provider can be sent. Choose its model again in the agent's settings.";

/**
 * A `fetch` that only talks to one origin.
 *
 * Given to every client below. The base URL already pins the host; this is the check at
 * the moment of sending, where it cannot be argued with: whatever built the address, a
 * request carrying the key leaves for the provider's own origin or does not leave. A
 * redirect is an error for the same reason. The global `fetch` is read at call time, so
 * a test that swaps it sees the request.
 */
function onlyTo(origin: string): typeof fetch {
  return async (input, init) => {
    const address = input instanceof Request ? input.url : String(input);
    let target: string | null = null;
    try {
      target = new URL(address).origin;
    } catch {
      target = null;
    }
    // The address is not repeated: it is whatever was about to be sent somewhere wrong.
    if (target !== origin) throw new Error(`A request for ${new URL(origin).host} was about to go to another address, so it was not sent.`);
    return globalThis.fetch(input, { ...init, redirect: "error" });
  };
}

/**
 * On a Vercel deployment the gateway's client adds that deployment's own ids to every
 * request it makes (`ai-o11y-deployment-id`, `-project-id`, `-environment`, `-region`,
 * `-request-id`, read from the environment). The request is made with the owner's key
 * and lands in the owner's Vercel account; which deployment Tocker runs on is no part of
 * it. They are taken off, which is also what the client sends anywhere but on Vercel.
 */
function withoutDeploymentIds(send: typeof fetch): typeof fetch {
  return (input, init) => {
    const headers = new Headers(init?.headers);
    for (const name of [...headers.keys()]) if (name.startsWith("ai-o11y-")) headers.delete(name);
    return send(input, { ...init, headers });
  };
}

/** What every builder is handed: the key, the registry's base URL, and the guarded fetch. */
interface Wiring {
  apiKey: string;
  baseURL: string;
  fetch: typeof fetch;
}

type Build = (modelId: string, wiring: Wiring, workspaceId: string | null) => Promise<LanguageModel>;

/**
 * Hosts with no client of their own: they serve OpenAI's chat-completions format, and
 * the generic client is pointed at them under their own name. The name is also the key
 * their provider options are read from (`callOptionsFor`).
 */
const compatible =
  (name: CatalogueId): Build =>
  async (modelId, wiring) => {
    const { createOpenAICompatible } = await import("@ai-sdk/openai-compatible");
    return createOpenAICompatible({ name, ...wiring })(modelId);
  };

/**
 * One builder per row of the catalogue. The type makes a row without one a compile
 * error; there is no fallback entry, so a provider this file does not know is never
 * built as some other provider.
 *
 * Each import is dynamic, as the three were before: a run loads the one client it uses.
 */
const BUILD: { readonly [Id in CatalogueId]: Build } = {
  anthropic: async (modelId, wiring, workspaceId) => {
    const { createAnthropic } = await import("@ai-sdk/anthropic");
    // An organization-level key must name the workspace it acts in; a key created
    // inside a workspace must not (Anthropic rejects the header on those).
    const headers = workspaceId ? { "anthropic-workspace-id": workspaceId } : undefined;
    return createAnthropic({ ...wiring, ...(headers ? { headers } : {}) })(modelId);
  },
  openai: async (modelId, wiring) => {
    const { createOpenAI } = await import("@ai-sdk/openai");
    return createOpenAI(wiring)(modelId);
  },
  openrouter: async (modelId, wiring) => {
    const { createOpenRouter } = await import("@openrouter/ai-sdk-provider");
    return createOpenRouter(wiring)(modelId);
  },
  google: async (modelId, wiring) => {
    const { createGoogle } = await import("@ai-sdk/google");
    // The plain call is generateContent, where the client carries Gemini's thought
    // signatures from one step to the next. Not `.interactions()`.
    return createGoogle(wiring)(modelId);
  },
  xai: async (modelId, wiring) => {
    const { createXai } = await import("@ai-sdk/xai");
    // The plain call is the Responses API, the one xAI lists for its current models.
    // `.chat()` is the form xAI calls legacy.
    return createXai(wiring)(modelId);
  },
  deepseek: async (modelId, wiring) => {
    const { createDeepSeek } = await import("@ai-sdk/deepseek");
    return createDeepSeek(wiring)(modelId);
  },
  mistral: async (modelId, wiring) => {
    const { createMistral } = await import("@ai-sdk/mistral");
    return createMistral(wiring)(modelId);
  },
  moonshot: async (modelId, wiring) => {
    const { createMoonshotAI } = await import("@ai-sdk/moonshotai");
    return createMoonshotAI(wiring)(modelId);
  },
  zai: async (modelId, wiring) => {
    const { createZai } = await import("@ai-sdk/zai");
    return createZai(wiring)(modelId);
  },
  groq: async (modelId, wiring) => {
    const { createGroq } = await import("@ai-sdk/groq");
    return createGroq(wiring)(modelId);
  },
  cerebras: async (modelId, wiring) => {
    const { createCerebras } = await import("@ai-sdk/cerebras");
    return createCerebras(wiring)(modelId);
  },
  together: async (modelId, wiring) => {
    const { createTogetherAI } = await import("@ai-sdk/togetherai");
    return createTogetherAI(wiring)(modelId);
  },
  fireworks: async (modelId, wiring) => {
    const { createFireworks } = await import("@ai-sdk/fireworks");
    return createFireworks(wiring)(modelId);
  },
  deepinfra: async (modelId, wiring) => {
    const { createDeepInfra } = await import("@ai-sdk/deepinfra");
    return createDeepInfra(wiring)(modelId);
  },
  vercel: async (modelId, wiring) => {
    // The gateway's client ships inside `ai`; it is not a package of its own here.
    const { createGateway } = await import("ai");
    return createGateway({ ...wiring, fetch: withoutDeploymentIds(wiring.fetch) })(modelId);
  },
  venice: compatible("venice"),
  nebius: compatible("nebius"),
  novita: compatible("novita"),
  // Not `@ai-sdk/huggingface`: that client speaks Hugging Face's Responses API and drops
  // tool calls and tool results on the way out, so a second step never sees the first.
  huggingface: compatible("huggingface"),
};

// Looked up through a map built from the registry's own list, never by indexing the
// object with a string from a stored row: "constructor" is not a provider.
const BUILDERS: ReadonlyMap<string, Build> = new Map(CATALOGUE_IDS.map((id) => [id, BUILD[id]]));

/**
 * The model for one provider's key.
 *
 * Refused, before any client is loaded or anything is sent: a provider with no row, an
 * empty key, and a model id that could not be one (Google's API takes the id in the
 * request path, and a run falls back to the config as stored when it no longer parses).
 *
 * Any row of the catalogue can be built, switched on or not. Whether a saved key's
 * provider may still be used is the caller's question (`isProvider`).
 */
export async function modelFor(provider: CatalogueId, { apiKey, modelId, workspaceId }: ModelKey): Promise<LanguageModel> {
  const build = BUILDERS.get(provider);
  if (!build) throw new Error(PROVIDER_UNSUPPORTED);
  if (typeof apiKey !== "string" || apiKey.trim().length === 0) throw new Error(EMPTY_KEY);
  if (typeof modelId !== "string" || !isModelId(modelId)) throw new Error(NOT_A_MODEL);
  const row = providerRow(provider);
  return build(modelId, { apiKey, baseURL: row.baseUrl, fetch: onlyTo(row.origin) }, workspaceId ?? null);
}

/** What a run passes to `generateText` beside the prompt and the tools, for one provider. */
export interface ModelCallOptions {
  temperature?: number;
  maxOutputTokens?: number;
  providerOptions?: Record<string, Record<string, JSONValue>>;
}

/**
 * What a key agent's run sends with every step, for the provider its key is from.
 *
 *  - The temperature by the registry's rule: as set, capped, or not at all. A key that
 *    is absent here is a parameter that is not sent.
 *  - An output limit only where the registry sets one.
 *  - Provider options for the two providers that need one, and no one else. Options are
 *    keyed by provider, but a client is free to read another's key: the Vercel gateway
 *    forwards them all, so an option meant for Anthropic is not sent anywhere else.
 */
export function callOptionsFor(provider: CatalogueId, config: { llm: { temperature: number; model: string } }): ModelCallOptions {
  const row = providerRow(provider);
  const options: ModelCallOptions = {};

  const temperature = requestTemperature(provider, config.llm.temperature, config.llm.model);
  if (temperature !== undefined) options.temperature = temperature;
  if (row.maxOutputTokens !== undefined) options.maxOutputTokens = row.maxOutputTokens;

  if (provider === "anthropic") {
    // Anthropic prompt caching, automatic mode: a top-level `cache_control` asks the
    // API to cache the whole prefix on every step, so a 20-step tick re-reads its
    // tools, system prompt and growing transcript at a tenth of the input price
    // instead of paying full price for them twenty times. A 113k-input-token run
    // measured before this was mostly that repetition.
    options.providerOptions = { anthropic: { cacheControl: { type: "ephemeral" } } };
  }
  if (provider === "venice") {
    // Venice puts its own system prompt in front of the agent's unless told not to.
    // The generic client copies what is under the provider's name into the request body.
    options.providerOptions = { venice: { venice_parameters: { include_venice_system_prompt: false } } };
  }
  return options;
}

/** Takes one key out of a piece of text. */
export type KeyScrub = (text: string) => string;

/** For a run that has no key: the scripted model, and pay-per-use. */
export const noScrub: KeyScrub = (text) => text;

/** The fewest characters of a key's own that are looked for as a piece of it. */
const PIECE = 8;

/** What a key is written in, with the asterisk a provider masks one with: the same characters the `sk-` rule in `redact.ts` takes. */
const KEY_CHARS = /[A-Za-z0-9_*-]/;

/** How much of the key's start is a prefix every key of its provider has, and so says nothing about this one. */
function sharedStart(key: string): number {
  let length = 0;
  for (const id of CATALOGUE_IDS) {
    for (const prefix of CATALOGUE[id].keyPrefixes) if (key.startsWith(prefix)) length = Math.max(length, prefix.length);
  }
  return length;
}

/**
 * A function that removes this exact key from text, closed over the plaintext.
 *
 * `redactSecrets` finds a credential by its shape, and most of the newer providers' keys
 * have none: a run of letters and digits with no prefix. A provider that repeats such a
 * key in its refusal would have it stored on the run and sent in a notification. The one
 * place that can still find it is the place that holds it, so the run asks for this when
 * it builds the model and applies it to whatever went wrong, before `redactSecrets`.
 *
 * Removed: the key as it is, as a URL would write it, and as JSON would. Also a
 * half-masked echo of it, which is how a refusal usually repeats a key: its first or
 * last characters, with whatever run of key-like characters they are part of. A piece
 * shorter than {@link PIECE} characters of the key's own is left alone; the last four
 * are shown to the owner on purpose.
 *
 * Text that carries no part of the key comes back untouched.
 */
export function keyScrubber(apiKey: string): KeyScrub {
  const key = typeof apiKey === "string" ? apiKey.trim() : "";
  if (key.length === 0) return noScrub;
  // The same key as an address or a JSON string spells it, where that differs.
  const written = [...new Set([encodeURIComponent(key), JSON.stringify(key).slice(1, -1)])]
    .filter((form) => form !== key)
    .sort((a, b) => b.length - a.length);

  const start = sharedStart(key) + PIECE;
  // Only for a key long enough that its two ends are different text.
  const ends = key.length >= start + PIECE ? { head: key.slice(0, start), tail: key.slice(-PIECE) } : null;
  // A key's own punctuation ("AQ." has a dot) counts as part of the run it sits in.
  // Never a space: a run that could cross one would take the sentence with it.
  const own = new Set([...key].filter((char) => !/\s/.test(char)));
  const inKey = (char: string | undefined) => char !== undefined && (KEY_CHARS.test(char) || own.has(char));

  /** Removes every run of key-like characters that has `piece` in it. */
  const withoutRunsOf = (text: string, piece: string): string => {
    let out = text;
    for (let at = out.indexOf(piece); at !== -1; ) {
      let from = at;
      let to = at + piece.length;
      while (from > 0 && inKey(out[from - 1])) from--;
      while (inKey(out[to])) to++;
      out = out.slice(0, from) + REDACTED + out.slice(to);
      at = out.indexOf(piece, from + REDACTED.length);
    }
    return out;
  };

  return (text) => {
    if (typeof text !== "string" || text.length === 0) return text;
    // By the run it sits in, as `redactSecrets` takes a key it knows: what is left reads
    // the same whichever of the two found it.
    let out = withoutRunsOf(text, key);
    for (const form of written) if (out.includes(form)) out = out.split(form).join(REDACTED);
    if (!ends) return out;
    // The mask and the other end of the key are part of the same run, so they go with it.
    return withoutRunsOf(withoutRunsOf(out, ends.head), ends.tail);
  };
}
