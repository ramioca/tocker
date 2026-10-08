/**
 * The Costs group of the full receipt. What a fill was charged is a fact recorded with
 * the fill: the document prints that amount, whatever the fee is set to today.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildReceipt, type BuildReceiptInput } from "@/lib/trading/receipt";
import { TradeReceiptDetail } from "./trade-receipt";

const AT = new Date("2026-10-01T12:00:00Z");

function receipt(over: Partial<BuildReceiptInput>) {
  return buildReceipt({
    chain: "solana",
    side: "buy",
    symbol: "BONK",
    tokenAddress: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
    quote: { venue: "paper", priceUsd: 0.0000027, feeUsd: 0.006 },
    fill: { priceUsd: 0.0000027, amountToken: 740_740, amountUsd: 2, feeUsd: 0.006, txHash: null },
    slippageToleranceBps: 100,
    quotedAt: AT,
    filledAt: AT,
    ...over,
  });
}

/** The Costs group as a reader sees it: no tags, one space between words. */
function costs(data: ReturnType<typeof receipt>): string {
  const text = renderToStaticMarkup(createElement(TradeReceiptDetail, { receipt: data }))
    .replace(/<!-- -->/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");
  return text.slice(text.indexOf("Costs"), text.indexOf("Settlement"));
}

describe("the costs on a receipt", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("still shows the ten cents a fill was charged when the fee was flat", () => {
    // A $2 fill from before the fee became a share of the fill. At 0.5% it would be a
    // cent; it was charged a dime, and a dime is what the document says.
    vi.stubEnv("PLATFORM_FEE_BPS", "50");
    const old = receipt({ platformFeeUsd: 0.1 });
    expect(old.platformFeeUsd).toBe(0.1);
    expect(old.totalFeeUsd).toBeCloseTo(0.106, 9);
    const said = costs(old);
    expect(said).toContain("Tocker fee $0.10 Network fee");
    expect(said).toContain("Total $0.106");
    // No rate beside a recorded amount: today's is not what this fill was charged at.
    expect(said).not.toContain("%");
    expect(said).not.toContain("per fill");
  });

  it("prints a fee that is not whole cents as it was recorded, so the rows add up to the total", () => {
    // A $25 fill at 0.5% is twelve and a half cents. "$0.13" would be more than was charged.
    const fill = receipt({
      quote: { venue: "paper", priceUsd: 0.0000027, feeUsd: 0.075 },
      fill: { priceUsd: 0.0000027, amountToken: 9_259_259, amountUsd: 25, feeUsd: 0.075, txHash: null },
      platformFeeUsd: 0.125,
    });
    const said = costs(fill);
    expect(said).toContain("Venue fee $0.075");
    expect(said).toContain("Tocker fee $0.125 Network fee");
    expect(said).toContain("Total $0.20");
    // The amount is this fill's own. "per fill" after it would read as a fixed price.
    expect(said).not.toContain("per fill");
  });

  it("has no Tocker row for a fill that was charged nothing", () => {
    expect(costs(receipt({ platformFeeUsd: 0 }))).not.toContain("Tocker fee");
    expect(costs(receipt({}))).not.toContain("Tocker fee");
  });
});
