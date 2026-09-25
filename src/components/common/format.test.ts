import { describe, expect, it } from "vitest";
import { formatExact, formatPreviewFees, formatPriceUsd, formatSignedPct, formatTokenAmount, formatUsd } from "./format";

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

  it("keeps three significant digits between a cent and a dollar", () => {
    // A $300 buy of 25,381.94 DEGEN filled at $0.01182; "$0.01" was 15% off.
    expect(formatPriceUsd(0.01182)).toBe("$0.0118");
    expect(formatPriceUsd(0.1412)).toBe("$0.141");
    expect(formatPriceUsd(0.0999)).toBe("$0.0999");
    expect(formatPriceUsd(0.5)).toBe("$0.50");
    expect(formatPriceUsd(0.14)).toBe("$0.14");
    expect(formatPriceUsd(0.01)).toBe("$0.01");
  });

  it("is ordinary currency from a dollar up", () => {
    expect(formatPriceUsd(1)).toBe("$1.00");
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

describe("formatSignedPct", () => {
  it("signs the number as printed, so a rounding-to-zero move is not a red minus", () => {
    expect(formatSignedPct(-0.004, 1)).toBe("0.0%");
    expect(formatSignedPct(0.004, 2)).toBe("0.00%");
    expect(formatSignedPct(0, 1)).toBe("0.0%");
  });

  it("keeps the typographic minus and the plus once the move shows", () => {
    expect(formatSignedPct(-0.06, 1)).toBe("−0.1%");
    expect(formatSignedPct(7.591, 2)).toBe("+7.59%");
    expect(formatSignedPct(null)).toBe("—");
  });
});

describe("formatExact", () => {
  it("says the second and the zone, in the zone it is given", () => {
    const iso = new Date().getFullYear() + "-09-25T01:58:59Z";
    expect(formatExact(iso, "America/Los_Angeles")).toBe("Sep 24, 6:58:59 PM PDT");
    expect(formatExact(iso, "UTC")).toBe("Sep 25, 1:58:59 AM UTC");
  });

  it("names the year only when it is not this one", () => {
    expect(formatExact("2020-01-02T03:04:05Z", "UTC")).toBe("Jan 2, 2020, 3:04:05 AM UTC");
    expect(formatExact("not a date")).toBe("—");
  });
});

describe("formatTokenAmount", () => {
  it("prints the same fill the same way everywhere", () => {
    expect(formatTokenAmount(314_465.408805)).toBe("314,465.41");
    expect(formatTokenAmount(786_163.522)).toBe("786,163.52");
    expect(formatTokenAmount(1.23456)).toBe("1.2346");
    expect(formatTokenAmount(0.000123456)).toBe("0.0001235");
    expect(formatTokenAmount(2_500_000)).toBe("2.5M");
  });
});

describe("formatPreviewFees", () => {
  it("totals both fees and names each", () => {
    expect(formatPreviewFees({ tockerUsd: 0.1, venueUsd: 0.03 })).toBe("≈ $0.13 (Tocker $0.10 · venue $0.03)");
  });

  it("does not invent a venue fee nobody quoted", () => {
    expect(formatPreviewFees({ tockerUsd: 0.1, venueUsd: null })).toBe("$0.10 Tocker · venue fee not quoted");
    expect(formatPreviewFees({ tockerUsd: 0, venueUsd: null })).toBeNull();
  });
});
