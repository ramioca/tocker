/**
 * What the builder refuses to create, decided without a browser.
 *
 * A key draft is judged exactly as it was before pay-per-use existed, whatever the
 * viewer is allowed. A pay-per-use draft needs no key, and is refused for the things
 * that would leave it unable to think or spending past its own limit.
 */
import { describe, expect, it } from "vitest";
import { chooseSource, defaultUsdc, suggestedLimits } from "@/components/agents/thinking";
import { emptyDraft, type BuilderDraft } from "./types";
import { validateDraft } from "./validate";

const anthropic = { id: "key_a", provider: "anthropic" as const };
const openai = { id: "key_oa", provider: "openai" as const };

function named(overrides: Partial<BuilderDraft> = {}): BuilderDraft {
  return { ...emptyDraft(), name: "Momentum Mike", ...overrides };
}

function payPerUse(overrides: Partial<BuilderDraft> = {}): BuilderDraft {
  const draft = named(overrides);
  return { ...draft, config: chooseSource(draft.config, "usdc").config };
}

describe("a key draft", () => {
  it("needs a key, and says so in the words it always has", () => {
    expect(validateDraft(named(), [])).toEqual({
      llmKeyId: "Pick or add an API key. The agent cannot think without one.",
    });
  });

  it("needs a key of its own provider that still exists", () => {
    expect(validateDraft(named({ llmKeyId: "gone" }), [anthropic]).llmKeyId).toBe(
      "Pick one of your Anthropic keys, or add one.",
    );
    expect(validateDraft(named({ llmKeyId: "key_oa" }), [openai, anthropic]).llmKeyId).toBe(
      "Pick one of your Anthropic keys, or add one.",
    );
  });

  it("passes with a name, a usable key and the default config", () => {
    expect(validateDraft(named({ llmKeyId: "key_a" }), [anthropic])).toEqual({});
  });

  it("still needs a name and a strategy", () => {
    const draft = named({ name: " ", llmKeyId: "key_a" });
    draft.config = { ...draft.config, strategyPrompt: "too short" };
    const errors = validateDraft(draft, [anthropic]);
    expect(errors.name).toBe("Give it a name — at least two characters.");
    expect(errors.strategyPrompt).toBe("Describe the strategy in at least a sentence.");
  });

  /** The feature ships switched off: being allowed pay-per-use changes nothing for a key draft. */
  it("is judged the same whether or not the viewer may pay per use", () => {
    const drafts = [named(), named({ llmKeyId: "gone" }), named({ llmKeyId: "key_a" }), named({ name: "" })];
    for (const draft of drafts) {
      const off = validateDraft(draft, [anthropic]);
      expect(validateDraft(draft, [anthropic], { payPerUseAllowed: false })).toEqual(off);
      expect(validateDraft(draft, [anthropic], { payPerUseAllowed: true })).toEqual(off);
    }
  });
});

describe("a pay-per-use draft", () => {
  it("passes with no key at all", () => {
    expect(validateDraft(payPerUse(), [], { payPerUseAllowed: true })).toEqual({});
  });

  it("is not asked about a key it has left over from before the switch", () => {
    expect(validateDraft(payPerUse({ llmKeyId: "gone" }), [], { payPerUseAllowed: true })).toEqual({});
  });

  it("is refused when its schedule is expected to cost more than its daily limit", () => {
    const draft = payPerUse();
    draft.config = { ...draft.config, schedule: { intervalMinutes: 5 } };
    const errors = validateDraft(draft, [], { payPerUseAllowed: true });
    expect(errors.thinking).toContain("more than its $3.00 daily limit");
    expect(errors.llmKeyId).toBeUndefined();

    // Raising the limit to the suggested one is what makes it pass.
    const usdc = draft.config.llm.usdc!;
    draft.config = { ...draft.config, llm: { ...draft.config.llm, usdc: { ...usdc, ...suggestedLimits(usdc.model, 5) } } };
    expect(validateDraft(draft, [], { payPerUseAllowed: true })).toEqual({});
  });

  it("is refused for a model that is not offered, and for limits outside their ranges", () => {
    const draft = payPerUse();
    const usdc = defaultUsdc(60);
    const withUsdc = (next: typeof usdc): BuilderDraft => ({
      ...draft,
      config: { ...draft.config, llm: { ...draft.config.llm, usdc: next } },
    });
    expect(validateDraft(withUsdc({ ...usdc, model: "openai/not-offered" }), [], { payPerUseAllowed: true }).thinking).toContain(
      "not offered",
    );
    expect(validateDraft(withUsdc({ ...usdc, maxUsdPerRun: 5 }), [], { payPerUseAllowed: true }).thinking).toContain(
      "between $0.05 and $2.00",
    );
    expect(validateDraft(withUsdc({ ...usdc, maxUsdPerDay: 0.1 }), [], { payPerUseAllowed: true }).thinking).toContain(
      "between $0.50 and $50.00",
    );
  });

  it("is refused without Solana among its chains, at the chain picker", () => {
    const draft = payPerUse();
    draft.config = { ...draft.config, chains: ["base"] };
    const errors = validateDraft(draft, [], { payPerUseAllowed: true });
    expect(errors.chains).toContain("paid from the agent's Solana wallet");
    expect(errors.thinking).toBeUndefined();
  });

  /** A draft saved while pay-per-use was allowed, opened by a viewer for whom it is not. */
  it("is judged as a key draft for a viewer who may not pay per use", () => {
    expect(validateDraft(payPerUse(), [])).toEqual({
      llmKeyId: "Pick or add an API key. The agent cannot think without one.",
    });
    expect(validateDraft(payPerUse({ llmKeyId: "key_a" }), [anthropic], { payPerUseAllowed: false })).toEqual({});
  });
});
