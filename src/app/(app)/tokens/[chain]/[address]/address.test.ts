import { describe, expect, it } from "vitest";
import { isTokenAddress } from "./address";

describe("isTokenAddress", () => {
  it("accepts the book's native alias on either chain", () => {
    expect(isTokenAddress("base", "native")).toBe(true);
    expect(isTokenAddress("solana", "native")).toBe(true);
  });

  it("accepts EVM addresses on base in any case", () => {
    expect(isTokenAddress("base", "0x940181a94A35A4569E4529A3CDfB74e38FD98631")).toBe(true);
    expect(isTokenAddress("base", "0x940181a94a35a4569e4529a3cdfb74e38fd98631")).toBe(true);
  });

  it("rejects malformed base addresses and solana mints on base", () => {
    expect(isTokenAddress("base", "0x940181a94a35a4569e4529a3cdfb74e38fd9863")).toBe(false);
    expect(isTokenAddress("base", "0xZZ0181a94a35a4569e4529a3cdfb74e38fd98631")).toBe(false);
    expect(isTokenAddress("base", "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263")).toBe(false);
  });

  it("accepts base58 mints on solana", () => {
    expect(isTokenAddress("solana", "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263")).toBe(true);
    expect(isTokenAddress("solana", "So11111111111111111111111111111111111111112")).toBe(true);
  });

  it("rejects what can never be a mint", () => {
    expect(isTokenAddress("solana", "NotARealAddress1234567890")).toBe(false); // too short
    expect(isTokenAddress("solana", "0OIl0OIl0OIl0OIl0OIl0OIl0OIl0OIl0OIl")).toBe(false); // not base58
    expect(isTokenAddress("solana", "0x940181a94A35A4569E4529A3CDfB74e38FD98631")).toBe(false);
    expect(isTokenAddress("solana", "")).toBe(false);
  });
});
