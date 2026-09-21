import { describe, expect, it } from "vitest";
import { isNativeGasShortfall, transferErrorMessage } from "./use-transfer";

/**
 * The two failures that used to reach the user as a raw SDK string. Both look like
 * "your wallet rejected it" from the outside, and neither is the user's fault.
 */
describe("transferErrorMessage", () => {
  it("names sponsorship being off for the app, not the user's wallet", () => {
    const message = transferErrorMessage(
      new Error("Sponsoring transactions is only supported for wallets on the TEE stack"),
      "solana",
    );
    expect(message).toMatch(/sponsorship is not enabled/i);
    expect(message).toMatch(/operator/i);
    // It must not tell the user to deposit SOL — that would not fix it.
    expect(message).not.toMatch(/0\.01 SOL/);
  });

  it("turns a dry Solana wallet into an amount of SOL to deposit", () => {
    const message = transferErrorMessage(
      new Error("Transaction simulation failed: Insufficient lamports 0, need 5000"),
      "solana",
    );
    expect(message).toMatch(/0\.01 SOL/);
  });

  it("says ETH on Base, not SOL", () => {
    const message = transferErrorMessage(new Error("insufficient funds for fee"), "base");
    expect(message).toMatch(/ETH/);
    expect(message).not.toMatch(/SOL/);
  });

  it("does not dress a cancelled signature up as a problem", () => {
    expect(transferErrorMessage(new Error("User rejected the request"), "solana")).toMatch(
      /cancelled/i,
    );
  });

  it("passes an unrecognised failure through rather than inventing a cause", () => {
    expect(transferErrorMessage(new Error("RPC 503"), "solana")).toBe("RPC 503");
    expect(transferErrorMessage(null, "solana")).toBe("The transfer could not be signed.");
  });
});

describe("isNativeGasShortfall", () => {
  it("is true only for an out-of-gas failure", () => {
    expect(isNativeGasShortfall(new Error("Insufficient lamports 0"))).toBe(true);
    expect(isNativeGasShortfall(new Error("insufficient funds for fee"))).toBe(true);
    expect(isNativeGasShortfall(new Error("User rejected the request"))).toBe(false);
    expect(isNativeGasShortfall(undefined)).toBe(false);
  });
});
