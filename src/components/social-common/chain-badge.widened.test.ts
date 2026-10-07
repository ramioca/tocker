/**
 * The model chip with every provider in the registry switched on.
 *
 * The registry keeps a list of the providers that are enabled, and a card's model is
 * named from the enabled providers' lists. This file rehearses that list at its full
 * length, so what a card will read once a provider is switched on is pinned before it
 * is, and the names that change for cards that exist today are written down here rather
 * than discovered on the leaderboard.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/agent/providers", async (original) => {
  const actual = await original<typeof import("@/lib/agent/providers")>();
  return { ...actual, PROVIDER_IDS: actual.CATALOGUE_IDS };
});

import { knownModelLabel, modelNameOnAnyProvider } from "@/lib/agent/models";
import { CATALOGUE, CATALOGUE_IDS, PROVIDER_IDS } from "@/lib/agent/providers";
import { modelLabel } from "./chain-badge";

describe("modelLabel, with every provider switched on", () => {
  it("is rehearsing all nineteen", () => {
    expect(PROVIDER_IDS).toHaveLength(19);
    expect(modelNameOnAnyProvider("accounts/fireworks/models/glm-5p3")).toBe("GLM 5.3");
  });

  // A card has no provider, so where two hosts spell one id alike (Nebius's
  // zai-org/GLM-5.2 and Novita's zai-org/glm-5.2) the first list's name is used for both.
  it("names each provider's default model", () => {
    const names = Object.fromEntries(CATALOGUE_IDS.map((id) => [id, modelLabel(CATALOGUE[id].defaultModel)]));
    expect(names).toEqual({
      anthropic: "Claude Sonnet 5.5",
      openai: "GPT-5",
      openrouter: "Claude Sonnet 5.5",
      google: "Gemini 3.8 Flash",
      xai: "Grok 4.7",
      deepseek: "DeepSeek V4.1 Flash",
      mistral: "Mistral Medium (latest)",
      moonshot: "Kimi K3",
      zai: "GLM-5.3",
      groq: "GPT OSS 120B",
      cerebras: "GPT OSS 120B",
      together: "GLM-5.3",
      fireworks: "GLM 5.3",
      deepinfra: "GLM-5.3",
      vercel: "Claude Sonnet 5.5",
      venice: "GLM 5.2",
      nebius: "GLM-5.3",
      novita: "GLM-5.2",
      huggingface: "GLM-5.3",
    });
  });

  it("gives every listed model a listed name: no path, no slash, no title-cased id", () => {
    const listed = new Set(CATALOGUE_IDS.flatMap((id) => CATALOGUE[id].models.map((model) => model.label.replace(/^[^:]{1,24}:\s+/, ""))));
    for (const provider of CATALOGUE_IDS) {
      for (const model of CATALOGUE[provider].models) {
        const label = modelLabel(model.id);
        expect(label, model.id).not.toContain("/");
        expect(listed.has(label), `${model.id} reads “${label}”`).toBe(true);
      }
    }
  });

  it("reads a host's long path as the model", () => {
    expect(modelLabel("accounts/fireworks/models/glm-5p3")).toBe("GLM 5.3");
    expect(modelLabel("accounts/fireworks/models/deepseek-v4p1-flash")).toBe("DeepSeek V4.1 Flash");
    expect(modelLabel("accounts/fireworks/models/nemotron-lightning-3p5-30b-a3b")).toBe("NVIDIA Nemotron 3.5 Lightning 30B A3B");
    // Not in Fireworks's rows: still the model, from the last part of the path.
    expect(modelLabel("accounts/fireworks/models/qwen3p8-max")).toBe("Qwen3.8 Max");
  });

  it("reads a vendor-prefixed id as the model, whatever its capitals", () => {
    expect(modelLabel("zai-org/GLM-5.3")).toBe("GLM-5.3");
    expect(modelLabel("zai-org/glm-5.3")).toBe("GLM-5.3");
    expect(modelLabel("moonshotai/Kimi-K3")).toBe("Kimi K3");
    expect(modelLabel("deepseek-ai/DeepSeek-V4-Pro-0813")).toBe("DeepSeek V4 Pro 0813");
    expect(modelLabel("MiniMaxAI/MiniMax-M3")).toBe("MiniMax M3");
  });

  it("names the model makers' own ids", () => {
    expect(modelLabel("gemini-3.1-pro-preview")).toBe("Gemini 3.1 Pro (Preview)");
    expect(modelLabel("grok-4.20-0309-reasoning")).toBe("Grok 4.20 (Reasoning)");
    expect(modelLabel("deepseek-v4-pro")).toBe("DeepSeek V4 Pro");
    expect(modelLabel("kimi-k2.7-code")).toBe("Kimi K2.7 Code");
    expect(modelLabel("mistral-large-2512")).toBe("Mistral Large 3");
  });

  /** The promise of chain-badge.test.ts, held with every list in play. */
  it("leaves every Anthropic, OpenAI and OpenRouter model's name as it was", () => {
    for (const provider of ["anthropic", "openai", "openrouter"] as const) {
      for (const model of CATALOGUE[provider].models) {
        expect(modelLabel(model.id), model.id).toBe(knownModelLabel(model.id)?.replace(/^[^:]{1,24}:\s+/, ""));
      }
    }
    expect(modelLabel("claude-haiku-4-5-20251001")).toBe("Claude Haiku 4.5");
    expect(modelLabel("anthropic/claude-sonnet-5")).toBe("Claude Sonnet 5");
    expect(modelLabel("gpt-5-mini")).toBe("GPT-5 mini");
    // An id no list has is still made into words the same way.
    expect(modelLabel("mistral/mistral-large-2")).toBe("Mistral Large 2");
    expect(modelLabel("nousresearch/hermes-4-405b")).toBe("Hermes 4 405b");
  });

  /**
   * What does change for a card that exists today, on purpose. An OpenRouter agent on a
   * model the three lists do not carry was named by title-casing its id. Once the model's
   * maker or a host that lists it is switched on, the chip reads that list's name
   * instead. Each of these is the same model under a better-spelled name; the left
   * column is what the chip read before.
   */
  it("renames an OpenRouter model the three lists do not carry to its listed name", () => {
    const renamed: Array<[id: string, before: string, now: string]> = [
      ["z-ai/glm-5.3", "Glm 5.3", "GLM-5.3"],
      ["openai/gpt-oss-120b", "Gpt Oss 120b", "GPT OSS 120B"],
      ["deepseek/deepseek-v4-pro", "Deepseek V4 Pro", "DeepSeek V4 Pro"],
      ["minimax/minimax-m3", "Minimax M3", "MiniMax M3"],
      ["mistralai/mistral-large-2512", "Mistral Large 2512", "Mistral Large 3"],
    ];
    for (const [id, before, now] of renamed) {
      expect(knownModelLabel(id), id).toBeNull();
      expect(before).not.toBe(now);
      expect(modelLabel(id), id).toBe(now);
    }
    // And these read exactly as they did: the listed name is what title-casing gave.
    for (const [id, same] of [
      ["x-ai/grok-4.6", "Grok 4.6"],
      ["google/gemini-3.7-flash", "Gemini 3.7 Flash"],
      ["moonshotai/kimi-k3", "Kimi K3"],
    ]) {
      expect(modelLabel(id), id).toBe(same);
    }
  });
});
