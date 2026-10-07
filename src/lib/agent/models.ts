/**
 * The models the builder offers, what each one is called and what it lists at.
 *
 * A leaf module on purpose — no zod, no schema — so a chip on a card can print
 * "GPT-5 mini" without pulling the whole agent config into a client bundle.
 * `config.ts` re-exports `DEFAULT_MODELS` for the builder and settings form.
 *
 * The providers, their lists and their defaults are rows in `providers.ts`; what is
 * exported here under the older names is read from there, so there is one list.
 *
 * The lists are what the picker shows, not a fence: any id the provider accepts can be
 * typed there (`isModelId`), because a provider ships a model faster than a row is
 * edited. Where a provider can be asked, the picker asks it, and the built-in rows are
 * what it falls back to and where a price comes from.
 */
import {
  CATALOGUE,
  CATALOGUE_IDS,
  PROVIDER_IDS,
  type CatalogueId,
  type LlmProvider,
  type ModelOption,
  type ProviderRow,
} from "./providers";

export { providerLabel } from "./providers";
export type { LlmProvider, ModelOption } from "./providers";

/** One value per enabled provider, read off its row. */
function perProvider<T>(pick: (row: ProviderRow) => T): Record<LlmProvider, T> {
  return Object.fromEntries(PROVIDER_IDS.map((id) => [id, pick(CATALOGUE[id])])) as Record<LlmProvider, T>;
}

export const PROVIDER_LABELS: Record<LlmProvider, string> = perProvider((row) => row.label);

/** Newest first within each provider. Prices are the providers' list prices. */
export const DEFAULT_MODELS: Record<LlmProvider, ModelOption[]> = perProvider((row) => [...row.models]);

/**
 * The model a provider starts on: when the provider is switched, and when the first key
 * decides the provider. Named on the provider's row rather than read off the top of its
 * list, so that a default is something changed on purpose and not by adding a row above it.
 */
export const DEFAULT_MODEL_ID: Record<LlmProvider, string> = perProvider((row) => row.defaultModel);

/**
 * A model id is printed on every public card, so it is bounded and has to look like an
 * id: letters, digits and `. _ : / -`, which covers every provider's ("gpt-5-mini",
 * "claude-haiku-4-5-20251001", "x-ai/grok-4.7", an OpenRouter ":free" variant, a
 * Fireworks "accounts/fireworks/models/glm-5p3"). Free text there could carry a megabyte,
 * or a sentence beside the agent's name.
 *
 * Never two dots in a row. Some providers put the model id in the address of the request
 * (Google's is `/models/<id>:generateContent`), where `../` would climb out of that
 * path and send the owner's key to another endpoint on the same host. No provider's id
 * has two dots together, so nothing real is refused.
 */
export const MAX_MODEL_ID = 100;
export const MODEL_ID_PATTERN = /^(?!.*\.\.)[A-Za-z0-9][A-Za-z0-9._:\/-]*$/;

/** Could this string be sent to a provider as a model id? The config schema's own rule. */
export function isModelId(value: string): boolean {
  return value.length > 0 && value.length <= MAX_MODEL_ID && MODEL_ID_PATTERN.test(value);
}

/** A dated snapshot id and its alias are the same model: `claude-haiku-4-5[-20251001]`. */
const undated = (id: string) => id.replace(/-\d{8}$/, "");

/** Without an OpenRouter vendor prefix: `openai/gpt-5` is `gpt-5`. */
const unprefixed = (id: string) => (id.includes("/") ? id.slice(id.lastIndexOf("/") + 1) : id);

/**
 * The spellings one model goes by, most exact first: as stored, without a date, without
 * a vendor prefix, and with OpenRouter's dotted version read as Anthropic's dashed one
 * (`anthropic/claude-sonnet-5.5` is `claude-sonnet-5-5`).
 */
function spellings(model: string): string[] {
  const id = undated(model.trim().toLowerCase());
  const bare = unprefixed(id);
  return [...new Set([id, bare, bare.replace(/\./g, "-")])];
}

const ALL_MODELS: ModelOption[] = Object.values(DEFAULT_MODELS).flat();

/** These providers' rows by id, lower-cased and undated. The first row for an id wins. */
function indexModels(ids: readonly CatalogueId[]): Map<string, ModelOption> {
  const byId = new Map<string, ModelOption>();
  for (const id of ids) {
    for (const model of CATALOGUE[id].models) {
      const key = undated(model.id.toLowerCase());
      if (!byId.has(key)) byId.set(key, model);
    }
  }
  return byId;
}

/** Each provider's own rows, for a model looked up on the provider it is used with. */
const OWN_LIST = new Map<string, Map<string, ModelOption>>(CATALOGUE_IDS.map((id) => [id, indexModels([id])]));

