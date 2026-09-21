import { describe, expect, it } from "vitest";
import {
  ATA_RENT_LAMPORTS,
  ATA_RENT_SOL,
  GAS_DRIP_SOL,
  LAMPORTS_PER_SOL,
  MIN_AGENT_SOL,
  MIN_PLATFORM_SOL,
  SIGNATURE_FEE_LAMPORTS,
  SPONSOR_MARGIN_LAMPORTS,
  agentTransferLamports,
  gasDripPlan,
  gasShortfallSol,
  sponsoredFundingLamports,
} from "./gas";

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

  it("accepts a pre-summed requiredLamports, as ensureAgentGas passes it", () => {
    const split = gasDripPlan({
      balanceSol: 0,
      signatureFeeLamports: 5000,
      prioritizationFeeLamports: 2047,
      rentFeeLamports: 2_039_280,
    });
    const summed = gasDripPlan({ balanceSol: 0, requiredLamports: 5000 + 2047 + 2_039_280 });
    expect(summed).toEqual(split);
  });
});

/**
 * The two "how much SOL does this cost?" estimates. They differ only in the cushion, and
 * that difference is deliberate — see the constants.
 */
describe("sponsoredFundingLamports", () => {
  it("is a signature plus the margin when the agent's USDC account already exists", () => {
    expect(sponsoredFundingLamports({ ataExists: true })).toBe(
      SIGNATURE_FEE_LAMPORTS + SPONSOR_MARGIN_LAMPORTS,
    );
    expect(sponsoredFundingLamports({ ataExists: true })).toBe(1_005_000);
  });

  it("adds the token account's rent on a first funding — the part that actually costs money", () => {
    const first = sponsoredFundingLamports({ ataExists: false });
    expect(first).toBe(SIGNATURE_FEE_LAMPORTS + ATA_RENT_LAMPORTS + SPONSOR_MARGIN_LAMPORTS);
    expect(first - sponsoredFundingLamports({ ataExists: true })).toBe(ATA_RENT_LAMPORTS);
  });

  it("stays under the SOL the readiness check asks the platform wallet to hold", () => {
    // If the floor the operator is told to keep were below what one funding costs, the
    // checklist would pass and the first funding would still fail.
    expect(sponsoredFundingLamports({ ataExists: false })).toBeLessThanOrEqual(
      MIN_PLATFORM_SOL * LAMPORTS_PER_SOL,
    );
  });

  it("agrees with ATA_RENT_SOL — the same rent expressed twice must not drift", () => {
    expect(ATA_RENT_LAMPORTS).toBe(Math.round(ATA_RENT_SOL * LAMPORTS_PER_SOL));
  });
});

describe("agentTransferLamports", () => {
  it("is what a USDC-only agent wallet needs to sign one transfer out of itself", () => {
    expect(agentTransferLamports({ ataExists: true })).toBe(15_000);
    expect(agentTransferLamports({ ataExists: false })).toBe(5_000 + 2_039_280 + 10_000);
  });

  it("carries a smaller cushion than the sponsorship check, because a drip follows it", () => {
    expect(agentTransferLamports({ ataExists: true })).toBeLessThan(
      sponsoredFundingLamports({ ataExists: true }),
    );
  });

  it("is a number gasDripPlan can act on directly", () => {
    const plan = gasDripPlan({ balanceSol: 0, requiredLamports: agentTransferLamports({ ataExists: false }) });
    expect(plan.drip).toBe(true);
    expect(plan.amountSol).toBeGreaterThan(ATA_RENT_SOL);
  });
});
