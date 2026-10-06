import { describe, expect, it } from "vitest";
import { applyFillToPosition } from "@/lib/trading/positions";
import {
  PREVIEW_FAILED,
  PREVIEW_SLOW,
  noQuoteLine,
  realisedOnSale,
  sellVenueLine,
  thinPoolLine,
  thinPoolPct,
  unpreviewedLine,
} from "./sell-preview";

describe("sellVenueLine", () => {
  it("names the venue the position actually sells on", () => {
    expect(sellVenueLine("solana", false)).toBe("Sells at Jupiter's price the moment you confirm.");
    expect(sellVenueLine("base", false)).toBe("Sells through a swap on Base the moment you confirm.");
  });

  it("never names Jupiter for a Base position or a paper agent", () => {
    expect(sellVenueLine("base", false)).not.toContain("Jupiter");
    expect(sellVenueLine("solana", true)).toBe("Simulated at the live price. No real tokens move.");
    expect(sellVenueLine("base", true)).toBe("Simulated at the live price. No real tokens move.");
  });
});

describe("unpreviewedLine", () => {
  it("says what the preview could not do and that Sell still works", () => {
    expect(unpreviewedLine(PREVIEW_SLOW)).toBe(
      "The preview is taking a while. You can still sell: the order is checked and priced again when you confirm.",
    );
    expect(unpreviewedLine(PREVIEW_FAILED)).toBe(
      "Couldn't load a preview. You can still sell: the order is checked and priced again when you confirm.",
    );
  });

  it("finishes a refusal that is not a full sentence", () => {
    expect(unpreviewedLine("Sign in first")).toBe(
      "Sign in first. You can still sell: the order is checked and priced again when you confirm.",
    );
    expect(unpreviewedLine("Slow down — try again in 3 seconds. ")).toBe(
      "Slow down — try again in 3 seconds. You can still sell: the order is checked and priced again when you confirm.",
    );
  });
});

describe("noQuoteLine", () => {
  it("says why, and that the exit is still open", () => {
    expect(noQuoteLine("Jupiter is busy. Nothing was sent. Try again in a few seconds.")).toBe(
      "No live quote right now. Jupiter is busy. Nothing was sent. Try again in a few seconds. You can still sell: the order is priced again when you confirm.",
    );
  });

  it("reads as a sentence without a reason", () => {
    const bare = "No live quote right now. You can still sell: the order is priced again when you confirm.";
    expect(noQuoteLine(null)).toBe(bare);
    expect(noQuoteLine(undefined)).toBe(bare);
    expect(noQuoteLine("  ")).toBe(bare);
  });
});

describe("thinPoolPct", () => {
  it("is the gap between the quote and the slice's value at the last price", () => {
    expect(thinPoolPct(90, 100)).toBeCloseTo(10, 9);
    expect(thinPoolPct(46.3, 50)).toBeCloseTo(7.4, 9);
  });

  it("stays quiet at 3% or less, and when the quote is at or above the mark", () => {
    expect(thinPoolPct(97, 100)).toBeNull();
    expect(thinPoolPct(99.5, 100)).toBeNull();
    expect(thinPoolPct(104, 100)).toBeNull();
  });

  it("stays quiet without both figures", () => {
    expect(thinPoolPct(null, 100)).toBeNull();
    expect(thinPoolPct(90, null)).toBeNull();
    expect(thinPoolPct(90, 0)).toBeNull();
    expect(thinPoolPct(Number.NaN, 100)).toBeNull();
    expect(thinPoolPct(undefined, undefined)).toBeNull();
  });
});

describe("thinPoolLine", () => {
  it("prints the gap without false precision", () => {
    expect(thinPoolLine(7.4)).toBe("That is 7.4% under the last price: this pool is thin. Smaller slices may sell better.");
    expect(thinPoolLine(5)).toBe("That is 5% under the last price: this pool is thin. Smaller slices may sell better.");
    expect(thinPoolLine(23.456)).toContain("That is 23% under");
  });
});

describe("realisedOnSale", () => {
  it("is proceeds less every fee, less the cost of what was sold", () => {
    // 1,000 tokens bought at $0.05, half sold for $30 with $0.19 of fees.
    const realised = realisedOnSale({ amountUsd: 30, amountToken: 500, totalFeeUsd: 0.19, heldToken: 1_000, avgCostUsd: 0.05 });
    expect(realised.usd).toBeCloseTo(30 - 0.19 - 25, 9);
    expect(realised.pct).toBeCloseTo(((30 - 0.19 - 25) / 25) * 100, 9);
  });

  it("is the same figure the position row books for the fill", () => {
    const cases = [
      { amountUsd: 48.11, amountToken: 1_234_567, totalFeeUsd: 0.2443, heldToken: 1_234_567, avgCostUsd: 0.0000412 },
      { amountUsd: 12, amountToken: 400, totalFeeUsd: 0.136, heldToken: 1_000, avgCostUsd: 0.04 },
      // The venue reports a hair more than the book holds: the book clamps, and so does this.
      { amountUsd: 20, amountToken: 1_000.0001, totalFeeUsd: 0.16, heldToken: 1_000, avgCostUsd: 0.03 },
    ];
    for (const sale of cases) {
      const before = { amountToken: sale.heldToken, avgCostUsd: sale.avgCostUsd, realizedPnlUsd: 3.5 };
      const after = applyFillToPosition(before, {
        side: "sell",
        amountToken: sale.amountToken,
        amountUsd: sale.amountUsd,
        feeUsd: sale.totalFeeUsd,
      });
      expect(realisedOnSale(sale).usd).toBeCloseTo(after.realizedPnlUsd - before.realizedPnlUsd, 9);
    }
  });

  it("shows a loss as a loss", () => {
    const realised = realisedOnSale({ amountUsd: 8, amountToken: 100, totalFeeUsd: 0.12, heldToken: 100, avgCostUsd: 0.1 });
    expect(realised.usd).toBeCloseTo(-2.12, 9);
    expect(realised.pct).toBeCloseTo(-21.2, 9);
  });

  it("has no percentage when there is no cost to measure against", () => {
    expect(realisedOnSale({ amountUsd: 5, amountToken: 10, totalFeeUsd: 0.1, heldToken: 10, avgCostUsd: 0 }).pct).toBeNull();
    expect(realisedOnSale({ amountUsd: 5, amountToken: 10, totalFeeUsd: 0.1, heldToken: 0, avgCostUsd: 0.2 }).pct).toBeNull();
  });
});
