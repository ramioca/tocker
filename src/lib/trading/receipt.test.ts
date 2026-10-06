import { describe, expect, it } from "vitest";
import type { TokenScore } from "@/server/types";
import {
  SIMULATED_FILL_TEXT,
  SIMULATED_TX,
  buildReceipt,
  exceededTolerance,
  explorerUrl,
  publicReceipt,
  receiptSummary,
  scoreReasons,
  slippageBps,
  slippageText,
  type BuildReceiptInput,
} from "./receipt";

const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";

function score(overrides: Partial<TokenScore> = {}): TokenScore {
  return {
    tokenId: `solana:${BONK}`,
    chain: "solana",
    address: BONK,
    symbol: "BONK",
    name: "Bonk",
    total: 74,
    verdict: "candidate",
    components: { safety: 92, liquidity: 88, organic: 61, distribution: 70, momentum: 55, gecko: null, sentiment: null, smartMoney: null },
    blockers: [],
    warnings: [],
    priceUsd: 0.0000027,
    liquidityUsd: 2_000_000,
    volume24hUsd: 500_000,
    marketCapUsd: 1_000_000,
    holderCount: 900,
    ageHours: 200,
    priceChange24hPct: 4,
    sources: ["jupiter", "rugcheck"],
    scoredAt: new Date("2026-09-16T10:00:00Z").toISOString(),
    ...overrides,
  };
}

function input(overrides: Partial<BuildReceiptInput> = {}): BuildReceiptInput {
  return {
    chain: "solana",
    side: "buy",
    symbol: "BONK",
    tokenAddress: BONK,
    quote: { venue: "jupiter", priceUsd: 0.000002, feeUsd: 0 },
    fill: { priceUsd: 0.0000021, amountToken: 47_619_047, amountUsd: 100, feeUsd: 0.2, txHash: "5xSig" },
    slippageToleranceBps: 100,
    score: score(),
    networkFeeUsd: 0.05,
    quotedAt: new Date("2026-09-16T10:00:00Z"),
    filledAt: new Date("2026-09-16T10:00:01.400Z"),
    ...overrides,
  };
}

describe("slippageBps", () => {
  it("is positive when the fill was worse than the quote, whichever side we were on", () => {
    // Bought above the quote: worse.
    expect(slippageBps("buy", 100, 101)).toBeCloseTo(100, 6);
    // Sold below the quote: also worse.
    expect(slippageBps("sell", 100, 99)).toBeCloseTo(100, 6);
  });

  it("is negative when the fill beat the quote", () => {
    expect(slippageBps("buy", 100, 99)).toBeCloseTo(-100, 6);
    expect(slippageBps("sell", 100, 101)).toBeCloseTo(-100, 6);
  });

  it("returns 0 rather than Infinity on a missing or zero price", () => {
    expect(slippageBps("buy", 0, 10)).toBe(0);
    expect(slippageBps("buy", 10, 0)).toBe(0);
    expect(slippageBps("buy", Number.NaN, 10)).toBe(0);
  });
});

describe("scoreReasons", () => {
  it("returns the strongest components first, as facts about the token", () => {
    const reasons = scoreReasons(score().components);
    expect(reasons.map((r) => r.key)).toEqual(["safety", "liquidity", "distribution"]);
    expect(reasons[0]).toEqual({ key: "safety", label: "Safety", value: 92 });
  });

  it("skips components nobody paid for", () => {
    const reasons = scoreReasons(score().components, 7);
    expect(reasons.some((r) => r.key === "sentiment")).toBe(false);
  });

  it("survives a null or empty score", () => {
    expect(scoreReasons(null)).toEqual([]);
    expect(scoreReasons({})).toEqual([]);
  });
});

