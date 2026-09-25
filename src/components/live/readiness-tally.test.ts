import { describe, expect, it } from "vitest";
import type { ReadinessStep, StepState } from "@/lib/security/types";
import { readinessTally } from "./readiness-tally";

function steps(...states: StepState[]): ReadinessStep[] {
  return states.map((state, index) => ({
    id: "wallets",
    title: `Step ${index + 1}`,
    state,
    detail: "",
    fix: null,
  }));
}

describe("readinessTally", () => {
  it("names what blocks, what to review and what is green when not ready", () => {
    const tally = readinessTally({ steps: steps("pass", "pass", "warn", "warn", "fail"), ready: false });
    expect(tally).toMatchObject({ fail: 1, warn: 2, pass: 2 });
    expect(tally.label).toBe("1 blocking · 2 to review · 2 ready");
  });

  it("says ready when only amber rows remain, rather than counting green ones", () => {
    const tally = readinessTally({ steps: steps("pass", "warn", "warn", "pass"), ready: true });
    expect(tally.label).toBe("Ready to go live · 2 to review");
  });

  it("drops the review count when everything is green", () => {
    expect(readinessTally({ steps: steps("pass", "pass"), ready: true }).label).toBe("Ready to go live");
  });

  it("leaves out empty parts while a transfer is still confirming", () => {
    const tally = readinessTally({ steps: steps("pass", "warn"), ready: false });
    expect(tally.fail).toBe(0);
    expect(tally.label).toBe("1 to review · 1 ready");
  });
});
