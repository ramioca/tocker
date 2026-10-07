/**
 * How each provider is asked about a key, and how it is asked for its models.
 *
 * `providers.ts` is the list: who the providers are and the one host each one's key may
 * be sent to. This file is the part of each row that makes a request by hand: the free
 * call that says whether a key is a key, and the call that lists the models an agent
 * could think on. One entry per row, all nineteen, whether or not the row is switched on.
 *
 * Every request made here goes through {@link providerFetch}, and that is the point of
 * the file. It builds the address from the row's own origin and a path written below,
 * checks the result is still on that origin, does not follow a redirect (`fetch` drops
 * `Authorization` when a redirect leaves the origin, but forwards `x-api-key` and
 * `x-goog-api-key`), and gives up after a few seconds. There is no address in here that
 * came from a form, a stored row or a provider's answer.
 *
 * A key is sent only by the two functions that are handed one, `checkKey` and
 * `listModels`, and only to the provider it was saved under. Both refuse, before any
 * request, a key that starts the way another provider's keys do. The public lists are
 * read with no key at all. Nothing here decrypts, logs, stores or returns a key, and
 * what a provider wrote (a model's name) has the key taken out of it before it is
 * handed back.
 */
import "server-only";
import { redactSecrets } from "@/lib/security/redact";
import { featuredFirst, isModelId, knownModel } from "./models";
import { CATALOGUE, CATALOGUE_IDS, PROVIDER_UNSUPPORTED, keyProblem, type CatalogueId, type ModelOption, type ProviderRow } from "./providers";
import { keyScrubber } from "./providers-server";

// Looked up through maps, never by indexing an object with a string from outside.
const ROWS: ReadonlyMap<string, ProviderRow> = new Map(CATALOGUE_IDS.map((id) => [id, CATALOGUE[id]]));

// ---------- the guarded fetch ----------

/**
 * Which of a row's hosts a request is for. `api` is the provider's origin, where a run
 * goes. `key-check` exists for Hugging Face alone: its router does not say whether a
 * token is good, and the call that does lives on the Hub, the site that issued the token.
 */
export type FetchTarget = "api" | "key-check";

const CHECK_TIMEOUT_MS = 5_000;
const LIST_TIMEOUT_MS = 8_000;

/**
 * Pure: the address of one request to a provider, or a thrown refusal.
 *
 * The origin is the registry's constant and the path is one written in this file, so the
 * checks here should never fire. They are made anyway, at the last moment before a key
 * is attached to the request: whatever built the path, the address is on the provider's
 * own https origin or there is no request.
 */
export function providerUrl(provider: CatalogueId, path: string, target: FetchTarget = "api"): URL {
  const row = ROWS.get(provider);
  if (!row) throw new Error(PROVIDER_UNSUPPORTED);
  const origin = target === "key-check" ? row.keyCheckOrigin : row.origin;
  // The message names the provider and nothing else: not the path, not a header.
  const refused = () => new Error(`Refused a request that is not to ${row.label}'s own host`);
  if (!origin) throw refused();

  let base: URL;
  try {
    base = new URL(origin);
  } catch {
    throw refused();
  }
  // An origin and nothing else: https, no credentials, no path.
  if (base.protocol !== "https:" || base.origin !== origin || base.username || base.password) throw refused();

  // "//host" and "/\host" both name another host, and so does a whole address.
  if (typeof path !== "string" || !path.startsWith("/") || path.startsWith("//") || /[\\\s]/.test(path)) throw refused();
  let url: URL;
  try {
    url = new URL(path, origin);
  } catch {
    throw refused();
  }
  // Nothing above lets another host through. Asked once more of the finished address,
  // because this is the line a key's safety rests on.
  if (url.origin !== origin || url.username || url.password) throw refused();
  return url;
}

/**
 * The one way this file, the key check and the workspace lookup reach a provider.
 *
 * A GET to `path` on the provider's own origin. A redirect is an error rather than
 * followed, the answer is never cached, and the request is dropped after `timeoutMs`.
 * Throws when the address is refused, the provider cannot be reached or it redirects;
 * every caller turns that into "could not tell".
 */
export async function providerFetch(
  provider: CatalogueId,
  path: string,
  options: { headers?: Record<string, string>; timeoutMs?: number; target?: FetchTarget } = {},
): Promise<Response> {
  const url = providerUrl(provider, path, options.target);
  const res = await fetch(url.href, {
    headers: options.headers ?? {},
    redirect: "error",
    signal: AbortSignal.timeout(options.timeoutMs ?? LIST_TIMEOUT_MS),
    cache: "no-store",
  });
  // `redirect: "error"` already refuses one. This is for a `fetch` that did not honour it.
  if (res.redirected) throw new Error(`${ROWS.get(provider)?.label ?? provider} redirected the request`);
  return res;
}

