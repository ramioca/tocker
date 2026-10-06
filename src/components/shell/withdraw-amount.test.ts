import { describe, expect, it } from "vitest";
import { checkWithdrawAmount, maxAmountText } from "./withdraw-amount";

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

describe("maxAmountText", () => {
  it("is the balance floored to a cent, always with two decimals", () => {
    expect(maxAmountText(123.456789, 0)).toBe("123.45");
    expect(maxAmountText(120.5, 0)).toBe("120.50");
    expect(maxAmountText(25, 0)).toBe("25.00");
  });

  it("drops by the account fee, and never goes below zero", () => {
    expect(maxAmountText(25, 0.3)).toBe("24.70");
    expect(maxAmountText(10.009, 2.04)).toBe("7.96");
    expect(maxAmountText(0.2, 0.3)).toBe("0.00");
    expect(maxAmountText(0, 0)).toBe("0.00");
  });

  it("is always an amount the check accepts, with or without a fee", () => {
    for (const [availableUsdc, feeUsdc] of [
      [123.456789, 0],
      [25, 0.3],
      [10.009, 2.04],
      [1.004999, 0],
      [57.3, 0.299999],
    ] as const) {
      const amount = maxAmountText(availableUsdc, feeUsdc);
      const checked = checkWithdrawAmount({ amount, availableUsdc, feeUsdc, minAmount: 1 });
      expect(checked.overBalance, `${availableUsdc} less ${feeUsdc}`).toBe(false);
      expect(checked.validAmount, `${availableUsdc} less ${feeUsdc}`).toBe(true);
      expect(checked.parsed).toBe(checked.sendable);
    }
  });
});
