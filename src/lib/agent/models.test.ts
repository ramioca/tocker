import { describe, expect, it } from "vitest";
import { knownModelLabel, providerLabel } from "./models";

describe("knownModelLabel", () => {
  it("returns the builder's name for every id it offers", () => {
    expect(knownModelLabel("gpt-5-mini")).toBe("GPT-5 mini");
    expect(knownModelLabel("deepseek/deepseek-v4")).toBe("DeepSeek V4");
  });

  it("matches either side of a dated alias, and looks through a vendor prefix", () => {
    expect(knownModelLabel("claude-haiku-4-5-20251001")).toBe("Claude Haiku 4.5");
    expect(knownModelLabel("claude-haiku-4-5")).toBe("Claude Haiku 4.5");
    expect(knownModelLabel("openai/gpt-5")).toBe("GPT-5");
  });

  it("says it does not know rather than guessing", () => {
    expect(knownModelLabel("mistral/mistral-large-2")).toBeNull();
    expect(knownModelLabel("")).toBeNull();
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