describe("buildReceipt", () => {
  it("records quoted against filled, the fee split and the latency", () => {
    const receipt = buildReceipt(input());
    expect(receipt.quotedPriceUsd).toBe(0.000002);
    expect(receipt.filledPriceUsd).toBe(0.0000021);
    expect(receipt.slippageBps).toBeCloseTo(500, 0);
    expect(receipt.venueFeeUsd).toBe(0.2);
    expect(receipt.networkFeeUsd).toBe(0.05);
    expect(receipt.totalFeeUsd).toBeCloseTo(0.25, 6);
    expect(receipt.latencyMs).toBe(1_400);
    expect(receipt.venueLabel).toBe("Jupiter Ultra");
  });

  it("links a live fill to the right explorer", () => {
    expect(buildReceipt(input()).explorerUrl).toBe("https://solscan.io/tx/5xSig");
    const base = buildReceipt(
      input({
        chain: "base",
        quote: { venue: "privy-base", priceUsd: 1, feeUsd: 0 },
        fill: { priceUsd: 1, amountToken: 100, amountUsd: 100, feeUsd: 0, txHash: "0xabc" },
      }),
    );
    expect(base.explorerUrl).toBe("https://basescan.org/tx/0xabc");
    expect(base.venueLabel).toBe("Privy swap (Base)");
  });

  it("marks a paper fill simulated, with no hash and no explorer link", () => {
    const receipt = buildReceipt(
      input({
        quote: { venue: "paper", priceUsd: 0.000002, feeUsd: 0.3 },
        fill: { priceUsd: 0.000002, amountToken: 50_000_000, amountUsd: 100, feeUsd: 0.3, txHash: null },
        networkFeeUsd: null,
      }),
    );
    expect(receipt.simulated).toBe(true);
    expect(receipt.txHash).toBe(SIMULATED_TX);
    expect(receipt.explorerUrl).toBeNull();
    expect(receipt.networkFeeUsd).toBeNull();
    expect(receipt.totalFeeUsd).toBeCloseTo(0.3, 6);
    expect(receiptSummary(receipt)).toContain(SIMULATED_FILL_TEXT);
  });

  it("falls back to the quoted price when the fill did not report one", () => {
    const receipt = buildReceipt(
      input({ fill: { priceUsd: 0, amountToken: 1, amountUsd: 100, feeUsd: 0, txHash: "sig" } }),
    );
    expect(receipt.filledPriceUsd).toBe(receipt.quotedPriceUsd);
    expect(receipt.slippageBps).toBe(0);
  });

  it("carries the score total, verdict and component reasons — and nothing from the strategy", () => {
    const receipt = buildReceipt(input());
    expect(receipt.scoreTotal).toBe(74);
    expect(receipt.scoreVerdict).toBe("candidate");
    expect(receipt.scoreReasons.length).toBeGreaterThan(0);

    // The privacy invariant, asserted on the shape rather than on caller discipline:
    // a receipt has nowhere to put a prompt, a threshold, a source list or a transcript.
    const serialised = JSON.stringify(receipt);
    for (const leak of ["strategyPrompt", "universe", "minScore", "dataSources", "blockers", "steps", "transcript"]) {
      expect(serialised).not.toContain(leak);
    }
    expect(Object.keys(receipt)).not.toContain("blockers");
  });

  it("handles a sell with no score at all", () => {
    const receipt = buildReceipt(input({ side: "sell", score: null }));
    expect(receipt.scoreTotal).toBeNull();
    expect(receipt.scoreVerdict).toBeNull();
    expect(receipt.scoreReasons).toEqual([]);
  });
});

describe("publicReceipt", () => {
  /** An agent that paid for both sources, on a token where they were the strongest signals. */
  const paid = () =>
    buildReceipt(
      input({
        score: score({
          components: { safety: 92, liquidity: 60, organic: 61, distribution: 70, momentum: 55, gecko: null, sentiment: 88, smartMoney: 91 },
        }),
      }),
    );

  it("is what the owner's receipt says, minus the rows a paid source produced", () => {
    const owner = paid();
    // The owner's document names them: that is why the entry scored what it did.
    expect(owner.scoreReasons.map((r) => r.key)).toEqual(["safety", "smartMoney", "sentiment"]);

    const stranger = publicReceipt(owner);
    expect(stranger.scoreReasons).toEqual([{ key: "safety", label: "Safety", value: 92 }]);
    // Nowhere else in the document either.
    expect(JSON.stringify(stranger)).not.toMatch(/sentiment|smart ?money/i);
  });

  it("changes nothing else, and does not touch the stored document", () => {
    const owner = paid();
    const before = JSON.stringify(owner);
    const stranger = publicReceipt(owner);
    expect(JSON.stringify(owner)).toBe(before);
    expect({ ...stranger, scoreReasons: owner.scoreReasons }).toEqual(owner);
    // Total and verdict are the public verdict on the token, as on the trade row.
    expect(stranger.scoreTotal).toBe(owner.scoreTotal);
    expect(stranger.scoreVerdict).toBe(owner.scoreVerdict);
    // The tolerance stays: it is part of the receipt's public shape.
    expect(stranger.slippageToleranceBps).toBe(100);
  });

  it("leaves a receipt with only free components as it was", () => {
    const receipt = buildReceipt(input());
    expect(publicReceipt(receipt)).toEqual(receipt);
  });

  it("reads a stored row with no reason list as having none", () => {
    const { scoreReasons: _missing, ...legacy } = buildReceipt(input());
    expect(publicReceipt(legacy as ReturnType<typeof buildReceipt>).scoreReasons).toEqual([]);
  });
});

describe("tolerance and phrasing", () => {
  it("flags only a fill that drifted past the agent's own tolerance", () => {
    expect(exceededTolerance({ slippageBps: 120, slippageToleranceBps: 100 })).toBe(true);
    expect(exceededTolerance({ slippageBps: 40, slippageToleranceBps: 100 })).toBe(false);
    // A fill that beat the quote is never a tolerance breach.
    expect(exceededTolerance({ slippageBps: -400, slippageToleranceBps: 100 })).toBe(false);
  });

  it("writes slippage for a human", () => {
    expect(slippageText(19)).toBe("+19 bps");
    expect(slippageText(-4)).toBe("−4 bps");
    expect(slippageText(0.2)).toBe("at the quote");
  });
});

describe("explorerUrl", () => {
  it("has no link for a simulated or missing hash", () => {
    expect(explorerUrl("solana", null)).toBeNull();
    expect(explorerUrl("solana", SIMULATED_TX)).toBeNull();
    expect(explorerUrl("base", "")).toBeNull();
  });
});
