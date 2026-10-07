/**
 * Where the builder sends people, decided without a browser: the step and control an
 * error belongs to, each step's status word, where a restored draft resumes.
 */
import { describe, expect, it } from "vitest";
import { chooseSource } from "@/components/agents/thinking";
import { BUILDER_STEPS, CARD_IDS, CARD_STEP, parseCard, parseStep, type BuilderStepId } from "./contract";
import {
  firstErrorKey,
  firstErrorPlace,
  neighbours,
  placeOfError,
  resumeStep,
  rulesEdited,
  stepHref,
  stepOf,
  stepStatus,
} from "./flow";
import { emptyDraft, type BuilderDraft } from "./types";
import { validateDraft } from "./validate";

const anthropic = { id: "key_a", provider: "anthropic" as const };

function keyed(overrides: Partial<BuilderDraft> = {}): BuilderDraft {
  return { ...emptyDraft(), llmKeyId: "key_a", ...overrides };
}

function withConfig(draft: BuilderDraft, patch: Partial<BuilderDraft["config"]>): BuilderDraft {
  return { ...draft, config: { ...draft.config, ...patch } };
}

function payPerUse(draft: BuilderDraft): BuilderDraft {
  return { ...draft, config: chooseSource(draft.config, "usdc").config };
}

function statuses(
  draft: BuilderDraft,
  errors: Record<string, string>,
  flags: { attempted?: boolean; fundingBlocked?: boolean } = {},
): Record<BuilderStepId, string> {
  const ctx = { config: draft.config, attempted: flags.attempted ?? false, fundingBlocked: flags.fundingBlocked ?? false };
  return {
    strategy: stepStatus("strategy", errors, ctx),
    rules: stepStatus("rules", errors, ctx),
    brain: stepStatus("brain", errors, ctx),
    create: stepStatus("create", errors, ctx),
  };
}

describe("neighbours", () => {
  it("has no Back on the first step and no Next on the last", () => {
    expect(neighbours("strategy")).toEqual({ back: null, next: "rules" });
    expect(neighbours("rules")).toEqual({ back: "strategy", next: "brain" });
    expect(neighbours("brain")).toEqual({ back: "rules", next: "create" });
    expect(neighbours("create")).toEqual({ back: "brain", next: null });
  });
});

describe("placeOfError", () => {
  it("sends each field error to its own control", () => {
    expect(placeOfError("strategyPrompt")).toEqual({ step: "strategy", focusIds: ["strategy-prompt"] });
    expect(placeOfError("llmKeyId")).toEqual({ step: "brain", focusIds: ["llm-key", "llm-key-add"] });
    expect(placeOfError("thinking")).toEqual({ step: "brain", focusIds: ["builder-usdc-model"] });
    expect(placeOfError("llm")).toEqual({ step: "brain", focusIds: ["llm-model"] });
    expect(placeOfError("name")).toEqual({ step: "create", focusIds: ["agent-name"] });
  });

  it("sends each rule error to the header of the card that holds the rule", () => {
    expect(placeOfError("chains")).toEqual({ step: "rules", card: "universe", focusIds: ["rule-card-universe"] });
    expect(placeOfError("universe")).toEqual({ step: "rules", card: "universe", focusIds: ["rule-card-universe"] });
    expect(placeOfError("dataSources")).toEqual({ step: "rules", card: "data", focusIds: ["rule-card-data"] });
    expect(placeOfError("risk")).toEqual({ step: "rules", card: "risk", focusIds: ["rule-card-risk"] });
    expect(placeOfError("schedule")).toEqual({ step: "rules", card: "schedule", focusIds: ["rule-card-schedule"] });
    expect(placeOfError("execution")).toEqual({ step: "rules", card: "schedule", focusIds: ["rule-card-schedule"] });
  });

  it("puts a card on the step that shows it", () => {
    for (const key of ["chains", "universe", "dataSources", "risk", "schedule", "execution"]) {
      const place = placeOfError(key);
      expect(CARD_STEP[place.card!], key).toBe(place.step);
    }
  });

  it("falls back to the last step, with nothing to focus, for a key it does not know", () => {
    expect(placeOfError("somethingNew")).toEqual({ step: "create" });
  });

  it("hands out a copy, so a caller cannot change the table", () => {
    placeOfError("name").focusIds!.push("elsewhere");
    expect(placeOfError("name").focusIds).toEqual(["agent-name"]);
  });
});

