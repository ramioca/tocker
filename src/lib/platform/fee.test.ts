/**
 * The fee, as arithmetic. No database, no Privy, no network — every rule the platform
 * charges by is a pure function, and this is where it is pinned down.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_PLATFORM_FEE_BPS,
  DEFAULT_SETTLE_MIN_USD,
  MAX_PLATFORM_FEE_BPS,
  buyCostUsd,
  feeEnabled,
  feeForFill,
  floorToCents,
  formatFeeRate,
  maxBuyUsd,
  netLiveCashUsd,
  planSettlement,
  platformFeeBps,
  settleMinUsd,
  sumFees,
  withdrawableAfterFees,
  type FeeRow,
} from "./fee";

const ENV = ["PLATFORM_FEE_BPS", "PLATFORM_FEE_USD", "PLATFORM_FEE_SETTLE_MIN_USD"] as const;
const saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));

afterEach(() => {
  for (const key of ENV) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

/** A dollar figure in whole micro-dollars, as the ledger's six decimals hold it. */
const micros = (usd: number): number => Math.round(usd * 1e6);

/** The fee worked out again in exact whole numbers, to check the real one against. */
function exactFeeMicros(sizeMicros: number, bps: number): number {
  return Number((BigInt(sizeMicros) * BigInt(Math.round(bps * 100))) / BigInt(1_000_000));
}

/** The same sequence on every run: a test that fails must fail the same way twice. */
function sequence(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state / 2_147_483_648;
  };
}

describe("the configured rate", () => {
  it("is half a percent of a fill by default", () => {
    delete process.env.PLATFORM_FEE_BPS;
    expect(platformFeeBps()).toBe(DEFAULT_PLATFORM_FEE_BPS);
    expect(platformFeeBps()).toBe(50);
    expect(feeEnabled()).toBe(true);
  });

  it("reads the setting, spaces and all", () => {
    for (const [raw, bps] of [["50", 50], [" 25 ", 25], ["100", 100], ["1", 1], ["1000", 1000]] as const) {
      process.env.PLATFORM_FEE_BPS = raw;
      expect(platformFeeBps()).toBe(bps);
      expect(feeEnabled()).toBe(true);
    }
  });

  it("is switched off, completely, by zero", () => {
    for (const zero of ["0", " 0 ", "0.0", "-0"]) {
      process.env.PLATFORM_FEE_BPS = zero;
      expect(platformFeeBps()).toBe(0);
      expect(feeEnabled()).toBe(false);
    }
    // And then nothing shifts by a cent: a buy costs exactly its notional, a fill is
    // charged nothing, and the cash buys what it says.
    expect(buyCostUsd(50, platformFeeBps())).toBe(50);
    expect(feeForFill(50, platformFeeBps())).toBe(0);
    expect(maxBuyUsd(50, platformFeeBps())).toBe(50);
  });

  it("falls back rather than going free on a typo", () => {
    // A malformed value must not silently make the product free — that failure would
    // show up in a revenue report weeks later, not in a log.
    for (const bad of ["", "   ", "abc", "-1", "NaN", "50bps", "0,5", "Infinity", "-Infinity"]) {
      process.env.PLATFORM_FEE_BPS = bad;
      expect(platformFeeBps()).toBe(DEFAULT_PLATFORM_FEE_BPS);
    }
  });

  it("falls back rather than taking a tenth of a trade or more", () => {
    // 1000 is the most the setting may ask for. A slipped digit above it is a typo too,
    // and this one would come out of every owner's fill.
    process.env.PLATFORM_FEE_BPS = String(MAX_PLATFORM_FEE_BPS);
    expect(platformFeeBps()).toBe(1000);
    for (const tooMuch of ["1001", "1000.01", "5000", "1e9"]) {
      process.env.PLATFORM_FEE_BPS = tooMuch;
      expect(platformFeeBps()).toBe(DEFAULT_PLATFORM_FEE_BPS);
    }
  });

  it("takes a fraction of a basis point, and only a zero switches the fee off", () => {
    process.env.PLATFORM_FEE_BPS = "12.5";
    expect(platformFeeBps()).toBe(12.5);
    process.env.PLATFORM_FEE_BPS = "0.25";
    expect(platformFeeBps()).toBe(0.25);
    // Too small to keep is not a zero, so it is a typo, not an off switch.
    process.env.PLATFORM_FEE_BPS = "0.001";
    expect(platformFeeBps()).toBe(DEFAULT_PLATFORM_FEE_BPS);
  });

  it("does not read PLATFORM_FEE_USD at all", () => {
    delete process.env.PLATFORM_FEE_BPS;
    for (const old of ["0", "0.10", "5", "abc"]) {
      process.env.PLATFORM_FEE_USD = old;
      expect(platformFeeBps()).toBe(DEFAULT_PLATFORM_FEE_BPS);
      expect(feeForFill(100, platformFeeBps())).toBe(0.5);
    }
    process.env.PLATFORM_FEE_BPS = "25";
    process.env.PLATFORM_FEE_USD = "0";
    expect(platformFeeBps()).toBe(25);
  });

  it("defaults the sweep threshold to a dollar", () => {
    delete process.env.PLATFORM_FEE_SETTLE_MIN_USD;
    expect(settleMinUsd()).toBe(DEFAULT_SETTLE_MIN_USD);
    process.env.PLATFORM_FEE_SETTLE_MIN_USD = "2.50";
    expect(settleMinUsd()).toBe(2.5);
  });
});

