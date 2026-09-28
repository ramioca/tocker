import { describe, expect, it } from "vitest";
import { MIN_PLATFORM_SOL } from "@/lib/wallets/gas";
import { PLATFORM_USDC_RESERVE } from "./sol";
import {
  PLATFORM_SOL_FLOOR,
  PLATFORM_USDC_LOW,
  platformWithdrawable,
  platformWithdrawProblem,
  platformWithdrawWarning,
} from "./withdraw";

describe("platform withdraw limits", () => {
  it("keeps its constants in step with the gas and refuel modules", () => {
    expect(PLATFORM_SOL_FLOOR).toBe(MIN_PLATFORM_SOL);
    expect(PLATFORM_USDC_LOW).toBe(PLATFORM_USDC_RESERVE);
  });

  it("lets all USDC and all Base ETH go", () => {
    expect(platformWithdrawable("base", "usdc", { usdc: 12.345678, native: 0 })).toBe(12.345678);
    expect(platformWithdrawable("base", "native", { usdc: 0, native: 0.01 })).toBe(0.01);
  });

  it("keeps the SOL floor plus the transfer's own cost", () => {
    expect(platformWithdrawable("solana", "native", { usdc: 0, native: 0.1 })).toBeCloseTo(0.077, 9);
    expect(platformWithdrawable("solana", "native", { usdc: 0, native: 0.01 })).toBe(0);
  });

  it("treats an unread balance as unknown, never zero", () => {
    expect(platformWithdrawable("base", "usdc", { usdc: null, native: 0 })).toBeNull();
    expect(platformWithdrawProblem({ chain: "base", asset: "usdc", amount: 1, balances: { usdc: null, native: 0 } })).toMatch(
      /could not be read/,
    );
    expect(
      platformWithdrawProblem({ chain: "solana", asset: "usdc", amount: 1, balances: { usdc: 5, native: null } }),
    ).toMatch(/SOL balance could not be read/);
  });

  it("refuses zero, over-balance and dipping into the SOL floor", () => {
    const balances = { usdc: 10, native: 0.05 };
    expect(platformWithdrawProblem({ chain: "base", asset: "usdc", amount: 0, balances })).toMatch(/greater than zero/);
    expect(platformWithdrawProblem({ chain: "base", asset: "usdc", amount: 10.01, balances })).toMatch(/More than/);
    expect(platformWithdrawProblem({ chain: "base", asset: "usdc", amount: 10, balances })).toBeNull();
    expect(platformWithdrawProblem({ chain: "solana", asset: "native", amount: 0.03, balances })).toMatch(/keeps 0.02 SOL/);
    expect(platformWithdrawProblem({ chain: "solana", asset: "native", amount: 0.027, balances })).toBeNull();
  });

  it("needs SOL on Solana to pay for a USDC transfer", () => {
    expect(
      platformWithdrawProblem({ chain: "solana", asset: "usdc", amount: 1, balances: { usdc: 10, native: 0.001 } }),
    ).toMatch(/needs at least/);
    expect(
      platformWithdrawProblem({ chain: "solana", asset: "usdc", amount: 1, balances: { usdc: 10, native: 0.004 } }),
    ).toBeNull();
  });

  it("refuses a SOL send Solana would reject", () => {
    expect(
      platformWithdrawProblem({ chain: "solana", asset: "native", amount: 0.0005, balances: { usdc: 0, native: 1 } }),
    ).toMatch(/at least 0.001 SOL/);
  });

  it("warns, without refusing, when USDC runs low or empty", () => {
    const balances = { usdc: 10, native: 0.05 };
    expect(platformWithdrawWarning({ chain: "base", asset: "usdc", amount: 10, balances })).toMatch(/empties/);
    expect(platformWithdrawWarning({ chain: "base", asset: "usdc", amount: 9, balances })).toMatch(/Leaves 1 USDC/);
    expect(platformWithdrawWarning({ chain: "solana", asset: "usdc", amount: 9, balances })).toMatch(/buying itself SOL/);
    expect(platformWithdrawWarning({ chain: "base", asset: "usdc", amount: 5, balances })).toBeNull();
    expect(platformWithdrawWarning({ chain: "base", asset: "native", amount: 0.01, balances })).toBeNull();
  });
});
