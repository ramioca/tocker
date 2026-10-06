import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { JUPITER_FALLBACK_MAX_PCT, slippageMeaning } from "./slippage-copy";

/**
 * The cap is read out of the executor rather than trusted from the copy: the sentence
 * promises "never above 15%", and the day someone changes the executor's constant is the
 * day that promise would otherwise go quietly false.
 */
const EXECUTOR = readFileSync(new URL("../../../lib/trading/jupiter.ts", import.meta.url), "utf8");

describe("slippage tolerance copy", () => {
  it("quotes the executor's own cap on Jupiter's tolerance", () => {
    const match = EXECUTOR.match(/const MAX_ACCEPTED_SLIPPAGE_BPS = ([\d_]+);/);
    expect(match).not.toBeNull();
    const bps = Number(match![1].replaceAll("_", ""));
    expect(JUPITER_FALLBACK_MAX_PCT).toBe(bps / 100);
    expect(slippageMeaning(100)).toContain(`never above ${bps / 100}%`);
  });

  it("states the setting as a percentage", () => {
    expect(slippageMeaning(300)).toContain("at most 3.00% slippage");
    expect(slippageMeaning(80)).toContain("at most 0.80% slippage");
  });

  /** The old sentence said worse fills "are rejected", which the fallback makes untrue. */
  it("does not promise that a looser fill is always rejected", () => {
    expect(slippageMeaning(100)).not.toMatch(/reject/i);
    expect(slippageMeaning(100)).toContain("Tocker takes Jupiter's own tolerance");
  });
});