describe("the rate in words", () => {
  it("is a percentage with no padding", () => {
    expect(formatFeeRate(50)).toBe("0.5%");
    expect(formatFeeRate(25)).toBe("0.25%");
    expect(formatFeeRate(100)).toBe("1%");
    expect(formatFeeRate(1000)).toBe("10%");
    expect(formatFeeRate(1)).toBe("0.01%");
    expect(formatFeeRate(12.5)).toBe("0.125%");
    expect(formatFeeRate(DEFAULT_PLATFORM_FEE_BPS)).toBe("0.5%");
  });

  it("is 0% for no rate at all", () => {
    expect(formatFeeRate(0)).toBe("0%");
    expect(formatFeeRate(Number.NaN)).toBe("0%");
    expect(formatFeeRate(-5)).toBe("0%");
  });
});

describe("the fee on one fill", () => {
  it("is the rate times the fill, at every size and rate", () => {
    const cases: Array<[size: number, bps: number, fee: number]> = [
      [0.5, 0, 0],
      [0.5, 25, 0.00125],
      [0.5, 50, 0.0025],
      [0.5, 100, 0.005],
      [3, 0, 0],
      [3, 25, 0.0075],
      [3, 50, 0.015],
      [3, 100, 0.03],
      [100, 0, 0],
      [100, 25, 0.25],
      [100, 50, 0.5],
      [100, 100, 1],
      [12_345.67, 0, 0],
      [12_345.67, 25, 30.864175],
      [12_345.67, 50, 61.72835],
      [12_345.67, 100, 123.4567],
      [1, 50, 0.005],
      [2, 50, 0.01],
      [50, 50, 0.25],
      [1_000_000, 50, 5_000],
    ];
    for (const [size, bps, fee] of cases) {
      expect(micros(feeForFill(size, bps)), `$${size} at ${bps} bps`).toBe(micros(fee));
    }
  });

  it("has no minimum and no cap", () => {
    expect(feeForFill(0.01, 50)).toBe(0.00005);
    expect(feeForFill(0.0002, 50)).toBe(0.000001);
    expect(feeForFill(25_000_000, 50)).toBe(125_000);
  });

  it("is exact where floating point is not", () => {
    // 1.005 × 50 / 10,000 is 0.005024999… in floating point. The fee is 0.005025.
    expect(micros(feeForFill(1.005, 50))).toBe(5025);
    expect(micros(feeForFill(0.07, 50))).toBe(350);
    expect(micros(feeForFill(4.35, 100))).toBe(43_500);
    expect(micros(feeForFill(1.1, 1000))).toBe(110_000);
  });

  it("is rounded down to the sixth decimal, so no fill pays more than the rate", () => {
    // 0.5% of $0.0023 is $0.0000115. Rounded to the nearest it would be $0.000012.
    expect(micros(feeForFill(0.0023, 50))).toBe(11);
    expect(micros(feeForFill(4.975125, 50))).toBe(24_875);
    // And a fill too small for its fee to reach a millionth of a dollar pays nothing.
    expect(feeForFill(0.0001, 50)).toBe(0);
    expect(feeForFill(0.000199, 50)).toBe(0);
  });

  it("agrees with whole-number arithmetic on two hundred thousand sizes", () => {
    const next = sequence(20_261_008);
    for (const bps of [1, 12.5, 25, 50, 100, 1000]) {
      let wrong = 0;
      for (let i = 0; i < 40_000; i += 1) {
        // Dust, ordinary tickets and large ones, to the micro-dollar.
        const sizeMicros = Math.floor(next() * (i % 3 === 0 ? 5_000 : i % 3 === 1 ? 50_000_000 : 5_000_000_000_000)) + 1;
        if (micros(feeForFill(sizeMicros / 1e6, bps)) !== exactFeeMicros(sizeMicros, bps)) wrong += 1;
      }
      expect(wrong, `${bps} bps`).toBe(0);
    }
  });

  it("is the fee on the size the ledger stores, six decimals of it", () => {
    // A paper fill's size is tokens × price and carries more decimals than the trade row
    // keeps. The fee is the rate times what the row says.
    expect(feeForFill(49.9999996, 50)).toBe(feeForFill(50, 50));
    expect(feeForFill(100.0000004, 50)).toBe(feeForFill(100, 50));
  });

  it("is nothing for a size or a rate that is not a positive number", () => {
    for (const size of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) expect(feeForFill(size, 50)).toBe(0);
    for (const bps of [0, -50, Number.NaN]) expect(feeForFill(100, bps)).toBe(0);
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
  it("is the notional plus its own fee, so the last dollar is never overspent", () => {
    expect(buyCostUsd(50, 50)).toBe(50.25);
    expect(buyCostUsd(2, 50)).toBe(2.01);
    expect(buyCostUsd(1, 50)).toBe(1.005);
    expect(buyCostUsd(100, 25)).toBe(100.25);
    // The case the guard exists for: $10.00 of cash cannot buy $10.00 of token.
    expect(buyCostUsd(10, 50)).toBeGreaterThan(10);
  });

  it("grows with the size: a bigger buy never costs less", () => {
    let last = 0;
    for (let size = 1; size <= 3_000; size += 1) {
      const cost = micros(buyCostUsd(size / 1e6, 50));
      expect(cost).toBeGreaterThan(last);
      last = cost;
    }
  });

  it("ignores nonsense on either side", () => {
    expect(buyCostUsd(Number.NaN, 50)).toBe(0);
    expect(buyCostUsd(-5, 50)).toBe(0);
    expect(buyCostUsd(50, Number.NaN)).toBe(50);
    expect(buyCostUsd(50, 0)).toBe(50);
  });
});

describe("the most a cash balance can buy", () => {
  it("is the largest amount whose cost, fee included, the cash covers", () => {
    // $5.00 at 0.5%: a $4.975125 buy pays $0.024875 and costs exactly $5.000000.
    const most = maxBuyUsd(5, 50);
    expect(micros(most)).toBe(4_975_125);
    expect(micros(feeForFill(most, 50))).toBe(24_875);
    expect(micros(buyCostUsd(most, 50))).toBe(5_000_000);
    // One millionth of a dollar more does not fit.
    expect(micros(buyCostUsd(most + 0.000001, 50))).toBe(5_000_001);
  });

  it("leaves exactly its fee behind: once that is charged, the wallet is empty and owes nothing more", () => {
    for (const [cash, bps] of [[5, 50], [10, 50], [2.01, 50], [100.5, 50], [101, 100], [12_345.67, 25]] as const) {
      const most = maxBuyUsd(cash, bps);
      const left = cash - most;
      const fee = feeForFill(most, bps);
      // What stays in the wallet after the buy covers the fee, to within the one
      // micro-dollar a fee is rounded down by.
      expect(micros(left) - micros(fee), `$${cash} at ${bps} bps`).toBeGreaterThanOrEqual(0);
      expect(micros(left) - micros(fee), `$${cash} at ${bps} bps`).toBeLessThanOrEqual(1);
      expect(netLiveCashUsd(left, fee)).toBeLessThanOrEqual(0.000001);
    }
    // The round cases, to the micro-dollar: a $2.00 buy from $2.01, a $100 buy from $100.50.
    expect(maxBuyUsd(2.01, 50)).toBe(2);
    expect(netLiveCashUsd(2.01 - 2, feeForFill(2, 50))).toBe(0);
    expect(maxBuyUsd(100.5, 50)).toBe(100);
    expect(netLiveCashUsd(100.5 - 100, feeForFill(100, 50))).toBe(0);
  });

  it("is not the cash less the rate, which would under-size every buy", () => {
    // 100 / 1.1, not 100 × 0.9.
    expect(micros(maxBuyUsd(100, 1000))).toBe(90_909_091);
    expect(micros(maxBuyUsd(10, 50))).toBe(9_950_249);
    expect(micros(maxBuyUsd(1, 50))).toBe(995_025);
    expect(micros(maxBuyUsd(4.15, 50))).toBe(4_129_354);
    expect(micros(maxBuyUsd(10_000, 25))).toBe(9_975_062_345);
  });

  it("fits, and a micro-dollar more does not, for every cash balance and rate tried", () => {
    const next = sequence(50);
    for (const bps of [1, 12.5, 25, 50, 100, 1000]) {
      for (let i = 0; i < 5_000; i += 1) {
        // From a fraction of a cent to a few million dollars, to the micro-dollar.
        const cash = (Math.floor(next() * (i % 2 === 0 ? 20_000_000 : 4_000_000_000_000)) + 1) / 1e6;
        const most = maxBuyUsd(cash, bps);
        expect(buyCostUsd(most, bps), `$${cash} at ${bps} bps`).toBeLessThanOrEqual(cash + 1e-9);
        expect(buyCostUsd(most + 0.000001, bps), `$${cash} at ${bps} bps`).toBeGreaterThan(cash + 1e-9);
      }
    }
  });

  it("reads cash that a subtraction left a hair short as the cash it is", () => {
    // 15.75 − 14.07 is 1.6799999999999997 in floating point. It is $1.68.
    expect(15.75 - 14.07).not.toBe(1.68);
    expect(maxBuyUsd(15.75 - 14.07, 50)).toBe(maxBuyUsd(1.68, 50));
    expect(maxBuyUsd(20 - 18.09, 50)).toBe(maxBuyUsd(1.91, 50));
  });

  it("is the cash itself when the fee is off", () => {
    expect(maxBuyUsd(5, 0)).toBe(5);
    expect(maxBuyUsd(4.996123, 0)).toBe(4.996123);
  });

  it("is nothing for no cash, and for a balance too small to cover a micro-dollar and its fee", () => {
    for (const cash of [0, -3, Number.NaN, Number.POSITIVE_INFINITY, 0.0000004]) expect(maxBuyUsd(cash, 50)).toBe(0);
    expect(maxBuyUsd(0.000001, 50)).toBe(0.000001);
  });
});

describe("a ceiling in whole cents", () => {
  it("rounds down, never up: the figure told has to be one that fits", () => {
    // $5.00 of cash covers $4.975125. Told as "$4.98" it is refused: that costs $5.0049.
    expect(floorToCents(maxBuyUsd(5, 50))).toBe(4.97);
    expect(buyCostUsd(4.97, 50)).toBeLessThanOrEqual(5);
    expect(buyCostUsd(4.98, 50)).toBeGreaterThan(5);
    expect(floorToCents(maxBuyUsd(4.15, 50))).toBe(4.12);
    expect(floorToCents(maxBuyUsd(10, 50))).toBe(9.95);
    expect(floorToCents(0.999999)).toBe(0.99);
  });

  it("keeps a figure that is whole cents already", () => {
    // 9.45 × 100 is 944.99… in floating point; a plain floor would answer $9.44.
    expect(floorToCents(9.45)).toBe(9.45);
    expect(floorToCents(1.1)).toBe(1.1);
    expect(floorToCents(2)).toBe(2);
    expect(floorToCents(0.07)).toBe(0.07);
  });

  it("is nothing under a cent, and for nonsense", () => {
    for (const usd of [0.009999, 0, -1, Number.NaN, Number.POSITIVE_INFINITY]) expect(floorToCents(usd)).toBe(0);
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
