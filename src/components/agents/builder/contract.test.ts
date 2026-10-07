import { describe, expect, it } from "vitest";
import {
  BUILDER_STEPS,
  CARD_IDS,
  CARD_STEP,
  LEGACY_RULES_STEP,
  LEGACY_RULES_TARGET,
  REQUIRED_ERROR_KEYS,
  REQUIRED_ORDER,
  REQUIRED_PLACE,
  ROW_PLACE,
  parseCard,
  parseStep,
  type Place,
} from "./contract";

describe("parseStep", () => {
  it("accepts the eight step ids", () => {
    for (const step of BUILDER_STEPS) expect(parseStep(step)).toBe(step);
    expect(BUILDER_STEPS).toEqual(["name", "strategy", "hunts", "data", "limits", "schedule", "brain", "create"]);
  });

  it("refuses everything else", () => {
    expect(parseStep(undefined)).toBeNull();
    expect(parseStep(null)).toBeNull();
    expect(parseStep("")).toBeNull();
    expect(parseStep("Limits")).toBeNull();
    expect(parseStep("LIMITS")).toBeNull();
    expect(parseStep(" limits")).toBeNull();
    expect(parseStep("limits ")).toBeNull();
    expect(parseStep("nonsense")).toBeNull();
    // The step the rule cards used to share is not a step any more.
    expect(parseStep(LEGACY_RULES_STEP)).toBeNull();
    // An old card id is not a step id, unless the step happens to carry the same name.
    expect(parseStep("risk")).toBeNull();
    expect(parseStep("universe")).toBeNull();
    expect(parseStep("funding")).toBeNull();
    // `?step=a&step=b` reaches a server page as an array.
    expect(parseStep(["limits"])).toBeNull();
    expect(parseStep(["limits", "brain"])).toBeNull();
    expect(parseStep(1)).toBeNull();
    expect(parseStep({ step: "limits" })).toBeNull();
    // Names every object has must not pass as a step.
    expect(parseStep("toString")).toBeNull();
    expect(parseStep("length")).toBeNull();
  });
});

describe("parseCard", () => {
  it("still accepts the five old card ids", () => {
    for (const card of CARD_IDS) expect(parseCard(card)).toBe(card);
    expect(CARD_IDS).toEqual(["universe", "data", "risk", "schedule", "funding"]);
  });

  it("refuses everything else", () => {
    expect(parseCard(undefined)).toBeNull();
    expect(parseCard(null)).toBeNull();
    expect(parseCard("")).toBeNull();
    expect(parseCard("Risk")).toBeNull();
    expect(parseCard("FUNDING")).toBeNull();
    expect(parseCard("risk ")).toBeNull();
    expect(parseCard("nonsense")).toBeNull();
    // A step id is not a card id.
    expect(parseCard("limits")).toBeNull();
    expect(parseCard("hunts")).toBeNull();
    expect(parseCard("rules")).toBeNull();
    expect(parseCard(["risk"])).toBeNull();
    expect(parseCard(0)).toBeNull();
    expect(parseCard("constructor")).toBeNull();
  });
});

describe("CARD_STEP", () => {
  it("sends every old card to the step that holds what it held", () => {
    expect(CARD_STEP).toEqual({
      universe: "hunts",
      data: "data",
      risk: "limits",
      schedule: "schedule",
      funding: "create",
    });
    for (const card of CARD_IDS) expect(BUILDER_STEPS).toContain(CARD_STEP[card]);
  });

  it("keeps Funding on the step that holds the Create button", () => {
    expect(CARD_STEP.funding).toBe(BUILDER_STEPS[BUILDER_STEPS.length - 1]);
  });

  it("sends the old rules step to the first of the rule steps", () => {
    expect(LEGACY_RULES_TARGET).toBe("hunts");
    expect(BUILDER_STEPS).toContain(LEGACY_RULES_TARGET);
  });
});

function expectPlaceIsReal(place: Place) {
  expect(BUILDER_STEPS).toContain(place.step);
  // A place is a step and, at most, ids to focus: nothing on the page opens any more.
  expect(Object.keys(place).filter((key) => key !== "step" && key !== "focusIds")).toEqual([]);
  for (const id of place.focusIds ?? []) expect(id).not.toMatch(/^rule-/);
}

describe("REQUIRED_PLACE", () => {
  it("covers the three required things, in step order", () => {
    expect(REQUIRED_ORDER).toEqual(["name", "strategy", "think"]);
    expect(Object.keys(REQUIRED_PLACE).sort()).toEqual([...REQUIRED_ORDER].sort());
    expect(Object.keys(REQUIRED_ERROR_KEYS).sort()).toEqual([...REQUIRED_ORDER].sort());
    const steps = REQUIRED_ORDER.map((id) => BUILDER_STEPS.indexOf(REQUIRED_PLACE[id].step));
    expect(steps).toEqual([...steps].sort((a, b) => a - b));
  });

  it("names the step that holds each one", () => {
    expect(REQUIRED_PLACE.name).toEqual({ step: "name", focusIds: ["agent-name"] });
    expect(REQUIRED_PLACE.strategy).toEqual({ step: "strategy", focusIds: ["strategy-prompt"] });
    expect(REQUIRED_PLACE.think.step).toBe("brain");
    for (const id of REQUIRED_ORDER) expectPlaceIsReal(REQUIRED_PLACE[id]);
  });

  it("gives every required thing a control to focus", () => {
    for (const id of REQUIRED_ORDER) expect(REQUIRED_PLACE[id].focusIds?.length ?? 0).toBeGreaterThan(0);
  });
});

describe("ROW_PLACE", () => {
  it("has the seven rows of the agent card, in the order they are shown", () => {
    expect(Object.keys(ROW_PLACE)).toEqual(["hunts", "data", "limits", "exits", "runs", "thinks", "money"]);
  });

  it("sends each row to the step that holds its controls", () => {
    expect(ROW_PLACE).toEqual({
      hunts: { step: "hunts" },
      data: { step: "data" },
      limits: { step: "limits" },
      exits: { step: "limits", focusIds: ["risk-exits"] },
      runs: { step: "schedule" },
      thinks: { step: "brain" },
      money: { step: "create" },
    });
    for (const place of Object.values(ROW_PLACE)) expectPlaceIsReal(place);
  });
});
