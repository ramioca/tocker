import { describe, expect, it } from "vitest";
import { emptyChainCash, type UnifiedCash } from "@/lib/wallets/funding";
import { shownCashTotal, shownUsdc } from "./cash-display";

function cashWith(base: number, solana: number, inAgentsUsd = 0): UnifiedCash {
  const perChain = [
    { ...emptyChainCash("base"), usdc: base, usdcUsd: base },
    { ...emptyChainCash("solana"), usdc: solana, usdcUsd: solana },
  ];
  const totalUsd = Math.round((base + solana) * 100) / 100;
  return { totalUsd, gasUsd: 0, perChain, inAgentsUsd, agents: [], allUsd: totalUsd + inAgentsUsd };
}

describe("shown cash", () => {
  it("floors a sub-cent balance instead of rounding it up", () => {
    expect(shownUsdc(12.349)).toBe(12.34);
    expect(shownUsdc(0.009)).toBe(0);
  });

  it("makes the total the sum of the rows it sits above", () => {
    const cash = cashWith(120.5, 12.349);
    // Rounded, the total would read $132.85 over rows of $120.50 and $12.34.
    expect(shownCashTotal(cash)).toBe(132.84);
  });

  it("adds agent equity as is on the all-in figure", () => {
    expect(shownCashTotal(cashWith(0.1, 0.2, 50.55), "all")).toBe(50.85);
  });
});
