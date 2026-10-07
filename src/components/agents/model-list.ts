/**
 * Where the model picker's rows come from for a provider, and what its footer says about
 * them. Pure, so the rule for each provider is tested without a browser.
 *
 * The provider's row in `providers.ts` names one of three ways. `by-key`: the provider is
 * asked which models the owner's saved key can use (`listKeyModels`, on the server; the
 * key never comes to the browser). `public`: the provider publishes its list, and the
 * picker reads it, without any key, through the session-gated route at
 * `/api/models/<provider>`. `built-in`: the provider has no list that says which models
 * can call tools, so the registry's own rows are the picker.
 *
 * Whatever the list, it is never a fence: an id that is typed is always accepted, and
 * the footer says where the rows came from, including when they are only the fallback.
 */
import { featuredFirst, isModelId, knownModelLabel, type ModelOption } from "@/lib/agent/models";
import { CATALOGUE, isCatalogueId, providerLabel, type ModelListSource } from "@/lib/agent/providers";

/**
 * How this provider's list is had. A provider with no row has no list to ask for, so it
 * is treated as built-in with no rows, and a typed id is the way in.
 */
export function modelListSource(provider: string): ModelListSource {
  return isCatalogueId(provider) ? CATALOGUE[provider].modelList : "built-in";
}

/** The registry's own rows for a provider: what the picker opens on and falls back to. */
export function builtInModels(provider: string): readonly ModelOption[] {
  return isCatalogueId(provider) ? CATALOGUE[provider].models : [];
}

/**
 * The route the public list is read from, or null for a provider whose list is not
 * public. The id is one of the registry's own, so it is safe as a path segment; no key
 * and nothing about the account goes in the address.
 */
export function publicListUrl(provider: string): string | null {
  return modelListSource(provider) === "public" ? `/api/models/${provider}` : null;
}

export interface PublicList {
  models: ModelOption[];
  /** False when the provider could not be reached and the route answered its short list. */
  live: boolean;
}

/** A ceiling on what one list may put on the page, far above any real catalogue. */
const MAX_ROWS = 1_000;
const MAX_LABEL = 120;

const isPrice = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;

/**
 * The route's answer, read as the rows the picker can draw. The server has already
 * parsed the provider's list; this is the second look, so that a body of the wrong shape
 * leaves the picker on its built-in rows rather than crashing the form it sits in. A row
 * is kept only if its id could be sent as a model id, once, and a price only if both
 * halves are numbers.
 */
export function readPublicList(body: unknown): PublicList {
  const raw = body as { models?: unknown; live?: unknown } | null;
  const models: ModelOption[] = [];
  const seen = new Set<string>();
  for (const entry of Array.isArray(raw?.models) ? raw.models : []) {
    if (models.length === MAX_ROWS) break;
    if (!entry || typeof entry !== "object") continue;
    const { id, label, inputPerMTok, outputPerMTok } = entry as Record<string, unknown>;
    if (typeof id !== "string" || !isModelId(id) || seen.has(id)) continue;
    seen.add(id);
    models.push({
      id,
      label: typeof label === "string" && label.trim() ? label.trim().slice(0, MAX_LABEL) : id,
      ...(isPrice(inputPerMTok) && isPrice(outputPerMTok) ? { inputPerMTok, outputPerMTok } : {}),
    });
  }
  return { models, live: raw?.live === true && models.length > 0 };
}

/** What the picker knows about its list at the moment it draws. */
export interface ModelListState {
  /** A saved key is chosen for the agent. */
  hasKey: boolean;
  /** The picker is open and the list it asked for has not come back yet. */
  loading: boolean;
  /** What the public route answered, once it has. */
  publicList: PublicList | null;
  /** The models the chosen key can use, when its provider said. */
  keyModels: readonly ModelOption[] | null;
  /** The server's sentence for why the key's provider could not say. */
  keyError: string | null;
}

/** A picker that has asked for nothing: closed, or on a provider with nothing to ask. */
export const NOTHING_ASKED: ModelListState = {
  hasKey: false,
  loading: false,
  publicList: null,
  keyModels: null,
  keyError: null,
};

/**
 * The rows the picker lists. A public catalogue arrives newest first and runs to
 * hundreds, so the registry's rows for that provider, which are the models people come
 * looking for, are moved to the front of it. A key's own list replaces the built-in one
 * only when there is a key and its provider answered.
 */
export function shownModels(provider: string, state: ModelListState): readonly ModelOption[] {
  const builtIn = builtInModels(provider);
  switch (modelListSource(provider)) {
    case "public": {
      const listed = state.publicList?.models;
      return featuredFirst(listed && listed.length > 0 ? listed : builtIn, builtIn);
    }
    case "by-key":
      return state.hasKey && state.keyModels ? state.keyModels : builtIn;
    case "built-in":
      return builtIn;
  }
}

/**
 * The line under the list: where these rows came from, said truthfully. `shown` is how
 * many models the picker has, not how many a search left.
 */
export function listFooter(provider: string, state: ModelListState, shown: number): string {
  const label = providerLabel(provider);
  switch (modelListSource(provider)) {
    case "public":
      if (state.loading) return `Loading ${label}'s list…`;
      return state.publicList?.live
        ? `${shown} models that can run an agent, from ${label}'s own list.`
        : `Couldn't reach ${label}'s list, so this is a short one. Any model id can be typed.`;
    case "by-key":
      if (!state.hasKey) {
        return "Pick a key to see every model it can use. Until then this is the built-in list; any model id can be typed.";
      }
      if (state.loading) return `Asking ${label} what this key can use…`;
      return state.keyModels
        ? `${state.keyModels.length} models this key can use, from ${label}.`
        : `${state.keyError ?? `Couldn't get the list from ${label} just now.`} This is the built-in list; any model id can be typed.`;
    case "built-in":
      return isCatalogueId(provider)
        ? `This list is kept by hand: ${label} has none Tocker can read that says which models can run an agent. Any model id can be typed.`
        : "There is no model list for this provider. Any model id can be typed.";
  }
}

/**
 * The builder's name for a model where the provider is in reach, or null for an id it
 * does not list.
 *
 * The lookup without a provider is tried first, and it is the only one that can answer
 * for Anthropic, OpenAI and OpenRouter: what their models are called does not move. Only
 * an id it does not know is then looked up in the provider's own list, which is where a
 * model on any other provider is found.
 */
export function modelNameOn(provider: string, model: string): string | null {
  return knownModelLabel(model) ?? knownModelLabel(model, provider);
}

/**
 * The name a model has in its provider's own list, for an id the lookup without a
 * provider does not know; null when that lookup already has a name, or neither does.
 * For the owner's summary, which prints the name the public header prints and only
 * wants to do better where the header has nothing but the raw id to prettify.
 */
export function ownListModelName(provider: string, model: string): string | null {
  return knownModelLabel(model) === null ? knownModelLabel(model, provider) : null;
}
