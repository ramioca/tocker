import { describe, expect, it } from "vitest";
import { applyFillToPosition, manualSellSizing, sellAmountToken, EMPTY_POSITION } from "./positions";

/**
 * W7 H1. Sells used to be sized as `amountUsd ÷ (a fresh buy-side quote)`. That is wrong
 * in both directions and both directions cost real money:
 *
 *  - mark above the route price → the order asks for more tokens than the wallet holds,
 *    Jupiter refuses with `errorCode 1`, and the stop loss simply never fires;
 *  - mark below it → a few base units are left behind, the position never closes, and
 *    the exit engine keeps firing on dust no venue will route.
 */
describe("sellAmountToken", () => {
  const position = { heldToken: 1_000_000, positionValueUsd: 100, decimals: 5 };

  it("sends the whole balance for a full exit, whatever the mark says", () => {
    expect(sellAmountToken({ ...position, requestedUsd: 100 })).toBe(1_000_000);
  });

  it("treats a request within a cent of the position as a full exit", () => {
    // The guardian clamps its notional to `held × mark`, and floating point means that
    // number is routinely a hair under the position value. Asking for 99.99% of a
    // balance is exactly how dust is made.
    expect(sellAmountToken({ ...position, requestedUsd: 99.995 })).toBe(1_000_000);
  });

  it("never asks for more than is held, even when the caller over-asks", () => {
    // The stop-loss case: the mark says the position is worth $105, the route says $100.
    expect(sellAmountToken({ ...position, requestedUsd: 105 })).toBe(1_000_000);
  });

  it("scales a partial sell by the position, not by a quote", () => {
    expect(sellAmountToken({ ...position, requestedUsd: 25 })).toBe(250_000);
  });

  it("floors a partial sell to an atomic unit rather than rounding up", () => {
    // 6 decimals, a third of the position: 333333.333… base units. Rounding up would be
    // an over-ask, and an over-ask is a refusal.
    const amount = sellAmountToken({ heldToken: 1, positionValueUsd: 3, requestedUsd: 1, decimals: 6 });
    expect(amount).toBeLessThan(1 / 3);
    expect(amount).toBeCloseTo(0.333333, 6);
  });

  it("declines to guess when the position cannot be priced", () => {
    expect(sellAmountToken({ ...position, positionValueUsd: null, requestedUsd: 25 })).toBeUndefined();
  });

  it("declines when nothing is held", () => {
    expect(sellAmountToken({ ...position, heldToken: 0, requestedUsd: 25 })).toBeUndefined();
  });

  it("declines when the share rounds away to nothing", () => {
    // $0.000001 of a $100 position in a 2-decimal token is less than one base unit.
    expect(sellAmountToken({ heldToken: 100, positionValueUsd: 100, requestedUsd: 1e-6, decimals: 2 })).toBeUndefined();
  });
});

/**
 * The owner's own sell. The preview and the order both size through this, so what the
 * dialog shows is the order that is sent.
 */
