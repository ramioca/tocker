/**
 * The providers an agent can think on with its owner's own API key: the one list.
 *
 * Everything that names a provider reads it from here: the type, the label, what a key
 * looks like, where a key is made, the one host a key may be sent to, how the model
 * picker gets its list, the model a new agent starts on and what a run sends. Adding a
 * provider is a row here and an entry in the server map beside it (`providers-server.ts`);
 * the database column is plain text and needs no migration.
 *
 * Pure, with no import at all, on purpose. Client components read labels and hints from
 * it, `src/db/schema.ts` takes its provider type from it, and neither may gain an edge
 * to a module that can reach a secret.
 *
 * What is in a row was read from each provider's own documentation and API on
 * 2026-10-07. Prices are list prices in USD per million tokens and are what an estimate
 * is made from, never what is charged.
 */

export interface ModelOption {
  id: string;
  label: string;
  /** List price in USD per million tokens, when it is published. */
  inputPerMTok?: number;
  outputPerMTok?: number;
}

/**
 * Every provider that has a row, enabled or not.
 *
 * The order matters in one place: a model id looked up without a provider resolves to the
 * first list that has it (`models.ts`), so the three the builder started with stay first
 * and in their old order, then the companies that make models, then the hosts that
 * serve other people's.
 */
export const CATALOGUE_IDS = [
  "anthropic",
  "openai",
  "openrouter",
  "google",
  "xai",
  "deepseek",
  "mistral",
  "moonshot",
  "zai",
  "groq",
  "cerebras",
  "together",
  "fireworks",
  "deepinfra",
  "vercel",
  "venice",
  "nebius",
  "novita",
  "huggingface",
] as const;

export type CatalogueId = (typeof CATALOGUE_IDS)[number];

/**
 * The providers a key can be added for, and so the values `LlmProvider` has: every row
 * of the catalogue. To withdraw a provider, list the ids to keep here instead; a saved
 * key for one that is no longer listed is refused at use with `PROVIDER_UNSUPPORTED`,
 * and nothing in the database has to change.
 */
export const PROVIDER_IDS = CATALOGUE_IDS;

export type LlmProvider = (typeof PROVIDER_IDS)[number];

/**
 * Where the model picker's rows come from. `by-key`: the provider is asked with the
 * owner's saved key. `public`: the provider publishes its list and it is read without a
 * key. `built-in`: the provider has no list that says which models can call tools, so
 * the rows are `models` below.
 */
export type ModelListSource = "by-key" | "public" | "built-in";

/**
 * What a run does with the temperature in the agent's config. `send`: as it is. `omit`:
 * nothing is sent, because the provider ignores or advises against one. `{ max }`: the
 * provider refuses anything above it, so a higher setting is sent as the maximum.
 */
export type TemperatureRule = "send" | "omit" | { readonly max: number };

export interface ProviderRow {
  id: CatalogueId;
  /** The name as the provider writes it. */
  label: string;
  /** "an OpenAI key", "a Groq key": said by letter sound, which the spelling of "xAI" hides. */
  article: "a" | "an";
  /** Other words the chooser finds this provider by: its models, its older names. */
  search: readonly string[];
  /** Placeholder for the key field. */
  keyHint: string;
  /** Where a key is made. */
  keyPage: string;
  /**
   * What this provider's keys start with, listed only when no other provider's keys
   * start the same way. A key that carries one is refused under any other provider
   * before it is sent anywhere.
   */
  keyPrefixes: readonly string[];
  /**
   * True only where the provider's own documentation says every key starts with a
   * prefix above. A key without it is then refused here. Where the prefix has only been
   * seen in examples this stays false: refusing a real key because its format moved
   * would leave its owner with no way to add it.
   */
  requiresPrefix: boolean;
  /** The one https origin a key of this provider is sent to on a run. */
  origin: string;
  /**
   * Hugging Face only: the model router does not say whether a token is good, and the
   * call that does lives on the Hub's own host. The key check, and nothing else, may
   * send the token there.
   */
  keyCheckOrigin?: string;
  /** What the SDK is given as its base URL, always, so no environment variable can move it. */
  baseUrl: string;
  modelList: ModelListSource;
  /** The model a new agent starts on. One of `models`. */
  defaultModel: string;
  /** What the picker shows when it has no live list, and where built-in prices come from. */
  models: readonly ModelOption[];
  temperature: TemperatureRule;
  /**
   * Lower-case fragments of model ids that fix their own sampling. A model whose id has
   * one is sent no temperature whatever the rule above says.
   */
  fixedSampling?: readonly string[];
  /** Set only where the provider needs an output limit on every request. */
  maxOutputTokens?: number;
  /**
   * Set where the provider's API refuses a tool whose parameter is an object with no
   * declared properties (Gemini does). One of the agent's tools takes such a parameter;
   * for these providers it is declared as JSON in a string instead, which every API takes.
   */
  freeFormParams?: "json-string";
  /** One line under the chooser, for something a new account runs into. */
  note?: string;
}

/** Said when a saved key names a provider that has no row any more, or is not switched on. */
export const PROVIDER_UNSUPPORTED =
  "This key's provider is no longer supported. Add a key for another provider and select it on the agent.";

/**
 * Kimi models set their own temperature and top_p. Moonshot's documentation says they
 * are fixed and to leave them out, and Together, which answers 400 to a changed top_p,
 * lists the temperature as fixed too. So the hosts that serve Kimi are sent no
 * temperature for it: the one request every one of them accepts.
 */
const KIMI_FIXES_SAMPLING = ["kimi-k"] as const;

