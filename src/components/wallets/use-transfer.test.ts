import { describe, expect, it } from "vitest";
import { isNativeGasShortfall, transferErrorMessage } from "./use-transfer";

/**
 * The two failures that used to reach the user as a raw SDK string. Both look like
 * "your wallet rejected it" from the outside, and neither is the user's fault.
 */
describe("transferErrorMessage", () => {
  it("passes a platform-wallet failure through word for word", () => {
    // On Solana the fee payer is Tocker's own wallet, so this message already names an
    // address the operator can top up. Rewriting it — worse, into "deposit 0.01 SOL" —
    // would send them to fund the wrong wallet.
    const raw =
      "Tocker's platform Solana wallet (7xKX…9bQ2) holds 0.000000 SOL and needs at least 0.003044 SOL to pay the network fee and the token-account rent on this funding transfer. Send that wallet at least 0.02 SOL and try again.";
    expect(transferErrorMessage(new Error(raw), "solana")).toBe(raw);
  });

  it("does not turn a platform-wallet gas shortfall into advice about the user's own SOL", () => {
    const raw =
      "The network rejected this transfer: Attempt to debit an account but found no record of a prior credit. Tocker's platform wallet (7xKX…9bQ2) was paying its fee; your USDC did not move.";
    expect(transferErrorMessage(new Error(raw), "solana")).toBe(raw);
  });

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

  it("never asks the user for SOL when a sponsored USDC transfer is short of fee", () => {
    // Every USDC transfer on Solana is paid by Tocker's fee wallet: a shortfall is
    // Tocker's, and the only honest advice is to try again.
    const message = transferErrorMessage(
      new Error("Transaction simulation failed: Insufficient lamports 0, need 5000"),
      "solana",
    );
    expect(message).toMatch(/try again/i);
    expect(message).not.toMatch(/SOL\b|deposit/i);
  });

  it("never asks the user for ETH when a sponsored Base USDC transfer is short of fee", () => {
    const message = transferErrorMessage(new Error("insufficient funds for fee"), "base");
    expect(message).not.toMatch(/ETH|SOL\b|deposit/i);
  });

  it("tells someone sending native SOL or ETH to send less, not to deposit", () => {
    const sol = transferErrorMessage(new Error("Insufficient lamports 0, need 5000"), "solana", "native");
    expect(sol).toMatch(/smaller amount/);
    expect(sol).not.toMatch(/deposit/i);
    const eth = transferErrorMessage(new Error("insufficient funds for fee"), "base", "native");
    expect(eth).toMatch(/ETH/);
    expect(eth).not.toMatch(/SOL\b|deposit/i);
  });

  it("passes the refilling sentence through word for word", () => {
    const raw = "Tocker's fee wallet is refilling — try again in a minute.";
    expect(transferErrorMessage(new Error(raw), "solana")).toBe(raw);
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
