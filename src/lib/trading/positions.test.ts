import { describe, expect, it } from "vitest";
import { applyFillToPosition, sellAmountToken, EMPTY_POSITION } from "./positions";

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
