import { describe, expect, it } from "vitest";
import { buildReceipt } from "@/lib/trading/receipt";
import { TOTAL_FEES_LABEL, feeSplitText } from "./receipt-fees";

describe("the compact row's fee label", () => {
  it("does not attribute the whole total to the venue", () => {
    // The total includes Tocker's own fee; "venue fees" put it on Jupiter.
    expect(TOTAL_FEES_LABEL).toBe("fees");
    expect(TOTAL_FEES_LABEL).not.toMatch(/venue/i);
  });
});

describe("feeSplitText", () => {
  it("names Tocker's fee and the venue's separately", () => {
    expect(feeSplitText({ platformFeeUsd: 0.1, venueFeeUsd: 0.15, networkFeeUsd: null })).toBe(
      "Tocker $0.10 · venue $0.15",
    );
  });

  it("keeps a sub-cent venue fee readable instead of rounding it to nothing", () => {
    // A $1 paper sell: the simulator's 0.3% is a third of a cent.
    expect(feeSplitText({ platformFeeUsd: 0.1, venueFeeUsd: 0.00301, networkFeeUsd: null })).toBe(
      "Tocker $0.10 · venue $0.00301",
    );
  });

  it("prints each part as it was recorded, so the parts come to the total the row shows", () => {
    // A $25 paper fill at 0.5%: twelve and a half cents and seven and a half, twenty in
    // all. To the cent the two read "$0.13" and "$0.08" under a "$0.20 fees" total.
    expect(feeSplitText({ platformFeeUsd: 0.125, venueFeeUsd: 0.075, networkFeeUsd: null })).toBe(
      "Tocker $0.125 · venue $0.075",
    );
    expect(feeSplitText({ platformFeeUsd: 0.243659, venueFeeUsd: 0.048732, networkFeeUsd: 0.000742 })).toBe(
      "Tocker $0.243659 · venue $0.048732 · network $0.000742",
    );
  });

  it("adds the network fee only when the venue reported one", () => {
    expect(feeSplitText({ platformFeeUsd: 0.1, venueFeeUsd: 0.15, networkFeeUsd: 0.002 })).toBe(
      "Tocker $0.10 · venue $0.15 · network $0.002",
    );
    expect(feeSplitText({ platformFeeUsd: 0.1, venueFeeUsd: 0.15, networkFeeUsd: 0 })).toBe("Tocker $0.10 · venue $0.15");
  });

  it("leaves out a part that was nothing", () => {
    // A receipt from before the Tocker fee existed carries no `platformFeeUsd`.
    expect(feeSplitText({ venueFeeUsd: 0.15, networkFeeUsd: null })).toBe("venue $0.15");
    // A Base swap reports no venue fee of its own.
    expect(feeSplitText({ platformFeeUsd: 0.1, venueFeeUsd: 0, networkFeeUsd: null })).toBe("Tocker $0.10");
    expect(feeSplitText({ platformFeeUsd: 0, venueFeeUsd: 0, networkFeeUsd: null })).toBe("");
  });

  it("reads the amounts off the receipt, whatever the fee was set to", () => {
    const at = new Date("2026-10-01T12:00:00Z");
    const receipt = buildReceipt({
      chain: "solana",
      side: "sell",
      symbol: "BONK",
      tokenAddress: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
      quote: { venue: "paper", priceUsd: 0.00000377, feeUsd: 0.003 },
      fill: { priceUsd: 0.00000377, amountToken: 265_252, amountUsd: 1, feeUsd: 0.003, txHash: null },
      slippageToleranceBps: 100,
      platformFeeUsd: 0.25,
      quotedAt: at,
      filledAt: at,
    });
    expect(feeSplitText(receipt)).toBe("Tocker $0.25 · venue $0.003");
    // The parts are the total the row prints in front of the label.
    expect(receipt.totalFeeUsd).toBeCloseTo(0.253, 9);
  });
});
