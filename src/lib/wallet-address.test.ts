import { describe, expect, it } from "vitest";
import { getAddress } from "viem";
import { USDC_MINT } from "@/lib/wallets/funding";
import {
  addressHintForChain,
  addressProblemForChain,
  CHECKSUM_TYPO,
  destinationProblemForChain,
  isValidAddressForChain,
  NAME_NOT_SUPPORTED,
  normalizeAddressForChain,
  USDC_TOKEN_NOT_A_WALLET,
} from "./wallet-address";

const LOWER = "0x8f3c2a9b41d7e6f05a12c3d4e5f60718293a4b5c";
const CHECKSUMMED = getAddress(LOWER);

describe("addressProblemForChain", () => {
  it("accepts a checksummed, an all-lowercase and an all-uppercase Base address", () => {
    expect(addressProblemForChain("base", CHECKSUMMED)).toBeNull();
    expect(addressProblemForChain("base", LOWER)).toBeNull();
    expect(addressProblemForChain("base", `0x${LOWER.slice(2).toUpperCase()}`)).toBeNull();
    expect(addressProblemForChain("base", `  ${CHECKSUMMED}  `)).toBeNull();
  });

  it("names a mixed-case typo as a typo, before the hold, not after it in viem's words", () => {
    // One character changed in a checksummed address: the shape is fine, the checksum is not.
    const i = CHECKSUMMED.search(/[a-f]/);
    const typo = `${CHECKSUMMED.slice(0, i)}${CHECKSUMMED[i] === "a" ? "b" : "a"}${CHECKSUMMED.slice(i + 1)}`;
    expect(typo).not.toBe(CHECKSUMMED);
    expect(addressProblemForChain("base", typo)).toBe(CHECKSUM_TYPO);
    expect(isValidAddressForChain("base", typo)).toBe(false);
    // The exact address from the report.
    expect(addressProblemForChain("base", "0x8f3C2a9B41d7E6f05A12c3D4e5F60718293a4B5c")).toBe(CHECKSUM_TYPO);
  });

  it("refuses the zero address, the wrong shape and the wrong chain", () => {
    expect(addressProblemForChain("base", `0x${"0".repeat(40)}`)).toMatch(/zero address/);
    expect(addressProblemForChain("base", "0x1234")).toBe(addressHintForChain("base"));
    expect(addressProblemForChain("solana", CHECKSUMMED)).toBe(addressHintForChain("solana"));
    expect(addressProblemForChain("solana", "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263")).toBeNull();
  });
});

describe("destinationProblemForChain", () => {
  const SOLANA_WALLET = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";

  it("accepts what a withdrawal can be sent to", () => {
    expect(destinationProblemForChain("solana", SOLANA_WALLET)).toBeNull();
    expect(destinationProblemForChain("solana", `  ${SOLANA_WALLET}  `)).toBeNull();
    expect(destinationProblemForChain("base", CHECKSUMMED)).toBeNull();
    expect(destinationProblemForChain("base", LOWER)).toBeNull();
  });

  it("names the other chain's address, and says the chain can be switched", () => {
    expect(destinationProblemForChain("solana", CHECKSUMMED)).toBe(
      "That's a Base (0x…) address. This withdrawal leaves on Solana. Paste a Solana address, or switch the chain to Base.",
    );
    expect(destinationProblemForChain("base", SOLANA_WALLET)).toBe(
      "That's a Solana address. This withdrawal leaves on Base. Paste a 0x… address, or switch the chain to Solana.",
    );
  });

  it("says names are not supported, on either chain", () => {
    for (const name of ["alice.sol", "alice.eth", "alice.base.eth", "ALICE.ETH", " alice.sol "]) {
      expect(destinationProblemForChain("solana", name)).toBe(NAME_NOT_SUPPORTED);
      expect(destinationProblemForChain("base", name)).toBe(NAME_NOT_SUPPORTED);
    }
  });

  it("refuses USDC itself: the mint on Solana, the contract on Base in any capitalisation", () => {
    expect(destinationProblemForChain("solana", USDC_MINT.solana)).toBe(USDC_TOKEN_NOT_A_WALLET);
    expect(destinationProblemForChain("base", USDC_MINT.base)).toBe(USDC_TOKEN_NOT_A_WALLET);
    expect(destinationProblemForChain("base", USDC_MINT.base.toLowerCase())).toBe(USDC_TOKEN_NOT_A_WALLET);
    expect(destinationProblemForChain("base", `0x${USDC_MINT.base.slice(2).toUpperCase()}`)).toBe(
      USDC_TOKEN_NOT_A_WALLET,
    );
    // The token on the chain that is not selected is still the token, not "switch the chain".
    expect(destinationProblemForChain("base", USDC_MINT.solana)).toBe(USDC_TOKEN_NOT_A_WALLET);
    expect(destinationProblemForChain("solana", USDC_MINT.base)).toBe(USDC_TOKEN_NOT_A_WALLET);
  });

  it("only ever refuses more than the plain address check", () => {
    const i = CHECKSUMMED.search(/[a-f]/);
    const typo = `${CHECKSUMMED.slice(0, i)}${CHECKSUMMED[i] === "a" ? "b" : "a"}${CHECKSUMMED.slice(i + 1)}`;
    expect(destinationProblemForChain("base", typo)).toBe(CHECKSUM_TYPO);
    expect(destinationProblemForChain("base", `0x${"0".repeat(40)}`)).toMatch(/zero address/);
    expect(destinationProblemForChain("base", "0x1234")).toBe(addressHintForChain("base"));
    expect(destinationProblemForChain("solana", "not an address")).toBe(addressHintForChain("solana"));

    const samples = [
      CHECKSUMMED, LOWER, typo, SOLANA_WALLET, USDC_MINT.solana, USDC_MINT.base,
      "", "0x1234", "alice.sol", `0x${"0".repeat(40)}`, "O0Il".repeat(10),
    ];
    for (const chain of ["solana", "base"] as const) {
      for (const sample of samples) {
        if (addressProblemForChain(chain, sample) !== null) {
          expect(destinationProblemForChain(chain, sample), `${chain} ${sample}`).not.toBeNull();
        }
      }
    }
  });

  it("leaves the plain check alone: a token address is still an address", () => {
    // The blocklist and the trade picker validate token addresses with it.
    expect(addressProblemForChain("solana", USDC_MINT.solana)).toBeNull();
    expect(addressProblemForChain("base", USDC_MINT.base)).toBeNull();
    expect(addressProblemForChain("solana", CHECKSUMMED)).toBe(addressHintForChain("solana"));
  });
});

describe("normalizeAddressForChain", () => {
  it("checksums an EVM address in any single case, and trims a Solana one", () => {
    expect(normalizeAddressForChain("base", LOWER)).toBe(CHECKSUMMED);
    expect(normalizeAddressForChain("base", `0x${LOWER.slice(2).toUpperCase()}`)).toBe(CHECKSUMMED);
    expect(normalizeAddressForChain("solana", " DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263 ")).toBe(
      "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
    );
  });
});
