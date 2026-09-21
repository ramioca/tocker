import { describe, expect, it } from "vitest";
import { formatPriceUsd, formatUsd } from "./format";

/**
 * The finding: `toPrecision(2)` returns exponential notation for anything below 1e-6, so
 * a memecoin at $0.00000045 rendered as `$4.5e-7` in the feed, the positions table and
 * on the receipt. Nobody reads that as a price, and it does not match the exit messages
 * the server writes with `priceText` (src/lib/trading/exits.ts), so the same fill was
 * described two different ways on two surfaces.
 */
describe("formatPriceUsd", () => {
  it("never renders exponential notation, however small the price", () => {
    for (const value of [4.5e-7, 1e-9, 9.87e-12, 1.2345e-15]) {
      const out = formatPriceUsd(value);
      expect(out).not.toMatch(/e[+-]/i);
      expect(out.startsWith("$0.")).toBe(true);
    }
  });

  it("keeps three significant digits below a cent, without trailing zeros", () => {
    expect(formatPriceUsd(0.00000045)).toBe("$0.00000045");
    expect(formatPriceUsd(0.000021)).toBe("$0.000021");
    expect(formatPriceUsd(0.0012345)).toBe("$0.00123");
    expect(formatPriceUsd(0.009)).toBe("$0.009");
  });

  it("is ordinary currency at a cent and above", () => {
    expect(formatPriceUsd(0.01)).toBe("$0.01");
    expect(formatPriceUsd(1.5)).toBe("$1.50");
    expect(formatPriceUsd(1234.5)).toBe("$1,234.50");
  });

  it("distinguishes a zero mark from a missing one", () => {
    expect(formatPriceUsd(0)).toBe("$0.00");
    expect(formatPriceUsd(null)).toBe("—");
    expect(formatPriceUsd(undefined)).toBe("—");
    expect(formatPriceUsd(Number.NaN)).toBe("—");
    expect(formatPriceUsd(Number.POSITIVE_INFINITY)).toBe("—");
  });

  it("keeps the sign on a negative", () => {
    expect(formatPriceUsd(-0.00000045)).toBe("$-0.00000045");
    expect(formatPriceUsd(-2)).toBe("-$2.00");
  });
});

describe("formatUsd sub-cent amounts", () => {
  it("stopped producing exponents too — the same bug reached fee and spend lines", () => {
    expect(formatUsd(4.5e-7)).toBe("$0.00000045");
    expect(formatUsd(0.006)).toBe("$0.006");
  });

  it("is unchanged everywhere else", () => {
    expect(formatUsd(0)).toBe("$0.00");
    expect(formatUsd(0.01)).toBe("$0.01");
    expect(formatUsd(10)).toBe("$10.00");
    expect(formatUsd(12_345, { compact: true })).toBe("$12.3K");
    expect(formatUsd(null)).toBe("—");
  });
});
