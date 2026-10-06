import { describe, expect, it } from "vitest";
import { answered, isNativeGasShortfall, TransferStatusUnknown, transferErrorMessage } from "./use-transfer";

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

  it("never shows viem's text for an address it refused to encode", () => {
    const viem = Object.assign(
      new Error('Address "0xAbC0000000000000000000000000000000000001" is invalid.\n\nDocs: https://viem.sh'),
      { name: "InvalidAddressError" },
    );
    expect(transferErrorMessage(viem, "base")).toBe("That address has a typo. Copy it again from the source.");
    expect(transferErrorMessage(new Error('Address "0x12" is invalid.'), "base")).toMatch(/typo/);
  });

  it("quotes a short unrecognised failure rather than inventing a cause", () => {
    expect(transferErrorMessage(new Error("RPC 503"), "solana")).toBe(
      "The transfer didn't complete: RPC 503. Check your balance before trying again.",
    );
    // The SDK's own full stop is not doubled.
    expect(transferErrorMessage(new Error("Failed to initialize embedded wallet proxy."), "base")).toBe(
      "The transfer didn't complete: Failed to initialize embedded wallet proxy. Check your balance before trying again.",
    );
  });

  it("says only that it did not complete when there is nothing fit to quote", () => {
    const generic =
      "The transfer didn't complete. Check your balance before trying again. If it hasn't changed, nothing was sent.";
    expect(transferErrorMessage(null, "solana")).toBe(generic);
    expect(transferErrorMessage(new Error(""), "base")).toBe(generic);
    // A multi-line viem revert: a dump, with a docs link and a version line.
    const revert = new Error(
      [
        "The contract function \"transfer\" reverted with the following reason:",
        "execution reverted",
        "",
        "Contract Call:",
        "  address:   0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        "  function:  transfer(address to, uint256 amount)",
        "",
        "Docs: https://viem.sh/docs/contract/simulateContract",
        "Version: viem@2.21.0",
      ].join("\n"),
    );
    expect(transferErrorMessage(revert, "base")).toBe(generic);
    // One line, but long enough to be a dump.
    expect(transferErrorMessage(new Error("x".repeat(121)), "base")).toBe(generic);
    // A URL can carry a key, and is never a reason a person can act on.
    expect(transferErrorMessage(new Error("POST https://rpc.example/v2/abc 503"), "solana")).toBe(generic);
  });

  it("reads a lapsed session as a sign-in problem", () => {
    const expired = "Your sign-in expired. Sign in again and retry. Nothing was sent.";
    expect(
      transferErrorMessage(new Error("User must be authenticated to use their embedded wallet."), "solana"),
    ).toBe(expired);
    expect(transferErrorMessage(new Error("Missing auth token"), "base")).toBe(expired);
  });

  it("reads the token's own balance refusal as a balance, per chain", () => {
    expect(transferErrorMessage(new Error("ERC20: transfer amount exceeds balance"), "base")).toBe(
      "You don't have that much USDC on Base right now. If you just sent some, the balance here may still be catching up.",
    );
    expect(transferErrorMessage(new Error("insufficient balance"), "solana")).toBe(
      "You don't have that much USDC on Solana right now.",
    );
    // Someone sending the SOL or ETH they hold is not told about USDC.
    expect(transferErrorMessage(new Error("insufficient balance"), "base", "native")).toMatch(/that much ETH on Base/);
  });
});

describe("answered", () => {
  it("returns an answer untouched, a refusal included", async () => {
    const refusal = { ok: false as const, error: "That's a lot of withdrawals in a short time." };
    expect(await answered(async () => refusal, () => new Error("unused"))).toBe(refusal);
  });

  it("turns a request that never got an answer into the caller's error, keeping the cause", async () => {
    const dropped = new TypeError("Failed to fetch");
    const attempt = answered(
      async () => {
        throw dropped;
      },
      (cause) => new TransferStatusUnknown({ cause }),
    );
    await expect(attempt).rejects.toMatchObject({ name: "TransferStatusUnknown", cause: dropped });
    // The raw transport text is not what a person reads, and it is not called a failure.
    await expect(attempt).rejects.toThrow(/can't tell whether it went/);
    await expect(attempt).rejects.not.toThrow(/Failed to fetch|failed/i);
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
