import { describe, expect, it } from "vitest";
import { checkWithdrawAmount } from "./withdraw-amount";

const base = { availableUsdc: 123.456789, feeUsdc: 0, minAmount: 0 };

describe("checkWithdrawAmount", () => {
  it("shows the floored balance, and accepts exactly that", () => {
    expect(checkWithdrawAmount({ ...base, amount: "" }).sendable).toBe(123.45);
    const atMost = checkWithdrawAmount({ ...base, amount: "123.45" });
    expect(atMost.validAmount).toBe(true);
    expect(atMost.overBalance).toBe(false);
  });

  it("refuses the rounded-up figure", () => {
    const over = checkWithdrawAmount({ ...base, amount: "123.46" });
    expect(over.overBalance).toBe(true);
    expect(over.validAmount).toBe(false);
  });

  it("takes the account fee out of what can be sent", () => {
    const withFee = checkWithdrawAmount({ availableUsdc: 10.009, feeUsdc: 2.04, minAmount: 1, amount: "7.96" });
    expect(withFee.sendable).toBe(7.96);
    expect(withFee.validAmount).toBe(true);
    expect(checkWithdrawAmount({ availableUsdc: 10.009, feeUsdc: 2.04, minAmount: 1, amount: "7.97" }).overBalance).toBe(true);
    expect(checkWithdrawAmount({ availableUsdc: 10.009, feeUsdc: 2.04, minAmount: 1, amount: "0.5" }).underMinimum).toBe(true);
  });
});
