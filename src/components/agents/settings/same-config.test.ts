import { describe, expect, it } from "vitest";
import { sameConfig } from "./same-config";

describe("sameConfig", () => {
  it("ignores key order at every depth", () => {
    const local = { risk: { maxTradeUsd: 2, slippageBps: 150, sizing: { mode: "fixed_usd", percentOfEquity: 10 } } };
    const fromJsonb = { risk: { sizing: { percentOfEquity: 10, mode: "fixed_usd" }, maxTradeUsd: 2, slippageBps: 150 } };
    expect(sameConfig(local, fromJsonb)).toBe(true);
  });

  it("still sees a changed value", () => {
    expect(sameConfig({ risk: { maxTradeUsd: 2 } }, { risk: { maxTradeUsd: 10 } })).toBe(false);
  });

  it("sees an added key, and keeps array order meaningful", () => {
    expect(sameConfig({ risk: {} }, { risk: { sizing: null } })).toBe(false);
    expect(sameConfig({ chains: ["solana", "base"] }, { chains: ["base", "solana"] })).toBe(false);
  });

  it("treats a key set to undefined like an absent one, as JSON does", () => {
    expect(sameConfig({ a: 1, b: undefined }, { a: 1 })).toBe(true);
  });
});
