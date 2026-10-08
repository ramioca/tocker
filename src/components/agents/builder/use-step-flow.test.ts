/**
 * How a page of steps moves, decided without a browser: which way a move goes, whether
 * it is written to the address as a new entry or over the current one, and the two cases
 * where no move is made at all.
 */
import { describe, expect, it } from "vitest";
import { BUILDER_STEPS, SETTINGS_STEPS, type Via } from "./contract";
import { neighbours } from "./flow";
import { directionOf, neighboursOf, planMove } from "./use-step-flow";

const VIAS: readonly Via[] = ["pointer", "keyboard", "auto"];

function plan(place: { step: string; focusIds?: string[]; sub?: string }, via: Via = "pointer", current = "hunts") {
  return planMove({ steps: SETTINGS_STEPS, current: current as (typeof SETTINGS_STEPS)[number], place, via, locked: false });
}

describe("directionOf", () => {
  it("is forward to a later step and back to an earlier one", () => {
    expect(directionOf(BUILDER_STEPS, "name", "limits")).toBe(1);
    expect(directionOf(BUILDER_STEPS, "limits", "name")).toBe(-1);
    expect(directionOf(BUILDER_STEPS, "brain", "create")).toBe(1);
    expect(directionOf(BUILDER_STEPS, "create", "brain")).toBe(-1);
  });

  it("follows the order of the steps it is given, not their names", () => {
    expect(directionOf(["b", "a"], "b", "a")).toBe(1);
    expect(directionOf(["a", "b"], "b", "a")).toBe(-1);
  });
});

describe("neighboursOf", () => {
  it("agrees with the builder's own neighbours on every step", () => {
    for (const step of BUILDER_STEPS) expect(neighboursOf(BUILDER_STEPS, step), step).toEqual(neighbours(step));
  });

  it("ends the settings page on Manage, where the builder ends on its last step", () => {
    expect(neighboursOf(SETTINGS_STEPS, "name")).toEqual({ back: null, next: "strategy" });
    expect(neighboursOf(SETTINGS_STEPS, "brain")).toEqual({ back: "schedule", next: "manage" });
    expect(neighboursOf(SETTINGS_STEPS, "manage")).toEqual({ back: "brain", next: null });
  });

  it("has no neighbours for a step the page does not have", () => {
    expect(neighboursOf(SETTINGS_STEPS, "create" as never)).toEqual({ back: null, next: null });
  });
});

describe("planMove", () => {
  it("goes forward or back by where the step is from the one showing", () => {
    expect(plan({ step: "limits" })?.change?.direction).toBe(1);
    expect(plan({ step: "manage" })?.change?.direction).toBe(1);
    expect(plan({ step: "name" })?.change?.direction).toBe(-1);
    expect(plan({ step: "strategy" })?.change?.direction).toBe(-1);
  });

  it("pushes a move the user made and replaces the entry for one the page made", () => {
    expect(plan({ step: "limits" }, "pointer")?.change?.history).toBe("push");
    expect(plan({ step: "limits" }, "keyboard")?.change?.history).toBe("push");
    expect(plan({ step: "limits" }, "auto")?.change?.history).toBe("replace");
  });

  it("animates a pointer move and nothing else", () => {
    expect(plan({ step: "limits" }, "pointer")?.change?.animate).toBe(true);
    expect(plan({ step: "limits" }, "keyboard")?.change?.animate).toBe(false);
    expect(plan({ step: "limits" }, "auto")?.change?.animate).toBe(false);
  });

  it("keeps the place, so focus can land on its control once the step is showing", () => {
    const place = { step: "manage", sub: "withdraw", focusIds: ["manage-withdraw"] };
    expect(plan(place)?.place).toEqual(place);
    expect(plan({ step: "limits" })?.place).toEqual({ step: "limits" });
  });

  it("leaves the address alone for a place on the step that is already showing", () => {
    for (const via of VIAS) {
      const move = plan({ step: "hunts", focusIds: ["universe-min-score-value"] }, via);
      // Still a move: focus goes to the control.
      expect(move, via).not.toBeNull();
      expect(move?.change, via).toBeNull();
    }
  });

  it("makes no move while the flow is locked, however it was asked", () => {
    for (const via of VIAS) {
      for (const step of SETTINGS_STEPS) {
        expect(
          planMove({ steps: SETTINGS_STEPS, current: "hunts", place: { step }, via, locked: true }),
          `${via} ${step}`,
        ).toBeNull();
      }
    }
  });

  it("ignores a place on a step the page does not have", () => {
    // The builder's last step is not a step of the settings page, and the other way round.
    expect(plan({ step: "create" })).toBeNull();
    expect(planMove({ steps: BUILDER_STEPS, current: "name", place: { step: "manage" }, via: "auto", locked: false })).toBeNull();
    expect(plan({ step: "" })).toBeNull();
    expect(plan({ step: "Limits" })).toBeNull();
    expect(plan({ step: "toString" })).toBeNull();
  });

  it("reaches every step of both pages from every other", () => {
    for (const steps of [BUILDER_STEPS, SETTINGS_STEPS] as const) {
      for (const from of steps) {
        for (const to of steps) {
          const move = planMove<string>({ steps, current: from, place: { step: to }, via: "pointer", locked: false });
          expect(move?.place.step, `${from} to ${to}`).toBe(to);
          expect(move?.change === null, `${from} to ${to}`).toBe(from === to);
        }
      }
    }
  });
});
