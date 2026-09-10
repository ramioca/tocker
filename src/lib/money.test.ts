import { describe, expect, it } from "vitest";
import {
  clamp,
  compactNumber,
  direction,
  fmtPct,
  fmtToken,
  fmtUsd,
  pctChange,
  signed,
  toNum,
  toNumOrNull,
  toNumeric,
} from "./money";

describe("toNum", () => {
  it("parses numeric strings", () => {
    expect(toNum("10000.00")).toBe(10000);
    expect(toNum("-3.5")).toBe(-3.5);
    expect(toNum("0.000000000001")).toBeCloseTo(1e-12);
  });
  it("falls back for null/blank/garbage", () => {
    expect(toNum(null)).toBe(0);
    expect(toNum(undefined)).toBe(0);
    expect(toNum("")).toBe(0);
    expect(toNum("abc")).toBe(0);
    expect(toNum(null, 42)).toBe(42);
  });
  it("passes numbers through", () => {
    expect(toNum(7)).toBe(7);
    expect(toNum(Number.NaN)).toBe(0);
  });
});

describe("toNumOrNull", () => {
  it("preserves null", () => {
    expect(toNumOrNull(null)).toBeNull();
    expect(toNumOrNull("")).toBeNull();
    expect(toNumOrNull("1.5")).toBe(1.5);
  });
});

describe("toNumeric", () => {
  it("formats with the requested scale", () => {
    expect(toNumeric(1.23456789, 6)).toBe("1.234568");
    expect(toNumeric(10, 2)).toBe("10.00");
  });
  it("never uses exponential notation", () => {
    expect(toNumeric(1e-11, 12)).toBe("0.000000000010");
    expect(toNumeric(1e21, 2)).not.toContain("e");
  });
  it("normalises -0", () => {
    expect(toNumeric(-0, 2)).toBe("0.00");
    expect(toNumeric(-0.0001, 2)).toBe("0.00");
  });
  it("handles non-finite input", () => {
    expect(toNumeric(Number.NaN, 2)).toBe("0.00");
    expect(toNumeric(Number.POSITIVE_INFINITY, 2)).toBe("0.00");
  });
  it("round-trips through toNum", () => {
    expect(toNum(toNumeric(1234.5, 6))).toBe(1234.5);
  });
});

describe("fmtUsd", () => {
  it("formats plain dollars", () => {
    expect(fmtUsd(1234.5)).toBe("$1,234.50");
    expect(fmtUsd("0")).toBe("$0.00");
  });
  it("renders em dash for null", () => {
    expect(fmtUsd(null)).toBe("—");
  });
  it("adds precision for sub-cent prices", () => {
    expect(fmtUsd(0.000012)).toMatch(/^\$0\.0000/);
  });
  it("compacts big numbers on request", () => {
    expect(fmtUsd(2_400_000, { compact: true })).toBe("$2.4M");
  });
  it("drops cents above 100k", () => {
    expect(fmtUsd(150_000)).toBe("$150,000");
  });
});

describe("fmtPct", () => {
  it("signs by default", () => {
    expect(fmtPct(12.44)).toBe("+12.4%");
    expect(fmtPct(-3)).toBe("-3.0%");
    expect(fmtPct(0)).toBe("0.0%");
  });
  it("honours digits and sign options", () => {
    expect(fmtPct(12.44, { digits: 2 })).toBe("+12.44%");
    expect(fmtPct(12.44, { sign: false })).toBe("12.4%");
  });
  it("returns em dash for null", () => {
    expect(fmtPct(null)).toBe("—");
  });
});

describe("fmtToken", () => {
  it("formats with a symbol", () => {
    expect(fmtToken(1234.5678, "SOL")).toBe("1,234.57 SOL");
    expect(fmtToken(0.5, "SOL")).toBe("0.5 SOL");
  });
  it("compacts millions", () => {
    expect(fmtToken(12_000_000, "BONK")).toBe("12M BONK");
  });
  it("returns em dash for null", () => {
    expect(fmtToken(null, "SOL")).toBe("—");
  });
});

describe("signed", () => {
  it("prefixes the sign outside the currency symbol", () => {
    expect(signed(12)).toBe("+$12.00");
    expect(signed(-12)).toBe("-$12.00");
    expect(signed(0)).toBe("$0.00");
  });
  it("accepts a custom formatter", () => {
    expect(signed(-2.5, (n) => `${n}%`)).toBe("-2.5%");
  });
});

describe("direction / pctChange / clamp / compactNumber", () => {
  it("classifies direction", () => {
    expect(direction(1)).toBe("up");
    expect(direction(-1)).toBe("down");
    expect(direction(0)).toBe("flat");
    expect(direction(null)).toBe("flat");
  });
  it("computes percent change", () => {
    expect(pctChange(100, 110)).toBeCloseTo(10);
    expect(pctChange(100, 90)).toBeCloseTo(-10);
    expect(pctChange(0, 10)).toBeNull();
    expect(pctChange(null, 10)).toBeNull();
  });
  it("clamps", () => {
    expect(clamp(5, 0, 3)).toBe(3);
    expect(clamp(-5, 0, 3)).toBe(0);
  });
  it("compacts numbers", () => {
    expect(compactNumber(1500)).toBe("1.5K");
    expect(compactNumber(-2_500_000)).toBe("-2.5M");
    expect(compactNumber(999)).toBe("999");
  });
});
