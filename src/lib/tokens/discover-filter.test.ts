import { describe, expect, it } from "vitest";
import { isDiscoveryCandidate } from "./discover";

describe("isDiscoveryCandidate", () => {
  it("drops stablecoins, the quote asset and wrapped majors", () => {
    for (const [address, symbol] of [
      ["EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", "USDC"],
      ["Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", "USDT"],
      ["So11111111111111111111111111111111111111112", "SOL"],
      ["0x4200000000000000000000000000000000000006", "WETH"],
      ["someOtherMint1111111111111111111111111111111", "PYUSD"],
      ["someOtherMint2222222222222222222222222222222", "USDe"],
      ["someOtherMint3333333333333333333333333333333", "WBTC"],
      ["someOtherMint4444444444444444444444444444444", "ETH"],
      ["someOtherMint5555555555555555555555555555555", "JitoSOL"],
    ]) {
      expect(isDiscoveryCandidate({ address, symbol }), symbol).toBe(false);
    }
  });

  it("keeps memecoins and fresh launches, including names that merely contain SOL or USD", () => {
    for (const symbol of ["BONK", "WIF", "BRETT", "SOLAMA", "USDUMB2", "baton", "ZCAT", "SOLCAT"]) {
      expect(isDiscoveryCandidate({ address: `mint-${symbol}`, symbol }), symbol).toBe(true);
    }
  });
});
