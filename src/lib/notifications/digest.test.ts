import { describe, expect, it } from "vitest";
import { buildDigest, digestHref, fillTitle, receiptHref, utcDay, type DigestInput, type DigestTrade } from "./index";
import { buildReceipt } from "@/lib/trading/receipt";

function trade(overrides: Partial<DigestTrade> = {}): DigestTrade {
  return {
    side: "buy",
    symbol: "BONK",
    amountUsd: 100,
    feeUsd: 0.3,
    origin: "agent",
    exitReason: null,
    status: "filled",
    ...overrides,
  };
}

function digestInput(overrides: Partial<DigestInput> = {}): DigestInput {
  return {
    agentName: "Launch Sniper",
    agentSlug: "launch-sniper",
    day: "2026-09-15",
    trades: [],
    realizedPnlUsd: 0,
    equityUsd: 10_000,
    openingEquityUsd: 10_000,
    failedRuns: 0,
    ...overrides,
  };
}

describe("buildDigest", () => {
  it("stays silent on a day where nothing happened at all", () => {
    expect(buildDigest(digestInput())).toBeNull();
  });

  it("still speaks when the only thing that happened was a failure", () => {
    expect(buildDigest(digestInput({ failedRuns: 2 }))?.body).toContain("2 runs failed");
    expect(buildDigest(digestInput({ trades: [trade({ status: "failed" })] }))?.body).toContain(
      "1 trade failed to execute",
    );
  });

  it("counts fills, volume and fees", () => {
    const digest = buildDigest(
      digestInput({
        trades: [trade(), trade({ side: "sell", amountUsd: 140, feeUsd: 0.42 })],
        realizedPnlUsd: 39.28,
      }),
    );
    expect(digest?.title).toContain("2 trades today");
    expect(digest?.title).toContain("+$39.28");
    expect(digest?.body).toContain("1 buy, 1 sell");
    expect(digest?.body).toContain("$240.00 traded");
    expect(digest?.body).toContain("$0.72 in fees");
  });

  it("groups exits by the rule that fired, not just their number", () => {
    const digest = buildDigest(
      digestInput({
        trades: [
          trade({ side: "sell", origin: "guardian", exitReason: "stop_loss", symbol: "AAA" }),
          trade({ side: "sell", origin: "guardian", exitReason: "stop_loss", symbol: "BBB" }),
          trade({ side: "sell", origin: "guardian", exitReason: "take_profit", symbol: "CCC" }),
        ],
      }),
    );
    expect(digest?.body).toContain("stop loss × 2 (AAA, BBB)");
    expect(digest?.body).toContain("take profit × 1 (CCC)");
  });

  it("says so explicitly when the exit engine did nothing on a day that traded", () => {
    expect(buildDigest(digestInput({ trades: [trade()] }))?.body).toContain("no rule fired");
  });

  it("reports the day's equity move when it can compute one", () => {
    const up = buildDigest(digestInput({ trades: [trade()], equityUsd: 11_000, openingEquityUsd: 10_000 }));
    expect(up?.body).toContain("+10.00% on the day");
    const unknown = buildDigest(digestInput({ trades: [trade()], openingEquityUsd: null }));
    expect(unknown?.body).toContain("Equity $10000.00.");
    expect(unknown?.body).not.toContain("on the day");
  });

  it("carries the day in its href, which is what makes it one-per-day", () => {
    const digest = buildDigest(digestInput({ trades: [trade()] }));
    expect(digest?.href).toBe(digestHref("launch-sniper", "2026-09-15"));
    expect(digest?.href).toContain("?digest=2026-09-15");
  });

  it("never quotes anything from the strategy", () => {
    const digest = buildDigest(digestInput({ trades: [trade(), trade({ side: "sell", origin: "guardian", exitReason: "max_hold" })] }));
    const serialised = JSON.stringify(digest);
    for (const leak of ["minScore", "strategyPrompt", "dataSources", "universe", "blocklist", "threshold"]) {
      expect(serialised).not.toContain(leak);
    }
  });
});

describe("fill notifications", () => {
  const receipt = buildReceipt({
    chain: "solana",
    side: "buy",
    symbol: "BONK",
    tokenAddress: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
    quote: { venue: "paper", priceUsd: 0.000002, feeUsd: 0.3 },
    fill: { priceUsd: 0.000002, amountToken: 50_000_000, amountUsd: 100, feeUsd: 0.3, txHash: null },
    slippageToleranceBps: 100,
    score: null,
    quotedAt: new Date("2026-09-16T10:00:00Z"),
    filledAt: new Date("2026-09-16T10:00:00.900Z"),
  });

  it("names the agent, the side, the size and whether it was paper", () => {
    expect(fillTitle({ agentName: "Sniper", receipt })).toBe("Sniper bought $100.00 of BONK (paper)");
  });

  it("marks a manual order as the owner's own", () => {
    expect(fillTitle({ agentName: "Sniper", receipt, origin: "manual" })).toContain("(your manual order)");
  });

  it("links at the trade in the context of its token", () => {
    expect(receiptHref(receipt, "trade-1")).toBe(
      "/tokens/solana/DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263?trade=trade-1",
    );
  });
});

describe("utcDay", () => {
  it("is UTC, not local", () => {
    expect(utcDay(new Date("2026-09-16T23:59:59Z"))).toBe("2026-09-16");
    expect(utcDay(new Date("2026-09-17T00:00:00Z"))).toBe("2026-09-17");
  });
});