export const CATALOGUE: Readonly<Record<CatalogueId, ProviderRow>> = {
  anthropic: {
    id: "anthropic",
    label: "Anthropic",
    article: "an",
    search: ["claude", "sonnet", "opus", "haiku", "fable"],
    keyHint: "sk-ant-…",
    keyPage: "https://console.anthropic.com/settings/keys",
    keyPrefixes: ["sk-ant-"],
    requiresPrefix: false,
    origin: "https://api.anthropic.com",
    baseUrl: "https://api.anthropic.com/v1",
    modelList: "by-key",
    defaultModel: "claude-sonnet-5-5",
    // Newest first. Prices are Anthropic's list prices.
    models: [
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
    temperature: "send",
  },

  openai: {
    id: "openai",
    label: "OpenAI",
    article: "an",
    search: ["gpt", "chatgpt", "o3", "o4"],
    keyHint: "sk-…",
    keyPage: "https://platform.openai.com/api-keys",
    // A legacy key is a bare `sk-`, which is also how half the industry's keys start, so
    // only the three prefixes that are OpenAI's alone are listed.
    keyPrefixes: ["sk-proj-", "sk-svcacct-", "sk-admin-"],
    requiresPrefix: false,
    origin: "https://api.openai.com",
    baseUrl: "https://api.openai.com/v1",
    modelList: "by-key",
    defaultModel: "gpt-5",
    models: [
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
    temperature: "send",
  },

  openrouter: {
    id: "openrouter",
    label: "OpenRouter",
    article: "an",
    search: ["open router"],
    keyHint: "sk-or-…",
    keyPage: "https://openrouter.ai/keys",
    keyPrefixes: ["sk-or-"],
    requiresPrefix: false,
    origin: "https://openrouter.ai",
    baseUrl: "https://openrouter.ai/api/v1",
    // Hundreds of models that change weekly: read live (`openrouter-catalog.ts`). The
    // rows here are what the picker opens on and what it falls back to.
    modelList: "public",
    defaultModel: "anthropic/claude-sonnet-5.5",
    models: [
      { id: "anthropic/claude-sonnet-5.5", label: "Anthropic: Claude Sonnet 5.5", inputPerMTok: 2, outputPerMTok: 10 },
      { id: "anthropic/claude-sonnet-5", label: "Anthropic: Claude Sonnet 5", inputPerMTok: 2, outputPerMTok: 10 },
      { id: "anthropic/claude-opus-5.5", label: "Anthropic: Claude Opus 5.5", inputPerMTok: 4, outputPerMTok: 20 },
      { id: "openai/gpt-6.1-sol", label: "OpenAI: GPT-6.1 Sol", inputPerMTok: 2, outputPerMTok: 10 },
      { id: "openai/gpt-6-luna", label: "OpenAI: GPT-6 Luna", inputPerMTok: 0.1, outputPerMTok: 0.5 },
      { id: "google/gemini-3.8-flash", label: "Google: Gemini 3.8 Flash", inputPerMTok: 0.75, outputPerMTok: 3.75 },
      { id: "x-ai/grok-4.7", label: "SpaceXAI: Grok 4.7", inputPerMTok: 2, outputPerMTok: 6 },
      { id: "deepseek/deepseek-v4.1-flash", label: "DeepSeek: DeepSeek V4.1 Flash", inputPerMTok: 0.055, outputPerMTok: 1.32 },
    ],
    temperature: "send",
  },

  google: {
    id: "google",
    label: "Google Gemini",
    article: "a",
    search: ["ai studio", "aistudio", "generative language"],
    keyHint: "AIza… or AQ.…",
    keyPage: "https://aistudio.google.com/apikey",
    // Google documents neither. Older keys start AIza and keys made since May 2026 start
    // AQ., so both are recognised under another provider and neither is demanded here.
    keyPrefixes: ["AIza", "AQ."],
    requiresPrefix: false,
    origin: "https://generativelanguage.googleapis.com",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    modelList: "by-key",
    defaultModel: "gemini-3.8-flash",
    // The 2.5 models are left out: Google serves them only to accounts that already used them.
    models: [
      { id: "gemini-3.8-flash", label: "Gemini 3.8 Flash", inputPerMTok: 0.75, outputPerMTok: 3.75 },
      { id: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro (Preview)", inputPerMTok: 2, outputPerMTok: 12 },
      { id: "gemini-3.7-flash", label: "Gemini 3.7 Flash", inputPerMTok: 0.75, outputPerMTok: 3.75 },
      { id: "gemini-3.6-flash", label: "Gemini 3.6 Flash", inputPerMTok: 0.75, outputPerMTok: 3.75 },
      { id: "gemini-3.5-flash", label: "Gemini 3.5 Flash", inputPerMTok: 1.5, outputPerMTok: 9 },
      { id: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash-Lite", inputPerMTok: 0.3, outputPerMTok: 2.5 },
      { id: "gemini-3.1-flash-lite", label: "Gemini 3.1 Flash-Lite", inputPerMTok: 0.25, outputPerMTok: 1.5 },
      { id: "gemini-3-flash-preview", label: "Gemini 3 Flash (Preview)", inputPerMTok: 0.5, outputPerMTok: 3 },
    ],
    // Google advises leaving Gemini 3 at its own temperature: a lower one can make it loop.
    temperature: "omit",
    // Gemini's function declarations want every object parameter to name its properties.
    freeFormParams: "json-string",
    note: "A free-tier key has low limits, and Google may use what it is sent to improve its products. A key with billing turned on has neither.",
  },

  xai: {
    id: "xai",
    label: "xAI",
    article: "an",
    search: ["grok", "spacexai", "spacex", "x.ai"],
    keyHint: "xai-…",
    keyPage: "https://console.x.ai/team/default/api-keys",
    // Every key in xAI's API reference starts xai-, but no page says every key does.
    keyPrefixes: ["xai-"],
    requiresPrefix: false,
    origin: "https://api.x.ai",
    baseUrl: "https://api.x.ai/v1",
    modelList: "by-key",
    defaultModel: "grok-4.7",
    // grok-4.20-multi-agent is left out: it cannot call an app's own tools.
    models: [
      { id: "grok-4.7", label: "Grok 4.7", inputPerMTok: 2, outputPerMTok: 6 },
      { id: "grok-4.6", label: "Grok 4.6", inputPerMTok: 2, outputPerMTok: 6 },
      { id: "grok-4.5", label: "Grok 4.5", inputPerMTok: 2, outputPerMTok: 6 },
      { id: "grok-4.3", label: "Grok 4.3", inputPerMTok: 1.25, outputPerMTok: 2.5 },
      { id: "grok-4.20-0309-reasoning", label: "Grok 4.20 (Reasoning)", inputPerMTok: 1.25, outputPerMTok: 2.5 },
      { id: "grok-4.20-0309-non-reasoning", label: "Grok 4.20 (Non-Reasoning)", inputPerMTok: 1.25, outputPerMTok: 2.5 },
      { id: "grok-build-0.1", label: "Grok Build 0.1", inputPerMTok: 1, outputPerMTok: 2 },
    ],
    temperature: "send",
    note: "xAI is prepaid: buy credits in its console before the first run.",
  },

  deepseek: {
    id: "deepseek",
    label: "DeepSeek",
    article: "a",
    search: ["deep seek"],
    keyHint: "sk-…",
    keyPage: "https://platform.deepseek.com/api_keys",
    // A bare `sk-`, the same as a legacy OpenAI key: nothing here tells the two apart.
    keyPrefixes: [],
    requiresPrefix: false,
    origin: "https://api.deepseek.com",
    baseUrl: "https://api.deepseek.com",
    modelList: "by-key",
    defaultModel: "deepseek-flash",
    // DeepSeek sells two chat models. Prices are the peak rate; off-peak is half.
    models: [
      { id: "deepseek-flash", label: "DeepSeek V4.1 Flash", inputPerMTok: 0.3, outputPerMTok: 1.2 },
      { id: "deepseek-v4-pro", label: "DeepSeek V4 Pro", inputPerMTok: 1.32, outputPerMTok: 3.96 },
    ],
    // Thinking is on by default and the API ignores a temperature while it is.
    temperature: "omit",
    note: "DeepSeek is prepaid: top up the account before the first run.",
  },

  mistral: {
    id: "mistral",
    label: "Mistral AI",
    article: "a",
    search: ["la plateforme", "codestral", "ministral"],
    keyHint: "API key",
    keyPage: "https://console.mistral.ai/home?profile_dialog=api-keys",
    keyPrefixes: [],
    requiresPrefix: false,
    origin: "https://api.mistral.ai",
    baseUrl: "https://api.mistral.ai/v1",
    modelList: "by-key",
    // The alias, because it is the one id certain to be accepted: the dated ids below are
    // from Mistral's model cards and were not seen in a live list.
    defaultModel: "mistral-medium-latest",
    models: [
      { id: "mistral-medium-latest", label: "Mistral Medium (latest)", inputPerMTok: 1.5, outputPerMTok: 7.5 },
      { id: "mistral-medium-3-5", label: "Mistral Medium 3.5", inputPerMTok: 1.5, outputPerMTok: 7.5 },
      { id: "mistral-large-2512", label: "Mistral Large 3", inputPerMTok: 0.5, outputPerMTok: 1.5 },
      // The list price. Mistral sells the preview at half of it for now.
      { id: "mistral-large-4", label: "Mistral Large 4", inputPerMTok: 1.36, outputPerMTok: 4.18 },
      { id: "mistral-small-2603", label: "Mistral Small 4", inputPerMTok: 0.15, outputPerMTok: 0.6 },
      { id: "zai-glm-5-3", label: "Z.ai GLM 5.3", inputPerMTok: 1.4, outputPerMTok: 4.4 },
      { id: "ministral-14b-2512", label: "Ministral 3 14B", inputPerMTok: 0.2, outputPerMTok: 0.2 },
      { id: "ministral-8b-2512", label: "Ministral 3 8B", inputPerMTok: 0.15, outputPerMTok: 0.15 },
      { id: "ministral-3b-2512", label: "Ministral 3 3B", inputPerMTok: 0.1, outputPerMTok: 0.1 },
    ],
    // The API refuses a temperature above 1.5; the agent's setting goes to 2.
    temperature: { max: 1.5 },
    note: "Mistral does not publish its free plan's limits. An agent on a schedule is likely to need pay-as-you-go turned on.",
  },

  moonshot: {
    id: "moonshot",
    label: "Moonshot AI",
    article: "a",
    search: ["kimi", "moonshotai"],
    keyHint: "API key",
    keyPage: "https://platform.kimi.ai/console/api-keys",
    keyPrefixes: [],
    requiresPrefix: false,
    origin: "https://api.moonshot.ai",
    baseUrl: "https://api.moonshot.ai/v1",
    modelList: "by-key",
    defaultModel: "kimi-k3",
    // The four models Moonshot sells today. kimi-k2.5 and moonshot-v1 ended in August 2026.
    models: [
      { id: "kimi-k3", label: "Kimi K3", inputPerMTok: 3, outputPerMTok: 15 },
      { id: "kimi-k2.6", label: "Kimi K2.6", inputPerMTok: 0.95, outputPerMTok: 4 },
      { id: "kimi-k2.7-code", label: "Kimi K2.7 Code", inputPerMTok: 0.95, outputPerMTok: 4 },
      { id: "kimi-k2.7-code-highspeed", label: "Kimi K2.7 Code Highspeed", inputPerMTok: 1.9, outputPerMTok: 8 },
    ],
    // Every Kimi model fixes its own temperature.
    temperature: "omit",
    note: "Use a key from platform.kimi.ai, the global platform. Until the account has added $10 in total it is held to 3 requests a minute, too few for a run.",
  },

  zai: {
    id: "zai",
    label: "Z.AI",
    article: "a",
    search: ["zai", "zhipu", "glm", "bigmodel"],
    keyHint: "API key",
    keyPage: "https://z.ai/manage-apikey/apikey-list",
    keyPrefixes: [],
    requiresPrefix: false,
    origin: "https://api.z.ai",
    baseUrl: "https://api.z.ai/api/paas/v4",
    // Z.AI documents no model list, so these rows are the picker.
    modelList: "built-in",
    defaultModel: "glm-5.3",
    models: [
      { id: "glm-5.3", label: "GLM-5.3", inputPerMTok: 1.4, outputPerMTok: 4.4 },
      { id: "glm-5.2", label: "GLM-5.2", inputPerMTok: 1.4, outputPerMTok: 4.4 },
      { id: "glm-5.1", label: "GLM-5.1", inputPerMTok: 1.4, outputPerMTok: 4.4 },
      { id: "glm-5.3-flash", label: "GLM-5.3-Flash", inputPerMTok: 0.15, outputPerMTok: 0.5 },
      { id: "glm-5", label: "GLM-5", inputPerMTok: 1, outputPerMTok: 3.2 },
      { id: "glm-4.7", label: "GLM-4.7", inputPerMTok: 0.6, outputPerMTok: 2.2 },
      { id: "glm-4.6", label: "GLM-4.6", inputPerMTok: 0.6, outputPerMTok: 2.2 },
      { id: "glm-4.5-air", label: "GLM-4.5-Air", inputPerMTok: 0.2, outputPerMTok: 1.1 },
      { id: "glm-4.7-flashx", label: "GLM-4.7-FlashX", inputPerMTok: 0.07, outputPerMTok: 0.4 },
      { id: "glm-4.7-flash", label: "GLM-4.7-Flash", inputPerMTok: 0, outputPerMTok: 0 },
    ],
    // The API takes 0 to 1 and nothing above.
    temperature: { max: 1 },
    note: "Needs a pay-as-you-go balance on z.ai. A GLM Coding Plan key does not work here.",
  },

  groq: {
    id: "groq",
    label: "Groq",
    article: "a",
    search: ["groqcloud"],
    keyHint: "gsk_…",
    keyPage: "https://console.groq.com/keys",
    // Seen on every key and in Groq's own placeholder, but not documented as a rule.
    keyPrefixes: ["gsk_"],
    requiresPrefix: false,
    origin: "https://api.groq.com",
    baseUrl: "https://api.groq.com/openai/v1",
    modelList: "by-key",
    defaultModel: "openai/gpt-oss-120b",
    // The three chat models Groq sells self-serve. The rest of its list is speech and guard models.
    models: [
      { id: "openai/gpt-oss-120b", label: "GPT OSS 120B", inputPerMTok: 0.15, outputPerMTok: 0.6 },
      { id: "qwen/qwen3.8-27b", label: "Qwen 3.8 27B", inputPerMTok: 0.8, outputPerMTok: 4 },
      { id: "openai/gpt-oss-20b", label: "GPT OSS 20B", inputPerMTok: 0.075, outputPerMTok: 0.3 },
    ],
    temperature: "send",
    note: "The free plan allows 8,000 tokens a minute, less than one step of a run needs. Use a key on the Developer plan.",
  },

  cerebras: {
    id: "cerebras",
    label: "Cerebras",
    article: "a",
    search: ["cerebras inference"],
    keyHint: "csk-…",
    keyPage: "https://cloud.cerebras.ai",
    // Documented: Cerebras's own guides say a key "starts with csk-".
    keyPrefixes: ["csk-"],
    requiresPrefix: true,
    origin: "https://api.cerebras.ai",
    baseUrl: "https://api.cerebras.ai/v1",
    // Cerebras publishes a list with prices and a tools flag that needs no key.
    modelList: "public",
    defaultModel: "gpt-oss-120b",
    models: [
      { id: "gpt-oss-120b", label: "GPT OSS 120B", inputPerMTok: 0.35, outputPerMTok: 0.75 },
      { id: "qwen-3.8-27b", label: "Qwen 3.8 27B", inputPerMTok: 0.99, outputPerMTok: 1.49 },
    ],
    temperature: "send",
    // Cerebras counts a request's whole output allowance against the per-minute limit
    // before it runs, so a run states one rather than leaving it to the limiter's guess.
    // Both models think before they answer; this leaves room for that and for a tool call.
    maxOutputTokens: 8192,
    note: "The free trial allows 5 requests a minute, too few for a run. Buy credits first.",
  },

  together: {
    id: "together",
    label: "Together AI",
    article: "a",
    search: ["togetherai", "together.ai"],
    keyHint: "API key",
    keyPage: "https://api.together.ai/settings/projects/~current/api-keys",
    keyPrefixes: [],
    requiresPrefix: false,
    // The host in Together's documentation. The older api.together.xyz answers the same.
    origin: "https://api.together.ai",
    baseUrl: "https://api.together.ai/v1",
    // Together's list does not say which models can call tools; only its documentation
    // does. These rows are the ones it marks "Function calling: Yes".
    modelList: "built-in",
    defaultModel: "zai-org/GLM-5.3",
    models: [
      { id: "zai-org/GLM-5.3", label: "GLM-5.3", inputPerMTok: 1.4, outputPerMTok: 4.4 },
      { id: "zai-org/GLM-5.3-Flash", label: "GLM-5.3 Flash", inputPerMTok: 0.15, outputPerMTok: 0.5 },
      { id: "deepseek-ai/DeepSeek-V4-Pro-0813", label: "DeepSeek V4 Pro 0813", inputPerMTok: 1.32, outputPerMTok: 3.96 },
      { id: "deepseek-ai/DeepSeek-V4.1-Flash", label: "DeepSeek V4.1 Flash", inputPerMTok: 0.3, outputPerMTok: 1.2 },
      { id: "deepseek-ai/DeepSeek-V4-Flash-0731", label: "DeepSeek V4 Flash 0731", inputPerMTok: 0.14, outputPerMTok: 0.28 },
      { id: "MiniMaxAI/MiniMax-M3", label: "MiniMax M3", inputPerMTok: 0.3, outputPerMTok: 1.2 },
      { id: "thinkingmachines/Inkling", label: "Inkling", inputPerMTok: 1, outputPerMTok: 4.05 },
      { id: "openai/gpt-oss-120b", label: "GPT-OSS 120B", inputPerMTok: 0.15, outputPerMTok: 0.6 },
      { id: "moonshotai/Kimi-K3", label: "Kimi K3", inputPerMTok: 3, outputPerMTok: 15 },
      { id: "Qwen/Qwen3.5-9B", label: "Qwen3.5 9B", inputPerMTok: 0.17, outputPerMTok: 0.25 },
    ],
    temperature: "send",
    fixedSampling: KIMI_FIXES_SAMPLING,
    note: "Together AI has no free tier: buy credits before the first run.",
  },

  fireworks: {
    id: "fireworks",
    label: "Fireworks AI",
    article: "a",
    search: ["fireworks.ai"],
    keyHint: "fw_…",
    keyPage: "https://app.fireworks.ai/settings/users/api-keys",
    // Fireworks's documentation writes its keys fw_…, as a placeholder and not as a rule.
    keyPrefixes: ["fw_"],
    requiresPrefix: false,
    origin: "https://api.fireworks.ai",
    baseUrl: "https://api.fireworks.ai/inference/v1",
    modelList: "by-key",
    defaultModel: "accounts/fireworks/models/glm-5p3",
    // Fixed ids only. Fireworks's "-latest" aliases move to a newer model without notice.
    models: [
      { id: "accounts/fireworks/models/glm-5p3", label: "GLM 5.3", inputPerMTok: 1.4, outputPerMTok: 4.4 },
      { id: "accounts/fireworks/models/glm-5p3-flash", label: "GLM 5.3 Flash", inputPerMTok: 0.15, outputPerMTok: 0.5 },
      { id: "accounts/fireworks/models/deepseek-v4p1-flash", label: "DeepSeek V4.1 Flash", inputPerMTok: 0.3, outputPerMTok: 1.2 },
      { id: "accounts/fireworks/models/minimax-m3", label: "MiniMax M3", inputPerMTok: 0.3, outputPerMTok: 1.2 },
      { id: "accounts/fireworks/models/gpt-oss-120b", label: "OpenAI GPT OSS 120B", inputPerMTok: 0.15, outputPerMTok: 0.6 },
      { id: "accounts/fireworks/models/kimi-k3", label: "Kimi K3", inputPerMTok: 3, outputPerMTok: 15 },
      { id: "accounts/fireworks/models/ember-1", label: "Ember-1", inputPerMTok: 3, outputPerMTok: 15 },
      {
        id: "accounts/fireworks/models/nemotron-lightning-3p5-30b-a3b",
        label: "NVIDIA Nemotron 3.5 Lightning 30B A3B",
        inputPerMTok: 0.05,
        outputPerMTok: 0.2,
      },
    ],
    temperature: "send",
    fixedSampling: KIMI_FIXES_SAMPLING,
  },

  deepinfra: {
    id: "deepinfra",
    label: "DeepInfra",
    article: "a",
    search: ["deep infra"],
    keyHint: "API key",
    keyPage: "https://deepinfra.com/dash/api_keys",
    keyPrefixes: [],
    requiresPrefix: false,
    origin: "https://api.deepinfra.com",
    baseUrl: "https://api.deepinfra.com/v1",
    // DeepInfra publishes its list, with prices and a tools tag, without a key.
    modelList: "public",
    defaultModel: "zai-org/GLM-5.3",
    models: [
      { id: "zai-org/GLM-5.3", label: "GLM-5.3", inputPerMTok: 0.9, outputPerMTok: 4 },
      { id: "deepseek-ai/DeepSeek-V4-Flash-0731", label: "DeepSeek V4 Flash 0731", inputPerMTok: 0.06, outputPerMTok: 0.18 },
      { id: "zai-org/GLM-5.3-Flash", label: "GLM-5.3 Flash", inputPerMTok: 0.15, outputPerMTok: 0.5 },
      { id: "deepseek-ai/DeepSeek-V4-Pro-0813", label: "DeepSeek V4 Pro 0813", inputPerMTok: 1.3, outputPerMTok: 2.6 },
      { id: "deepseek-ai/DeepSeek-V4.1-Flash", label: "DeepSeek V4.1 Flash", inputPerMTok: 0.2, outputPerMTok: 0.6 },
      { id: "Qwen/Qwen3.5-27B", label: "Qwen3.5 27B", inputPerMTok: 0.26, outputPerMTok: 2.6 },
      { id: "google/gemma-4-31B-it-turbo", label: "Gemma 4 31B Turbo", inputPerMTok: 0.09, outputPerMTok: 0.34 },
      { id: "meta-llama/Llama-4-Scout-17B-16E-Instruct", label: "Llama 4 Scout", inputPerMTok: 0.1, outputPerMTok: 0.3 },
      { id: "openai/gpt-oss-120b", label: "GPT-OSS 120B", inputPerMTok: 0.037, outputPerMTok: 0.17 },
      { id: "moonshotai/Kimi-K3", label: "Kimi K3", inputPerMTok: 2.85, outputPerMTok: 14.25 },
    ],
    temperature: "send",
    fixedSampling: KIMI_FIXES_SAMPLING,
  },

  vercel: {
    id: "vercel",
    label: "Vercel AI Gateway",
    article: "a",
    search: ["ai-gateway", "aigateway"],
    keyHint: "vck_…",
    keyPage: "https://vercel.com/d?to=%2F%5Bteam%5D%2F%7E%2Fai-gateway%2Fapi-keys",
    // Vercel's key page shows a gateway key as vck_…; the gateway also takes a Vercel
    // access token, which does not start that way.
    keyPrefixes: ["vck_"],
    requiresPrefix: false,
    origin: "https://ai-gateway.vercel.sh",
    baseUrl: "https://ai-gateway.vercel.sh/v4/ai",
    // The gateway publishes its catalogue, with prices and a tool-use tag, without a key.
    modelList: "public",
    defaultModel: "anthropic/claude-sonnet-5.5",
    models: [
      { id: "anthropic/claude-sonnet-5.5", label: "Claude Sonnet 5.5", inputPerMTok: 2, outputPerMTok: 10 },
      { id: "openai/gpt-6.1-sol", label: "GPT-6.1 Sol", inputPerMTok: 2, outputPerMTok: 10 },
      { id: "anthropic/claude-opus-5.5", label: "Claude Opus 5.5", inputPerMTok: 4, outputPerMTok: 20 },
      { id: "google/gemini-3.8-flash", label: "Gemini 3.8 Flash", inputPerMTok: 0.75, outputPerMTok: 3.75 },
      { id: "spacexai/grok-4.7", label: "Grok 4.7", inputPerMTok: 2, outputPerMTok: 6 },
      { id: "zai/glm-5.3", label: "GLM 5.3", inputPerMTok: 1.4, outputPerMTok: 4.4 },
      { id: "anthropic/claude-haiku-4.5", label: "Claude Haiku 4.5", inputPerMTok: 1, outputPerMTok: 5 },
      { id: "deepseek/deepseek-v4.1-flash", label: "DeepSeek V4.1 Flash", inputPerMTok: 0.3, outputPerMTok: 1.2 },
      { id: "openai/gpt-6-luna", label: "GPT-6 Luna", inputPerMTok: 0.1, outputPerMTok: 0.5 },
      { id: "zai/glm-5.3-flash", label: "GLM 5.3 Flash", inputPerMTok: 0.15, outputPerMTok: 0.5 },
    ],
    // The gateway marks 27 of its tool-capable models, the default among them, as taking
    // no temperature, and does not say what it does when sent one. Sending none is the
    // one choice every model accepts.
    temperature: "omit",
    note: "The free tier covers only some models. The others need credits on your Vercel team.",
  },

  venice: {
    id: "venice",
    label: "Venice",
    article: "a",
    search: ["venice.ai"],
    keyHint: "API key",
    keyPage: "https://venice.ai/settings/api",
    keyPrefixes: [],
    requiresPrefix: false,
    origin: "https://api.venice.ai",
    baseUrl: "https://api.venice.ai/api/v1",
    // Venice publishes its list, with prices and a function-calling flag, without a key.
    modelList: "public",
    // The model Venice itself marks as its default for function calling.
    defaultModel: "zai-org-glm-5-2",
    models: [
      { id: "zai-org-glm-5-2", label: "GLM 5.2", inputPerMTok: 1.4, outputPerMTok: 4.4 },
      { id: "z-ai-glm-5-3", label: "GLM 5.3", inputPerMTok: 1.75, outputPerMTok: 5.5 },
      { id: "kimi-k3", label: "Kimi K3", inputPerMTok: 3.75, outputPerMTok: 18.75 },
      { id: "deepseek-v4-pro-0813", label: "DeepSeek V4 Pro 0813", inputPerMTok: 1.65, outputPerMTok: 4.95 },
      { id: "grok-4-7", label: "Grok 4.7", inputPerMTok: 2.27, outputPerMTok: 6.8 },
      { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5", inputPerMTok: 2.5, outputPerMTok: 12.5 },
      { id: "openai-gpt-6-sol", label: "GPT-6 Sol", inputPerMTok: 2.5, outputPerMTok: 12.5 },
      { id: "deepseek-v4-1-flash", label: "DeepSeek V4.1 Flash", inputPerMTok: 0.3, outputPerMTok: 1.2 },
      { id: "minimax-m3-preview", label: "MiniMax M3 Preview", inputPerMTok: 0.3, outputPerMTok: 1.2 },
      { id: "z-ai-glm-5-3-flash", label: "GLM 5.3 Flash", inputPerMTok: 0.15, outputPerMTok: 0.5 },
    ],
    temperature: "send",
    fixedSampling: KIMI_FIXES_SAMPLING,
  },

  nebius: {
    id: "nebius",
    label: "Nebius Token Factory",
    article: "a",
    search: ["ai studio", "tokenfactory"],
    keyHint: "API key",
    keyPage: "https://tokenfactory.nebius.com/project/api-keys",
    keyPrefixes: [],
    requiresPrefix: false,
    // The global host only. Nebius warns against its region hosts for shared models.
    origin: "https://api.tokenfactory.nebius.com",
    baseUrl: "https://api.tokenfactory.nebius.com/v1",
    modelList: "by-key",
    defaultModel: "zai-org/GLM-5.3",
    // The models Nebius tags for function calling. DeepSeek V4.1 Flash is not one of them there.
    models: [
      { id: "zai-org/GLM-5.3", label: "GLM-5.3", inputPerMTok: 1.4, outputPerMTok: 4.4 },
      { id: "moonshotai/Kimi-K3", label: "Kimi-K3", inputPerMTok: 3, outputPerMTok: 15 },
      { id: "deepseek-ai/DeepSeek-V4-Pro-0813", label: "DeepSeek-V4-Pro-0813", inputPerMTok: 1.32, outputPerMTok: 3.96 },
      { id: "MiniMaxAI/MiniMax-M3", label: "MiniMax-M3", inputPerMTok: 0.3, outputPerMTok: 1.2 },
      { id: "zai-org/GLM-5.2", label: "GLM-5.2", inputPerMTok: 1.4, outputPerMTok: 4.4 },
      { id: "moonshotai/Kimi-K2.7-Code", label: "Kimi-K2.7-Code", inputPerMTok: 0.95, outputPerMTok: 4 },
      { id: "Qwen/Qwen3.5-397B-A17B", label: "Qwen3.5-397B-A17B", inputPerMTok: 0.6, outputPerMTok: 3.6 },
      { id: "zai-org/GLM-5.3-Flash", label: "GLM-5.3-Flash", inputPerMTok: 0.15, outputPerMTok: 0.5 },
      { id: "deepseek-ai/DeepSeek-V4-Flash-0731", label: "DeepSeek-V4-Flash-0731", inputPerMTok: 0.14, outputPerMTok: 0.28 },
      { id: "openai/gpt-oss-120b", label: "gpt-oss-120b", inputPerMTok: 0.15, outputPerMTok: 0.6 },
    ],
    temperature: "send",
    fixedSampling: KIMI_FIXES_SAMPLING,
  },

  novita: {
    id: "novita",
    label: "Novita AI",
    article: "a",
    search: ["novita.ai"],
    keyHint: "sk_…",
    keyPage: "https://novita.ai/settings/key-management",
    // Documented: "Every key begins with the sk_ prefix". An underscore, not OpenAI's hyphen.
    keyPrefixes: ["sk_"],
    requiresPrefix: true,
    origin: "https://api.novita.ai",
    baseUrl: "https://api.novita.ai/openai/v1",
    // Novita publishes its list, with prices and a function-calling feature, without a key.
    modelList: "public",
    // The first three are the ones Novita recommends for agents and tool use.
    defaultModel: "zai-org/glm-5.2",
    models: [
      { id: "zai-org/glm-5.2", label: "GLM 5.2", inputPerMTok: 1.4, outputPerMTok: 4.4 },
      { id: "moonshotai/kimi-k2.7-code", label: "Kimi K2.7 Code", inputPerMTok: 0.95, outputPerMTok: 4 },
      { id: "minimax/minimax-m3", label: "MiniMax M3", inputPerMTok: 0.3, outputPerMTok: 1.2 },
      { id: "zai-org/glm-5.3", label: "GLM 5.3", inputPerMTok: 1.4, outputPerMTok: 4.4 },
      { id: "deepseek/deepseek-v4-pro", label: "DeepSeek V4 Pro", inputPerMTok: 1.6, outputPerMTok: 3.2 },
      { id: "moonshotai/kimi-k3", label: "Kimi K3", inputPerMTok: 3, outputPerMTok: 15 },
      { id: "qwen/qwen3.8-max", label: "Qwen3.8 Max", inputPerMTok: 2, outputPerMTok: 6 },
      { id: "deepseek/deepseek-v4.1-flash", label: "DeepSeek V4.1 Flash", inputPerMTok: 0.3, outputPerMTok: 1.2 },
      { id: "qwen/qwen3.5-397b-a17b", label: "Qwen3.5 397B A17B", inputPerMTok: 0.6, outputPerMTok: 3.6 },
      { id: "zai-org/glm-5.3-flash", label: "GLM 5.3 Flash", inputPerMTok: 0.15, outputPerMTok: 0.5 },
    ],
    temperature: "send",
    fixedSampling: KIMI_FIXES_SAMPLING,
    // Novita's chat reference marks the output limit as required. It counts a thinking
    // model's reasoning too, so it is set well above what a step's answer needs.
    maxOutputTokens: 8192,
  },

  huggingface: {
    id: "huggingface",
    label: "Hugging Face",
    article: "a",
    search: ["hf", "huggingface", "inference providers", "token"],
    keyHint: "hf_…",
    // Hugging Face's own link to a new token with the one permission a run needs.
    keyPage: "https://huggingface.co/settings/tokens/new?ownUserPermissions=inference.serverless.write&tokenType=fineGrained",
    // Hugging Face's documentation writes a token as hf_…, in an example and not as a rule.
    keyPrefixes: ["hf_"],
    requiresPrefix: false,
    origin: "https://router.huggingface.co",
    keyCheckOrigin: "https://huggingface.co",
    baseUrl: "https://router.huggingface.co/v1",
    // The router publishes its list, with each serving provider's price and tool support, without a token.
    modelList: "public",
    defaultModel: "zai-org/GLM-5.3",
    // Each price is the highest among the providers serving the model with tools, so an
    // estimate made from it is never low.
    models: [
      { id: "zai-org/GLM-5.3", label: "GLM-5.3", inputPerMTok: 1.4, outputPerMTok: 4.4 },
      { id: "moonshotai/Kimi-K3", label: "Kimi K3", inputPerMTok: 3, outputPerMTok: 15 },
      { id: "deepseek-ai/DeepSeek-V4-Pro-0813", label: "DeepSeek V4 Pro 0813", inputPerMTok: 1.32, outputPerMTok: 3.96 },
      { id: "MiniMaxAI/MiniMax-M3", label: "MiniMax M3", inputPerMTok: 0.3, outputPerMTok: 1.2 },
      { id: "zai-org/GLM-5.2", label: "GLM-5.2", inputPerMTok: 2.052, outputPerMTok: 6.27 },
      { id: "Qwen/Qwen3.8-2.4T-A95B", label: "Qwen3.8 2.4T", inputPerMTok: 2, outputPerMTok: 6 },
      { id: "moonshotai/Kimi-K2.7-Code", label: "Kimi K2.7 Code", inputPerMTok: 0.95, outputPerMTok: 4 },
      { id: "deepseek-ai/DeepSeek-V4.1-Flash", label: "DeepSeek V4.1 Flash", inputPerMTok: 0.3, outputPerMTok: 1.2 },
      { id: "zai-org/GLM-5.3-Flash", label: "GLM-5.3 Flash", inputPerMTok: 0.15, outputPerMTok: 0.5 },
      { id: "openai/gpt-oss-120b", label: "gpt-oss-120b", inputPerMTok: 0.35, outputPerMTok: 0.75 },
    ],
    temperature: "send",
    fixedSampling: KIMI_FIXES_SAMPLING,
    note: "The token needs the permission “Make calls to Inference Providers”.",
  },
};

// Looked up through maps built from the lists above, never by indexing an object with a
// string that came from a form or a database row: "constructor" is not a provider.
const ROWS: ReadonlyMap<string, ProviderRow> = new Map(CATALOGUE_IDS.map((id) => [id, CATALOGUE[id]]));
const ENABLED: ReadonlySet<string> = new Set(PROVIDER_IDS);

/** Is this one of the providers a key can be added for? The gate for anything a client or a stored row says. */
export function isProvider(value: unknown): value is LlmProvider {
  return typeof value === "string" && ENABLED.has(value);
}

/** Does this provider have a row, switched on or not? */
export function isCatalogueId(value: unknown): value is CatalogueId {
  return typeof value === "string" && ROWS.has(value);
}

/**
 * The row for a provider. Throws the sentence a person can read for an id that has none,
 * so a stale value can never fall through to some other provider's host. Ask
 * `isProvider` first wherever the id came from a form or a stored row.
 */
export function providerRow(id: CatalogueId): ProviderRow {
  const row = ROWS.get(id);
  if (!row) throw new Error(PROVIDER_UNSUPPORTED);
  return row;
}

/** "OpenAI" for `openai`; an id with no row is returned as stored rather than guessed at. */
export function providerLabel(id: string): string {
  return ROWS.get(id)?.label ?? id;
}

/** "an OpenAI", "a Groq", "an xAI": the label with the article a sentence needs before it. */
export function withArticle(id: string): string {
  const row = ROWS.get(id);
  if (row) return `${row.article} ${row.label}`;
  return `${/^[aeiou]/i.test(id) ? "an" : "a"} ${id}`;
}

/** The providers people look for first, in the order the chooser leads with them. */
const LEADING: readonly CatalogueId[] = ["anthropic", "openai", "google", "xai", "openrouter"];

/** Display order for a set of providers: the leading five that are in it, then the rest by label. */
export function providersInOrder<T extends CatalogueId>(ids: readonly T[]): T[] {
  const given = new Set<CatalogueId>(ids);
  const lead = LEADING.filter((id): id is T => given.has(id));
  const rest = ids
    .filter((id) => !LEADING.includes(id))
    .sort((a, b) => {
      const [x, y] = [CATALOGUE[a].label.toLowerCase(), CATALOGUE[b].label.toLowerCase()];
      return x < y ? -1 : x > y ? 1 : 0;
    });
  return [...lead, ...rest];
}

/** The enabled providers in the order the chooser lists them. */
export const PROVIDER_ORDER: readonly LlmProvider[] = providersInOrder(PROVIDER_IDS);

/**
 * The providers in `ids` a search leaves, in their own order. Every word typed has to
 * appear in the label, the id or one of the row's search words, so "grok" finds xAI and
 * "ai gateway" finds Vercel.
 */
export function searchProviders<T extends CatalogueId>(ids: readonly T[], query: string): T[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...ids];
  return ids.filter((id) => {
    const row = CATALOGUE[id];
    const text = `${row.label} ${row.id} ${row.search.join(" ")}`.toLowerCase();
    return words.every((word) => text.includes(word));
  });
}

/** What the chooser shows for what was typed: enabled providers only, in display order. */
export function filterProviders(query: string): LlmProvider[] {
  return searchProviders(PROVIDER_ORDER, query);
}

/**
 * The provider whose prefix this key starts with, enabled or not, or null when it starts
 * with none of them. A bare `sk-` names nobody: OpenAI's older keys, DeepSeek's and
 * others all start that way.
 */
export function keyPrefixProvider(key: string): CatalogueId | null {
  const k = key.trim();
  for (const id of CATALOGUE_IDS) {
    if (CATALOGUE[id].keyPrefixes.some((prefix) => k.startsWith(prefix))) return id;
  }
  return null;
}

/** Whether the refusal is for a new key or for replacing a saved one: the way out differs. */
export type KeyUse = "add" | "rotate";

/**
 * The sentence for a key that is `detected`'s under a provider that is not. A provider
 * that is not switched on yet cannot be offered as the fix, so the sentence stops at
 * saying whose key it is.
 */
export function wrongProviderSentence(detected: CatalogueId, chosen: CatalogueId, use: KeyUse = "add"): string {
  const offered = isProvider(detected);
  const cannot = `Tocker cannot use ${providerLabel(detected)} keys`;
  if (use === "rotate") {
    const said = `That looks like ${withArticle(detected)} key; this is ${withArticle(chosen)} key`;
    return offered ? `${said} — add it as a new key instead` : `${said}. ${cannot}`;
  }
  const said = `That looks like ${withArticle(detected)} key, not ${withArticle(chosen)} one`;
  return offered ? `${said} — choose ${providerLabel(detected)} as the provider` : `${said}. ${cannot}`;
}

/**
 * Why this key must not be sent to this provider, as the one sentence to show, or null
 * when nothing here speaks against it.
 *
 * Two refusals, both made before any request. The key starts the way another provider's
 * keys do: sending it would hand that provider's credential to this one. Or this
 * provider documents a prefix on every key and the key has none: it is some other
 * service's, or not all of it was pasted. Nothing is ever refused for its length or its
 * characters, because most providers publish neither.
 */
export function keyProblem(provider: CatalogueId, key: string, use: KeyUse = "add"): string | null {
  const row = providerRow(provider);
  const detected = keyPrefixProvider(key);
  if (detected && detected !== provider) return wrongProviderSentence(detected, provider, use);
  if (row.requiresPrefix && !detected) {
    const starts = row.keyPrefixes.join(" or ");
    const fix = use === "rotate" ? "check you copied all of it" : "check you copied all of it, or choose the provider this key is from";
    return `${row.label} keys start with ${starts} — ${fix}`;
  }
  return null;
}

/**
 * The temperature to send on a run, or undefined to send none. `configured` is the
 * agent's setting (0 to 2); `model`, when given, lets a model that fixes its own
 * sampling be left alone on a provider that otherwise takes a temperature.
 */
export function requestTemperature(provider: CatalogueId, configured: number, model?: string | null): number | undefined {
  const row = providerRow(provider);
  if (row.temperature === "omit") return undefined;
  if (model && row.fixedSampling?.some((part) => model.toLowerCase().includes(part))) return undefined;
  return row.temperature === "send" ? configured : Math.min(configured, row.temperature.max);
}
