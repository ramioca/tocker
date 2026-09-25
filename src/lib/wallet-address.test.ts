import { describe, expect, it } from "vitest";
import { getAddress } from "viem";
import {
  addressHintForChain,
  addressProblemForChain,
  CHECKSUM_TYPO,
  isValidAddressForChain,
  normalizeAddressForChain,
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

describe("normalizeAddressForChain", () => {
  it("checksums an EVM address in any single case, and trims a Solana one", () => {
    expect(normalizeAddressForChain("base", LOWER)).toBe(CHECKSUMMED);
    expect(normalizeAddressForChain("base", `0x${LOWER.slice(2).toUpperCase()}`)).toBe(CHECKSUMMED);
    expect(normalizeAddressForChain("solana", " DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263 ")).toBe(
      "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
    );
  });
});
