import { describe, expect, it } from "vitest";
import { applyFill, computeEquity, pnlOverWindow, replayTrades, unrealized, winRate, windowSparkline, EMPTY_POSITION } from "./pnl";

const T = "solana:BONK";

describe("applyFill", () => {
  it("opens a position", () => {
    const r = applyFill(null, { side: "buy", amountToken: 10, priceUsd: 2 });
    expect(r.position.amountToken).toBe(10);
    expect(r.position.avgCostUsd).toBe(2);
    expect(r.cashDeltaUsd).toBe(-20);
    expect(r.realizedDeltaUsd).toBe(0);
  });

  it("folds buy fees into cost basis", () => {
    const r = applyFill(null, { side: "buy", amountToken: 10, priceUsd: 2, feeUsd: 1 });
    expect(r.position.avgCostUsd).toBeCloseTo(2.1);
    expect(r.cashDeltaUsd).toBe(-21);
  });

  it("weights the average cost across buys", () => {
    const a = applyFill(null, { side: "buy", amountToken: 10, priceUsd: 1 });
    const b = applyFill(a.position, { side: "buy", amountToken: 10, priceUsd: 3 });
    expect(b.position.amountToken).toBe(20);
    expect(b.position.avgCostUsd).toBe(2);
  });

  it("books realized pnl on a winning sell", () => {
    const open = applyFill(null, { side: "buy", amountToken: 10, priceUsd: 2 }).position;
    const r = applyFill(open, { side: "sell", amountToken: 4, priceUsd: 3 });
    expect(r.realizedDeltaUsd).toBeCloseTo(4);
    expect(r.position.realizedPnlUsd).toBeCloseTo(4);
    expect(r.position.amountToken).toBe(6);
    expect(r.position.avgCostUsd).toBe(2); // unchanged by a partial sell
    expect(r.cashDeltaUsd).toBeCloseTo(12);
  });

  it("books realized pnl on a losing sell, net of fees", () => {
    const open = applyFill(null, { side: "buy", amountToken: 10, priceUsd: 2 }).position;
    const r = applyFill(open, { side: "sell", amountToken: 10, priceUsd: 1.5, feeUsd: 1 });
    expect(r.realizedDeltaUsd).toBeCloseTo(-6);
    expect(r.cashDeltaUsd).toBeCloseTo(14);
  });

  it("flattens to zero and clears the cost basis on a full exit", () => {
    const open = applyFill(null, { side: "buy", amountToken: 3, priceUsd: 7 }).position;
    const r = applyFill(open, { side: "sell", amountToken: 3, priceUsd: 9 });
    expect(r.position.amountToken).toBe(0);
    expect(r.position.avgCostUsd).toBe(0);
  });

  it("caps sells at the held amount and never goes short", () => {
    const open = applyFill(null, { side: "buy", amountToken: 5, priceUsd: 1 }).position;
    const r = applyFill(open, { side: "sell", amountToken: 50, priceUsd: 2 });
    expect(r.filledAmountToken).toBe(5);
    expect(r.position.amountToken).toBe(0);
    expect(r.cashDeltaUsd).toBe(10);
  });

  it("is a no-op selling a position it does not hold", () => {
    const r = applyFill(EMPTY_POSITION, { side: "sell", amountToken: 5, priceUsd: 2 });
    expect(r.filledAmountToken).toBe(0);
    expect(r.cashDeltaUsd).toBe(0);
  });

  it("does not mutate the input position", () => {
    const pos = { amountToken: 10, avgCostUsd: 1, realizedPnlUsd: 0 };
    applyFill(pos, { side: "sell", amountToken: 5, priceUsd: 2 });
    expect(pos.amountToken).toBe(10);
  });
});

describe("computeEquity", () => {
  it("adds cash and marked positions", () => {
    const e = computeEquity({
      cash: 1000,
      positions: [{ tokenId: T, amountToken: 100, avgCostUsd: 1, realizedPnlUsd: 5 }],
      marks: { [T]: 1.5 },
    });
    expect(e.equityUsd).toBe(1150);
    expect(e.positionsValueUsd).toBe(150);
    expect(e.costBasisUsd).toBe(100);
    expect(e.unrealizedPnlUsd).toBe(50);
    expect(e.realizedPnlUsd).toBe(5);
    expect(e.unmarkedCount).toBe(0);
  });

  it("falls back to cost when a mark is missing", () => {
    const e = computeEquity({
      cash: 0,
      positions: [{ tokenId: T, amountToken: 10, avgCostUsd: 2 }],
      marks: {},
    });
    expect(e.equityUsd).toBe(20);
    expect(e.unrealizedPnlUsd).toBe(0);
    expect(e.unmarkedCount).toBe(1);
  });

  it("handles an empty portfolio", () => {
    expect(computeEquity({ cash: 500, positions: [], marks: {} }).equityUsd).toBe(500);
  });
});

describe("unrealized", () => {
  it("computes value and percent", () => {
    const u = unrealized(10, 2, 3);
    expect(u.valueUsd).toBe(30);
    expect(u.pnlUsd).toBe(10);
    expect(u.pnlPct).toBeCloseTo(50);
  });
  it("returns nulls without a mark", () => {
    expect(unrealized(10, 2, null).pnlUsd).toBeNull();
  });
});

