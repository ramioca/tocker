/**
 * The fee, as arithmetic. No database, no Privy, no network — every rule the platform
 * charges by is a pure function, and this is where it is pinned down.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_PLATFORM_FEE_USD,
  DEFAULT_SETTLE_MIN_USD,
  buyCostUsd,
  feeEnabled,
  netLiveCashUsd,
  planSettlement,
  platformFeeUsd,
  settleMinUsd,
  sumFees,
  withdrawableAfterFees,
  type FeeRow,
} from "./fee";

const ENV = ["PLATFORM_FEE_USD", "PLATFORM_FEE_SETTLE_MIN_USD"] as const;
const saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));

afterEach(() => {
  for (const key of ENV) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe("the configured fee", () => {
  it("is ten cents a fill by default", () => {
    delete process.env.PLATFORM_FEE_USD;
    expect(platformFeeUsd()).toBe(DEFAULT_PLATFORM_FEE_USD);
    expect(platformFeeUsd()).toBe(0.1);
    expect(feeEnabled()).toBe(true);
  });

  it("is switched off, completely, by zero", () => {
    process.env.PLATFORM_FEE_USD = "0";
    expect(platformFeeUsd()).toBe(0);
    expect(feeEnabled()).toBe(false);
    // And a buy then costs exactly its notional: nothing shifts by a cent.
    expect(buyCostUsd(50, platformFeeUsd())).toBe(50);
  });

  it("falls back rather than going free on a typo", () => {
    // A malformed value must not silently make the product free — that failure would
    // show up in a revenue report weeks later, not in a log.
    for (const bad of ["", "   ", "abc", "-1", "NaN"]) {
      process.env.PLATFORM_FEE_USD = bad;
      expect(platformFeeUsd()).toBe(DEFAULT_PLATFORM_FEE_USD);
    }
  });

  it("takes a sub-cent fee, rounded to the ledger's six decimals", () => {
    process.env.PLATFORM_FEE_USD = "0.0012345678";
    expect(platformFeeUsd()).toBe(0.001235);
  });

  it("defaults the sweep threshold to a dollar", () => {
    delete process.env.PLATFORM_FEE_SETTLE_MIN_USD;
    expect(settleMinUsd()).toBe(DEFAULT_SETTLE_MIN_USD);
    process.env.PLATFORM_FEE_SETTLE_MIN_USD = "2.50";
    expect(settleMinUsd()).toBe(2.5);
  });
});

describe("accrual math", () => {
  const rows = (...amounts: Array<[string, "base" | "solana", number]>): FeeRow[] =>
    amounts.map(([id, chain, amountUsd]) => ({ id, chain, amountUsd }));

  it("sums to the ledger's precision, ignoring nonsense", () => {
    expect(sumFees(rows(["a", "base", 0.1], ["b", "base", 0.1], ["c", "solana", 0.1]))).toBe(0.3);
    expect(sumFees(rows(["a", "base", Number.NaN], ["b", "base", 0.1]))).toBe(0.1);
    expect(sumFees([])).toBe(0);
  });

  it("charges the same for ten fills as ten times one fill", () => {
    const ten = rows(...Array.from({ length: 10 }, (_, i) => [`f${i}`, "base", 0.1] as [string, "base", number]));
    expect(sumFees(ten)).toBeCloseTo(1, 9);
  });
});

describe("settlement batching", () => {
  const fee = (id: string, chain: "base" | "solana", amountUsd = 0.1): FeeRow => ({ id, chain, amountUsd });

  it("does nothing under the threshold — the fees simply wait", () => {
    const plan = planSettlement([fee("a", "base"), fee("b", "base")], 1);
    expect(plan.totalUsd).toBeCloseTo(0.2, 9);
    expect(plan.batches).toEqual([]);
  });

  it("sweeps once the total clears it, one transfer per chain", () => {
    const rows = [
      ...Array.from({ length: 7 }, (_, i) => fee(`b${i}`, "base")),
      ...Array.from({ length: 4 }, (_, i) => fee(`s${i}`, "solana")),
    ];
    const plan = planSettlement(rows, 1);
    expect(plan.totalUsd).toBeCloseTo(1.1, 9);
    expect(plan.batches).toHaveLength(2);

    const base = plan.batches.find((b) => b.chain === "base");
    const solana = plan.batches.find((b) => b.chain === "solana");
    expect(base?.amountUsd).toBeCloseTo(0.7, 9);
    expect(base?.feeIds).toHaveLength(7);
    expect(solana?.amountUsd).toBeCloseTo(0.4, 9);
    expect(solana?.feeIds).toHaveLength(4);
    // Every row is accounted for exactly once: nothing is settled twice, nothing is lost.
    expect(plan.batches.flatMap((b) => b.feeIds).sort()).toEqual(rows.map((r) => r.id).sort());
  });

  it("decides on the total across chains, not per chain", () => {
    // $0.60 on each side is not a dollar anywhere, but it is $1.20 owed. A per-chain
    // threshold would leave both halves waiting forever for the other.
    const rows = [
      ...Array.from({ length: 6 }, (_, i) => fee(`b${i}`, "base")),
      ...Array.from({ length: 6 }, (_, i) => fee(`s${i}`, "solana")),
    ];
    const plan = planSettlement(rows, 1);
    expect(plan.batches.map((b) => b.chain).sort()).toEqual(["base", "solana"]);
  });

  it("sweeps a total sitting exactly on the threshold", () => {
    const rows = Array.from({ length: 10 }, (_, i) => fee(`b${i}`, "base"));
    expect(planSettlement(rows, 1).batches).toHaveLength(1);
  });

  it("has nothing to plan when nothing is owed", () => {
    expect(planSettlement([], 1)).toEqual({ totalUsd: 0, batches: [] });
  });
});

describe("cash, net of fees", () => {
  it("is the wallet balance minus what is already owed", () => {
    expect(netLiveCashUsd(100, 0.3)).toBeCloseTo(99.7, 9);
    expect(netLiveCashUsd(100, 0)).toBe(100);
  });

  it("never goes negative — a debt is not negative cash", () => {
    expect(netLiveCashUsd(0.05, 0.3)).toBe(0);
  });

  it("survives an unreadable balance", () => {
    expect(netLiveCashUsd(Number.NaN, 0.3)).toBe(0);
    expect(netLiveCashUsd(10, Number.NaN)).toBe(10);
  });
});

describe("what a buy actually costs", () => {
  it("is the notional plus the fee, so the last dollar is never overspent", () => {
    expect(buyCostUsd(50, 0.1)).toBeCloseTo(50.1, 9);
    // The case the guard exists for: $10.00 of cash cannot buy $10.00 of token.
    expect(buyCostUsd(10, 0.1)).toBeGreaterThan(10);
  });

  it("ignores nonsense on either side", () => {
    expect(buyCostUsd(Number.NaN, 0.1)).toBeCloseTo(0.1, 9);
    expect(buyCostUsd(50, Number.NaN)).toBe(50);
    expect(buyCostUsd(-5, 0.1)).toBeCloseTo(0.1, 9);
  });
});

describe("what may be withdrawn from a wallet that owes fees", () => {
  it("is the balance less what is owed, to the cent", () => {
    // 10 − 0.3 is 9.699999… in floating point; a plain floor to cents would say $9.69.
    expect(withdrawableAfterFees(10, 0.3)).toBe(9.7);
    expect(withdrawableAfterFees(25, 0.1)).toBe(24.9);
    expect(withdrawableAfterFees(10.123456, 0.3)).toBe(9.82);
  });

  it("is the whole balance, floored to a cent, when nothing is owed", () => {
    expect(withdrawableAfterFees(12.349, 0)).toBe(12.34);
    expect(withdrawableAfterFees(5, 0)).toBe(5);
  });

  it("is nothing when the wallet holds no more than it owes", () => {
    expect(withdrawableAfterFees(0.3, 0.3)).toBe(0);
    expect(withdrawableAfterFees(0.05, 0.3)).toBe(0);
    expect(withdrawableAfterFees(0, 0.3)).toBe(0);
  });

  it("never answers with a number it could not work out", () => {
    expect(withdrawableAfterFees(Number.NaN, 0.3)).toBe(0);
    expect(withdrawableAfterFees(10, Number.NaN)).toBe(10);
    expect(withdrawableAfterFees(-4, 0)).toBe(0);
  });
});
