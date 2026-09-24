import { describe, expect, it } from "vitest";
import { parseAgentTab } from "./agent-tab";

describe("parseAgentTab", () => {
  it("accepts every tab name", () => {
    for (const tab of ["overview", "trades", "performance", "runs", "config"]) {
      expect(parseAgentTab(tab)).toBe(tab);
    }
  });

  it("drops anything else", () => {
    expect(parseAgentTab(null)).toBeUndefined();
    expect(parseAgentTab(undefined)).toBeUndefined();
    expect(parseAgentTab("")).toBeUndefined();
    expect(parseAgentTab("Runs")).toBeUndefined();
    // The non-owner's label for the last tab, not its value.
    expect(parseAgentTab("strategy")).toBeUndefined();
    expect(parseAgentTab("toString")).toBeUndefined();
  });
});