describe("manualSellSizing", () => {
  // 1,000,000 tokens on the row, worth $80 at the mark read now (it was $100 when the
  // page rendered, which is the figure a "sell everything" still carries).
  const position = { amountToken: 1_000_000, valueUsd: 80 };
  const held = { heldTokenRow: 1_000_000, position, decimals: 5 };

  it("sends the row balance for a sell-all and sizes it at the current mark, not the typed figure", () => {
    const sizing = manualSellSizing({ ...held, sellAll: true, requestedUsd: 100 });
    expect(sizing.amountToken).toBe(1_000_000);
    // Under the typed $100: the guard checks this against the $80 position and passes.
    expect(sizing.sizedUsd).toBe(80);
    expect(sizing.fullExit).toBe(true);
  });

  it("takes the balance from the row when the book hides the position as dust", () => {
    const sizing = manualSellSizing({ sellAll: true, requestedUsd: 0.2, heldTokenRow: 12.5, position: null, decimals: 5 });
    expect(sizing.amountToken).toBe(12.5);
    // No mark to size from, so the typed figure stands and the guard decides.
    expect(sizing.sizedUsd).toBe(0.2);
    expect(sizing.fullExit).toBe(true);
  });

  it("does not call an empty row a sell-all", () => {
    const sizing = manualSellSizing({ sellAll: true, requestedUsd: 40, heldTokenRow: 0, position: null, decimals: 5 });
    expect(sizing).toEqual({ sizedUsd: 40, amountToken: undefined, fullExit: false });
  });

  it("sizes a partial sell as its share of the position, floored to an atomic unit", () => {
    const quarter = manualSellSizing({ ...held, sellAll: false, requestedUsd: 20 });
    expect(quarter).toEqual({ sizedUsd: 20, amountToken: 250_000, fullExit: false });

    // A third of one 6-decimal token: 333333.33… base units, never rounded up.
    const third = manualSellSizing({
      sellAll: false,
      requestedUsd: 1,
      heldTokenRow: 1,
      position: { amountToken: 1, valueUsd: 3 },
      decimals: 6,
    });
    expect(third.amountToken).toBeLessThan(1 / 3);
    expect(third.amountToken).toBeCloseTo(0.333333, 6);
    expect(third.fullExit).toBe(false);
  });

  it("still refuses nothing itself: an over-ask keeps its typed dollars for the guard to refuse", () => {
    const sizing = manualSellSizing({ ...held, sellAll: false, requestedUsd: 100 });
    expect(sizing.sizedUsd).toBe(100);
  });

  it("calls a slice that would leave dust or under 5% behind a full exit", () => {
    // $77 of $80 leaves $3, under 5% of the position.
    expect(manualSellSizing({ ...held, sellAll: false, requestedUsd: 77 })).toEqual({
      sizedUsd: 77,
      amountToken: 1_000_000,
      fullExit: true,
    });
    // Within a cent of the whole position.
    expect(manualSellSizing({ ...held, sellAll: false, requestedUsd: 79.995 }).fullExit).toBe(true);
    // $0.80 of a $1 position leaves $0.20, under the dust line.
    const small = manualSellSizing({
      sellAll: false,
      requestedUsd: 0.8,
      heldTokenRow: 500,
      position: { amountToken: 500, valueUsd: 1 },
      decimals: 5,
    });
    expect(small.amountToken).toBe(500);
    expect(small.fullExit).toBe(true);
    // $70 of $80 leaves $10: a real remainder.
    expect(manualSellSizing({ ...held, sellAll: false, requestedUsd: 70 }).fullExit).toBe(false);
  });

  it("gives the venue no token amount when the position cannot be priced", () => {
    const sizing = manualSellSizing({
      sellAll: false,
      requestedUsd: 20,
      heldTokenRow: 1_000_000,
      position: { amountToken: 1_000_000, valueUsd: null },
      decimals: 5,
    });
    expect(sizing).toEqual({ sizedUsd: 20, amountToken: undefined, fullExit: false });
  });
});

describe("applyFillToPosition residuals", () => {
  const held = { amountToken: 1_000_000, avgCostUsd: 0.0001, realizedPnlUsd: 0 };

  it("closes the position when the residual is under one base unit", () => {
    // 5 decimals: anything left under 0.00001 tokens is not a position, it is rounding.
    const next = applyFillToPosition(held, {
      side: "sell",
      amountToken: 999_999.999999,
      amountUsd: 100,
      feeUsd: 0.1,
      decimals: 5,
    });
    expect(next.amountToken).toBe(0);
    expect(next.avgCostUsd).toBe(0);
  });

  it("keeps a residual that is a real, routable amount", () => {
    const next = applyFillToPosition(held, {
      side: "sell",
      amountToken: 900_000,
      amountUsd: 90,
      feeUsd: 0.1,
      decimals: 5,
    });
    expect(next.amountToken).toBeCloseTo(100_000, 6);
    expect(next.avgCostUsd).toBe(held.avgCostUsd);
  });

  it("falls back to the column's own precision when decimals are not supplied", () => {
    const next = applyFillToPosition(held, {
      side: "sell",
      amountToken: 1_000_000 - 1e-13,
      amountUsd: 100,
      feeUsd: 0,
    });
    expect(next.amountToken).toBe(0);
  });

  it("still clamps a sell larger than the position", () => {
    const next = applyFillToPosition(held, {
      side: "sell",
      amountToken: 2_000_000,
      amountUsd: 200,
      feeUsd: 0,
      decimals: 5,
    });
    expect(next.amountToken).toBe(0);
    // Only the held amount's basis is realised, not the phantom half.
    expect(next.realizedPnlUsd).toBeCloseTo(200 - 1_000_000 * 0.0001, 6);
  });

  it("leaves buys untouched by the residual rule", () => {
    const next = applyFillToPosition(EMPTY_POSITION, {
      side: "buy",
      amountToken: 1_000,
      amountUsd: 10,
      feeUsd: 0.1,
      decimals: 5,
    });
    expect(next.amountToken).toBe(1_000);
    expect(next.avgCostUsd).toBeCloseTo(0.0101, 9);
  });
});
