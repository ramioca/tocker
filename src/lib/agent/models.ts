/**
 * The models the builder offers, and what each one is called.
 *
 * A leaf module on purpose — no zod, no schema — so a chip on a card can print
 * "GPT-5 mini" without pulling the whole agent config into a client bundle.
 * `config.ts` re-exports `DEFAULT_MODELS` for the builder and settings form.
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

export const DEFAULT_MODELS: Record<LlmProvider, { id: string; label: string }[]> = {
  anthropic: [
    { id: "claude-sonnet-5", label: "Claude Sonnet 5" },
    { id: "claude-opus-5", label: "Claude Opus 5" },
    { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5" },
  ],
  openai: [
    { id: "gpt-5", label: "GPT-5" },
    { id: "gpt-5-mini", label: "GPT-5 mini" },
  ],
  openrouter: [
    { id: "anthropic/claude-sonnet-5", label: "Claude Sonnet 5 (OpenRouter)" },
    { id: "nousresearch/hermes-4-405b", label: "Hermes 4 405B" },
    { id: "deepseek/deepseek-v4", label: "DeepSeek V4" },
  ],
};

/** A dated snapshot id and its alias are the same model: `claude-haiku-4-5[-20251001]`. */
const undated = (id: string) => id.replace(/-\d{8}$/, "");

/** Model id (undated) → the label the builder shows. */
export const MODEL_LABELS: Record<string, string> = Object.fromEntries(
  Object.values(DEFAULT_MODELS)
    .flat()
    .map((m) => [undated(m.id), m.label]),
);

/**
 * The label for a model id, or null when it is not one the builder offers. Tries the id
 * as stored, then without an OpenRouter vendor prefix (`openai/gpt-5` is GPT-5).
 */
export function knownModelLabel(model: string): string | null {
  const id = undated(model);
  const bare = id.includes("/") ? id.split("/").slice(1).join("/") : id;
  return MODEL_LABELS[id] ?? MODEL_LABELS[bare] ?? null;
}
