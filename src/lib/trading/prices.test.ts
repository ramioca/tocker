import { describe, expect, it } from "vitest";
import { pickDexScreenerPrices } from "./prices";

const pair = (address: string, priceUsd: string, liquidityUsd: number | null) => ({
  baseToken: { address },
  priceUsd,
  liquidity: liquidityUsd === null ? undefined : { usd: liquidityUsd },
});

describe("pickDexScreenerPrices", () => {
  it("ignores a dead bonding curve with no liquidity figure and takes the deepest real pool", () => {
    const prices = pickDexScreenerPrices([
      pair("CLIP", "0.0000485", null),
      pair("CLIP", "0.00121", 40_000),
      pair("CLIP", "0.00123", 95_000),
    ]);
    expect(prices.get("CLIP")).toBe(0.00123);
  });

  it("returns nothing for a token whose only pools are dust", () => {
    expect(pickDexScreenerPrices([pair("X", "1", 500), pair("X", "2", null)]).size).toBe(0);
  });

  it("drops zero and malformed prices", () => {
    expect(pickDexScreenerPrices([pair("X", "0", 10_000), pair("X", "abc", 10_000), {}, null]).size).toBe(0);
  });
});
