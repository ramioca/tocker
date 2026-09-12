import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { setupTestDb } from "@/lib/agent/test-support";
import { computePaperCash, PaperExecutor, PAPER_FEE_BPS } from "./paper";
import { applyFillToPosition, EMPTY_POSITION } from "./positions";
import type { TradeRequest } from "./executor";

// The price path reads the tokens table. Use a throwaway in-memory database so the
// suite never touches (or depends on) the developer's ./.pglite.
beforeAll(async () => {
  await setupTestDb();
});

const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";

const request: TradeRequest = {
  chain: "solana",
  side: "buy",
  tokenId: `solana:${BONK}`,
  tokenAddress: BONK,
  symbol: "BONK",
  decimals: 5,
  amountUsd: 100,
  slippageBps: 100,
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** Stubs both price paths: Jupiter Ultra (routed) and Jupiter price v3 (mark). */
function stubPrice(pricePerToken: number): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/ultra/v1/order")) {
        const inUsdc = Number(new URL(url).searchParams.get("amount"));
        const outTokens = (inUsdc / 1e6 / pricePerToken) * 10 ** request.decimals;
        return new Response(
          JSON.stringify({ requestId: "req-1", transaction: null, inAmount: String(inUsdc), outAmount: String(Math.round(outTokens)) }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response("{}", { status: 404 });
    }),
  );
}

describe("computePaperCash", () => {
  it("returns the starting balance for an empty ledger", () => {
    expect(computePaperCash(10_000, [])).toBe(10_000);
  });

  it("subtracts buys and their fees", () => {
    expect(computePaperCash(10_000, [{ side: "buy", amountUsd: 100, feeUsd: 0.3 }])).toBeCloseTo(9_899.7, 6);
  });

  it("adds sells and still subtracts their fees", () => {
    expect(
      computePaperCash(10_000, [
        { side: "buy", amountUsd: 100, feeUsd: 0.3 },
        { side: "sell", amountUsd: 140, feeUsd: 0.42 },
      ]),
    ).toBeCloseTo(10_039.28, 6);
  });

  it("is a pure function of the ledger, not of ordering", () => {
    const ledger = [
      { side: "buy" as const, amountUsd: 50, feeUsd: 0.15 },
      { side: "sell" as const, amountUsd: 75, feeUsd: 0.225 },
      { side: "buy" as const, amountUsd: 20, feeUsd: 0.06 },
    ];
    const reversed = [...ledger].reverse();
    expect(computePaperCash(1_000, ledger)).toBeCloseTo(computePaperCash(1_000, reversed), 9);
  });
});

describe("PaperExecutor", () => {
  it("quotes at the routed price and charges 0.3%", async () => {
    stubPrice(0.000004);
    const executor = new PaperExecutor();
    const quote = await executor.quote(request);

    expect(quote.venue).toBe("paper");
    expect(quote.priceUsd).toBeCloseTo(0.000004, 12);
    expect(quote.amountToken).toBeCloseTo(100 / 0.000004, 0);
    expect(quote.feeUsd).toBeCloseTo((100 * PAPER_FEE_BPS) / 10_000, 9);
    expect(quote.feeUsd).toBeCloseTo(0.3, 9);
  });

  it("fills instantly at the quoted price with no tx hash", async () => {
    stubPrice(0.000004);
    const executor = new PaperExecutor();
    const quote = await executor.quote(request);
    const fill = await executor.execute(quote);

    expect(fill.status).toBe("filled");
    expect(fill.txHash).toBeNull();
    expect(fill.priceUsd).toBe(quote.priceUsd);
    expect(fill.amountToken).toBe(quote.amountToken);
    expect(fill.feeUsd).toBe(quote.feeUsd);
  });

  it("refuses to fill when nothing can price the token", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 503 })));
    const executor = new PaperExecutor();
    await expect(
      executor.quote({ ...request, tokenAddress: "UnknownMint111111111111111111111111111111", symbol: "NOPE" }),
    ).rejects.toThrow(/No price available/);
  });
});

describe("applyFillToPosition", () => {
  it("capitalises fees into the cost basis on a buy", () => {
    const next = applyFillToPosition(EMPTY_POSITION, { side: "buy", amountToken: 100, amountUsd: 100, feeUsd: 0.3 });
    expect(next.amountToken).toBe(100);
    expect(next.avgCostUsd).toBeCloseTo(1.003, 9);
    expect(next.realizedPnlUsd).toBe(0);
  });

  it("weights the average cost across two buys", () => {
    const first = applyFillToPosition(EMPTY_POSITION, { side: "buy", amountToken: 100, amountUsd: 100, feeUsd: 0 });
    const second = applyFillToPosition(first, { side: "buy", amountToken: 100, amountUsd: 300, feeUsd: 0 });
    expect(second.amountToken).toBe(200);
    expect(second.avgCostUsd).toBeCloseTo(2, 9);
  });

  it("realizes PnL on a sell and keeps the unit basis", () => {
    const held = applyFillToPosition(EMPTY_POSITION, { side: "buy", amountToken: 100, amountUsd: 100, feeUsd: 0 });
    const after = applyFillToPosition(held, { side: "sell", amountToken: 50, amountUsd: 75, feeUsd: 0.225 });
    expect(after.amountToken).toBe(50);
    expect(after.avgCostUsd).toBeCloseTo(1, 9);
    expect(after.realizedPnlUsd).toBeCloseTo(75 - 0.225 - 50, 9);
  });

  it("zeroes the basis when the position is fully closed", () => {
    const held = applyFillToPosition(EMPTY_POSITION, { side: "buy", amountToken: 10, amountUsd: 10, feeUsd: 0 });
    const closed = applyFillToPosition(held, { side: "sell", amountToken: 10, amountUsd: 12, feeUsd: 0 });
    expect(closed.amountToken).toBe(0);
    expect(closed.avgCostUsd).toBe(0);
    expect(closed.realizedPnlUsd).toBeCloseTo(2, 9);
  });

  it("clamps an oversized sell to the held amount", () => {
    const held = applyFillToPosition(EMPTY_POSITION, { side: "buy", amountToken: 10, amountUsd: 10, feeUsd: 0 });
    const closed = applyFillToPosition(held, { side: "sell", amountToken: 999, amountUsd: 12, feeUsd: 0 });
    expect(closed.amountToken).toBe(0);
  });
});