describe("firstErrorPlace", () => {
  it("picks the earliest step", () => {
    // A strategy error wins over a name error, and so does a key error.
    expect(firstErrorPlace({ name: "x", strategyPrompt: "y" }, null)?.step).toBe("strategy");
    expect(firstErrorPlace({ name: "x", llmKeyId: "y" }, null)).toEqual(placeOfError("llmKeyId"));
    expect(firstErrorPlace({ name: "x", llmKeyId: "y", risk: "z" }, null)).toEqual(placeOfError("risk"));
  });

  it("takes rule errors top to bottom within the step", () => {
    expect(firstErrorPlace({ schedule: "x", dataSources: "y" }, null)?.card).toBe("data");
    expect(firstErrorPlace({ execution: "x", risk: "y", chains: "z" }, null)?.card).toBe("universe");
  });

  it("goes to the Funding card for a blocker alone", () => {
    expect(firstErrorPlace({}, "Not enough USDC")).toEqual({
      step: "create",
      card: "funding",
      focusIds: ["rule-card-funding"],
    });
  });

  it("puts validation errors before the funding blocker", () => {
    expect(firstErrorPlace({ name: "x" }, "Not enough USDC")).toEqual(placeOfError("name"));
    expect(firstErrorPlace({ somethingNew: "x" }, "Not enough USDC")).toEqual({ step: "create" });
  });

  it("is null when nothing is wrong", () => {
    expect(firstErrorPlace({}, null)).toBeNull();
  });

  it("names the error it routes to, so the toast quotes the same one", () => {
    expect(firstErrorKey({ name: "x", risk: "y" })).toBe("risk");
    expect(firstErrorKey({ somethingNew: "x", name: "y" })).toBe("name");
    expect(firstErrorKey({ somethingNew: "x" })).toBe("somethingNew");
    expect(firstErrorKey({})).toBeNull();
  });

  it("routes what validateDraft really returns", () => {
    const empty = withConfig(emptyDraft(), { strategyPrompt: "" });
    const errors = validateDraft(empty, []);
    expect(Object.keys(errors).sort()).toEqual(["llmKeyId", "name", "strategyPrompt"]);
    expect(firstErrorPlace(errors, null)).toEqual(placeOfError("strategyPrompt"));
  });
});

describe("stepStatus", () => {
  it("reads Ready, Defaults, Needed, Needed on a fresh draft with no key", () => {
    const draft = emptyDraft();
    expect(statuses(draft, validateDraft(draft, []))).toEqual({
      strategy: "ready",
      rules: "defaults",
      brain: "needed",
      create: "needed",
    });
  });

  it("reads Ready for the brain once the draft has a usable key", () => {
    const draft = keyed();
    expect(statuses(draft, validateDraft(draft, [anthropic])).brain).toBe("ready");
  });

  it("reads Needed for a strategy that is not written", () => {
    const draft = withConfig(keyed(), { strategyPrompt: "" });
    expect(statuses(draft, validateDraft(draft, [anthropic])).strategy).toBe("needed");
  });

  it("reads Fix for the rules of a pay-per-use draft with no Solana wallet", () => {
    const draft = withConfig(payPerUse(emptyDraft()), { chains: ["base"] });
    const errors = validateDraft(draft, [], { payPerUseAllowed: true });
    expect(errors.chains).toBeDefined();
    expect(statuses(draft, errors).rules).toBe("fix");
  });

  it("reads Edited for the rules after one slider moves", () => {
    const base = keyed();
    const draft = withConfig(base, { risk: { ...base.config.risk, maxTradeUsd: 50 } });
    expect(statuses(draft, validateDraft(draft, [anthropic])).rules).toBe("edited");
  });

  it("reads Fix for the last step only after a failed Create with funding blocked", () => {
    const draft = keyed({ name: "Momentum Mike" });
    const errors = validateDraft(draft, [anthropic]);
    expect(statuses(draft, errors).create).toBe("ready");
    expect(statuses(draft, errors, { fundingBlocked: true }).create).toBe("ready");
    expect(statuses(draft, errors, { attempted: true }).create).toBe("ready");
    expect(statuses(draft, errors, { attempted: true, fundingBlocked: true }).create).toBe("fix");
  });

  it("keeps Needed on the last step while the name is missing, blocked or not", () => {
    const draft = keyed();
    const errors = validateDraft(draft, [anthropic]);
    expect(statuses(draft, errors, { attempted: true, fundingBlocked: true }).create).toBe("needed");
  });
});