describe("pnlOverWindow", () => {
  const now = new Date("2026-02-01T00:00:00Z");
  const day = (d: number, equityUsd: number) => ({
    at: new Date(now.getTime() - d * 86_400_000),
    equityUsd,
  });

  it("returns null with too little data", () => {
    expect(pnlOverWindow([], "7d", now)).toBeNull();
    expect(pnlOverWindow([day(1, 100)], "7d", now)).toBeNull();
  });

  it("measures the 7d window from the snapshot just before the cutoff", () => {
    const snaps = [day(30, 1000), day(10, 1200), day(6, 1500), day(0, 1800)];
    const r = pnlOverWindow(snaps, "7d", now)!;
    expect(r.startEquityUsd).toBe(1200);
    expect(r.endEquityUsd).toBe(1800);
    expect(r.pnlUsd).toBe(600);
    expect(r.pnlPct).toBeCloseTo(50);
  });

  it("measures all-time from the first snapshot", () => {
    const snaps = [day(30, 1000), day(0, 2000)];
    const r = pnlOverWindow(snaps, "all", now)!;
    expect(r.pnlUsd).toBe(1000);
    expect(r.pnlPct).toBeCloseTo(100);
  });

  it("reports negative returns", () => {
    const r = pnlOverWindow([day(20, 1000), day(0, 750)], "30d", now)!;
    expect(r.pnlPct).toBeCloseTo(-25);
  });

  it("sorts unordered input", () => {
    const r = pnlOverWindow([day(0, 2000), day(20, 1000)], "30d", now)!;
    expect(r.startEquityUsd).toBe(1000);
  });

  it("does not divide by zero", () => {
    const r = pnlOverWindow([day(20, 0), day(0, 100)], "30d", now)!;
    expect(r.pnlPct).toBe(0);
  });
});

describe("winRate", () => {
  const t = (side: "buy" | "sell", amountToken: number, priceUsd: number, i: number) => ({
    tokenId: T,
    side,
    amountToken,
    priceUsd,
    createdAt: new Date(2026, 0, 1, i),
  });

  it("is null before anything is closed", () => {
    expect(winRate([t("buy", 10, 1, 0)]).rate).toBeNull();
  });

  it("scores winners and losers", () => {
    const r = winRate([t("buy", 10, 1, 0), t("sell", 5, 2, 1), t("sell", 5, 0.5, 2)]);
    expect(r.closed).toBe(2);
    expect(r.wins).toBe(1);
    expect(r.losses).toBe(1);
    expect(r.rate).toBe(0.5);
    expect(r.realizedPnlUsd).toBeCloseTo(5 - 2.5);
  });

  it("keeps books per token", () => {
    const r = winRate([
      { tokenId: "a", side: "buy", amountToken: 1, priceUsd: 10, createdAt: 1 },
      { tokenId: "b", side: "buy", amountToken: 1, priceUsd: 100, createdAt: 2 },
      { tokenId: "a", side: "sell", amountToken: 1, priceUsd: 20, createdAt: 3 },
      { tokenId: "b", side: "sell", amountToken: 1, priceUsd: 50, createdAt: 4 },
    ]);
    expect(r.wins).toBe(1);
    expect(r.losses).toBe(1);
    expect(r.realizedPnlUsd).toBeCloseTo(-40);
  });

  it("ignores unfilled trades", () => {
    const r = winRate([
      { tokenId: T, side: "buy", amountToken: 10, priceUsd: 1, status: "filled", createdAt: 1 },
      { tokenId: T, side: "sell", amountToken: 10, priceUsd: 5, status: "failed", createdAt: 2 },
    ]);
    expect(r.closed).toBe(0);
    expect(r.rate).toBeNull();
  });
});

describe("replayTrades", () => {
  it("rebuilds cash and positions", () => {
    const { cashUsd, positions } = replayTrades(
      [
        { tokenId: T, side: "buy", amountToken: 100, priceUsd: 1, createdAt: 1 },
        { tokenId: T, side: "sell", amountToken: 50, priceUsd: 2, createdAt: 2 },
      ],
      1000,
    );
    expect(cashUsd).toBe(1000 - 100 + 100);
    expect(positions.get(T)!.amountToken).toBe(50);
    expect(positions.get(T)!.realizedPnlUsd).toBeCloseTo(50);
  });
});

describe("windowSparkline", () => {
  const now = new Date("2026-02-01T00:00:00Z");
  const at = (daysAgo: number, equityUsd: number) => ({ at: new Date(now.getTime() - daysAgo * 86_400_000), equityUsd });

  it("starts at the window's baseline, so the line and the PnL beside it cover one period", () => {
    // Down over 30 days, up over the last 7: the 7-day line must rise.
    const series = [at(30, 120), at(20, 110), at(8, 90), at(6, 92), at(3, 95), at(0, 99)];
    const week = windowSparkline(series, "7d", now);
    expect(week).toEqual([90, 92, 95, 99]);
    expect(week.at(-1)! > week[0]).toBe(true);
    expect(windowSparkline(series, "all", now)).toEqual([120, 110, 90, 92, 95, 99]);
  });

  it("keeps the last point of each slice when there are more points than it can draw", () => {
    const series = Array.from({ length: 2_000 }, (_, i) => at(7 - (7 * i) / 1_999, 100 + i));
    const line = windowSparkline(series, "7d", now, 30);
    expect(line.length).toBeLessThanOrEqual(30);
    expect(line[0]).toBe(100);
    expect(line.at(-1)).toBe(2_099);
  });

  it("is empty when there are not two points in the window", () => {
    expect(windowSparkline([], "7d", now)).toEqual([]);
    expect(windowSparkline([at(1, 100)], "7d", now)).toEqual([]);
  });
});
