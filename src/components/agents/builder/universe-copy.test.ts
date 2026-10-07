/**
 * The sentences about where an agent hunts. They state the gates a real-money agent
 * trades behind, so an off-ladder value must be said as the number it is.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_AGENT_CONFIG } from "@/lib/agent/config";
import { UNIVERSE_PRESETS, type UniverseConfig } from "./types";
import { compareToBalanced, universeSentence, universeSummary } from "./universe-copy";

const BALANCED: UniverseConfig = DEFAULT_AGENT_CONFIG.universe;

/** Every gate off its ladder, as somebody typing exact values would leave it. */
const ODD: UniverseConfig = {
  ...BALANCED,
  minScore: 61.5,
  minLiquidityUsd: 12_345,
  minHolderCount: 37,
  minAgeMinutes: 7,
  maxAgeHours: 36,
  maxTop10HolderPct: 42.5,
  maxBuyTaxPct: 7.5,
};

describe("universeSummary", () => {
  it("is unchanged for the shipped default", () => {
    expect(universeSummary(BALANCED, ["solana"])).toBe("Solana · score 62+ · $15K+ liquidity · 4 feeds");
  });

  it("says a typed liquidity gate as the number it is", () => {
    expect(universeSummary(ODD, ["solana"])).toBe("Solana · score 62+ · $12,345+ liquidity · 4 feeds");
  });

  it("names the chains, and counts what is blocked", () => {
    expect(universeSummary(BALANCED, ["solana", "base"])).toContain("Solana + Base · ");
    expect(universeSummary(BALANCED, [])).toContain("No chain · ");
    const blocked = { ...BALANCED, blocklist: [{ chain: "solana" as const, address: "abc123", symbol: "RUG" }] };
    expect(universeSummary(blocked, ["solana"])).toBe("Solana · score 62+ · $15K+ liquidity · 4 feeds · 1 blocked");
  });
});

describe("universeSentence", () => {
  it("is unchanged for the shipped default", () => {
    expect(universeSentence(BALANCED, ["solana"])).toContain(
      "it only buys tokens scoring 62+ (candidate and up) with at least $15K of liquidity, 150 holders or more, " +
        "at least 30 minutes old, top-10 wallets under 60% and buy tax under 5%. " +
        "Mint and freeze authorities must both be revoked.",
    );
  });

  it("says typed gates exactly", () => {
    const sentence = universeSentence(ODD, ["solana"]);
    expect(sentence).toContain("at least $12,345 of liquidity");
    expect(sentence).toContain("37 holders or more");
    expect(sentence).toContain("at least 7 minutes old");
    expect(sentence).toContain("no older than 36 hours");
    expect(sentence).not.toContain("2 days");
    expect(sentence).not.toContain("$12K");
  });

  it("says a ceiling under an hour in minutes", () => {
    expect(universeSentence({ ...BALANCED, maxAgeHours: 0.25 }, ["solana"])).toContain("no older than 15 minutes");
  });

  it("prints every posture's ladder values as before", () => {
    const degen = UNIVERSE_PRESETS.find((preset) => preset.id === "degen")!;
    const sentence = universeSentence({ ...degen.values, blocklist: [] }, ["solana"]);
    expect(sentence).toContain("at least $5.0K of liquidity, 50 holders or more, at least 15 minutes old, no older than 3 days");
  });
});

describe("compareToBalanced", () => {
  it("finds nothing to say about the default", () => {
    expect(compareToBalanced(BALANCED)).toEqual({ tighter: [], looser: [], feedsDiffer: false });
  });

  it("compares numbers, so typed values land on the right side", () => {
    expect(compareToBalanced(ODD)).toEqual({
      tighter: ["top-10 share", "maximum age"],
      looser: ["score", "liquidity", "holders", "minimum age", "buy tax"],
      feedsDiffer: false,
    });
  });
});
