import { describe, expect, it } from "vitest";
import {
  DEFAULT_MODELS,
  DEFAULT_MODEL_ID,
  MODEL_PICKER_ROWS,
  PROVIDER_LABELS,
  featuredFirst,
  filterModels,
  isModelId,
  knownModel,
  knownModelLabel,
  modelNameOnAnyProvider,
  priceHint,
  providerLabel,
  typedModelId,
  type LlmProvider,
} from "./models";
import { CATALOGUE, CATALOGUE_IDS, PROVIDER_IDS, isProvider } from "./providers";

/** Whether a provider is switched on. A plain yes or no, so it narrows no type. */
const enabled = (id: string): boolean => isProvider(id);

const PROVIDERS = Object.keys(DEFAULT_MODELS) as LlmProvider[];

describe("the model lists", () => {
  it("offers the current Claude models, by their exact ids", () => {
    const ids = DEFAULT_MODELS.anthropic.map((model) => model.id);
    for (const id of ["claude-sonnet-5-5", "claude-opus-5-5", "claude-fable-5-1", "claude-sonnet-5", "claude-opus-5"]) {
      expect(ids, id).toContain(id);
    }
    // The newest Sonnet leads the list.
    expect(ids[0]).toBe("claude-sonnet-5-5");
  });

  it("lists nothing twice, and nothing that could not be sent as a model id", () => {
    for (const provider of PROVIDERS) {
      const ids = DEFAULT_MODELS[provider].map((model) => model.id);
      expect(new Set(ids).size, provider).toBe(ids.length);
      for (const id of ids) expect(isModelId(id), id).toBe(true);
    }
  });

  it("gives every listed model a label and a price", () => {
    for (const model of Object.values(DEFAULT_MODELS).flat()) {
      expect(model.label.length, model.id).toBeGreaterThan(0);
      expect(model.inputPerMTok, model.id).toBeGreaterThanOrEqual(0);
      expect(model.outputPerMTok, model.id).toBeGreaterThanOrEqual(model.inputPerMTok ?? 0);
    }
  });

  /** A provider's default is chosen on purpose; it must at least be something the list offers. */
  it("starts each provider on a model its own list offers", () => {
    for (const provider of PROVIDERS) {
      expect(DEFAULT_MODELS[provider].map((model) => model.id), provider).toContain(DEFAULT_MODEL_ID[provider]);
    }
  });

  /** These three names are older than the registry and are read from it now. */
  it("reads the labels, lists and defaults off the registry, for exactly the enabled providers", () => {
    expect(Object.keys(DEFAULT_MODELS)).toEqual([...PROVIDER_IDS]);
    expect(Object.keys(DEFAULT_MODEL_ID)).toEqual([...PROVIDER_IDS]);
    expect(Object.keys(PROVIDER_LABELS)).toEqual([...PROVIDER_IDS]);
    for (const provider of PROVIDER_IDS) {
      expect(DEFAULT_MODELS[provider], provider).toEqual(CATALOGUE[provider].models);
      expect(DEFAULT_MODEL_ID[provider], provider).toBe(CATALOGUE[provider].defaultModel);
      expect(PROVIDER_LABELS[provider], provider).toBe(CATALOGUE[provider].label);
    }
  });

  it("starts the three there were before on the models they started on", () => {
    expect(DEFAULT_MODEL_ID.anthropic).toBe("claude-sonnet-5-5");
    expect(DEFAULT_MODEL_ID.openai).toBe("gpt-5");
    expect(DEFAULT_MODEL_ID.openrouter).toBe("anthropic/claude-sonnet-5.5");
  });
});

describe("knownModelLabel", () => {
  it("returns the builder's name for every id it offers", () => {
    expect(knownModelLabel("gpt-5-mini")).toBe("GPT-5 mini");
    expect(knownModelLabel("claude-sonnet-5-5")).toBe("Claude Sonnet 5.5");
    expect(knownModelLabel("deepseek/deepseek-v4.1-flash")).toBe("DeepSeek: DeepSeek V4.1 Flash");
  });

  it("matches either side of a dated alias, and looks through a vendor prefix", () => {
    expect(knownModelLabel("claude-haiku-4-5-20251001")).toBe("Claude Haiku 4.5");
    expect(knownModelLabel("claude-haiku-4-5")).toBe("Claude Haiku 4.5");
    expect(knownModelLabel("openai/gpt-5")).toBe("GPT-5");
  });

  /** OpenRouter writes the version with a dot where Anthropic's own id has a dash. */
  it("reads OpenRouter's dotted Claude ids as the same model", () => {
    expect(knownModel("anthropic/claude-opus-4.8")?.id).toBe("claude-opus-4-8");
    expect(knownModel("anthropic/claude-fable-5.1")?.label).toBe("Claude Fable 5.1");
  });

  it("does not take one version for another", () => {
    expect(knownModel("claude-opus-5-5")?.inputPerMTok).toBe(4);
    expect(knownModel("claude-opus-5")?.inputPerMTok).toBe(5);
    expect(knownModel("gpt-5.4")?.label).toBe("GPT-5.4");
    expect(knownModel("gpt-5-4")).toBeNull();
  });

  it("says it does not know rather than guessing", () => {
    expect(knownModelLabel("mistral/mistral-large-2")).toBeNull();
    expect(knownModelLabel("claude-sonnet-9")).toBeNull();
    expect(knownModelLabel("")).toBeNull();
    expect(knownModel(null)).toBeNull();
  });
});

