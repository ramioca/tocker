import { describe, expect, it } from "vitest";
import { knownModelLabel } from "@/lib/agent/models";
import { CATALOGUE, CATALOGUE_IDS } from "@/lib/agent/providers";
import { modelLabel } from "./chain-badge";

describe("modelLabel", () => {
  it("uses the builder's names, not a title-cased id", () => {
    expect(modelLabel("claude-haiku-4-5-20251001")).toBe("Claude Haiku 4.5");
    expect(modelLabel("gpt-5")).toBe("GPT-5");
    expect(modelLabel("gpt-5-mini")).toBe("GPT-5 mini");
    expect(modelLabel("claude-sonnet-5-5")).toBe("Claude Sonnet 5.5");
    expect(modelLabel("deepseek/deepseek-v4.1-flash")).toBe("DeepSeek V4.1 Flash");
  });

  it("drops the vendor OpenRouter puts in front of the name", () => {
    expect(modelLabel("anthropic/claude-sonnet-5")).toBe("Claude Sonnet 5");
    expect(modelLabel("anthropic/claude-opus-5.5")).toBe("Claude Opus 5.5");
    expect(modelLabel("openai/gpt-6.1-sol")).toBe("GPT-6.1 Sol");
  });

  it("still prettifies an id the builder does not offer", () => {
    expect(modelLabel("mistral/mistral-large-2")).toBe("Mistral Large 2");
    expect(modelLabel("nousresearch/hermes-4-405b")).toBe("Hermes 4 405b");
    expect(modelLabel("meta-llama/llama-3.3-70b-instruct:free")).toBe("Llama 3.3 70b Instruct:Free");
    expect(modelLabel("some-model-20260101")).toBe("Some Model");
  });

  /**
   * Nothing moves for a model Anthropic, OpenAI or OpenRouter lists, whichever other
   * providers are switched on: the chip says what the three lists' own lookup says, with
   * the vendor dropped, which is all this function did before there were others.
   */
  it("names every model of the three providers the builder started with as before", () => {
    for (const provider of ["anthropic", "openai", "openrouter"] as const) {
      for (const model of CATALOGUE[provider].models) {
        const before = knownModelLabel(model.id)?.replace(/^[^:]{1,24}:\s+/, "");
        expect(before).toBeTruthy();
        expect(modelLabel(model.id), model.id).toBe(before);
      }
    }
    // In OpenRouter's spelling too, for the two makers' own models.
    expect(modelLabel("anthropic/claude-haiku-4.5")).toBe("Claude Haiku 4.5");
    expect(modelLabel("openai/gpt-5-mini")).toBe("GPT-5 mini");
  });

  /**
   * A host's id can be a path. Whether or not that host is switched on, the chip is the
   * model: never the path, never a slash.
   */
  it("never prints a path for any provider's model, switched on or not", () => {
    for (const provider of CATALOGUE_IDS) {
      for (const model of CATALOGUE[provider].models) {
        const label = modelLabel(model.id);
        expect(label, model.id).not.toMatch(/[/]/);
        expect(label, model.id).not.toMatch(/accounts|models$/i);
        expect(label.length, model.id).toBeGreaterThan(1);
      }
    }
  });

  it("reads the model out of a host's path when no list has it", () => {
    // Fireworks files every model under one account, and writes a version's dot as "p".
    expect(modelLabel("accounts/fireworks/models/qwen3p8-max")).toBe("Qwen3.8 Max");
    expect(modelLabel("accounts/fireworks/models/llama-v3p3-70b-instruct")).toBe("Llama V3.3 70b Instruct");
    expect(modelLabel("accounts/someone/models/my-finetune")).toBe("My Finetune");
    // A "p" between digits is a dot on Fireworks only.
    expect(modelLabel("vendor/cam-1080p30")).toBe("Cam 1080p30");
  });

  it("keeps a vendor's own capitals when it drops the vendor", () => {
    expect(modelLabel("zai-org/GLM-6-Turbo")).toBe("GLM 6 Turbo");
    expect(modelLabel("deepseek-ai/DeepSeek-V5")).toBe("DeepSeek V5");
    expect(modelLabel("Qwen/Qwen4-Max")).toBe("Qwen4 Max");
  });

  it("names a maker's own id that no list has yet", () => {
    expect(modelLabel("gemini-4-flash")).toBe("Gemini 4 Flash");
    expect(modelLabel("grok-5")).toBe("Grok 5");
    expect(modelLabel("kimi-k4")).toBe("Kimi K4");
  });

  it("is never empty for something that passed as an id", () => {
    expect(modelLabel("vendor/")).toBe("Vendor");
    expect(modelLabel("a")).toBe("A");
  });
});
