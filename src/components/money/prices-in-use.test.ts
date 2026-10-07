import { describe, expect, it } from "vitest";
import { CATALOGUE } from "@/lib/agent/providers";
import { pricesInUse } from "./prices-in-use";

const labels = (agents: Parameters<typeof pricesInUse>[0]) => pricesInUse(agents).map((line) => line.label);

describe("the rates behind the model estimate", () => {
  it("is one line per model, in the order the agents appear", () => {
    const lines = pricesInUse([
      { model: "gpt-5", provider: "openai" },
      { model: "claude-sonnet-5-5", provider: "anthropic" },
      { model: "gpt-5", provider: "openai" },
    ]);
    expect(lines.map((line) => line.label)).toEqual(["GPT-5", "Claude Sonnet 5.5"]);
    expect(lines[0]).toMatchObject({ inputPerMTok: 1.25, outputPerMTok: 10 });
    expect(new Set(lines.map((line) => line.key)).size).toBe(lines.length);
  });

  /**
   * Nothing moves for the three providers the builder started with: a row that names its
   * provider reads exactly as a row that names none, which is how every row read before.
   */
  it("reads the same with the provider as it did without, for Anthropic, OpenAI and OpenRouter", () => {
    for (const provider of ["anthropic", "openai", "openrouter"] as const) {
      const agents = CATALOGUE[provider].models.map((model) => ({ model: model.id, provider }));
      const before = pricesInUse(agents.map(({ model }) => ({ model })));
      expect(pricesInUse(agents)).toEqual(before);
      expect(before).toHaveLength(agents.length);
    }
    // An OpenRouter agent on a maker's model still reads at the maker's list price.
    expect(pricesInUse([{ model: "openai/gpt-5", provider: "openrouter" }])).toEqual(pricesInUse([{ model: "openai/gpt-5" }]));
    expect(labels([{ model: "anthropic/claude-sonnet-5.5", provider: "openrouter" }])).toEqual(["Anthropic: Claude Sonnet 5.5"]);
  });

  it("names the provider only where one name has two prices", () => {
    expect(labels([{ model: "zai-org/GLM-5.3", provider: "together" }])).toEqual(["GLM-5.3"]);
    expect(
      labels([
        { model: "zai-org/GLM-5.3", provider: "together" },
        { model: "zai-org/GLM-5.3", provider: "deepinfra" },
      ]),
    ).toEqual(["GLM-5.3 on Together AI", "GLM-5.3 on DeepInfra"]);
  });

  it("puts two providers that charge the same on one line", () => {
    const lines = pricesInUse([
      { model: "zai-org/GLM-5.3", provider: "together" },
      { model: "zai-org/GLM-5.3", provider: "huggingface" },
      { model: "zai-org/GLM-5.3", provider: "deepinfra" },
    ]);
    expect(lines.map((line) => line.label)).toEqual(["GLM-5.3 on Together AI, Hugging Face", "GLM-5.3 on DeepInfra"]);
    expect(lines[1]).toMatchObject({ inputPerMTok: 0.9, outputPerMTok: 4 });
  });

  it("prices a host's long model path from that host's own list", () => {
    const [line] = pricesInUse([{ model: "accounts/fireworks/models/glm-5p3", provider: "fireworks" }]);
    expect(line).toMatchObject({ label: "GLM 5.3", inputPerMTok: 1.4, outputPerMTok: 4.4 });
  });

  it("has no line for a model its provider does not list, rather than another host's price", () => {
    expect(pricesInUse([{ model: "zai-org/GLM-5.3", provider: "fireworks" }])).toEqual([]);
    expect(pricesInUse([{ model: "zai-org/GLM-5.3" }])).toEqual([]);
    expect(pricesInUse([{ model: "", provider: "anthropic" }])).toEqual([]);
  });

  it("reads a provider it does not know as no provider, and never prints it", () => {
    // A stored row can name anything. An unknown provider is read like no provider.
    expect(labels([{ model: "claude-sonnet-5-5", provider: "constructor" }])).toEqual(["Claude Sonnet 5.5"]);
    expect(pricesInUse([{ model: "zai-org/GLM-5.3", provider: "nobody" }])).toEqual([]);
    // Venice sells this model under Anthropic's id at another price: two lines, and only
    // the provider that has a row is named beside its own.
    expect(
      labels([
        { model: "claude-sonnet-5-5", provider: "<b>nobody</b>" },
        { model: "claude-sonnet-5-5", provider: "venice" },
      ]),
    ).toEqual(["Claude Sonnet 5.5", "Claude Sonnet 5.5 on Venice"]);
  });
});
