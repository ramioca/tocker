import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { describeBlocker, knownBlocker, visibleWarnings } from "./blocker-copy";

/**
 * The code list is read out of the scorer itself rather than kept here by hand: a
 * copied list goes stale the day someone adds a warning, and the failure this guards
 * against — a raw `lp_barely_locked` on screen — is exactly that day.
 */
const SCORER = readFileSync(new URL("../../lib/tokens/score.ts", import.meta.url), "utf8");

function emittedCodes(): string[] {
  const codes = new Set<string>();
  for (const [, code] of SCORER.matchAll(/(?:blockers|warnings)\.push\("([a-z0-9_]+)"\)/g)) codes.add(code);
  // Templated codes (`top10_holders_${pct}pct`) get a sample number in each slot.
  for (const [, template] of SCORER.matchAll(/(?:blockers|warnings)\.push\(`([^`]+)`\)/g)) {
    codes.add(template.replace(/\$\{[^}]*\}/g, "12"));
  }
  return [...codes].sort();
}

describe("blocker copy", () => {
  const codes = emittedCodes();

  it("finds the scorer's codes (the scan itself still works)", () => {
    expect(codes.length).toBeGreaterThan(30);
    expect(codes).toContain("mint_authority_unknown");
    expect(codes).toContain("top10_holders_12pct");
    expect(codes).toContain("rugcheck_12_danger_risks");
  });

  it.each(codes)("has written copy for %s", (code) => {
    expect(knownBlocker(code, "owner")).not.toBeNull();
    expect(knownBlocker(code, "public")).not.toBeNull();
  });

  it("never addresses an operator on a public surface", () => {
    for (const code of codes) {
      const copy = describeBlocker(code, "public");
      expect(`${copy.title} ${copy.detail ?? ""}`).not.toMatch(/\byour (floor|minimum|maximum|bar|blocklist)\b/i);
    }
  });

  it("says whose rules failed", () => {
    expect(describeBlocker("liquidity_below_floor").title).toBe("Liquidity is below your floor");
    expect(describeBlocker("liquidity_below_floor", "public").title).toBe("Liquidity is below the platform's floor");
    expect(describeBlocker("blocklisted", "public").title).toBe("On the platform blocklist");
  });

  it("counts RugCheck risks in words", () => {
    expect(describeBlocker("rugcheck_1_danger_risks").title).toBe("RugCheck flags 1 danger-level risk");
    expect(describeBlocker("rugcheck_3_danger_risks").title).toBe("RugCheck flags 3 danger-level risks");
  });

  it("still degrades an unknown code to words", () => {
    expect(knownBlocker("some_new_check")).toBeNull();
    expect(describeBlocker("some_new_check").title).toBe("Some new check");
  });

  it("does not repeat a failed gate as a warning", () => {
    const warnings = ["top10_holders_concentrated", "lp_barely_locked"];
    expect(visibleWarnings(warnings, ["top10_holders_66pct"])).toEqual(["lp_barely_locked"]);
    expect(visibleWarnings(warnings, [])).toEqual(warnings);
    expect(visibleWarnings(["contract_is_mintable"], ["mint_authority_active"])).toEqual([]);
    expect(visibleWarnings(["contract_is_mintable"], ["mint_authority_unknown"])).toEqual(["contract_is_mintable"]);
  });
});
