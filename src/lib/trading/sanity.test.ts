import { describe, expect, it } from "vitest";
import { DEFAULT_MAX_DEVIATION_BPS, checkQuoteSanity, quoteDeviationBps } from "./sanity";

const base = { side: "buy" as const, symbol: "BONK" };

describe("quoteDeviationBps", () => {
  it("is symmetric and always positive", () => {
    expect(quoteDeviationBps(110, 100)).toBeCloseTo(1_000, 6);
    expect(quoteDeviationBps(90, 100)).toBeCloseTo(1_000, 6);
  });

  it("has no opinion without a usable reference", () => {
    expect(quoteDeviationBps(100, null)).toBeNull();
    expect(quoteDeviationBps(100, 0)).toBeNull();
    expect(quoteDeviationBps(100, Number.NaN)).toBeNull();
    expect(quoteDeviationBps(0, 100)).toBeNull();
  });
});

describe("checkQuoteSanity", () => {
  it("lets a violently moving but plausible token through", () => {
    // 30% apart between two feeds mid-launch is normal and must not block a trade.
    const result = checkQuoteSanity({ ...base, quotePriceUsd: 1.3, referencePriceUsd: 1 });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.checked).toBe(true);
  });

  it("stops an order-of-magnitude error — the decimals bug this exists for", () => {
    const result = checkQuoteSanity({ ...base, quotePriceUsd: 1_000, referencePriceUsd: 1 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("1000.00× higher");
      expect(result.reason).toContain("No order was sent");
      expect(result.deviationBps).toBeGreaterThan(DEFAULT_MAX_DEVIATION_BPS);
    }
  });

  it("catches the error in the other direction too", () => {
    const result = checkQuoteSanity({ ...base, quotePriceUsd: 0.001, referencePriceUsd: 1 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("lower");
  });

  it("never blocks a sell — an exit is not blocked by anything", () => {
    const result = checkQuoteSanity({ ...base, side: "sell", quotePriceUsd: 1_000_000, referencePriceUsd: 1 });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.checked).toBe(false);
  });

  it("does not block when there was nothing to compare against, and says so", () => {
    const result = checkQuoteSanity({ ...base, quotePriceUsd: 1, referencePriceUsd: null });
    expect(result.ok).toBe(true);
    // `checked: false` is the point: "we agreed" and "we could not ask" are different
    // facts, and only one of them should reassure anybody.
    if (result.ok) expect(result.checked).toBe(false);
  });

  it("sits exactly on the boundary without tripping", () => {
    const atLimit = checkQuoteSanity({ ...base, quotePriceUsd: 1.5, referencePriceUsd: 1 });
    expect(atLimit.ok).toBe(true);
    const past = checkQuoteSanity({ ...base, quotePriceUsd: 1.51, referencePriceUsd: 1 });
    expect(past.ok).toBe(false);
  });

  it("honours a tighter tolerance when a caller wants one", () => {
    const result = checkQuoteSanity({ ...base, quotePriceUsd: 1.2, referencePriceUsd: 1, maxDeviationBps: 1_000 });
    expect(result.ok).toBe(false);
  });
});