/**
 * The same open model is a different id at a different price on every host, so a caller
 * that knows the provider gets that provider's row and never a neighbour's.
 */
describe("knownModel, for the provider a model is used on", () => {
  it("finds every listed model on its own provider, at that provider's price", () => {
    for (const provider of CATALOGUE_IDS) {
      for (const model of CATALOGUE[provider].models) {
        expect(knownModel(model.id, provider), `${provider} ${model.id}`).toEqual(model);
      }
    }
  });

  it("tells one host's price for a model from another's", () => {
    expect(knownModel("zai-org/GLM-5.3", "together")?.inputPerMTok).toBe(1.4);
    expect(knownModel("zai-org/GLM-5.3", "deepinfra")?.inputPerMTok).toBe(0.9);
    expect(knownModel("openai/gpt-oss-120b", "groq")?.outputPerMTok).toBe(0.6);
    expect(knownModel("openai/gpt-oss-120b", "deepinfra")?.outputPerMTok).toBe(0.17);
    expect(knownModel("kimi-k3", "moonshot")?.inputPerMTok).toBe(3);
    expect(knownModel("kimi-k3", "venice")?.inputPerMTok).toBe(3.75);
    expect(knownModelLabel("gpt-oss-120b", "cerebras")).toBe("GPT OSS 120B");
  });

  /** A price borrowed from another host would be a wrong number; "not listed" is a true one. */
  it("does not borrow another provider's row for a provider added since", () => {
    expect(knownModel("claude-sonnet-5-5", "groq")).toBeNull();
    expect(knownModel("zai-org/GLM-5.2", "deepinfra")).toBeNull();
    expect(knownModel("gemini-3.8-flash", "xai")).toBeNull();
    // Z.AI's own id for the model is not Together's id for it.
    expect(knownModel("glm-5.3", "together")).toBeNull();
  });

  /**
   * Nothing changes for an agent on Anthropic, OpenAI or OpenRouter when its provider is
   * passed: the price is the one it had, and the row is the same wherever the id is one
   * the provider itself lists. The only difference is a name: an OpenRouter-style id
   * asked about on OpenAI is called what OpenAI calls it.
   */
  it("prices the three there were before exactly as it does without a provider", () => {
    const three = ["anthropic", "openai", "openrouter"] as const;
    const asked = three.flatMap((provider) => CATALOGUE[provider].models.map((model) => model.id));
    asked.push("claude-haiku-4-5", "openai/gpt-5", "anthropic/claude-opus-4.8", "anthropic/claude-fable-5.1", "z-ai/glm-5.3", "gpt-5-4", "");
    const price = (id: string, provider?: string) => {
      const found = knownModel(id, provider);
      return found ? [found.inputPerMTok, found.outputPerMTok] : null;
    };
    for (const id of asked) {
      for (const provider of three) expect(price(id, provider), `${provider} ${id}`).toEqual(price(id));
      expect(knownModel(id, "openrouter"), id).toEqual(knownModel(id));
    }
    for (const provider of three) {
      for (const model of CATALOGUE[provider].models) expect(knownModel(model.id, provider), model.id).toEqual(knownModel(model.id));
    }
    // OpenRouter sells Anthropic's models at Anthropic's price, under a longer id.
    expect(knownModel("anthropic/claude-opus-4.8", "openrouter")?.inputPerMTok).toBe(5);
    expect(knownModel("openai/gpt-6.1-sol", "openai")?.label).toBe("GPT-6.1 Sol");
    // A model none of the three lists stays unknown for them, whatever else is enabled.
    expect(knownModel("z-ai/glm-5.3", "openrouter")).toBeNull();
    expect(knownModel("kimi-k3", "openrouter")).toBeNull();
  });

  /**
   * A caller with no provider (a public card, a pay-per-use comparison) reads the first
   * three lists and no other, so switching a provider on moves no existing agent's name
   * or price. Every id below is on a later provider's list and on none of the three's.
   */
  it("reads only the three first lists when it is given no provider", () => {
    for (const id of ["grok-4.3", "kimi-k2.6", "glm-5.3", "gpt-oss-120b", "z-ai/glm-5.3", "moonshotai/Kimi-K3", "zai-org/GLM-5.3"]) {
      expect(knownModel(id), id).toBeNull();
      expect(knownModelLabel(id), id).toBeNull();
    }
    expect(knownModel("gemini-3.8-flash")).toBeNull();
    expect(knownModel("google/gemini-3.8-flash")?.label).toBe("Google: Gemini 3.8 Flash");
  });
});