// The three providers the builder started with are read as one list, Anthropic's and
// OpenAI's rows before OpenRouter's, so a provider's own row is not replaced by a
// reseller's. The providers added since are kept apart from it: what an id resolved to
// before they existed is what it resolves to now, whichever of them are switched on.
const STARTED_WITH: readonly CatalogueId[] = ["anthropic", "openai", "openrouter"];
const FIRST_LISTS = indexModels(STARTED_WITH);
const LATER_LISTS = indexModels(PROVIDER_IDS.filter((id: CatalogueId) => !STARTED_WITH.includes(id)));

/** The first row any of these lists has for the id, trying each list in every spelling before the next. */
function findIn(lists: ReadonlyArray<Map<string, ModelOption>>, model: string): ModelOption | null {
  const names = spellings(model);
  for (const list of lists) {
    for (const spelling of names) {
      const found = list.get(spelling);
      if (found) return found;
    }
  }
  return null;
}

/** Model id (undated) → the label the builder shows. */
export const MODEL_LABELS: Record<string, string> = Object.fromEntries(
  ALL_MODELS.map((m) => [undated(m.id), m.label]),
);

/**
 * The catalogue row for a model id in any of its spellings, or null when it is not listed.
 *
 * With the provider the model is used on, the row is that provider's own: the same open
 * model has a different id and a different price on every host, and a price borrowed
 * from another host is a wrong number where "not known" would be a true one. The three
 * providers the builder started with also read each other's rows, as they always have:
 * OpenRouter sells Anthropic's and OpenAI's models at their list prices under a longer id.
 *
 * Without a provider only those three are read, exactly as before the others were added,
 * so nothing an existing agent is shown or priced at moves when a provider is switched
 * on. A caller that has the provider passes it; one that has only an id and wants a name
 * for it uses `modelNameOnAnyProvider`.
 */
export function knownModel(model: string | null | undefined, provider?: string | null): ModelOption | null {
  if (!model) return null;
  const own = provider ? OWN_LIST.get(provider) : undefined;
  if (!own) return findIn([FIRST_LISTS], model);
  return findIn(STARTED_WITH.includes(provider as CatalogueId) ? [own, FIRST_LISTS] : [own], model);
}

/**
 * The label for a model id, or null when it is not one the builder lists. Tries the id
 * as stored, then without an OpenRouter vendor prefix (`openai/gpt-5` is GPT-5).
 */
export function knownModelLabel(model: string, provider?: string | null): string | null {
  return knownModel(model, provider)?.label ?? null;
}

/**
 * A name for a model id where the provider is not known, which is every public card: the
 * first three lists as `knownModelLabel` reads them, then the other enabled providers'.
 *
 * A name only, and deliberately not a row. The lists it reaches past the first three
 * belong to hosts that charge differently for the same model, so a price must never be
 * taken this way.
 */
export function modelNameOnAnyProvider(model: string | null | undefined): string | null {
  if (!model) return null;
  return findIn([FIRST_LISTS, LATER_LISTS], model)?.label ?? null;
}

/** "$2 / $10 per M" for a model with a published price; null without one. */
export function priceHint(model: Pick<ModelOption, "inputPerMTok" | "outputPerMTok">): string | null {
  if (model.inputPerMTok === undefined || model.outputPerMTok === undefined) return null;
  if (model.inputPerMTok === 0 && model.outputPerMTok === 0) return "free";
  return `$${model.inputPerMTok} / $${model.outputPerMTok} per M`;
}

/**
 * A long list with the rows named in `featured` moved to the front, in `featured`'s own
 * order, and everything else behind them as it was. OpenRouter's catalogue arrives
 * newest first, which opens on whatever was listed this week; the picker opens on the
 * models people come looking for instead.
 */
export function featuredFirst(models: readonly ModelOption[], featured: readonly ModelOption[]): ModelOption[] {
  const byId = new Map(models.map((model) => [model.id, model]));
  const front = featured.flatMap((model) => byId.get(model.id) ?? []);
  const frontIds = new Set(front.map((model) => model.id));
  return [...front, ...models.filter((model) => !frontIds.has(model.id))];
}

/** How many rows the picker draws at once; the rest are a search away. */
export const MODEL_PICKER_ROWS = 60;

/**
 * The rows a search leaves, in the list's own order. Every word typed has to appear in
 * the label or the id, so "sonnet 5.5" and "5.5 sonnet" find the same model.
 */
export function filterModels(models: readonly ModelOption[], query: string): ModelOption[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return models.slice(0, MODEL_PICKER_ROWS);
  const hits: ModelOption[] = [];
  for (const model of models) {
    const text = `${model.label} ${model.id}`.toLowerCase();
    if (words.every((word) => text.includes(word))) hits.push(model);
    if (hits.length === MODEL_PICKER_ROWS) break;
  }
  return hits;
}

/**
 * What was typed, when it could be used as a model id as it stands and is not already a
 * row: the picker then offers it as "Use …". Null otherwise.
 */
export function typedModelId(models: readonly ModelOption[], query: string): string | null {
  const typed = query.trim();
  if (!isModelId(typed) || typed.length < 3) return null;
  return models.some((model) => model.id === typed) ? null : typed;
}