/** The body as JSON, or null when it is not JSON or is larger than anything a list should be. */
async function jsonOf(res: Response, maxChars: number): Promise<unknown> {
  try {
    const text = await res.text();
    if (text.length > maxChars) return null;
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

// ---------- taking a key back out of text ----------

/**
 * Makes text a provider wrote safe to return or log: this exact key is taken out first,
 * then anything shaped like a credential. The order matters and so does the first step.
 * Most of the newer providers' keys are a plain run of letters and digits that no
 * pattern could tell from any other word, so only the code holding the key can find it.
 */
export function withoutKey(key: string): (text: string) => string {
  const scrub = keyScrubber(key);
  return (value) => (typeof value === "string" ? redactSecrets(scrub(value)) : value);
}

// ---------- how a key is presented ----------

/** The three ways the providers take a key. Never in the address: a URL ends up in logs. */
type KeyAuth = "bearer" | "anthropic" | "google";

const ANTHROPIC_VERSION = "2023-06-01";

function authHeaders(auth: KeyAuth, key: string, workspaceId: string | null): Record<string, string> {
  switch (auth) {
    case "bearer":
      return { authorization: `Bearer ${key}` };
    case "google":
      return { "x-goog-api-key": key };
    case "anthropic":
      // With the workspace when the key is organization-level and one is known.
      return {
        "x-api-key": key,
        "anthropic-version": ANTHROPIC_VERSION,
        ...(workspaceId ? { "anthropic-workspace-id": workspaceId } : {}),
      };
  }
}

// ---------- what an answer says about the key ----------

export type KeyProbe = "ok" | "rejected" | "unreachable";

/**
 * Pure: what a probe's response means for the key.
 *
 * Only 401 is a verdict on the key itself. A 403 is not: OpenAI answers 403 to a
 * request from an unsupported region and Anthropic to a real key without a permission,
 * and refusing every key because of where Tocker runs would lock everyone out. OpenAI
 * also answers 401 to a real restricted key that lacks the scope to list models; that
 * key authenticated, so it is not a typo.
 */
export function probeOutcome(status: number, errorMessage = ""): KeyProbe {
  if (status >= 200 && status < 300) return "ok";
  if (status === 401) {
    return /insufficient permissions|missing scopes?/i.test(errorMessage) ? "ok" : "rejected";
  }
  return "unreachable";
}

type Json = Record<string, unknown>;

function record(value: unknown): Json | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Json) : null;
}

function items(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** The objects in what should be an array of them; anything else in it is skipped. */
function records(value: unknown): Json[] {
  const found: Json[] = [];
  for (const item of items(value)) {
    const one = record(item);
    if (one) found.push(one);
  }
  return found;
}

/**
 * The sentence in a refusal, wherever the provider put it: OpenAI's `error.message`,
 * xAI's flat `error`, Cerebras's and Novita's `message`, Mistral's and Nebius's `detail`.
 */
function saidIn(body: unknown): string {
  const top = record(body);
  if (!top) return "";
  const error = record(top.error);
  for (const candidate of [error?.message, top.error, top.message, top.detail]) {
    if (typeof candidate === "string") return candidate;
  }
  return "";
}

/** The rule every provider but two follows: 401 means the key is not a key. */
function byStatus(status: number, body: unknown): KeyProbe {
  return probeOutcome(status, saidIn(body));
}

/**
 * Google answers a key it does not know with 400, and says which 400 it is in
 * `details[].reason`. Its 401 and 403 are about something else (the kind of credential,
 * an API not switched on, a region), so neither is taken as a verdict on the key.
 */
function googleVerdict(status: number, body: unknown): KeyProbe {
  if (status >= 200 && status < 300) return "ok";
  const error = record(record(body)?.error);
  const namedInvalid = records(error?.details).some((detail) => detail.reason === "API_KEY_INVALID");
  const saysInvalid = status === 400 && /api key not valid/i.test(typeof error?.message === "string" ? error.message : "");
  return namedInvalid || saysInvalid ? "rejected" : "unreachable";
}

/**
 * xAI answers a key it does not know with 400 and a flat `{ code, error }`, where its
 * own error table says 401. Both are a refusal of the key; any other 400 is not.
 */
function xaiVerdict(status: number, body: unknown): KeyProbe {
  if (status === 400) return /incorrect api key/i.test(saidIn(body)) ? "rejected" : "unreachable";
  return byStatus(status, body);
}

// ---------- model lists: shared pieces ----------

/** One page of a provider's list as picker rows, and the token for the next page if there is one. */
export interface ModelPage {
  models: ModelOption[];
  next: string | null;
}

/** Far above any provider's real list; a ceiling on what one answer can put in a picker. */
const MAX_KEY_MODELS = 500;
const MAX_PUBLIC_MODELS = 1_000;
/** Pages of a list to follow. One page has always been all of it. */
const MAX_PAGES = 3;
/** The largest list today, OpenRouter's, is under a megabyte. */
const MAX_LIST_CHARS = 4_000_000;
const MAX_ERROR_CHARS = 64_000;

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 80) : null;
}

function modelId(value: unknown): string | null {
  return typeof value === "string" && isModelId(value) ? value : null;
}

function strings(value: unknown): string[] {
  return items(value).filter((item): item is string => typeof item === "string");
}

/** The last part of a path-like id: `zai-org/GLM-5.3` reads as GLM-5.3 where no name is given. */
function tail(id: string): string {
  return id.slice(id.lastIndexOf("/") + 1) || id;
}

