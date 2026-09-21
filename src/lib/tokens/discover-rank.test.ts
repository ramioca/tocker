import { describe, expect, it } from "vitest";
import { rankCandidates } from "./discover";
import type { TokenCandidate } from "@/server/types";

const candidate = (symbol: string, origin: TokenCandidate["origin"], quickScore: number): TokenCandidate =>
  ({ token: { id: `solana:${symbol}`, symbol }, origin, quickScore }) as unknown as TokenCandidate;

describe("rankCandidates", () => {
  it("puts launch-feed candidates above the free feeds whatever their quick score", () => {
    const ranked = rankCandidates([
      candidate("TREND", "trending", 90),
      candidate("GECKO", "gecko_launches", 60),
      candidate("ORG", "top_organic", 80),
      candidate("RADAR", "paid_launches", 55),
    ]).map((c) => c.token.symbol);
    expect(ranked).toEqual(["GECKO", "RADAR", "TREND", "ORG"]);
  });

  it("orders within a tier by quick score and leaves the input untouched", () => {
    const input = [candidate("A", "new_launches", 10), candidate("B", "new_launches", 20)];
    expect(rankCandidates(input).map((c) => c.token.symbol)).toEqual(["B", "A"]);
    expect(input[0].token.symbol).toBe("A");
  });
});