describe("modelNameOnAnyProvider", () => {
  it("names every model the first three list exactly as knownModelLabel does", () => {
    const asked = (["anthropic", "openai", "openrouter"] as const).flatMap((provider) => CATALOGUE[provider].models.map((model) => model.id));
    asked.push("claude-haiku-4-5", "openai/gpt-5", "anthropic/claude-opus-4.8", "anthropic/claude-fable-5.1");
    for (const id of asked) expect(modelNameOnAnyProvider(id), id).toBe(knownModelLabel(id));
  });

  /** For a card that has only the id: the name a provider added since gives it, once that provider is on. */
  it("names a model only a later provider lists, when that provider is enabled", () => {
    expect(modelNameOnAnyProvider("grok-4.3")).toBe(enabled("xai") ? "Grok 4.3" : null);
    expect(modelNameOnAnyProvider("kimi-k2.6")).toBe(enabled("moonshot") ? "Kimi K2.6" : null);
    expect(modelNameOnAnyProvider("accounts/fireworks/models/glm-5p3")).toBe(enabled("fireworks") ? "GLM 5.3" : null);
    expect(modelNameOnAnyProvider("gemini-3.8-flash")).toBe(enabled("google") ? "Gemini 3.8 Flash" : null);
  });

  it("says it does not know rather than guessing", () => {
    expect(modelNameOnAnyProvider("claude-sonnet-9")).toBeNull();
    expect(modelNameOnAnyProvider("mistral/mistral-large-2")).toBeNull();
    expect(modelNameOnAnyProvider("")).toBeNull();
    expect(modelNameOnAnyProvider(null)).toBeNull();
  });

  it("treats a provider it has no row for as no provider at all", () => {
    expect(knownModel("gpt-5", "cohere")?.label).toBe("GPT-5");
    expect(knownModel("gpt-5", "constructor")?.label).toBe("GPT-5");
    expect(knownModel("gpt-5", null)?.label).toBe("GPT-5");
    expect(knownModel(null, "openai")).toBeNull();
  });
});

describe("isModelId", () => {
  it("takes the shapes providers use", () => {
    for (const id of ["claude-sonnet-5-5", "gpt-6.1-sol", "x-ai/grok-4.7", "meta-llama/llama-4-scout:free", "ft:gpt-5:acme::abc123"]) {
      expect(isModelId(id), id).toBe(true);
    }
  });

  it("refuses text, markup, and anything too long to be an id", () => {
    for (const id of ["", "sonnet 5.5", "-leading-dash", "<b>gpt-5</b>", "claude\nsonnet", "a".repeat(101)]) {
      expect(isModelId(id), JSON.stringify(id.slice(0, 20))).toBe(false);
    }
  });

  /**
   * Google's API carries the model id in the address of the request. An id that could
   * climb out of that path would send the owner's key to some other endpoint there.
   */
  it("refuses an id that could walk out of a path it is put in", () => {
    for (const id of ["gemini/../../v1/files", "..", "a/..", "../a", "models/x/..%2f", "gemini..flash", "a...b"]) {
      expect(isModelId(id), id).toBe(false);
    }
    for (const id of ["gemini-3.8-flash", "accounts/fireworks/models/glm-5p3", "Qwen/Qwen3.8-2.4T-A95B", "zai-org/GLM-5.3:cheapest", "a.b.c"]) {
      expect(isModelId(id), id).toBe(true);
    }
  });
});

