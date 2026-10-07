/**
 * Where the builder sends people, decided without a browser: the step and control an
 * error belongs to, each step's status word, where a restored draft resumes.
 */
import { describe, expect, it } from "vitest";
import { chooseSource } from "@/components/agents/thinking";
import { agentConfigSchema } from "@/lib/agent/config";
import { BUILDER_STEPS, CARD_IDS, CARD_STEP, parseStep, type BuilderStepId } from "./contract";
import {
  firstErrorKey,
  firstErrorPlace,
  neighbours,
  placeOfError,
  requestedStep,
  resumeStep,
  rulesEdited,
  stepEdited,
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
  return Object.fromEntries(BUILDER_STEPS.map((step) => [step, stepStatus(step, errors, ctx)])) as Record<
    BuilderStepId,
    string
  >;
}

/** The step whose controls write each section of the config (`./steps`). */
const SECTION_STEP: Record<string, BuilderStepId> = {
  strategyPrompt: "strategy",
  chains: "hunts",
  universe: "hunts",
  dataSources: "data",
  risk: "limits",
  schedule: "schedule",
  execution: "schedule",
  llm: "brain",
};

describe("neighbours", () => {
  it("walks the eight steps in order", () => {
    expect(neighbours("name")).toEqual({ back: null, next: "strategy" });
    expect(neighbours("strategy")).toEqual({ back: "name", next: "hunts" });
    expect(neighbours("hunts")).toEqual({ back: "strategy", next: "data" });
    expect(neighbours("data")).toEqual({ back: "hunts", next: "limits" });
    expect(neighbours("limits")).toEqual({ back: "data", next: "schedule" });
    expect(neighbours("schedule")).toEqual({ back: "limits", next: "brain" });
    expect(neighbours("brain")).toEqual({ back: "schedule", next: "create" });
    expect(neighbours("create")).toEqual({ back: "brain", next: null });
  });

  it("has no Back on the first step and no Next on the last", () => {
    expect(neighbours(BUILDER_STEPS[0]).back).toBeNull();
    expect(neighbours(BUILDER_STEPS[BUILDER_STEPS.length - 1]).next).toBeNull();
  });
});

