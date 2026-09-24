import { describe, expect, it } from "vitest";
import { formatFeedTokenAmount } from "./trade-amount";

describe("formatFeedTokenAmount", () => {
  it("drops to two decimals from 100 up", () => {
    expect(formatFeedTokenAmount(241.9559)).toBe("241.96");
    expect(formatFeedTokenAmount(1018.4809)).toBe("1,018.48");
    expect(formatFeedTokenAmount(-350.123)).toBe("-350.12");
  });

  it("keeps the shared precision for small amounts", () => {
    expect(formatFeedTokenAmount(12.34567)).toBe("12.3457");
    expect(formatFeedTokenAmount(0.004213)).toBe("0.004213");
  });

  it("keeps compact millions and the empty dash", () => {
    expect(formatFeedTokenAmount(2_500_000)).toBe("2.5M");
    expect(formatFeedTokenAmount(null)).toBe("—");
    expect(formatFeedTokenAmount(Number.NaN)).toBe("—");
  });
});
