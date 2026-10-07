/**
 * The chip on an owner's own agent card: what stops every tick, in two words.
 *
 * A key agent's chip is what it always was. An agent that pays for its own thinking has
 * no key on purpose, so it must never read "No key"; what can stop it is a hold.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_AGENT_CONFIG } from "@/lib/agent/config";
import { INFERENCE_STOPS, describeInferenceStop, type InferenceStopReason } from "@/lib/x402/inference-types";
import { blockerFor } from "./agent-blockers";

const keyConfig = { llm: { ...DEFAULT_AGENT_CONFIG.llm } };
const payPerUseConfig = {
  llm: {
    ...DEFAULT_AGENT_CONFIG.llm,
    source: "usdc" as const,
    usdc: { model: "google/gemini-2.5-flash", maxUsdPerRun: 0.15, maxUsdPerDay: 3 },
  },
};
const real = { llmMock: false };

describe("blockerFor a key agent", () => {
  it("says No key when there is none, in the words it always has", () => {
    expect(blockerFor({ llmKeyId: null, config: keyConfig, inferenceHold: null }, real)).toEqual({
      label: "No key",
      detail: "No LLM key attached: every tick fails before it starts.",
    });
  });

  it("says nothing with a key attached, or while the scripted model stands in for one", () => {
    expect(blockerFor({ llmKeyId: "key_a", config: keyConfig, inferenceHold: null }, real)).toBeNull();
    expect(blockerFor({ llmKeyId: null, config: keyConfig, inferenceHold: null }, { llmMock: true })).toBeNull();
  });

  /** A hold left behind by an agent that went back to a key is not that agent's problem any more. */
  it("ignores a pay-per-use hold left on its row", () => {
    expect(blockerFor({ llmKeyId: "key_a", config: keyConfig, inferenceHold: "needs_funds" }, real)).toBeNull();
    expect(blockerFor({ llmKeyId: null, config: keyConfig, inferenceHold: "needs_funds" }, real)?.label).toBe("No key");
  });

  it("treats a config that could not be read as a key agent", () => {
    expect(blockerFor({ llmKeyId: null, config: null, inferenceHold: null }, real)?.label).toBe("No key");
  });
});

describe("blockerFor an agent that pays for its own thinking", () => {
  it("never says No key", () => {
    expect(blockerFor({ llmKeyId: null, config: payPerUseConfig, inferenceHold: null }, real)).toBeNull();
    expect(blockerFor({ llmKeyId: "key_a", config: payPerUseConfig, inferenceHold: null }, real)).toBeNull();
  });

  it("names an empty wallet, and calls every other hold a hold", () => {
    for (const reason of Object.keys(INFERENCE_STOPS) as InferenceStopReason[]) {
      const blocker = blockerFor({ llmKeyId: null, config: payPerUseConfig, inferenceHold: reason }, real);
      const words = describeInferenceStop(reason);
      expect(blocker?.label, reason).toBe(reason === "needs_funds" ? "Add USDC" : "On hold");
      expect(blocker?.detail).toBe(`${words.title}. ${words.detail}`);
    }
  });

  it("is still held while the scripted model is on: a hold is not a missing key", () => {
    const blocker = blockerFor({ llmKeyId: null, config: payPerUseConfig, inferenceHold: "paused" }, { llmMock: true });
    expect(blocker?.label).toBe("On hold");
  });

  it("shows a hold whose reason this build does not know without printing the stored text", () => {
    const blocker = blockerFor({ llmKeyId: null, config: payPerUseConfig, inferenceHold: "a_reason_from_the_future" }, real);
    expect(blocker?.label).toBe("On hold");
    expect(blocker?.detail).not.toContain("a_reason_from_the_future");
  });
});
