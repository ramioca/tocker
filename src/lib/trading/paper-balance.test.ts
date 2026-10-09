import { describe, expect, it } from "vitest";
import {
  PAPER_BALANCE_MAX_USD,
  PAPER_BALANCE_MIN_USD,
  PAPER_BALANCE_REFUSED,
  PAPER_BALANCE_TOO_HIGH,
  PAPER_BALANCE_TOO_LOW,
  PAPER_BALANCE_TRADED,
  PAPER_BALANCE_TRADED_LIVE,
  checkPaperStartingUsd,
  sameBalance,
} from "./paper-balance";

describe("checkPaperStartingUsd", () => {
  it("takes $10 to $10,000,000, both ends included", () => {
    expect(PAPER_BALANCE_MIN_USD).toBe(10);
    expect(PAPER_BALANCE_MAX_USD).toBe(10_000_000);
    for (const usd of [10, 10.01, 20, 250, 1_500, 12_345.67, 2_500_000, 9_999_999.99, 10_000_000]) {
      expect(checkPaperStartingUsd(usd), String(usd)).toBeNull();
    }
  });

  it("refuses a cent under and a cent over, each in a sentence that names the limit", () => {
    expect(checkPaperStartingUsd(9.99)).toBe("Paper starting balance must be $10 or more");
    expect(checkPaperStartingUsd(10_000_000.01)).toBe("Paper starting balance must be $10,000,000 or less");
    expect(PAPER_BALANCE_TOO_LOW).toBe("Paper starting balance must be $10 or more");
    expect(PAPER_BALANCE_TOO_HIGH).toBe("Paper starting balance must be $10,000,000 or less");
  });

  it("refuses anything that is not an amount", () => {
    for (const value of [0, -1, Number.NaN, Number.NEGATIVE_INFINITY, "10000", "", null, undefined, {}, [], true]) {
      expect(checkPaperStartingUsd(value), String(value)).toBe(PAPER_BALANCE_TOO_LOW);
    }
    expect(checkPaperStartingUsd(Number.POSITIVE_INFINITY)).toBe(PAPER_BALANCE_TOO_HIGH);
  });
});

describe("sameBalance", () => {
  it("compares to the cent, as the column keeps a balance", () => {
    expect(sameBalance(10_000, 10_000)).toBe(true);
    expect(sameBalance(10_000, 10_000.004)).toBe(true);
    expect(sameBalance(12_345.67, 12_345.67)).toBe(true);
    expect(sameBalance(10_000, 10_000.01)).toBe(false);
    expect(sameBalance(10_000, 9_999.99)).toBe(false);
    expect(sameBalance(Number.NaN, Number.NaN)).toBe(false);
  });
});

describe("the sentences for a balance that can no longer change", () => {
  it("say why and that nothing was saved, and never say reset", () => {
    expect(PAPER_BALANCE_TRADED).toBe(
      "This agent has traded on paper, so its paper balance can no longer be changed. Nothing was saved.",
    );
    // An agent with real-money trades and no paper ones has not "traded on paper", and
    // is not told it has.
    expect(PAPER_BALANCE_TRADED_LIVE).toBe(
      "This agent has traded with real money, and its paper book counts those trades, so its paper balance can no longer be changed. Nothing was saved.",
    );
    expect(PAPER_BALANCE_TRADED_LIVE).not.toContain("on paper");
    expect(PAPER_BALANCE_REFUSED).toEqual({ paper: PAPER_BALANCE_TRADED, live: PAPER_BALANCE_TRADED_LIVE });
    for (const words of [PAPER_BALANCE_TRADED, PAPER_BALANCE_TRADED_LIVE, PAPER_BALANCE_TOO_LOW, PAPER_BALANCE_TOO_HIGH]) {
      expect(words.toLowerCase()).not.toContain("reset");
    }
  });
});
