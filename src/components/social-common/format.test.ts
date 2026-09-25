import { describe, expect, it } from "vitest";
import { formatPct, formatUsd } from "./format";

describe("formatUsd (social)", () => {
  it("compacts from five figures, as common/format does, and keeps cents below", () => {
    // A leaderboard column reads "+$1,318.20" beside "+$930.75", not "+$1.3K".
    expect(formatUsd(1_318.2, { signed: true, compact: true })).toBe("+$1,318.20");
    expect(formatUsd(5_218.4, { compact: true })).toBe("$5,218.40");
    expect(formatUsd(10_756.58, { compact: true })).toBe("$10.8K");
    expect(formatUsd(873.88, { compact: true })).toBe("$873.88");
    expect(formatUsd(-12_680, { signed: true, compact: true })).toBe("−$12.7K");
  });

  it("keeps cents without `compact`", () => {
    expect(formatUsd(1_577.2)).toBe("$1,577.20");
    expect(formatUsd(12.5, { signed: true })).toBe("+$12.50");
  });
});

describe("formatPct (social)", () => {
  it("signs the number as printed, so a rounding-to-zero move is not a minus", () => {
    expect(formatPct(-0.004)).toBe("0.0%");
    expect(formatPct(0.04)).toBe("0.0%");
    expect(formatPct(-0.06)).toBe("−0.1%");
    expect(formatPct(91.554, { dp: 2 })).toBe("+91.55%");
    expect(formatPct(-3.2, { signed: false })).toBe("3.2%");
  });
});
