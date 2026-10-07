import { describe, expect, it } from "vitest";
import {
  BUILDER_STEPS,
  CARD_IDS,
  CARD_STEP,
  REQUIRED_ERROR_KEYS,
  REQUIRED_ORDER,
  REQUIRED_PLACE,
  ROW_PLACE,
  parseCard,
  parseStep,
  type Place,
} from "./contract";

describe("parseStep", () => {
  it("accepts the four step ids", () => {
    for (const step of BUILDER_STEPS) expect(parseStep(step)).toBe(step);
    expect(BUILDER_STEPS).toEqual(["strategy", "rules", "brain", "create"]);
  });

  it("refuses everything else", () => {
    expect(parseStep(undefined)).toBeNull();
    expect(parseStep(null)).toBeNull();
    expect(parseStep("")).toBeNull();
    expect(parseStep("Rules")).toBeNull();
    expect(parseStep("RULES")).toBeNull();
    expect(parseStep(" rules")).toBeNull();
    expect(parseStep("rules ")).toBeNull();
    expect(parseStep("nonsense")).toBeNull();
    // A card id is not a step id.
    expect(parseStep("risk")).toBeNull();
    // `?step=a&step=b` reaches a server page as an array.
    expect(parseStep(["rules"])).toBeNull();
    expect(parseStep(["rules", "brain"])).toBeNull();
    expect(parseStep(1)).toBeNull();
    expect(parseStep({ step: "rules" })).toBeNull();
    // Names every object has must not pass as a step.
    expect(parseStep("toString")).toBeNull();
    expect(parseStep("length")).toBeNull();
  });
});

describe("parseCard", () => {
  it("accepts the five card ids", () => {
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
    expect(parseCard("rules")).toBeNull();
    expect(parseCard(["risk"])).toBeNull();
    expect(parseCard(0)).toBeNull();
    expect(parseCard("constructor")).toBeNull();
  });
});

describe("CARD_STEP", () => {
  it("places every card on a step, and only the cards", () => {
    expect(Object.keys(CARD_STEP).sort()).toEqual([...CARD_IDS].sort());
    for (const card of CARD_IDS) expect(BUILDER_STEPS).toContain(CARD_STEP[card]);
  });

  it("keeps Funding on the step that holds the Create button", () => {
    expect(CARD_STEP.funding).toBe("create");
  });
});

function expectPlaceIsConsistent(place: Place) {
  expect(BUILDER_STEPS).toContain(place.step);
  if (place.card !== undefined) {
    expect(CARD_IDS).toContain(place.card);
    expect(CARD_STEP[place.card]).toBe(place.step);
  }
}

describe("REQUIRED_PLACE", () => {
  it("covers the three required things, in step order", () => {
    expect(Object.keys(REQUIRED_PLACE).sort()).toEqual([...REQUIRED_ORDER].sort());
    expect(Object.keys(REQUIRED_ERROR_KEYS).sort()).toEqual([...REQUIRED_ORDER].sort());
    const steps = REQUIRED_ORDER.map((id) => BUILDER_STEPS.indexOf(REQUIRED_PLACE[id].step));
    expect(steps).toEqual([...steps].sort((a, b) => a - b));
  });

  it("names a real step, and a card that sits on it", () => {
    for (const id of REQUIRED_ORDER) expectPlaceIsConsistent(REQUIRED_PLACE[id]);
  });

  it("gives every required thing a control to focus", () => {
    for (const id of REQUIRED_ORDER) expect(REQUIRED_PLACE[id].focusIds?.length ?? 0).toBeGreaterThan(0);
  });
});

describe("ROW_PLACE", () => {
  it("has the seven rows of the agent card, in the order they are shown", () => {
    expect(Object.keys(ROW_PLACE)).toEqual(["hunts", "data", "limits", "exits", "runs", "thinks", "money"]);
  });

  it("names a real step, and a card that sits on it", () => {
    for (const place of Object.values(ROW_PLACE)) expectPlaceIsConsistent(place);
  });

  it("focuses the header of the card it opens, except the exits row", () => {
    for (const [row, place] of Object.entries(ROW_PLACE)) {
      if (place.card === undefined) continue;
      expect(place.focusIds).toEqual([row === "exits" ? "risk-exits" : `rule-card-${place.card}`]);
    }
  });
});
