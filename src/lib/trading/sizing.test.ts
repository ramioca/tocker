import { describe, expect, it } from "vitest";
import {
  DEFAULT_SIZING,
  rangePctFrom,
  readSizing,
  sizeOrder,
  volatilityScale,
  type PositionSizingConfig,
} from "./sizing";

function sizing(overrides: Partial<PositionSizingConfig> = {}): PositionSizingConfig {
  return { ...DEFAULT_SIZING, ...overrides };
}

describe("readSizing", () => {
  it("gives a config with no sizing block the old fixed-USD behaviour", () => {
    expect(readSizing(undefined)).toEqual(DEFAULT_SIZING);
    expect(readSizing(null)).toEqual(DEFAULT_SIZING);
    // @ts-expect-error — a legacy risk object, exactly as it comes out of jsonb
    expect(readSizing({ maxTradeUsd: 100 })).toEqual(DEFAULT_SIZING);
  });

  it("clamps nonsense rather than throwing — a bad block must not stop trading", () => {
    const read = readSizing({
      // @ts-expect-error — deliberately malformed, as a half-written form would be
      sizing: { mode: "moon", percentOfEquity: -5, referenceRangePct: 0, minTradeUsd: "x" },
    });
    expect(read.mode).toBe("fixed_usd");
    expect(read.percentOfEquity).toBe(0.1);
    expect(read.referenceRangePct).toBe(1);
    expect(read.minTradeUsd).toBe(DEFAULT_SIZING.minTradeUsd);
  });
});

describe("volatilityScale", () => {
  it("never scales a ticket up — a calm token gets full size, not more", () => {
    expect(volatilityScale(5, 25)).toBe(1);
    expect(volatilityScale(25, 25)).toBe(1);
    expect(volatilityScale(0, 25)).toBe(1);
    expect(volatilityScale(null, 25)).toBe(1);
  });

  it("shrinks in proportion to how far past the reference the range is", () => {
    expect(volatilityScale(50, 25)).toBeCloseTo(0.5, 10);
    expect(volatilityScale(100, 25)).toBeCloseTo(0.25, 10);
  });

  it("floors the scale so an absurd range gives a tiny ticket, not a zero one", () => {
    expect(volatilityScale(100_000, 25)).toBe(0.01);
  });
});

describe("sizeOrder", () => {
  it("fixed_usd is exactly maxTradeUsd", () => {
    const out = sizeOrder({ sizing: sizing(), maxTradeUsd: 100, equityUsd: 50_000 });
    expect(out.amountUsd).toBe(100);
    expect(out.effectiveMode).toBe("fixed_usd");
    expect(out.cappedByMaxTrade).toBe(false);
  });

  it("percent_equity scales with the book", () => {
    const config = sizing({ mode: "percent_equity", percentOfEquity: 10 });
    expect(sizeOrder({ sizing: config, maxTradeUsd: 10_000, equityUsd: 5_000 }).amountUsd).toBe(500);
    // Same agent after a 50% drawdown writes half the ticket, without anyone editing config.
    expect(sizeOrder({ sizing: config, maxTradeUsd: 10_000, equityUsd: 2_500 }).amountUsd).toBe(250);
  });

  it("keeps maxTradeUsd as the hard ceiling over every mode", () => {
    const config = sizing({ mode: "percent_equity", percentOfEquity: 25 });
    const out = sizeOrder({ sizing: config, maxTradeUsd: 100, equityUsd: 1_000_000 });
    expect(out.amountUsd).toBe(100);
    expect(out.cappedByMaxTrade).toBe(true);
    expect(out.explanation).toContain("capped at your max trade size");

    const vol = sizeOrder({
      sizing: sizing({ mode: "volatility_scaled", percentOfEquity: 25, referenceRangePct: 25 }),
      maxTradeUsd: 100,
      equityUsd: 1_000_000,
      rangePct: 10,
    });
    expect(vol.amountUsd).toBe(100);
    expect(vol.cappedByMaxTrade).toBe(true);
  });

  it("volatility_scaled shrinks a wide-ranging token and leaves a calm one alone", () => {
    const config = sizing({ mode: "volatility_scaled", percentOfEquity: 10, referenceRangePct: 25 });
    const calm = sizeOrder({ sizing: config, maxTradeUsd: 10_000, equityUsd: 10_000, rangePct: 12 });
    const wild = sizeOrder({ sizing: config, maxTradeUsd: 10_000, equityUsd: 10_000, rangePct: 100 });
    expect(calm.amountUsd).toBe(1_000);
    expect(calm.scale).toBe(1);
    expect(wild.amountUsd).toBe(250);
    expect(wild.scale).toBeCloseTo(0.25, 10);
    expect(wild.effectiveMode).toBe("volatility_scaled");
  });

  it("degrades downward when inputs are missing, and says why", () => {
    const noEquity = sizeOrder({
      sizing: sizing({ mode: "percent_equity", percentOfEquity: 50 }),
      maxTradeUsd: 100,
      equityUsd: null,
    });
    expect(noEquity.amountUsd).toBe(100);
    expect(noEquity.effectiveMode).toBe("fixed_usd");
    expect(noEquity.explanation).toContain("No equity figure");

    const noRange = sizeOrder({
      sizing: sizing({ mode: "volatility_scaled", percentOfEquity: 10 }),
      maxTradeUsd: 10_000,
      equityUsd: 10_000,
      rangePct: null,
    });
    expect(noRange.amountUsd).toBe(1_000);
    expect(noRange.effectiveMode).toBe("percent_equity");
    expect(noRange.explanation).toContain("nothing to shrink");
  });

  it("flags a size that fell under the floor instead of writing a dust ticket", () => {
    const out = sizeOrder({
      sizing: sizing({ mode: "percent_equity", percentOfEquity: 1, minTradeUsd: 5 }),
      maxTradeUsd: 100,
      equityUsd: 100,
    });
    expect(out.amountUsd).toBe(1);
    expect(out.belowMinimum).toBe(true);
  });

  it("never returns a negative or non-finite size", () => {
    const out = sizeOrder({ sizing: sizing(), maxTradeUsd: Number.NaN, equityUsd: 1_000 });
    expect(out.amountUsd).toBe(0);
    expect(Number.isFinite(out.amountUsd)).toBe(true);
  });
});

describe("rangePctFrom", () => {
  it("needs at least three usable points", () => {
    expect(rangePctFrom([])).toBeNull();
    expect(rangePctFrom([1, 2])).toBeNull();
    expect(rangePctFrom([1, null, undefined, 0, -3])).toBeNull();
  });

  it("measures high-to-low against the latest price", () => {
    expect(rangePctFrom([0.9, 1.1, 1.0])).toBeCloseTo(20, 6);
    expect(rangePctFrom([1, 1, 1])).toBe(0);
  });
});
