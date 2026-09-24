import { describe, expect, it } from "vitest";
import { modelLabel } from "./chain-badge";

describe("modelLabel", () => {
  it("uses the builder's names, not a title-cased id", () => {
    expect(modelLabel("claude-haiku-4-5-20251001")).toBe("Claude Haiku 4.5");
    expect(modelLabel("gpt-5")).toBe("GPT-5");
    expect(modelLabel("gpt-5-mini")).toBe("GPT-5 mini");
    expect(modelLabel("deepseek/deepseek-v4")).toBe("DeepSeek V4");
  });

  it("drops the OpenRouter routing note on the chip", () => {
    expect(modelLabel("anthropic/claude-sonnet-5")).toBe("Claude Sonnet 5");
  });

  it("still prettifies an id the builder does not offer", () => {
    expect(modelLabel("mistral/mistral-large-2")).toBe("Mistral Large 2");
  });
});
