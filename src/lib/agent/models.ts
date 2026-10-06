/**
 * The models the builder offers, what each one is called and what it lists at.
 *
 * A leaf module on purpose — no zod, no schema — so a chip on a card can print
 * "GPT-5 mini" without pulling the whole agent config into a client bundle.
 * `config.ts` re-exports `DEFAULT_MODELS` for the builder and settings form.
 *
 * The lists are what the picker shows, not a fence: any id the provider accepts can be
 * typed there (`isModelId`), because a provider ships a model faster than this file is
 * edited. Anthropic's and OpenAI's are kept here by hand; OpenRouter's catalogue runs to
 * hundreds and changes weekly, so the picker reads it live (`openrouter-catalog.ts`) and
 * the list here is only what it falls back to.
 */
export type LlmProvider = "anthropic" | "openai" | "openrouter";

export const PROVIDER_LABELS: Record<LlmProvider, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  openrouter: "OpenRouter",
};

/** "OpenAI" for `openai`; an unknown id is returned as stored rather than guessed at. */
export function providerLabel(provider: string): string {
  return PROVIDER_LABELS[provider as LlmProvider] ?? provider;
}

export interface ModelOption {
  id: string;
  label: string;
  /** List price in USD per million tokens, when it is published. */
  inputPerMTok?: number;
  outputPerMTok?: number;
}