/** Six significant digits: 0.000002 × 1e6 is 2, not 2.0000000000000004. */
function rounded(value: number): number {
  return Number(value.toPrecision(6));
}

function amount(raw: unknown): number | undefined {
  const value = typeof raw === "string" && raw.trim() !== "" ? Number(raw) : typeof raw === "number" ? raw : Number.NaN;
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}

type Price = Pick<ModelOption, "inputPerMTok" | "outputPerMTok">;

/** A price only when both halves are known: half a price reads as "input is free". */
function price(input: number | undefined, output: number | undefined): Price {
  return input !== undefined && output !== undefined ? { inputPerMTok: rounded(input), outputPerMTok: rounded(output) } : {};
}

/** USD per token, as a string or a number, to USD per million tokens. */
function perMillion(raw: unknown): number | undefined {
  const perToken = amount(raw);
  return perToken === undefined ? undefined : perToken * 1_000_000;
}

/**
 * A row for one of the newer providers. The name is the registry's when it has the
 * model, then the provider's, then the id. The price is the provider's when its list
 * carries one and the registry's own row for this provider otherwise, never another
 * host's: the same open model costs something different everywhere it is served.
 */
function listed(provider: CatalogueId, id: string, name: string | null, live: Price = {}): ModelOption {
  const known = knownModel(id, provider);
  return {
    id,
    label: known?.label ?? name ?? id,
    ...(live.inputPerMTok !== undefined ? live : price(known?.inputPerMTok, known?.outputPerMTok)),
  };
}

/** The `data` array most OpenAI-style lists answer with, as records. */
function dataOf(body: unknown): Json[] {
  return records(record(body)?.data);
}

// ---------- model lists: one parser per provider ----------

/**
 * Pure: one page of Anthropic's `GET /v1/models` → picker rows, in the order given
 * (newest first). Anything that is not a model with a usable id is dropped.
 */
export function parseAnthropicModels(body: unknown): { models: ModelOption[]; nextAfterId: string | null } {
  const page = record(body);
  const models: ModelOption[] = [];
  for (const model of dataOf(body)) {
    const id = modelId(model.id);
    if (!id) continue;
    // Anthropic's own name for the model first: it lists models the registry has not met.
    const known = knownModel(id, "anthropic");
    models.push({ id, label: text(model.display_name) ?? known?.label ?? id, ...price(known?.inputPerMTok, known?.outputPerMTok) });
  }
  const nextAfterId = page?.has_more === true && typeof page.last_id === "string" && page.last_id ? page.last_id : null;
  return { models, nextAfterId };
}

/**
 * What OpenAI lists that an agent cannot think on: its list is every model the key can
 * call, with nothing that says what each is for, so the kinds are told apart by name.
 */
const NOT_A_CHAT_MODEL =
  /embedding|whisper|tts|transcribe|dall-e|image|sora|moderation|realtime|audio|search|instruct|davinci|babbage|computer-use/i;
/** The families that take a chat with tools: GPT, the o-series, and fine-tunes of them. */
const CHAT_MODEL = /^(gpt-|o\d|chatgpt-|ft:(gpt-|o\d))/i;

/** Pure: OpenAI's `GET /v1/models` → picker rows for the chat models, newest first. */
export function parseOpenAiModels(body: unknown): ModelOption[] {
  const rows: Array<{ id: string; created: number }> = [];
  for (const model of dataOf(body)) {
    const id = modelId(model.id);
    if (!id || !CHAT_MODEL.test(id) || NOT_A_CHAT_MODEL.test(id)) continue;
    rows.push({ id, created: typeof model.created === "number" && Number.isFinite(model.created) ? model.created : 0 });
  }
  rows.sort((a, b) => b.created - a.created || a.id.localeCompare(b.id));
  return rows.slice(0, MAX_KEY_MODELS).map((row) => {
    const known = knownModel(row.id, "openai");
    return { id: row.id, label: known?.label ?? row.id, ...price(known?.inputPerMTok, known?.outputPerMTok) };
  });
}

/**
 * Pure: OpenRouter's response body → the rows the picker shows, newest first. Only
 * models an agent can run on are kept: text out, tool calling supported (a run is
 * nothing but tool calls), and not a `:batch` variant, which answers hours later.
 * `:free` variants stay. Nothing in the body is trusted to be the shape it should be.
 */
export function parseOpenRouterModels(body: unknown): ModelOption[] {
  const rows: Array<ModelOption & { created: number }> = [];
  for (const model of dataOf(body)) {
    const id = modelId(model.id);
    if (!id || id.endsWith(":batch")) continue;
    if (!strings(model.supported_parameters).includes("tools")) continue;

    const output = record(model.architecture)?.output_modalities;
    if (Array.isArray(output) && !(output.length === 1 && output[0] === "text")) continue;

    const pricing = record(model.pricing) ?? {};
    rows.push({
      id,
      label: text(model.name) ?? id,
      ...price(perMillion(pricing.prompt), perMillion(pricing.completion)),
      created: typeof model.created === "number" && Number.isFinite(model.created) ? model.created : 0,
    });
  }
  rows.sort((a, b) => b.created - a.created);
  return rows.slice(0, MAX_PUBLIC_MODELS).map((row) => {
    const { created, ...option } = row;
    void created;
    return option;
  });
}

