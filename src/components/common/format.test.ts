import { describe, expect, it } from "vitest";
import {
  formatCostUsd,
  formatExact,
  formatPreviewFees,
  formatPriceUsd,
  formatRelative,
  formatSignedPct,
  formatTokenAmount,
  formatUsd,
} from "./format";

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

  it("keeps trailing zeros in a fixed column so the decimals line up", () => {
    expect(formatTokenAmount(1_600_000, { fixed: true })).toBe("1.60M");
    expect(formatTokenAmount(25_000_000, { fixed: true })).toBe("25.00M");
    expect(formatTokenAmount(1_893.9, { fixed: true })).toBe("1,893.90");
    expect(formatTokenAmount(36.65, { fixed: true })).toBe("36.6500");
    expect(formatTokenAmount(0.00012, { fixed: true })).toBe("0.0001200");
  });
});

describe("formatRelative", () => {
  const now = Date.parse("2026-09-25T12:00:00Z");
  const ago = (ms: number) => new Date(now - ms).toISOString();
  const DAY = 24 * 3_600_000;

  it("counts back under a week", () => {
    expect(formatRelative(ago(10_000), now)).toBe("just now");
    expect(formatRelative(ago(12 * 60_000), now)).toBe("12m ago");
    expect(formatRelative(ago(3 * 3_600_000), now)).toBe("3h ago");
    expect(formatRelative(ago(DAY), now)).toBe("yesterday");
    expect(formatRelative(ago(2 * DAY), now)).toBe("2d ago");
    expect(formatRelative(ago(6 * DAY), now)).toBe("6d ago");
  });

  it("names the date from a week out, and the year only when it differs", () => {
    expect(formatRelative("2026-08-26T12:00:00Z", now)).toBe("Aug 26");
    expect(formatRelative("2025-12-30T12:00:00Z", now)).toBe("Dec 30, 2025");
  });
});

/**
 * A fee is a share of a fill, so it is seldom whole cents. Printed to the cent, half a
 * cent rounds up: a $0.125 fee read "$0.13", and the parts of a total came to a cent
 * more than the total printed beside them.
 */
describe("formatCostUsd", () => {
  it("prints whole cents as dollars and cents", () => {
    expect(formatCostUsd(0.1)).toBe("$0.10");
    expect(formatCostUsd(0.2)).toBe("$0.20");
    expect(formatCostUsd(1234.5)).toBe("$1,234.50");
    expect(formatCostUsd(0)).toBe("$0.00");
  });

  it("keeps the decimals of a cost that is not whole cents, and never rounds it up", () => {
    expect(formatCostUsd(0.125)).toBe("$0.125");
    expect(formatCostUsd(0.075)).toBe("$0.075");
    expect(formatCostUsd(0.015)).toBe("$0.015");
    expect(formatCostUsd(0.243659)).toBe("$0.243659");
    // A sum that floating point leaves a hair off whole cents is still whole cents.
    expect(formatCostUsd(0.125 + 0.075)).toBe("$0.20");
    expect(formatCostUsd(0.1 + 0.2)).toBe("$0.30");
  });

  it("leaves a cost under a cent as `formatUsd` prints it", () => {
    for (const usd of [0.009, 0.005, 0.00301, 0.000742]) expect(formatCostUsd(usd)).toBe(formatUsd(usd));
    expect(formatCostUsd(0.005)).toBe("$0.005");
  });
});

describe("formatPreviewFees", () => {
  it("totals both fees and names each", () => {
    expect(formatPreviewFees({ tockerUsd: 0.1, venueUsd: 0.03 })).toBe("≈ $0.13 (Tocker $0.10 · venue $0.03)");
  });

  it("prints each part as it stands, so the two add up to the total in front of them", () => {
    // 0.5% and the simulator's 0.30% on $25, $5 and $3. To the cent these read
    // "≈ $0.20 (Tocker $0.13 · venue $0.08)": a cent more in the brackets than outside.
    expect(formatPreviewFees({ tockerUsd: 0.125, venueUsd: 0.075 })).toBe("≈ $0.20 (Tocker $0.125 · venue $0.075)");
    expect(formatPreviewFees({ tockerUsd: 0.025, venueUsd: 0.015 })).toBe("≈ $0.04 (Tocker $0.025 · venue $0.015)");
    expect(formatPreviewFees({ tockerUsd: 0.015, venueUsd: 0.009 })).toBe("≈ $0.024 (Tocker $0.015 · venue $0.009)");
  });

  it("does not invent a venue fee nobody quoted", () => {
    expect(formatPreviewFees({ tockerUsd: 0.1, venueUsd: null })).toBe("$0.10 Tocker · venue fee not quoted");
    expect(formatPreviewFees({ tockerUsd: 0.125, venueUsd: null })).toBe("$0.125 Tocker · venue fee not quoted");
    expect(formatPreviewFees({ tockerUsd: 0, venueUsd: null })).toBeNull();
  });
});
