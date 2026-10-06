import { describe, expect, it } from "vitest";
import { canonicalTokenAddress, tokenAddressSpellings, tokenIdSpellings } from "./token-address";

const AERO = "0x940181a94A35A4569E4529A3CDfB74e38FD98631";
const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";

describe("canonicalTokenAddress", () => {
  it("gives a Base contract one spelling, whatever case it arrives in", () => {
    expect(canonicalTokenAddress("base", AERO)).toBe(AERO);
    expect(canonicalTokenAddress("base", AERO.toLowerCase())).toBe(AERO);
    expect(canonicalTokenAddress("base", `0x${AERO.slice(2).toUpperCase()}`)).toBe(AERO);
  });

  it("puts a mixed-case address with the wrong checksum right instead of refusing it", () => {
    // The last seven characters lowercased: a valid address, an invalid EIP-55 checksum.
    const wrong = `${AERO.slice(0, -7)}${AERO.slice(-7).toLowerCase()}`;
    expect(wrong).not.toBe(AERO);
    expect(canonicalTokenAddress("base", wrong)).toBe(AERO);
  });

  it("is stable: the canonical spelling is its own canonical spelling", () => {
    // What makes the permanent redirect safe to cache. It can never point back.
    const once = canonicalTokenAddress("base", AERO.toLowerCase());
    expect(canonicalTokenAddress("base", once)).toBe(once);
  });

  it("leaves a Solana mint alone: base58 is case-sensitive", () => {
    expect(canonicalTokenAddress("solana", BONK)).toBe(BONK);
    expect(canonicalTokenAddress("solana", BONK.toLowerCase())).toBe(BONK.toLowerCase());
  });

  it("leaves the native alias and anything that is not an address alone", () => {
    expect(canonicalTokenAddress("base", "native")).toBe("native");
    expect(canonicalTokenAddress("base", "0x1234")).toBe("0x1234");
    // An EVM-shaped string on Solana is not an EVM address there.
    expect(canonicalTokenAddress("solana", AERO.toLowerCase())).toBe(AERO.toLowerCase());
  });
});

describe("tokenAddressSpellings", () => {
  it("lists the checksum first, then lowercase, then the spelling given", () => {
    const upper = `0x${AERO.slice(2).toUpperCase()}`;
    expect(tokenAddressSpellings("base", upper)).toEqual([AERO, AERO.toLowerCase(), upper]);
  });

  it("does not repeat a spelling", () => {
    expect(tokenAddressSpellings("base", AERO)).toEqual([AERO, AERO.toLowerCase()]);
    expect(tokenAddressSpellings("base", AERO.toLowerCase())).toEqual([AERO, AERO.toLowerCase()]);
  });

  it("is the address alone for Solana and for native", () => {
    expect(tokenAddressSpellings("solana", BONK)).toEqual([BONK]);
    expect(tokenAddressSpellings("base", "native")).toEqual(["native"]);
  });

  it("gives the same ids for every spelling of one contract", () => {
    const ids = tokenIdSpellings("base", AERO);
    expect(ids).toEqual([`base:${AERO}`, `base:${AERO.toLowerCase()}`]);
    expect(tokenIdSpellings("base", AERO.toLowerCase())).toEqual(ids);
  });
});