/**
 * What Gemini's list holds that an agent cannot think on. Nothing in it marks a model
 * that can call tools, so the kinds are told apart by name, as with OpenAI.
 */
const NOT_A_GEMINI_CHAT_MODEL = /-tts|-image|-live|-transcribe|audio|embedding|robotics|omni|nano-banana|deep-research|computer-use/i;

/** Pure: one page of Google's `GET /v1beta/models`. The id is `name` without its `models/`. */
function parseGoogleModels(body: unknown): ModelPage {
  const page = record(body);
  const models: ModelOption[] = [];
  for (const model of records(page?.models)) {
    const id = modelId(typeof model.name === "string" ? model.name.replace(/^models\//, "") : null);
    if (!id || !id.startsWith("gemini-") || NOT_A_GEMINI_CHAT_MODEL.test(id)) continue;
    if (!strings(model.supportedGenerationMethods).includes("generateContent")) continue;
    models.push(listed("google", id, text(model.displayName)));
  }
  return { models, next: typeof page?.nextPageToken === "string" && page.nextPageToken ? page.nextPageToken : null };
}

/**
 * Pure: xAI's `GET /v1/language-models`. Prices come as USD cents per 100 million
 * tokens. The multi-agent models are left out: they cannot call an app's own tools.
 */
function parseXaiModels(body: unknown): ModelPage {
  const models: ModelOption[] = [];
  for (const model of records(record(body)?.models)) {
    const id = modelId(model.id);
    if (!id || /multi-agent/i.test(id)) continue;
    if (Array.isArray(model.output_modalities) && !model.output_modalities.includes("text")) continue;
    const input = amount(model.prompt_text_token_price);
    const output = amount(model.completion_text_token_price);
    models.push(listed("xai", id, null, price(input === undefined ? undefined : input / 10_000, output === undefined ? undefined : output / 10_000)));
  }
  return { models, next: null };
}

/** Pure: DeepSeek's `GET /models`. Every model it lists is a chat model that takes tools. */
function parseDeepSeekModels(body: unknown): ModelPage {
  const models = dataOf(body).flatMap((model) => {
    const id = modelId(model.id);
    return id ? [listed("deepseek", id, text(model.name))] : [];
  });
  return { models, next: null };
}

/**
 * Pure: Mistral's `GET /v1/models`, the one list here that says outright which models
 * can call tools. A model with a retirement date is left out.
 */
function parseMistralModels(body: unknown): ModelPage {
  const models: ModelOption[] = [];
  for (const model of dataOf(body)) {
    const id = modelId(model.id);
    const can = record(model.capabilities);
    if (!id || can?.completion_chat !== true || can.function_calling !== true) continue;
    if (typeof model.deprecation === "string" && model.deprecation) continue;
    // Mistral's `name` is the id again, so it adds nothing as a label.
    models.push(listed("mistral", id, null));
  }
  return { models, next: null };
}

/** Pure: Moonshot's `GET /v1/models`. It sells chat models only, and all of them take tools. */
function parseMoonshotModels(body: unknown): ModelPage {
  const models = dataOf(body).flatMap((model) => {
    const id = modelId(model.id);
    return id ? [listed("moonshot", id, null)] : [];
  });
  return { models, next: null };
}

/** What Groq lists beside its chat models: speech in, speech out, and the guard models. */
const NOT_A_GROQ_CHAT_MODEL = /whisper|tts|orpheus|canopylabs\/|guard|embed/i;

/** Pure: Groq's `GET /openai/v1/models`, without what is switched off or is not a chat model. */
function parseGroqModels(body: unknown): ModelPage {
  const models: ModelOption[] = [];
  for (const model of dataOf(body)) {
    const id = modelId(model.id);
    if (!id || model.active === false || NOT_A_GROQ_CHAT_MODEL.test(id)) continue;
    models.push(listed("groq", id, null));
  }
  return { models, next: null };
}

/**
 * Pure: one page of Fireworks's account list. Kept: models served without a deployment
 * of the owner's own that Fireworks flags as taking tools. The id is the long `name`.
 */
function parseFireworksModels(body: unknown): ModelPage {
  const page = record(body);
  const models: ModelOption[] = [];
  for (const model of records(page?.models)) {
    const id = modelId(model.name);
    if (!id || model.supportsServerless !== true || model.supportsTools !== true) continue;
    models.push(listed("fireworks", id, text(model.displayName) ?? tail(id)));
  }
  return { models, next: typeof page?.nextPageToken === "string" && page.nextPageToken ? page.nextPageToken : null };
}

/**
 * Pure: Nebius's `GET /v1/models?verbose=true`.
 *
 * With `verbose` each model names its features, and the ones kept are those that name
 * tools. Which words Nebius uses there has not been seen with a real key. So when no
 * model names tools at all, the answer is not "none can": it is the registry's own rows
 * (the models Nebius tags for function calling on its site), narrowed to the ones this
 * key's list has, with the list's prices.
 */
function parseNebiusModels(body: unknown): ModelPage {
  const all: Array<{ id: string; name: string | null; live: Price; tools: boolean }> = [];
  for (const model of dataOf(body)) {
    const id = modelId(model.id);
    if (!id) continue;
    // "text->text", "text+image->text": what comes out has to be text.
    const modality = record(model.architecture)?.modality;
    if (typeof modality === "string" && modality.includes("->") && !modality.endsWith("->text")) continue;
    const pricing = record(model.pricing) ?? {};
    all.push({
      id,
      name: text(model.name),
      live: price(perMillion(pricing.prompt), perMillion(pricing.completion)),
      tools: strings(model.supported_features).some((feature) => /tool|function/i.test(feature)),
    });
  }
  const row = (model: (typeof all)[number]) => listed("nebius", model.id, model.name ? tail(model.name) : tail(model.id), model.live);
  const withTools = all.filter((model) => model.tools);
  if (withTools.length > 0) return { models: withTools.map(row), next: null };
  if (all.length === 0) return { models: [], next: null };

  const byId = new Map(all.map((model) => [model.id.toLowerCase(), model]));
  const builtIn = CATALOGUE.nebius.models.flatMap((model) => {
    const live = byId.get(model.id.toLowerCase());
    return live ? [row(live)] : [];
  });
  return { models: builtIn.length > 0 ? builtIn : [...CATALOGUE.nebius.models], next: null };
}

/** Pure: Cerebras's public list, which carries prices per token and a tools flag. */
function parseCerebrasModels(body: unknown): ModelPage {
  const models: ModelOption[] = [];
  for (const model of dataOf(body)) {
    const id = modelId(model.id);
    const can = record(model.capabilities);
    if (!id || model.deprecated === true || (can?.tools !== true && can?.function_calling !== true)) continue;
    const pricing = record(model.pricing) ?? {};
    models.push(listed("cerebras", id, text(model.name), price(perMillion(pricing.prompt), perMillion(pricing.completion))));
  }
  return { models, next: null };
}

/**
 * Pure: DeepInfra's public `GET /models/list`, a bare array of everything it serves.
 * Kept: text models that are not retired and carry the `tools` tag. Prices come as
 * cents per token.
 */
function parseDeepInfraModels(body: unknown): ModelPage {
  const models: ModelOption[] = [];
  for (const model of records(body)) {
    const id = modelId(model.model_name);
    if (!id || model.type !== "text-generation" || model.deprecated != null) continue;
    if (!strings(model.tags).includes("tools")) continue;
    const pricing = record(model.pricing) ?? {};
    const cents = (raw: unknown) => {
      const perToken = amount(raw);
      return perToken === undefined ? undefined : perToken * 10_000;
    };
    models.push(listed("deepinfra", id, tail(id), price(cents(pricing.cents_per_input_token), cents(pricing.cents_per_output_token))));
  }
  return { models, next: null };
}

/** Pure: the Vercel AI Gateway's public catalogue. Kept: language models tagged `tool-use`. */
function parseVercelModels(body: unknown): ModelPage {
  const models: ModelOption[] = [];
  for (const model of dataOf(body)) {
    const id = modelId(model.id);
    if (!id || model.type !== "language" || !strings(model.tags).includes("tool-use")) continue;
    const pricing = record(model.pricing) ?? {};
    models.push(listed("vercel", id, text(model.name), price(perMillion(pricing.input), perMillion(pricing.output))));
  }
  return { models, next: null };
}

/** Pure: Venice's public list. Kept: models that are up and that it flags for function calling. */
function parseVeniceModels(body: unknown): ModelPage {
  const models: ModelOption[] = [];
  for (const model of dataOf(body)) {
    const id = modelId(model.id);
    const spec = record(model.model_spec);
    if (!id || !spec || spec.offline === true || record(spec.capabilities)?.supportsFunctionCalling !== true) continue;
    const pricing = record(spec.pricing);
    // Already in USD per million tokens.
    models.push(listed("venice", id, text(spec.name), price(amount(record(pricing?.input)?.usd), amount(record(pricing?.output)?.usd))));
  }
  return { models, next: null };
}

/**
 * Pure: Novita's public list. Kept: chat models that are switched on, answer in text
 * alone and list `function-calling` among their features.
 */
function parseNovitaModels(body: unknown): ModelPage {
  const models: ModelOption[] = [];
  for (const model of dataOf(body)) {
    const id = modelId(model.id);
    if (!id || !strings(model.features).includes("function-calling")) continue;
    if (typeof model.model_type === "string" && model.model_type !== "chat") continue;
    if (typeof model.status === "number" && model.status !== 1) continue;
    if (Array.isArray(model.output_modalities) && !(model.output_modalities.length === 1 && model.output_modalities[0] === "text")) continue;
    const pricing = record(model.pricing);
    // A decimal string in USD per million tokens; the older fields are that times 10,000.
    const usd = (decimal: unknown, tenThousandths: unknown) => {
      const whole = amount(tenThousandths);
      return amount(decimal) ?? (whole === undefined ? undefined : whole / 10_000);
    };
    const input = usd(record(pricing?.prompt)?.price_per_m_decimal, model.input_token_price_per_m);
    const output = usd(record(pricing?.completion)?.price_per_m_decimal, model.output_token_price_per_m);
    models.push(listed("novita", id, text(model.display_name) ?? text(model.title), price(input, output)));
  }
  return { models, next: null };
}

/**
 * Pure: Hugging Face's public router list. A model is served by several companies, each
 * with its own price and its own answer on tools. Kept: models that at least one of them
 * serves live with tools. The price shown is the highest among those, so an estimate
 * made from it is never low.
 */
function parseHuggingFaceModels(body: unknown): ModelPage {
  const models: ModelOption[] = [];
  for (const model of dataOf(body)) {
    const id = modelId(model.id);
    if (!id) continue;
    const serving = records(model.providers).filter((entry) => entry.status === "live" && entry.supports_tools === true);
    if (serving.length === 0) continue;
    const highest = (side: "input" | "output") => {
      const prices = serving.flatMap((entry) => amount(record(entry.pricing)?.[side]) ?? []);
      return prices.length > 0 ? Math.max(...prices) : undefined;
    };
    models.push(listed("huggingface", id, tail(id), price(highest("input"), highest("output"))));
  }
  return { models, next: null };
}

// ---------- one entry per provider ----------

interface KeyCheck {
  /** Path and query of the free, authenticated request, on the host `target` names. */
  path: string;
  target?: FetchTarget;
  auth: KeyAuth;
  /** What an answer means for the key, where 401 is not the whole story. */
  verdict?: (status: number, body: unknown) => KeyProbe;
}

interface ModelList {
  /** Path and query of the first page, on the provider's origin. */
  path: string;
  parse: (body: unknown) => ModelPage;
  /** The path of the page after the one that returned this token. */
  after?: (token: string) => string;
  /**
   * False where the list lives on a different endpoint from the key check and a refusal
   * there may be about that endpoint. It is then never reported as the key being refused.
   */
  refusalIsAboutKey?: false;
  /** True for the three lists that already had an order the picker relies on. */
  asGiven?: true;
}

interface ProviderEntry {
  check: KeyCheck;
  /**
   * Present exactly when the row's `modelList` is not `built-in`. Whether it is asked
   * with the key or without one is the row's word (`by-key` or `public`), not this file's.
   */
  list?: ModelList;
}

const openAiStyle = (path: string): KeyCheck => ({ path, auth: "bearer" });

/**
 * Typed by every catalogue id, so a row added to the registry does not compile until it
 * says here how its keys are checked.
 */
const ENTRIES_BY_ID: Readonly<Record<CatalogueId, ProviderEntry>> = {
  anthropic: {
    // The same free call `needsWorkspaceHeader` makes.
    check: { path: "/v1/models?limit=1", auth: "anthropic" },
    list: {
      path: "/v1/models?limit=1000",
      parse: (body) => {
        const { models, nextAfterId } = parseAnthropicModels(body);
        return { models, next: nextAfterId };
      },
      after: (id) => `/v1/models?limit=1000&after_id=${encodeURIComponent(id)}`,
      asGiven: true,
    },
  },
  openai: {
    check: openAiStyle("/v1/models"),
    list: { path: "/v1/models", parse: (body) => ({ models: parseOpenAiModels(body), next: null }), asGiven: true },
  },
  openrouter: {
    // Its model list answers without a key, so the key is asked about on its own endpoint.
    check: openAiStyle("/api/v1/key"),
    list: { path: "/api/v1/models", parse: (body) => ({ models: parseOpenRouterModels(body), next: null }), asGiven: true },
  },
  google: {
    check: { path: "/v1beta/models?pageSize=1", auth: "google", verdict: googleVerdict },
    list: {
      path: "/v1beta/models?pageSize=1000",
      parse: parseGoogleModels,
      after: (token) => `/v1beta/models?pageSize=1000&pageToken=${encodeURIComponent(token)}`,
    },
  },
  xai: {
    // The list of chat models only; `/v1/models` mixes in image and video models.
    check: { path: "/v1/language-models", auth: "bearer", verdict: xaiVerdict },
    list: { path: "/v1/language-models", parse: parseXaiModels },
  },
  deepseek: {
    check: openAiStyle("/models"),
    list: { path: "/models", parse: parseDeepSeekModels },
  },
  mistral: {
    check: openAiStyle("/v1/models"),
    list: { path: "/v1/models", parse: parseMistralModels },
  },
  moonshot: {
    check: openAiStyle("/v1/models"),
    list: { path: "/v1/models", parse: parseMoonshotModels },
  },
  // Not in Z.AI's documentation, but it answers 401 to a key it does not know. Whatever
  // it says to a good key, only that 401 refuses one.
  zai: { check: openAiStyle("/api/paas/v4/models") },
  groq: {
    // Groq turns some networks away with a 403 before it looks at the key. That is not
    // a 401, so it reads as "could not tell" and the key is saved.
    check: openAiStyle("/openai/v1/models"),
    list: { path: "/openai/v1/models", parse: parseGroqModels },
  },
  cerebras: {
    // The list that needs a key says whether the key is good; the public one beside it
    // has the prices and the tools flag, and is read with no key.
    check: openAiStyle("/v1/models"),
    list: { path: "/public/v1/models", parse: parseCerebrasModels },
  },
  together: { check: openAiStyle("/v1/models") },
  fireworks: {
    // The inference API's own list: the surface a run uses, which any key may call.
    check: openAiStyle("/inference/v1/models"),
    list: {
      path: "/v1/accounts/fireworks/models?filter=supports_serverless%3Dtrue&pageSize=200",
      parse: parseFireworksModels,
      after: (token) =>
        `/v1/accounts/fireworks/models?filter=supports_serverless%3Dtrue&pageSize=200&pageToken=${encodeURIComponent(token)}`,
      // The shared account's catalogue. A key that may not read it is still a good key.
      refusalIsAboutKey: false,
    },
  },
  deepinfra: {
    // Public without a key, and 401 to a key it does not know: it doubles as the check.
    check: openAiStyle("/v1/openai/models"),
    list: { path: "/models/list", parse: parseDeepInfraModels },
  },
  vercel: {
    // Not `/v4/ai/config`, which answers 200 to any key at all.
    check: openAiStyle("/v1/credits"),
    list: { path: "/v1/models", parse: parseVercelModels },
  },
  venice: {
    check: openAiStyle("/api/v1/api_keys/rate_limits"),
    list: { path: "/api/v1/models", parse: parseVeniceModels },
  },
  nebius: {
    check: openAiStyle("/v1/models"),
    list: { path: "/v1/models?verbose=true", parse: parseNebiusModels },
  },
  novita: {
    check: openAiStyle("/openapi/v1/billing/balance/detail"),
    list: { path: "/openai/v1/models", parse: parseNovitaModels },
  },
  huggingface: {
    // On the Hub, the site that issued the token: the router has no call that judges one.
    check: { path: "/api/whoami-v2", target: "key-check", auth: "bearer" },
    list: { path: "/v1/models", parse: parseHuggingFaceModels },
  },
};

const ENTRIES: ReadonlyMap<string, ProviderEntry> = new Map(CATALOGUE_IDS.map((id) => [id, ENTRIES_BY_ID[id]]));

// ---------- checking a key ----------

/**
 * Pure: the request that asks a provider about a key. Exported so a test can read, for
 * every provider, where a key would go and how it would be presented.
 */
export function keyCheckRequest(
  provider: CatalogueId,
  key: string,
  workspaceId?: string | null,
): { url: string; headers: Record<string, string> } {
  const entry = ENTRIES.get(provider);
  if (!entry) throw new Error(PROVIDER_UNSUPPORTED);
  return {
    url: providerUrl(provider, entry.check.path, entry.check.target).href,
    headers: authHeaders(entry.check.auth, key, workspaceId ?? null),
  };
}

/** Pure: what a provider's answer to the key check means, by that provider's own rule. */
export function keyVerdict(provider: CatalogueId, status: number, body: unknown): KeyProbe {
  const entry = ENTRIES.get(provider);
  if (!entry) return "rejected";
  return (entry.check.verdict ?? byStatus)(status, body);
}

/**
 * One free, authenticated request that says whether a provider recognises a key.
 *
 * - `ok`: the provider accepted the key.
 * - `rejected`: the provider said this key is not a key. Also the answer, with no
 *   request made, for a key that starts the way another provider's keys do, lacks the
 *   prefix this provider documents, or names a provider that has no entry here.
 * - `unreachable`: we could not tell. A timeout, a network error, a redirect, a 5xx, a
 *   rate limit, or a refusal that is about where the request came from.
 *
 * Never throws, and never logs or returns the key.
 */
export async function checkKey(provider: CatalogueId, key: string, workspaceId?: string | null): Promise<KeyProbe> {
  const entry = ENTRIES.get(provider);
  if (!entry || typeof key !== "string" || key.length === 0) return "rejected";
  try {
    if (keyProblem(provider, key) !== null) return "rejected";
    const { check } = entry;
    const res = await providerFetch(provider, check.path, {
      headers: authHeaders(check.auth, key, workspaceId ?? null),
      timeoutMs: CHECK_TIMEOUT_MS,
      target: check.target,
    });
    if (res.status >= 200 && res.status < 300) {
      // Some of these are whole model lists. The status was the answer.
      void res.body?.cancel().catch(() => undefined);
      return "ok";
    }
    return keyVerdict(provider, res.status, await jsonOf(res, MAX_ERROR_CHARS));
  } catch {
    return "unreachable";
  }
}

// ---------- listing models ----------

export type KeyModels = { ok: true; models: ModelOption[] } | { ok: false; reason: "rejected" | "unreachable" };

const UNREACHABLE: KeyModels = { ok: false, reason: "unreachable" };

/** Pure: one page of a provider's list as picker rows, or null for a provider that has no list. */
export function parseModelList(provider: CatalogueId, body: unknown): ModelPage | null {
  const list = ENTRIES.get(provider)?.list;
  return list ? list.parse(body) : null;
}

/**
 * What goes back to a picker: each model once, nothing in a name that should not be
 * shown, and for the newer providers the registry's own rows first, in its order, so the
 * picker opens on models that were checked by hand rather than on whatever is newest.
 *
 * `clean` is applied to every name. An id it would change is not an id: the row is dropped.
 */
function finished(row: ProviderRow, list: ModelList, models: readonly ModelOption[], clean: (text: string) => string): ModelOption[] {
  const seen = new Set<string>();
  const kept: ModelOption[] = [];
  for (const model of models) {
    if (seen.has(model.id) || clean(model.id) !== model.id) continue;
    seen.add(model.id);
    kept.push({ ...model, label: clean(model.label) });
  }
  return list.asGiven ? kept : featuredFirst(kept, row.models);
}

/**
 * The models a key can use, asked of the provider it was saved under.
 *
 * Only for a provider whose row says `by-key`: any other is answered `unreachable`
 * without a request, so a key can never fall through to some other provider's host. A
 * key that plainly belongs to another provider is `rejected`, also without a request.
 *
 * Never throws. `rejected` means the provider refused the key itself; `unreachable`
 * covers everything else (a timeout, a 5xx, a restricted key that may not list models),
 * and the picker falls back to the built-in list either way. What comes back is ids,
 * names and prices, with the key removed from any name that carried it.
 */
export async function listModels(provider: CatalogueId, key: string, workspaceId?: string | null): Promise<KeyModels> {
  const row = ROWS.get(provider);
  const entry = ENTRIES.get(provider);
  const list = entry?.list;
  if (!row || !entry || !list || row.modelList !== "by-key") return UNREACHABLE;
  if (typeof key !== "string" || key.length === 0) return { ok: false, reason: "rejected" };
  try {
    if (keyProblem(provider, key) !== null) return { ok: false, reason: "rejected" };
    const headers = authHeaders(entry.check.auth, key, workspaceId ?? null);
    const models: ModelOption[] = [];
    let path: string | null = list.path;
    for (let page = 0; page < MAX_PAGES && path; page += 1) {
      const res = await providerFetch(provider, path, { headers, timeoutMs: LIST_TIMEOUT_MS });
      if (res.status < 200 || res.status >= 300) {
        if (list.refusalIsAboutKey === false) return UNREACHABLE;
        const verdict = keyVerdict(provider, res.status, await jsonOf(res, MAX_ERROR_CHARS));
        return verdict === "rejected" ? { ok: false, reason: "rejected" } : UNREACHABLE;
      }
      const parsed = list.parse(await jsonOf(res, MAX_LIST_CHARS));
      models.push(...parsed.models);
      path = parsed.next && list.after ? list.after(parsed.next) : null;
    }
    const rows = finished(row, list, models, withoutKey(key)).slice(0, MAX_KEY_MODELS);
    return rows.length > 0 ? { ok: true, models: rows } : UNREACHABLE;
  } catch {
    return UNREACHABLE;
  }
}

// ---------- public lists ----------

export interface PublicCatalog {
  models: ModelOption[];
  /** False when the provider could not be reached and this is the short built-in list. */
  live: boolean;
}

/** How long one fetched list is served for. */
const CATALOG_TTL_MS = 60 * 60_000;

/** Model lists only, by provider. Read with no key, so there is no key near this. */
const catalogs = new Map<string, { at: number; models: ModelOption[] }>();

/**
 * A provider's published model list, fetched at most once an hour per server instance
 * and with no key: there is no parameter here to pass one in.
 *
 * Null for a provider whose row does not say `public`, without a request. Otherwise it
 * never throws: when the provider cannot be reached the last good list is served, and
 * failing that the row's short built-in one, with `live: false` so the picker can say
 * so. Any id can still be typed.
 */
export async function getPublicCatalog(provider: CatalogueId, now: number = Date.now()): Promise<PublicCatalog | null> {
  const row = ROWS.get(provider);
  const list = ENTRIES.get(provider)?.list;
  if (!row || !list || row.modelList !== "public") return null;

  const cached = catalogs.get(row.id);
  if (cached && now - cached.at < CATALOG_TTL_MS) return { models: cached.models, live: true };
  try {
    const res = await providerFetch(row.id, list.path, { headers: { accept: "application/json" }, timeoutMs: LIST_TIMEOUT_MS });
    if (!res.ok) throw new Error(`${row.label} answered ${res.status}`);
    const parsed = list.parse(await jsonOf(res, MAX_LIST_CHARS));
    const models = finished(row, list, parsed.models, redactSecrets).slice(0, MAX_PUBLIC_MODELS);
    if (models.length === 0) throw new Error(`${row.label} returned no usable models`);
    catalogs.set(row.id, { at: now, models });
    return { models, live: true };
  } catch (err) {
    console.warn(`[models] ${row.label} catalogue unavailable:`, redactSecrets(err instanceof Error ? err.message : String(err)));
    if (cached) return { models: cached.models, live: true };
    return { models: [...row.models], live: false };
  }
}

/** Test seam: forget every fetched list, or one provider's. */
export function resetPublicCatalogs(provider?: CatalogueId): void {
  if (provider) catalogs.delete(provider);
  else catalogs.clear();
}