describe("placeOfError", () => {
  it("sends each field error to its own control", () => {
    expect(placeOfError("name")).toEqual({ step: "name", focusIds: ["agent-name"] });
    expect(placeOfError("strategyPrompt")).toEqual({ step: "strategy", focusIds: ["strategy-prompt"] });
    expect(placeOfError("llmKeyId")).toEqual({ step: "brain", focusIds: ["llm-key", "llm-key-add"] });
    expect(placeOfError("thinking")).toEqual({ step: "brain", focusIds: ["builder-usdc-model"] });
    expect(placeOfError("llm")).toEqual({ step: "brain", focusIds: ["llm-model"] });
  });

  it("sends each rule error to the step that holds the rule, with its heading to focus", () => {
    expect(placeOfError("chains")).toEqual({ step: "hunts" });
    expect(placeOfError("universe")).toEqual({ step: "hunts" });
    expect(placeOfError("dataSources")).toEqual({ step: "data" });
    expect(placeOfError("risk")).toEqual({ step: "limits" });
    expect(placeOfError("schedule")).toEqual({ step: "schedule" });
    expect(placeOfError("execution")).toEqual({ step: "schedule" });
    expect(placeOfError("paperStartingUsd")).toEqual({ step: "schedule" });
  });

  it("has a home for every section of the config, on the step that writes it", () => {
    // `validateDraft` files a schema issue under the first segment of its path, so these
    // are all the keys the schema can ever produce.
    const sections = Object.keys(agentConfigSchema.shape);
    expect(sections.sort()).toEqual(Object.keys(SECTION_STEP).sort());
    for (const section of sections) expect(placeOfError(section).step, section).toBe(SECTION_STEP[section]);
  });

  it("has a home for every key validateDraft sets by hand", () => {
    // name, thinking, chains and llmKeyId are written outside the schema pass.
    expect(placeOfError("name").step).toBe("name");
    expect(placeOfError("thinking").step).toBe("brain");
    expect(placeOfError("llmKeyId").step).toBe("brain");
    expect(placeOfError("chains").step).toBe("hunts");
  });

  it("never names a step that does not exist, or a card", () => {
    for (const key of [...Object.keys(SECTION_STEP), "name", "thinking", "llmKeyId", "paperStartingUsd", "new"]) {
      const place = placeOfError(key);
      expect(BUILDER_STEPS, key).toContain(place.step);
      expect(place, key).not.toHaveProperty("card");
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
    // The name is on the first step now, so it wins over everything after it.
    expect(firstErrorPlace({ name: "x", strategyPrompt: "y" }, null)).toEqual(placeOfError("name"));
    expect(firstErrorPlace({ strategyPrompt: "x", llmKeyId: "y" }, null)).toEqual(placeOfError("strategyPrompt"));
    expect(firstErrorPlace({ llmKeyId: "y", risk: "z" }, null)).toEqual(placeOfError("risk"));
    expect(firstErrorPlace({ llm: "x", llmKeyId: "y", schedule: "z" }, null)?.step).toBe("schedule");
  });

  it("takes the rule steps in page order", () => {
    expect(firstErrorPlace({ schedule: "x", dataSources: "y" }, null)?.step).toBe("data");
    expect(firstErrorPlace({ execution: "x", risk: "y", chains: "z" }, null)?.step).toBe("hunts");
    expect(firstErrorPlace({ execution: "x", risk: "y" }, null)?.step).toBe("limits");
  });

  it("goes to the last step for a funding blocker alone", () => {
    expect(firstErrorPlace({}, "Not enough USDC")).toEqual({ step: "create" });
  });

  it("puts validation errors before the funding blocker", () => {
    expect(firstErrorPlace({ name: "x" }, "Not enough USDC")).toEqual(placeOfError("name"));
    expect(firstErrorPlace({ somethingNew: "x" }, "Not enough USDC")).toEqual({ step: "create" });
  });

  it("is null when nothing is wrong", () => {
    expect(firstErrorPlace({}, null)).toBeNull();
  });

  it("names the error it routes to, so the toast quotes the same one", () => {
    expect(firstErrorKey({ name: "x", risk: "y" })).toBe("name");
    expect(firstErrorKey({ llmKeyId: "x", risk: "y" })).toBe("risk");
    expect(firstErrorKey({ somethingNew: "x", llm: "y" })).toBe("llm");
    expect(firstErrorKey({ somethingNew: "x" })).toBe("somethingNew");
    expect(firstErrorKey({})).toBeNull();
  });

  it("routes what validateDraft really returns", () => {
    const empty = withConfig(emptyDraft(), { strategyPrompt: "" });
    const errors = validateDraft(empty, []);
    expect(Object.keys(errors).sort()).toEqual(["llmKeyId", "name", "strategyPrompt"]);
    expect(firstErrorPlace(errors, null)).toEqual(placeOfError("name"));
    const named = { ...empty, name: "Momentum Mike" };
    expect(firstErrorPlace(validateDraft(named, []), null)).toEqual(placeOfError("strategyPrompt"));
  });

  it("routes a pay-per-use draft with no Solana wallet to the chain picker's step", () => {
    const draft = withConfig(payPerUse({ ...emptyDraft(), name: "Momentum Mike" }), { chains: ["base"] });
    const errors = validateDraft(draft, [], { payPerUseAllowed: true });
    expect(errors.chains).toBeDefined();
    expect(firstErrorPlace(errors, null)).toEqual({ step: "hunts" });
  });
});

describe("stepStatus", () => {
  it("on a fresh draft with no key, only the name and the way to think are needed", () => {
    const draft = emptyDraft();
    expect(statuses(draft, validateDraft(draft, []))).toEqual({
      name: "needed",
      strategy: "ready",
      hunts: "defaults",
      data: "defaults",
      limits: "defaults",
      schedule: "defaults",
      brain: "needed",
      create: "needed",
    });
  });

  it("on a fresh draft with a key, only the name is needed", () => {
    const draft = keyed();
    expect(statuses(draft, validateDraft(draft, [anthropic]))).toEqual({
      name: "needed",
      strategy: "ready",
      hunts: "defaults",
      data: "defaults",
      limits: "defaults",
      schedule: "defaults",
      brain: "ready",
      create: "needed",
    });
  });

  it("reads Ready for the name once it has two characters", () => {
    const draft = keyed({ name: "Mo" });
    expect(statuses(draft, validateDraft(draft, [anthropic])).name).toBe("ready");
  });

  it("reads Needed for a strategy that is not written, and Fix once a Create has failed on it", () => {
    const draft = withConfig(keyed(), { strategyPrompt: "" });
    const errors = validateDraft(draft, [anthropic]);
    expect(statuses(draft, errors).strategy).toBe("needed");
    expect(statuses(draft, errors, { attempted: true }).strategy).toBe("fix");
    // A failed Create does not turn a strategy that is fine into a thing to fix.
    const fine = keyed();
    expect(statuses(fine, validateDraft(fine, [anthropic]), { attempted: true }).strategy).toBe("ready");
  });

  it("keeps Needed for the name and the brain after a failed Create", () => {
    const draft = emptyDraft();
    const after = statuses(draft, validateDraft(draft, []), { attempted: true });
    expect(after.name).toBe("needed");
    expect(after.brain).toBe("needed");
  });

  it("reads Fix on the hunts step alone for a pay-per-use draft with no Solana wallet", () => {
    const draft = withConfig(payPerUse(emptyDraft()), { chains: ["base"] });
    const errors = validateDraft(draft, [], { payPerUseAllowed: true });
    expect(errors.chains).toBeDefined();
    const all = statuses(draft, errors);
    expect(all.hunts).toBe("fix");
    // Choosing pay per use may move other settings; none of them is a thing to fix.
    for (const step of ["data", "limits", "schedule"] as const) expect(all[step], step).not.toBe("fix");
  });

  it("reads Edited on one step only after one control on it moves", () => {
    const base = keyed();
    const rules = (draft: BuilderDraft) => {
      const all = statuses(draft, validateDraft(draft, [anthropic]));
      return [all.hunts, all.data, all.limits, all.schedule];
    };
    expect(rules(withConfig(base, { universe: { ...base.config.universe, minScore: 70 } }))).toEqual([
      "edited",
      "defaults",
      "defaults",
      "defaults",
    ]);
    // The chain picker is drawn on the hunts step.
    expect(rules(withConfig(base, { chains: ["solana", "base"] }))).toEqual([
      "edited",
      "defaults",
      "defaults",
      "defaults",
    ]);
    expect(rules(withConfig(base, { dataSources: base.config.dataSources.slice(1) }))).toEqual([
      "defaults",
      "edited",
      "defaults",
      "defaults",
    ]);
    expect(rules(withConfig(base, { risk: { ...base.config.risk, maxTradeUsd: 50 } }))).toEqual([
      "defaults",
      "defaults",
      "edited",
      "defaults",
    ]);
    // The per-run data cap is a risk limit, whatever it caps.
    expect(rules(withConfig(base, { risk: { ...base.config.risk, maxDataSpendUsdPerRun: 0.1 } }))).toEqual([
      "defaults",
      "defaults",
      "edited",
      "defaults",
    ]);
    expect(rules(withConfig(base, { schedule: { intervalMinutes: 60 } }))).toEqual([
      "defaults",
      "defaults",
      "defaults",
      "edited",
    ]);
    expect(rules(withConfig(base, { execution: { ...base.config.execution, mode: "auto" } }))).toEqual([
      "defaults",
      "defaults",
      "defaults",
      "edited",
    ]);
  });

  it("reads Fix on the step that holds a rule the schema refuses", () => {
    const base = keyed();
    const draft = withConfig(base, { risk: { ...base.config.risk, maxTradeUsd: -1 } });
    const errors = validateDraft(draft, [anthropic]);
    expect(errors.risk).toBeDefined();
    const all = statuses(draft, errors);
    expect(all.limits).toBe("fix");
    expect([all.hunts, all.data, all.schedule]).toEqual(["defaults", "defaults", "defaults"]);
  });

  it("reads Fix for the last step only after a failed Create with funding blocked", () => {
    const draft = keyed({ name: "Momentum Mike" });
    const errors = validateDraft(draft, [anthropic]);
    expect(statuses(draft, errors).create).toBe("ready");
    expect(statuses(draft, errors, { fundingBlocked: true }).create).toBe("ready");
    expect(statuses(draft, errors, { attempted: true }).create).toBe("ready");
    expect(statuses(draft, errors, { attempted: true, fundingBlocked: true }).create).toBe("fix");
  });

  it("reads Needed for the last step while any of the three required things is missing", () => {
    // A tick on Create beside a missing name would say the agent is ready to make.
    const noName = keyed();
    expect(statuses(noName, validateDraft(noName, [anthropic])).create).toBe("needed");
    const noKey = emptyDraft();
    noKey.name = "Momentum Mike";
    expect(statuses(noKey, validateDraft(noKey, [])).create).toBe("needed");
    const noStrategy = keyed({ name: "Momentum Mike" });
    noStrategy.config = { ...noStrategy.config, strategyPrompt: "" };
    expect(statuses(noStrategy, validateDraft(noStrategy, [anthropic])).create).toBe("needed");
    // All three there: ready. A rule that needs a look is its own step's to say.
    const whole = keyed({ name: "Momentum Mike" });
    expect(statuses(whole, validateDraft(whole, [anthropic])).create).toBe("ready");
    expect(statuses(whole, { risk: "x" }).create).toBe("ready");
    // The name keeps its own word after a failed Create.
    expect(statuses(noName, validateDraft(noName, [anthropic]), { attempted: true }).name).toBe("needed");
  });

  /** Each rule key turns its own step to Fix and leaves the other three alone. */
  it.each(["chains", "universe", "dataSources", "risk", "schedule", "execution"])("a %s error reads Fix on the step that holds it, and only there", (key) => {
    const draft = keyed({ name: "Momentum Mike" });
    const home = placeOfError(key).step;
    const rules = ["hunts", "data", "limits", "schedule"] as const;
    expect(rules).toContain(home);
    const all = statuses(draft, { [key]: "x" });
    for (const step of rules) expect(all[step], `${key} on ${step}`).toBe(step === home ? "fix" : "defaults");
  });
});

describe("stepEdited", () => {
  const base = emptyDraft().config;
  const rules = ["hunts", "data", "limits", "schedule"] as const;

  it("is false on every step for the defaults", () => {
    for (const step of rules) expect(stepEdited(step, base), step).toBe(false);
  });

  it("ignores what is not a rule", () => {
    const other = { ...base, strategyPrompt: "Buy low, sell high, never chase.", llm: { ...base.llm, temperature: 0.9 } };
    for (const step of rules) expect(stepEdited(step, other), step).toBe(false);
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
  it("comes back to the name for a draft that has none, key or no key", () => {
    expect(resumeStep(validateDraft(emptyDraft(), []))).toBe("name");
    expect(resumeStep(validateDraft(keyed(), [anthropic]))).toBe("name");
  });

  it("comes back to the strategy when the agent is named and the prompt is empty", () => {
    const draft = withConfig({ ...emptyDraft(), name: "Momentum Mike" }, { strategyPrompt: "" });
    expect(resumeStep(validateDraft(draft, []))).toBe("strategy");
  });

  it("comes back to the key for a named draft that has none", () => {
    const draft = { ...emptyDraft(), name: "Momentum Mike" };
    expect(resumeStep(validateDraft(draft, []))).toBe("brain");
  });

  it("comes back to the last step for a complete draft", () => {
    const draft = keyed({ name: "Momentum Mike" });
    expect(resumeStep(validateDraft(draft, [anthropic]))).toBe("create");
  });

  it("does not stop on a rule step: a rule error is not a thing still to decide", () => {
    expect(resumeStep({ risk: "x", chains: "y" })).toBe("create");
  });
});

describe("stepHref", () => {
  const read = (href: string) => new URL(href, "https://example.test").searchParams;

  it("round-trips every step through parseStep and stepOf", () => {
    for (const step of BUILDER_STEPS) {
      const href = stepHref(step);
      expect(href).toBe(`/agents/new?step=${step}`);
      expect(parseStep(read(href).get("step"))).toBe(step);
      expect(stepOf(read(href))).toBe(step);
    }
  });

  it("never writes the old open param", () => {
    for (const step of BUILDER_STEPS) expect(read(stepHref(step)).get("open")).toBeNull();
  });
});

describe("stepOf", () => {
  const of = (query: string) => stepOf(new URLSearchParams(query));
  const asked = (query: string) => requestedStep(new URLSearchParams(query));

  it("is the first step when the address asks for nothing", () => {
    expect(of("")).toBe("name");
    expect(asked("")).toBeNull();
    expect(of("step=nonsense")).toBe("name");
    expect(asked("step=nonsense")).toBeNull();
    expect(asked("open=nonsense")).toBeNull();
  });

  it("takes each of the eight ids", () => {
    for (const step of BUILDER_STEPS) {
      expect(of(`step=${step}`)).toBe(step);
      expect(asked(`step=${step}`)).toBe(step);
    }
  });

  it("sends the old rules step to the first rule step", () => {
    expect(of("step=rules")).toBe("hunts");
    expect(asked("step=rules")).toBe("hunts");
  });

  it("sends an old rules link that names a card to that card's step", () => {
    expect(of("step=rules&open=universe")).toBe("hunts");
    expect(of("step=rules&open=data")).toBe("data");
    expect(of("step=rules&open=risk")).toBe("limits");
    expect(of("step=rules&open=schedule")).toBe("schedule");
  });

  it("sends an old link that names only a card to that card's step", () => {
    expect(of("open=funding")).toBe("create");
    expect(of("step=create&open=funding")).toBe("create");
    for (const card of CARD_IDS) expect(of(`open=${card}`)).toBe(CARD_STEP[card]);
  });

  it("falls back to the card's step when the step is not one it knows", () => {
    expect(of("step=nonsense&open=risk")).toBe("limits");
  });

  it("lets a step id win over an old card", () => {
    expect(of("step=brain&open=funding")).toBe("brain");
    expect(of("step=strategy&open=risk")).toBe("strategy");
  });
});
