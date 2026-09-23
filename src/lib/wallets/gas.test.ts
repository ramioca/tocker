import { describe, expect, it } from "vitest";
import {
  ATA_RENT_LAMPORTS,
  ATA_RENT_SOL,
  GAS_DRIP_SOL,
  LAMPORTS_PER_SOL,
  MAX_DRIP_REQUIREMENT_LAMPORTS,
  MAX_GAS_DRIP_SOL,
  MAX_SPONSORED_FAILURES_PER_HOUR,
  MAX_SPONSORED_PRIORITY_LAMPORTS,
  MAX_SPONSORED_SWAP_LAMPORTS,
  MAX_SWAP_DRIPS_PER_DAY,
  MIN_ACCOUNT_OPENING_BUY_USD,
  MIN_AGENT_SOL,
  MIN_PLATFORM_SOL,
  SIGNATURE_FEE_LAMPORTS,
  SPONSORED_PRIORITY_BASE_LAMPORTS,
  SPONSORED_SWAP_MARGIN_LAMPORTS,
  SPONSORED_SWAP_RESERVE_LAMPORTS,
  SPONSOR_MARGIN_LAMPORTS,
  accountOpeningProblem,
  agentTransferLamports,
  declaredOrderLamports,
  gasDripPlan,
  gasShortfallSol,
  priorityFeeLamports,
  sponsoredFailureProblem,
  sponsoredFundingLamports,
  sponsoredPriorityAllowance,
  sponsoredSwapBudget,
  swapDripProblem,
  withinSponsoredSwapCap,
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

  it("covers a shortfall bigger than the standard drip, plus a cushion, up to the cap", () => {
    // The agent-paid swap path's 0.006 SOL pre-quote top-up on an empty wallet.
    const plan = gasDripPlan({ balanceSol: 0, requiredLamports: MAX_DRIP_REQUIREMENT_LAMPORTS });
    expect(plan.drip).toBe(true);
    expect(plan.amountSol).toBeGreaterThan(GAS_DRIP_SOL);
    expect(plan.amountSol).toBeCloseTo(plan.shortfallSol + MIN_AGENT_SOL, 9);
    expect(plan.amountSol).toBeCloseTo(MAX_GAS_DRIP_SOL, 9);
  });

  /**
   * W8 review: the agent-paid fallback passed an order's own `prioritizationFeeLamports`
   * straight through as the requirement, so a compromised `/order` declaring 40M lamports
   * got a 0.045 SOL drip on every trade. Past the cap nothing is sent.
   */
  it("refuses a requirement past the cap instead of dripping whatever an order declares", () => {
    const plan = gasDripPlan({ balanceSol: 0, requiredLamports: 40_000_000 });
    expect(plan.drip).toBe(false);
    expect(plan.amountSol).toBe(0);
    expect(plan.overCap).toBe(true);
    // The same through the three fee fields.
    expect(gasDripPlan({ balanceSol: 0, prioritizationFeeLamports: 40_000_000 }).overCap).toBe(true);
    // Three new-token accounts at the old rent: over the cap too.
    expect(gasDripPlan({ balanceSol: 0, rentFeeLamports: 6_117_840, signatureFeeLamports: 5000 }).overCap).toBe(true);
    // A wallet that can already pay is not "over the cap", it just needs nothing.
    expect(gasDripPlan({ balanceSol: 1, requiredLamports: 40_000_000 })).toEqual({ drip: false, amountSol: 0, shortfallSol: 0 });
  });

  it("never sends more than MAX_GAS_DRIP_SOL, whatever the balance and requirement", () => {
    for (let required = 0; required <= MAX_DRIP_REQUIREMENT_LAMPORTS + 2_000_000; required += 250_000) {
      for (const balanceSol of [0, 0.001, 0.004]) {
        const plan = gasDripPlan({ balanceSol, requiredLamports: required });
        expect(plan.amountSol).toBeLessThanOrEqual(MAX_GAS_DRIP_SOL + 1e-12);
        if (required > MAX_DRIP_REQUIREMENT_LAMPORTS) expect(plan.drip).toBe(false);
      }
    }
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
describe("swapDripProblem", () => {
  it("allows swap drips up to the daily limit, then refuses without asking anyone for SOL", () => {
    expect(swapDripProblem(0)).toBeNull();
    expect(swapDripProblem(MAX_SWAP_DRIPS_PER_DAY - 1)).toBeNull();
    const problem = swapDripProblem(MAX_SWAP_DRIPS_PER_DAY);
    expect(problem).toMatch(/daily limit/);
    expect(problem).not.toMatch(/send .*SOL|top .* up yourself/i);
    expect(swapDripProblem(Number.NaN)).toBeNull();
  });
});

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

/**
 * The co-sign budget for a sponsored swap, priced from the transaction's bytes. Fixtures
 * are live payer orders from 2026-09-23, where the simulated platform loss equalled
 * signature + priority + declared rent to the lamport.
 */
describe("sponsoredSwapBudget", () => {
  const cost = (over: Partial<Parameters<typeof sponsoredSwapBudget>[0]> = {}) => ({
    signatureLamports: 2 * SIGNATURE_FEE_LAMPORTS,
    priorityLamports: 0,
    platformFundedAccounts: 0,
    declaredRentLamports: 0,
    ...over,
  });

  it("is the bytes' fees, the declared rent and the margin — live numbers", () => {
    // A pump.fun buy opening a USDT and a Token-2022 account plus a repaid wSOL account:
    // simulated loss 3,031,756.
    expect(
      sponsoredSwapBudget(cost({ priorityLamports: 19_476, platformFundedAccounts: 3, declaredRentLamports: 3_002_280 }), 1_000_000),
    ).toEqual({ ok: true, lamports: 3_031_756 + SPONSORED_SWAP_MARGIN_LAMPORTS });
    // A USDC→SOL buy: the wrapped-SOL account the platform opens is repaid, and Ultra
    // declares no rent: simulated loss 10,128.
    expect(sponsoredSwapBudget(cost({ priorityLamports: 128, platformFundedAccounts: 1 }), 1_000_000)).toEqual({
      ok: true,
      lamports: 10_128 + SPONSORED_SWAP_MARGIN_LAMPORTS,
    });
  });

  it("never lets the declared rent exceed the accounts the bytes have the platform open", () => {
    // Jupiter declares 3.9M of "rent" on a swap that opens one account.
    const budget = sponsoredSwapBudget(cost({ platformFundedAccounts: 1, declaredRentLamports: 3_900_000 }), 1_000_000);
    expect(budget).toEqual({ ok: true, lamports: 10_000 + ATA_RENT_LAMPORTS + SPONSORED_SWAP_MARGIN_LAMPORTS });
    // Declared rent with no account opened: none of it is allowed.
    expect(sponsoredSwapBudget(cost({ declaredRentLamports: 1_500_000 }), 1_000_000)).toEqual({
      ok: true,
      lamports: 10_000 + SPONSORED_SWAP_MARGIN_LAMPORTS,
    });
  });

  /**
   * W8 review: the old budget was the order's own JSON fee fields plus 0.0002 SOL, so a
   * compromised /order could declare a 3.79M priority fee and fill it with a transfer to
   * itself. The bytes set the priority now, and it must fit the trade's allowance.
   */
  it("refuses a priority fee in the bytes past the allowance, whatever the order declared", () => {
    const budget = sponsoredSwapBudget(cost({ priorityLamports: 3_790_000 }), 256_410);
    expect(budget.ok).toBe(false);
    if (!budget.ok) expect(budget.reason).toMatch(/3790000 lamports, over the 256410/);
  });

  it("never goes past the per-swap cap", () => {
    const budget = sponsoredSwapBudget(
      cost({ priorityLamports: MAX_SPONSORED_PRIORITY_LAMPORTS, platformFundedAccounts: 2, declaredRentLamports: 2 * ATA_RENT_LAMPORTS }),
      MAX_SPONSORED_PRIORITY_LAMPORTS,
    );
    expect(budget.ok).toBe(false);
    expect(MAX_SPONSORED_SWAP_LAMPORTS).toBe(4_000_000);
  });

  it("is too small a margin to hide an account the order did not declare", () => {
    expect(SPONSORED_SWAP_MARGIN_LAMPORTS).toBeLessThan(1_488_440);
  });

  it("treats junk as zero", () => {
    expect(
      sponsoredSwapBudget({ signatureLamports: Number.NaN, priorityLamports: -5, platformFundedAccounts: -1, declaredRentLamports: null }, 0),
    ).toEqual({ ok: true, lamports: SPONSORED_SWAP_MARGIN_LAMPORTS });
  });
});

describe("declaredOrderLamports / withinSponsoredSwapCap", () => {
  it("treats missing, null and junk fields as zero", () => {
    expect(declaredOrderLamports({})).toBe(0);
    expect(declaredOrderLamports({ signatureFeeLamports: null, rentFeeLamports: Number.NaN, prioritizationFeeLamports: -5 })).toBe(0);
  });

  it("says whether an order's gas fits under the cap at all", () => {
    // Two new Token-2022 accounts at today's rent fit; at the old 2,039,280 each they would not.
    expect(withinSponsoredSwapCap({ signatureFeeLamports: 10_000, prioritizationFeeLamports: 300_000, rentFeeLamports: 2 * 1_513_840 })).toBe(true);
    expect(withinSponsoredSwapCap({ signatureFeeLamports: 10_000, rentFeeLamports: 2 * ATA_RENT_LAMPORTS })).toBe(false);
    expect(withinSponsoredSwapCap({ prioritizationFeeLamports: MAX_SPONSORED_SWAP_LAMPORTS + 1 })).toBe(false);
  });
});

describe("priorityFeeLamports", () => {
  it("is limit × price in micro-lamports, rounded up — the live numbers", () => {
    expect(priorityFeeLamports(315_362, 15_230)).toBe(4_803);
    expect(priorityFeeLamports(180_443, 2_803)).toBe(506);
    expect(priorityFeeLamports(0, 5)).toBe(0);
    expect(priorityFeeLamports(200_000, 0)).toBe(0);
  });
});

/**
 * W8 review: a $0.01 manual-mode buy came back from Ultra with a 1.19M-lamport priority
 * fee, sponsored. The priority the platform pays is now tied to the trade's size.
 */
describe("sponsoredPriorityAllowance", () => {
  it("is the base on a tiny ticket, so a $0.01 trade never carries a 1.2M priority fee", () => {
    expect(sponsoredPriorityAllowance({ notionalUsd: 0.01, solPriceUsd: 117.37 })).toBe(SPONSORED_PRIORITY_BASE_LAMPORTS);
    // The live attack shapes: a $0.005 sell at 243,392 and $0.01 buys at 1.05M-1.19M.
    for (const priority of [243_392, 1_053_675, 1_193_823]) {
      expect(sponsoredPriorityAllowance({ notionalUsd: 0.01, solPriceUsd: 117.37 })).toBeLessThan(priority);
    }
    // A $0.25 ultra-mode exit at Jupiter's own 125,096 still goes through.
    expect(sponsoredPriorityAllowance({ notionalUsd: 0.25, solPriceUsd: 117.37 })).toBeGreaterThanOrEqual(125_096);
  });

  it("grows with the trade, 30 bps of it, up to the ceiling", () => {
    // $10 at $117: $0.03 of SOL ≈ 255,601 lamports.
    expect(sponsoredPriorityAllowance({ notionalUsd: 10, solPriceUsd: 117.37 })).toBe(255_601);
    expect(sponsoredPriorityAllowance({ notionalUsd: 10_000, solPriceUsd: 117.37 })).toBe(MAX_SPONSORED_PRIORITY_LAMPORTS);
  });

  it("is the base without a usable size or SOL price", () => {
    expect(sponsoredPriorityAllowance({ notionalUsd: 50, solPriceUsd: null })).toBe(SPONSORED_PRIORITY_BASE_LAMPORTS);
    expect(sponsoredPriorityAllowance({ notionalUsd: 50, solPriceUsd: 0 })).toBe(SPONSORED_PRIORITY_BASE_LAMPORTS);
    expect(sponsoredPriorityAllowance({ notionalUsd: Number.NaN, solPriceUsd: 117 })).toBe(SPONSORED_PRIORITY_BASE_LAMPORTS);
  });
});

/**
 * W8 review: a $0.01 buy of each of hundreds of tokens had the platform front ≈1.5M
 * lamports of rent apiece, held forever as dust so the account was never recycled.
 */
describe("accountOpeningProblem", () => {
  it("refuses an account-opening buy under the floor", () => {
    expect(accountOpeningProblem({ side: "buy", notionalUsd: 0.01, declaredRentLamports: 1_488_440 })).toMatch(/\$2 or more/);
    expect(accountOpeningProblem({ side: "buy", notionalUsd: MIN_ACCOUNT_OPENING_BUY_USD - 0.01, declaredRentLamports: 1 })).not.toBeNull();
  });
  it("allows it at the floor, into an existing account, or on a sell", () => {
    expect(accountOpeningProblem({ side: "buy", notionalUsd: MIN_ACCOUNT_OPENING_BUY_USD, declaredRentLamports: 1_488_440 })).toBeNull();
    expect(accountOpeningProblem({ side: "buy", notionalUsd: 0.01, declaredRentLamports: 0 })).toBeNull();
    expect(accountOpeningProblem({ side: "buy", notionalUsd: 0.01, declaredRentLamports: null })).toBeNull();
    expect(accountOpeningProblem({ side: "sell", notionalUsd: 0.01, declaredRentLamports: 1_488_440 })).toBeNull();
  });
});

describe("sponsoredFailureProblem", () => {
  it("pauses sponsorship at the hourly failure limit", () => {
    expect(sponsoredFailureProblem(MAX_SPONSORED_FAILURES_PER_HOUR - 1)).toBeNull();
    expect(sponsoredFailureProblem(MAX_SPONSORED_FAILURES_PER_HOUR)).toMatch(/failed on chain in the last hour/);
  });
});

describe("SPONSORED_SWAP_RESERVE_LAMPORTS", () => {
  it("is the most one swap may cost the platform, plus the sponsorship margin", () => {
    expect(SPONSORED_SWAP_RESERVE_LAMPORTS).toBe(MAX_SPONSORED_SWAP_LAMPORTS + SPONSOR_MARGIN_LAMPORTS);
    expect(SPONSORED_SWAP_RESERVE_LAMPORTS).toBe(5_000_000);
  });

  it("covers any swap the co-sign budget allows, and leaves the platform above its own rent floor", () => {
    // The biggest co-sign budget there is, and a system account's rent-exempt minimum (890,880).
    expect(SPONSORED_SWAP_RESERVE_LAMPORTS).toBeGreaterThanOrEqual(MAX_SPONSORED_SWAP_LAMPORTS + 890_880);
  });

  it("is a bar the platform's own comfortable floor clears, so a healthy wallet is never turned away", () => {
    expect(SPONSORED_SWAP_RESERVE_LAMPORTS).toBeLessThan(MIN_PLATFORM_SOL * LAMPORTS_PER_SOL);
  });
});