describe("filterModels", () => {
  const anthropic = DEFAULT_MODELS.anthropic;

  it("returns the list as it is when nothing is typed", () => {
    expect(filterModels(anthropic, "")).toEqual(anthropic);
    expect(filterModels(anthropic, "   ")).toEqual(anthropic);
  });

  it("finds a model by its name or its id, whatever the order of the words", () => {
    expect(filterModels(anthropic, "sonnet 5.5").map((m) => m.id)).toEqual(["claude-sonnet-5-5"]);
    expect(filterModels(anthropic, "5.5 SONNET").map((m) => m.id)).toEqual(["claude-sonnet-5-5"]);
    expect(filterModels(anthropic, "opus-5-5").map((m) => m.id)).toEqual(["claude-opus-5-5"]);
    expect(filterModels(anthropic, "haiku").map((m) => m.id)).toEqual(["claude-haiku-4-5-20251001"]);
  });

  it("keeps the list's order and returns nothing for no match", () => {
    expect(filterModels(anthropic, "opus").map((m) => m.id)).toEqual(
      anthropic.filter((m) => m.id.includes("opus")).map((m) => m.id),
    );
    expect(filterModels(anthropic, "gemini")).toEqual([]);
  });

  it("draws a bounded number of rows from a long list", () => {
    const many = Array.from({ length: 400 }, (_, i) => ({ id: `vendor/model-${i}`, label: `Model ${i}` }));
    expect(filterModels(many, "")).toHaveLength(MODEL_PICKER_ROWS);
    expect(filterModels(many, "model")).toHaveLength(MODEL_PICKER_ROWS);
    expect(filterModels(many, "model-399").map((m) => m.id)).toEqual(["vendor/model-399"]);
  });
});

describe("featuredFirst", () => {
  const live = ["v/newest", "anthropic/claude-sonnet-5.5", "v/other", "openai/gpt-6.1-sol"].map((id) => ({ id, label: id }));

  it("opens the list on the featured models that are in it, in their own order, and keeps the rest", () => {
    const ordered = featuredFirst(live, DEFAULT_MODELS.openrouter).map((m) => m.id);
    expect(ordered).toEqual(["anthropic/claude-sonnet-5.5", "openai/gpt-6.1-sol", "v/newest", "v/other"]);
  });

  /** A featured row the live list no longer carries is not put back. */
  it("adds nothing the list does not have", () => {
    expect(featuredFirst([{ id: "v/only", label: "Only" }], DEFAULT_MODELS.openrouter)).toEqual([{ id: "v/only", label: "Only" }]);
    expect(featuredFirst([], DEFAULT_MODELS.openrouter)).toEqual([]);
  });

  it("uses the live row, with the live price, for a featured model", () => {
    const priced = [{ id: "anthropic/claude-sonnet-5.5", label: "Live name", inputPerMTok: 9, outputPerMTok: 9 }];
    expect(featuredFirst(priced, DEFAULT_MODELS.openrouter)).toEqual(priced);
  });
});

describe("typedModelId", () => {
  const anthropic = DEFAULT_MODELS.anthropic;

  /** A provider ships a model before this list is edited; what is typed can still be used. */
  it("offers what was typed when it is an id the list does not have", () => {
    expect(typedModelId(anthropic, "claude-sonnet-6")).toBe("claude-sonnet-6");
    expect(typedModelId(anthropic, "  claude-sonnet-6  ")).toBe("claude-sonnet-6");
    expect(typedModelId(DEFAULT_MODELS.openrouter, "moonshotai/kimi-k3")).toBe("moonshotai/kimi-k3");
  });

  it("offers nothing for a row that is already there, a search phrase, or a stub", () => {
    expect(typedModelId(anthropic, "claude-sonnet-5-5")).toBeNull();
    expect(typedModelId(anthropic, "sonnet 5.5")).toBeNull();
    expect(typedModelId(anthropic, "cl")).toBeNull();
    expect(typedModelId(anthropic, "")).toBeNull();
  });
});

describe("priceHint", () => {
  it("prints list prices per million tokens", () => {
    expect(priceHint({ inputPerMTok: 2, outputPerMTok: 10 })).toBe("$2 / $10 per M");
    expect(priceHint({ inputPerMTok: 0.055, outputPerMTok: 1.32 })).toBe("$0.055 / $1.32 per M");
  });

  it("says free for a free model and nothing when the price is not published", () => {
    expect(priceHint({ inputPerMTok: 0, outputPerMTok: 0 })).toBe("free");
    expect(priceHint({})).toBeNull();
  });
});

describe("providerLabel", () => {
  it("names providers the way their own brands do", () => {
    expect(providerLabel("openai")).toBe("OpenAI");
    expect(providerLabel("anthropic")).toBe("Anthropic");
    expect(providerLabel("openrouter")).toBe("OpenRouter");
    expect(providerLabel("groq")).toBe("Groq");
    // An id with no row is printed as it is stored rather than guessed at.
    expect(providerLabel("cohere")).toBe("cohere");
  });
});
