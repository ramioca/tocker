import { describe, expect, it } from "vitest";
import { bookBasisUsd } from "./book-basis";

describe("bookBasisUsd", () => {
  it("measures a paper book against its notional", () => {
    expect(
      bookBasisUsd({ mode: "paper", paperStartingUsd: 10_000, equityUsd: 10_420, pnlUsd: 420 }, 9_990),
    ).toBe(10_000);
  });

  it("never measures a live book against the paper notional", () => {
    // $50 in, $48 now: the basis is the $50, not the $10,000 the flip left behind.
    expect(bookBasisUsd({ mode: "live", paperStartingUsd: 10_000, equityUsd: 48, pnlUsd: -2 }, 49)).toBe(50);
  });

  it("falls back to the first live point, then to equity, before any PnL", () => {
    expect(bookBasisUsd({ mode: "live", paperStartingUsd: 10_000, equityUsd: 48, pnlUsd: null }, 50)).toBe(50);
    expect(bookBasisUsd({ mode: "live", paperStartingUsd: 10_000, equityUsd: 48, pnlUsd: null }, undefined)).toBe(48);
    expect(bookBasisUsd({ mode: "live", paperStartingUsd: 10_000, equityUsd: null, pnlUsd: null }, undefined)).toBe(0);
  });
});
