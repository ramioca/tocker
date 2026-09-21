import { describe, expect, it } from "vitest";
import { GAS_DRIP_SOL, LAMPORTS_PER_SOL, MIN_AGENT_SOL, gasDripPlan, gasShortfallSol } from "./gas";

describe("gasShortfallSol", () => {
  it("is zero when the wallet already covers the order", () => {
    expect(
      gasShortfallSol({
        balanceSol: 0.01,
        signatureFeeLamports: 5000,
        prioritizationFeeLamports: 2047,
        rentFeeLamports: 0,
      }),
    ).toBe(0);
  });

  it("adds signature, priority and rent — the ATA rent is what actually bites", () => {
    // A new-token buy: 5000 + 2047 + 2_039_280 lamports against an empty wallet.
    const short = gasShortfallSol({
      balanceSol: 0,
      signatureFeeLamports: 5000,
      prioritizationFeeLamports: 2047,
      rentFeeLamports: 2_039_280,
    });
    expect(short).toBeCloseTo(2_046_327 / LAMPORTS_PER_SOL, 12);
  });

  it("treats a missing field as zero rather than NaN", () => {
    expect(gasShortfallSol({ balanceSol: 0, signatureFeeLamports: 5000 })).toBeCloseTo(0.000005, 12);
    expect(gasShortfallSol({ balanceSol: 0 })).toBe(0);
    expect(gasShortfallSol({ balanceSol: 0, rentFeeLamports: null })).toBe(0);
  });

  it("does not let a negative balance invent a bigger shortfall", () => {
    expect(gasShortfallSol({ balanceSol: -5, signatureFeeLamports: 5000 })).toBeCloseTo(0.000005, 12);
  });
});

describe("gasDripPlan", () => {
  it("does not drip when the wallet can already pay", () => {
    const plan = gasDripPlan({ balanceSol: 0.02, signatureFeeLamports: 5000, prioritizationFeeLamports: 2047 });
    expect(plan).toEqual({ drip: false, amountSol: 0, shortfallSol: 0 });
  });

  it("drips the standard amount for a dry wallet facing a plain swap fee", () => {
    const plan = gasDripPlan({ balanceSol: 0, signatureFeeLamports: 5000, prioritizationFeeLamports: 2047 });
    expect(plan.drip).toBe(true);
    // The shortfall is tiny, so the floor applies: one drip, not seven thousand lamports.
    expect(plan.amountSol).toBe(GAS_DRIP_SOL);
  });

  it("covers a shortfall bigger than the standard drip, plus a cushion", () => {
    // Three new-token ATAs in one route: ~0.0061 SOL of rent on an empty wallet.
    const plan = gasDripPlan({ balanceSol: 0, rentFeeLamports: 6_117_840, signatureFeeLamports: 5000 });
    expect(plan.drip).toBe(true);
    expect(plan.amountSol).toBeGreaterThan(GAS_DRIP_SOL);
    expect(plan.amountSol).toBeCloseTo(plan.shortfallSol + MIN_AGENT_SOL, 9);
  });

  it("sends whole lamports — a fractional lamport is not a number Solana accepts", () => {
    const plan = gasDripPlan({ balanceSol: 0.000_000_333, rentFeeLamports: 2_039_280 });
    expect(Number.isInteger(Math.round(plan.amountSol * LAMPORTS_PER_SOL))).toBe(true);
    expect(plan.amountSol * LAMPORTS_PER_SOL).toBeCloseTo(Math.round(plan.amountSol * LAMPORTS_PER_SOL), 6);
  });

  it("leaves a gasless order alone: nothing required means nothing sent", () => {
    expect(gasDripPlan({ balanceSol: 0, signatureFeeLamports: 0, rentFeeLamports: 0 }).drip).toBe(false);
  });
});
