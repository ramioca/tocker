import { describe, expect, it } from "vitest";
import { feeFailureSentence } from "@/lib/wallets/funding";
import { publicErrorMessage, transferErrorMessage } from "./_shared";

const FALLBACK = "Something went wrong.";

describe("publicErrorMessage", () => {
  it("passes through a sentence the code composed for a person", () => {
    expect(publicErrorMessage(new Error("That amount rounds to zero USDC."), FALLBACK)).toBe(
      "That amount rounds to zero USDC.",
    );
  });

  it("hides raw database, fetch and provider errors", () => {
    expect(publicErrorMessage(new Error('relation "agents" does not exist'), FALLBACK)).toBe(FALLBACK);
    expect(publicErrorMessage(new Error("fetch failed"), FALLBACK)).toBe(FALLBACK);
    expect(publicErrorMessage(new Error('400 {"error":"invalid wallet"}'), FALLBACK)).toBe(FALLBACK);
    expect(publicErrorMessage(new Error('Failed query: insert into "agents"\nparams: a,b.'), FALLBACK)).toBe(FALLBACK);
  });

  /** The one leak that matters most: the Helius URL carries its key in the query string. */
  it("never forwards a URL, even inside a well-formed sentence", () => {
    expect(
      publicErrorMessage(new Error("Could not reach https://mainnet.helius-rpc.com/?api-key=abc."), FALLBACK),
    ).toBe(FALLBACK);
  });

  it("falls back for non-Error throws", () => {
    expect(publicErrorMessage("boom", FALLBACK)).toBe(FALLBACK);
    expect(publicErrorMessage(undefined, FALLBACK)).toBe(FALLBACK);
  });
});

describe("transferErrorMessage", () => {
  /** The forms classify fee failures from this text, so it has to survive the trip. */
  it("passes a short fee failure through for the client to classify", () => {
    expect(transferErrorMessage(new Error("Insufficient lamports 0, need 5000"), FALLBACK, "solana")).toBe(
      "Insufficient lamports 0, need 5000",
    );
  });

  it("turns a fee failure that carries a URL into the finished sentence", () => {
    const err = new Error("insufficient lamports at https://rpc.example/?api-key=abc");
    expect(transferErrorMessage(err, FALLBACK, "solana")).toBe(feeFailureSentence("solana", "refuel"));
  });

  it("treats everything else like publicErrorMessage", () => {
    expect(transferErrorMessage(new Error("That amount rounds to zero USDC."), FALLBACK, "solana")).toBe(
      "That amount rounds to zero USDC.",
    );
    expect(transferErrorMessage(new Error('relation "wallets" does not exist'), FALLBACK, "base")).toBe(FALLBACK);
  });
});