/** Newest first within each provider. Prices are the providers' list prices. */
export const DEFAULT_MODELS: Record<LlmProvider, ModelOption[]> = {
  anthropic: [
    { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5", inputPerMTok: 2, outputPerMTok: 10 },
    { id: "claude-opus-5-5", label: "Claude Opus 5.5", inputPerMTok: 4, outputPerMTok: 20 },
    { id: "claude-fable-5-1", label: "Claude Fable 5.1", inputPerMTok: 10, outputPerMTok: 50 },
    { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5", inputPerMTok: 1, outputPerMTok: 5 },
    { id: "claude-sonnet-5", label: "Claude Sonnet 5", inputPerMTok: 2, outputPerMTok: 10 },
    { id: "claude-opus-5", label: "Claude Opus 5", inputPerMTok: 5, outputPerMTok: 25 },
    { id: "claude-fable-5", label: "Claude Fable 5", inputPerMTok: 10, outputPerMTok: 50 },
    { id: "claude-opus-4-8", label: "Claude Opus 4.8", inputPerMTok: 5, outputPerMTok: 25 },
    { id: "claude-opus-4-7", label: "Claude Opus 4.7", inputPerMTok: 5, outputPerMTok: 25 },
    { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", inputPerMTok: 3, outputPerMTok: 15 },
    { id: "claude-opus-4-6", label: "Claude Opus 4.6", inputPerMTok: 5, outputPerMTok: 25 },
  ],
  openai: [
    { id: "gpt-6.1-sol", label: "GPT-6.1 Sol", inputPerMTok: 2, outputPerMTok: 10 },
    { id: "gpt-6.1-sol-pro", label: "GPT-6.1 Sol Pro", inputPerMTok: 2, outputPerMTok: 10 },
    { id: "gpt-6-sol", label: "GPT-6 Sol", inputPerMTok: 2, outputPerMTok: 10 },
    { id: "gpt-6-sol-pro", label: "GPT-6 Sol Pro", inputPerMTok: 2, outputPerMTok: 10 },
    { id: "gpt-6-luna", label: "GPT-6 Luna", inputPerMTok: 0.1, outputPerMTok: 0.5 },
    { id: "gpt-6-luna-pro", label: "GPT-6 Luna Pro", inputPerMTok: 0.1, outputPerMTok: 0.5 },
    { id: "gpt-6-astra", label: "GPT-6 Astra", inputPerMTok: 10, outputPerMTok: 50 },
    { id: "gpt-6-astra-pro", label: "GPT-6 Astra Pro", inputPerMTok: 10, outputPerMTok: 50 },
    { id: "gpt-5.6-sol", label: "GPT-5.6 Sol", inputPerMTok: 2, outputPerMTok: 10 },
    { id: "gpt-5.6-sol-pro", label: "GPT-5.6 Sol Pro", inputPerMTok: 2, outputPerMTok: 10 },
    { id: "gpt-5.6-terra", label: "GPT-5.6 Terra", inputPerMTok: 2, outputPerMTok: 12 },
    { id: "gpt-5.6-terra-pro", label: "GPT-5.6 Terra Pro", inputPerMTok: 2, outputPerMTok: 12 },
    { id: "gpt-5.6-luna", label: "GPT-5.6 Luna", inputPerMTok: 0.2, outputPerMTok: 1.2 },
    { id: "gpt-5.6-luna-pro", label: "GPT-5.6 Luna Pro", inputPerMTok: 0.2, outputPerMTok: 1.2 },
    { id: "gpt-5.5", label: "GPT-5.5", inputPerMTok: 5, outputPerMTok: 30 },
    { id: "gpt-5.5-pro", label: "GPT-5.5 Pro", inputPerMTok: 30, outputPerMTok: 180 },
    { id: "gpt-5.4", label: "GPT-5.4", inputPerMTok: 2.5, outputPerMTok: 15 },
    { id: "gpt-5.4-mini", label: "GPT-5.4 Mini", inputPerMTok: 0.75, outputPerMTok: 4.5 },
    { id: "gpt-5.4-nano", label: "GPT-5.4 Nano", inputPerMTok: 0.2, outputPerMTok: 1.25 },
    { id: "gpt-5.4-pro", label: "GPT-5.4 Pro", inputPerMTok: 30, outputPerMTok: 180 },
    { id: "gpt-5.2", label: "GPT-5.2", inputPerMTok: 1.75, outputPerMTok: 14 },
    { id: "gpt-5.1", label: "GPT-5.1", inputPerMTok: 1.25, outputPerMTok: 10 },
    { id: "gpt-5", label: "GPT-5", inputPerMTok: 1.25, outputPerMTok: 10 },
    { id: "gpt-5-mini", label: "GPT-5 mini", inputPerMTok: 0.25, outputPerMTok: 2 },
    { id: "gpt-5-nano", label: "GPT-5 nano", inputPerMTok: 0.05, outputPerMTok: 0.4 },
    { id: "gpt-4.1", label: "GPT-4.1", inputPerMTok: 2, outputPerMTok: 8 },
    { id: "gpt-4.1-mini", label: "GPT-4.1 Mini", inputPerMTok: 0.4, outputPerMTok: 1.6 },
    { id: "o3", label: "o3", inputPerMTok: 2, outputPerMTok: 8 },
    { id: "o4-mini", label: "o4 Mini", inputPerMTok: 1.1, outputPerMTok: 4.4 },
  ],
  openrouter: [
    { id: "anthropic/claude-sonnet-5.5", label: "Anthropic: Claude Sonnet 5.5", inputPerMTok: 2, outputPerMTok: 10 },
    { id: "anthropic/claude-sonnet-5", label: "Anthropic: Claude Sonnet 5", inputPerMTok: 2, outputPerMTok: 10 },
    { id: "anthropic/claude-opus-5.5", label: "Anthropic: Claude Opus 5.5", inputPerMTok: 4, outputPerMTok: 20 },
    { id: "openai/gpt-6.1-sol", label: "OpenAI: GPT-6.1 Sol", inputPerMTok: 2, outputPerMTok: 10 },
    { id: "openai/gpt-6-luna", label: "OpenAI: GPT-6 Luna", inputPerMTok: 0.1, outputPerMTok: 0.5 },
    { id: "google/gemini-3.8-flash", label: "Google: Gemini 3.8 Flash", inputPerMTok: 0.75, outputPerMTok: 3.75 },
    { id: "x-ai/grok-4.7", label: "SpaceXAI: Grok 4.7", inputPerMTok: 2, outputPerMTok: 6 },
    { id: "deepseek/deepseek-v4.1-flash", label: "DeepSeek: DeepSeek V4.1 Flash", inputPerMTok: 0.055, outputPerMTok: 1.32 },
  ],
};

/**
 * The model a provider starts on: when the provider is switched, and when the first key
 * decides the provider. Deliberately not "the newest in the list". It is the one new
 * agents have been running on, and a default is changed on purpose, after a run on the
 * new one, not by adding a row above it.
 */
export const DEFAULT_MODEL_ID: Record<LlmProvider, string> = {
  anthropic: "claude-sonnet-5",
  openai: "gpt-5",
  openrouter: "anthropic/claude-sonnet-5",
};

/**
 * A model id is printed on every public card, so it is bounded and has to look like an
 * id: letters, digits and `. _ : / -`, which covers every provider's ("gpt-5-mini",
 * "claude-haiku-4-5-20251001", "x-ai/grok-4.7", an OpenRouter ":free" variant). Free
 * text there could carry a megabyte, or a sentence beside the agent's name.
 */
export const MAX_MODEL_ID = 100;
export const MODEL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:\/-]*$/;

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
const BY_ID = new Map<string, ModelOption>();
// The first entry for an id wins, so a provider's own row is not replaced by OpenRouter's.
for (const model of ALL_MODELS) {
  const key = undated(model.id.toLowerCase());
  if (!BY_ID.has(key)) BY_ID.set(key, model);
}

/** Model id (undated) → the label the builder shows. */
export const MODEL_LABELS: Record<string, string> = Object.fromEntries(
  ALL_MODELS.map((m) => [undated(m.id), m.label]),
);

/** The catalogue row for a model id in any of its spellings, or null when it is not listed. */
export function knownModel(model: string | null | undefined): ModelOption | null {
  if (!model) return null;
  for (const spelling of spellings(model)) {
    const found = BY_ID.get(spelling);
    if (found) return found;
  }
  return null;
}

/**
 * The label for a model id, or null when it is not one the builder lists. Tries the id
 * as stored, then without an OpenRouter vendor prefix (`openai/gpt-5` is GPT-5).
 */
export function knownModelLabel(model: string): string | null {
  return knownModel(model)?.label ?? null;
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
