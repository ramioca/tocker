import { describe, expect, it } from "vitest";
import {
  DEFAULT_MODELS,
  DEFAULT_MODEL_ID,
  MODEL_PICKER_ROWS,
  featuredFirst,
  filterModels,
  isModelId,
  knownModel,
  knownModelLabel,
  priceHint,
  providerLabel,
  typedModelId,
  type LlmProvider,
} from "./models";

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
    expect(providerLabel("groq")).toBe("groq");
  });
});