describe("rulesEdited", () => {
  const base = emptyDraft().config;

  it("is false for the defaults", () => {
    expect(rulesEdited(base)).toBe(false);
  });

  it("is true after each of the six sections changes", () => {
    expect(rulesEdited({ ...base, chains: ["solana", "base"] })).toBe(true);
    expect(rulesEdited({ ...base, dataSources: base.dataSources.slice(1) })).toBe(true);
    expect(rulesEdited({ ...base, universe: { ...base.universe, minScore: 70 } })).toBe(true);
    expect(rulesEdited({ ...base, risk: { ...base.risk, stopLossPct: null } })).toBe(true);
    expect(rulesEdited({ ...base, schedule: { intervalMinutes: 60 } })).toBe(true);
    expect(rulesEdited({ ...base, execution: { ...base.execution, mode: "auto" } })).toBe(true);
  });

  it("notices a feed dropped and a token blocked", () => {
    expect(rulesEdited({ ...base, universe: { ...base.universe, discovery: base.universe.discovery.slice(1) } })).toBe(
      true,
    );
    expect(
      rulesEdited({
        ...base,
        universe: { ...base.universe, blocklist: [{ chain: "solana", address: "So1", symbol: "X" }] },
      }),
    ).toBe(true);
  });

  it("is false when feeds, sources or chains are only reordered", () => {
    expect(rulesEdited({ ...base, dataSources: [...base.dataSources].reverse() })).toBe(false);
    expect(
      rulesEdited({ ...base, universe: { ...base.universe, discovery: [...base.universe.discovery].reverse() } }),
    ).toBe(false);
  });

  it("ignores what is not a rule", () => {
    expect(rulesEdited({ ...base, strategyPrompt: "Buy low, sell high, never chase." })).toBe(false);
    expect(rulesEdited({ ...base, llm: { ...base.llm, temperature: 0.9 } })).toBe(false);
  });
});

describe("resumeStep", () => {
  it("comes back to the key for a draft that has none", () => {
    const draft = emptyDraft();
    expect(resumeStep(validateDraft(draft, []))).toBe("brain");
  });

  it("comes back to the last step for a keyed draft with no name", () => {
    const draft = keyed();
    expect(resumeStep(validateDraft(draft, [anthropic]))).toBe("create");
  });

  it("comes back to the last step for a complete draft", () => {
    const draft = keyed({ name: "Momentum Mike" });
    expect(resumeStep(validateDraft(draft, [anthropic]))).toBe("create");
  });

  it("comes back to the strategy when the prompt is empty", () => {
    const draft = withConfig(emptyDraft(), { strategyPrompt: "" });
    expect(resumeStep(validateDraft(draft, []))).toBe("strategy");
  });
});

describe("stepHref", () => {
  const read = (href: string) => new URL(href, "https://example.test").searchParams;

  it("round-trips every step through parseStep", () => {
    for (const step of BUILDER_STEPS) {
      const href = stepHref(step);
      expect(href.startsWith("/agents/new?")).toBe(true);
      expect(parseStep(read(href).get("step"))).toBe(step);
      expect(read(href).get("open")).toBeNull();
    }
  });

  it("round-trips every card through parseCard", () => {
    for (const card of CARD_IDS) {
      const href = stepHref(CARD_STEP[card], card);
      expect(parseStep(read(href).get("step"))).toBe(CARD_STEP[card]);
      expect(parseCard(read(href).get("open"))).toBe(card);
    }
  });
});

describe("stepOf", () => {
  const of = (query: string) => stepOf(new URLSearchParams(query));

  it("is the first step when the address asks for nothing", () => {
    expect(of("")).toBe("strategy");
  });

  it("is the step a card sits on when only the card is named", () => {
    expect(of("open=funding")).toBe("create");
    for (const card of CARD_IDS) expect(of(`open=${card}`)).toBe(CARD_STEP[card]);
  });

  it("falls back to the card's step when the step is not one of the four", () => {
    expect(of("step=nonsense&open=risk")).toBe("rules");
  });

  it("lets a valid step win over the card", () => {
    expect(of("step=brain&open=funding")).toBe("brain");
  });
});
