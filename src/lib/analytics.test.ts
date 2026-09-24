import { describe, expect, it } from "vitest";
import {
  avgHoldHours,
  bandFor,
  calibration,
  calibrationSentence,
  closedSells,
  closedTrades,
  computeAnalytics,
  maxDrawdownPct,
  winRateOf,
  type AnalyticsFill,
} from "./analytics";
import { winRate } from "./pnl";

const HOUR = 3_600_000;
const T0 = Date.parse("2026-09-01T00:00:00.000Z");

let seq = 0;
function fill(over: Partial<AnalyticsFill> & Pick<AnalyticsFill, "side" | "amountToken" | "priceUsd">): AnalyticsFill {
  seq += 1;
  return {
    id: over.id ?? `t${seq}`,
    tokenId: over.tokenId ?? "solana:BONK",
    chain: over.chain ?? "solana",
    amountUsd: over.amountUsd ?? over.amountToken * over.priceUsd,
    feeUsd: over.feeUsd ?? 0,
    status: over.status ?? "filled",
    origin: over.origin ?? "agent",
    exitReason: over.exitReason ?? null,
    entryScore: over.entryScore ?? null,
    createdAt: over.createdAt ?? new Date(T0),
    ...over,
  };
}

describe("closedTrades (FIFO)", () => {
  it("closes the oldest lot first and keeps each lot's own entry price", () => {
    const closed = closedTrades([
      fill({ id: "b1", side: "buy", amountToken: 100, priceUsd: 1, entryScore: 85, createdAt: new Date(T0) }),
      fill({ id: "b2", side: "buy", amountToken: 100, priceUsd: 2, entryScore: 50, createdAt: new Date(T0 + HOUR) }),
      fill({ id: "s1", side: "sell", amountToken: 150, priceUsd: 3, createdAt: new Date(T0 + 3 * HOUR) }),
    ]);

    expect(closed).toHaveLength(2);
    // first slice: all 100 of the $1 lot
    expect(closed[0]).toMatchObject({ amountToken: 100, entryPriceUsd: 1, entryScore: 85 });
    expect(closed[0].realizedPnlUsd).toBeCloseTo(200, 6);
    // second slice: 50 of the $2 lot
    expect(closed[1]).toMatchObject({ amountToken: 50, entryPriceUsd: 2, entryScore: 50 });
    expect(closed[1].realizedPnlUsd).toBeCloseTo(50, 6);
  });

  it("measures hold time per lot, not per position", () => {
    const closed = closedTrades([
      fill({ side: "buy", amountToken: 10, priceUsd: 1, createdAt: new Date(T0) }),
      fill({ side: "buy", amountToken: 10, priceUsd: 1, createdAt: new Date(T0 + 10 * HOUR) }),
      fill({ side: "sell", amountToken: 20, priceUsd: 1.5, createdAt: new Date(T0 + 20 * HOUR) }),
    ]);
    expect(closed.map((c) => c.holdHours)).toEqual([20, 10]);
    // equal quantities → plain mean
    expect(avgHoldHours(closed)).toBeCloseTo(15, 6);
  });

  it("weights average hold time by quantity", () => {
    const closed = closedTrades([
      fill({ side: "buy", amountToken: 90, priceUsd: 1, createdAt: new Date(T0) }),
      fill({ side: "buy", amountToken: 10, priceUsd: 1, createdAt: new Date(T0 + 100 * HOUR) }),
      fill({ side: "sell", amountToken: 100, priceUsd: 1, createdAt: new Date(T0 + 100 * HOUR) }),
    ]);
    // 90 tokens held 100h, 10 tokens held 0h → 90h
    expect(avgHoldHours(closed)).toBeCloseTo(90, 6);
  });

  it("books fees on both legs, pro-rata on a partial exit", () => {
    const closed = closedTrades([
      fill({ side: "buy", amountToken: 100, priceUsd: 1, feeUsd: 10, createdAt: new Date(T0) }),
      fill({ side: "sell", amountToken: 50, priceUsd: 1, feeUsd: 4, createdAt: new Date(T0 + HOUR) }),
    ]);
    // entry cost 1.10/token on 50 tokens = 55; proceeds 50 - 4 fee = 46 → -9
    expect(closed[0].realizedPnlUsd).toBeCloseTo(-9, 6);
    expect(closed[0].returnPct).toBeCloseTo((-9 / 55) * 100, 6);
  });

  it("ignores a sell with nothing open behind it rather than inventing a 100% win", () => {
    expect(closedTrades([fill({ side: "sell", amountToken: 10, priceUsd: 5 })])).toEqual([]);
  });

  it("ignores fills that never filled", () => {
    const closed = closedTrades([
      fill({ side: "buy", amountToken: 10, priceUsd: 1, status: "rejected" }),
      fill({ side: "sell", amountToken: 10, priceUsd: 2, createdAt: new Date(T0 + HOUR) }),
    ]);
    expect(closed).toEqual([]);
  });

  it("keeps tokens in separate books", () => {
    const closed = closedTrades([
      fill({ tokenId: "solana:A", side: "buy", amountToken: 10, priceUsd: 1, createdAt: new Date(T0) }),
      fill({ tokenId: "base:B", side: "buy", amountToken: 10, priceUsd: 10, chain: "base", createdAt: new Date(T0) }),
      fill({ tokenId: "base:B", side: "sell", amountToken: 10, priceUsd: 20, chain: "base", createdAt: new Date(T0 + HOUR) }),
    ]);
    expect(closed).toHaveLength(1);
    expect(closed[0]).toMatchObject({ tokenId: "base:B", chain: "base" });
    expect(closed[0].realizedPnlUsd).toBeCloseTo(100, 6);
  });
});

describe("winRateOf", () => {
  it("scores one exit as one outcome however many lots it closed", () => {
    const closed = closedTrades([
      fill({ side: "buy", amountToken: 10, priceUsd: 1, createdAt: new Date(T0) }),
      fill({ side: "buy", amountToken: 10, priceUsd: 4, createdAt: new Date(T0 + HOUR) }),
      // one sell at $2: +10 on the first lot, -20 on the second → net loss, one loss
      fill({ id: "s", side: "sell", amountToken: 20, priceUsd: 2, createdAt: new Date(T0 + 2 * HOUR) }),
    ]);
    expect(closed).toHaveLength(2);
    expect(winRateOf(closed)).toEqual({ rate: 0, wins: 0, losses: 1, closed: 1 });
  });

  it("is null before anything has been closed", () => {
    expect(winRateOf([]).rate).toBeNull();
  });

  it("counts a mix", () => {
    const closed = closedTrades([
      fill({ tokenId: "a", side: "buy", amountToken: 1, priceUsd: 1, createdAt: new Date(T0) }),
      fill({ tokenId: "a", side: "sell", amountToken: 1, priceUsd: 2, createdAt: new Date(T0 + HOUR) }),
      fill({ tokenId: "b", side: "buy", amountToken: 1, priceUsd: 1, createdAt: new Date(T0) }),
      fill({ tokenId: "b", side: "sell", amountToken: 1, priceUsd: 0.5, createdAt: new Date(T0 + HOUR) }),
    ]);
    expect(winRateOf(closed)).toMatchObject({ wins: 1, losses: 1, closed: 2 });
    expect(winRateOf(closed).rate).toBeCloseTo(0.5, 6);
  });
});

describe("bandFor", () => {
  it("uses the SPEC bands, upper-exclusive", () => {
    expect(bandFor(0)).toBe("0-39");
    expect(bandFor(39.9)).toBe("0-39");
    expect(bandFor(40)).toBe("40-59");
    expect(bandFor(59.9)).toBe("40-59");
    expect(bandFor(60)).toBe("60-79");
    expect(bandFor(79.9)).toBe("60-79");
    expect(bandFor(80)).toBe("80-100");
    expect(bandFor(100)).toBe("80-100");
  });
});

describe("calibration", () => {
  const closed = closedTrades([
    // an 85 that doubled
    fill({ tokenId: "a", side: "buy", amountToken: 10, priceUsd: 1, entryScore: 85, createdAt: new Date(T0) }),
    fill({ tokenId: "a", side: "sell", amountToken: 10, priceUsd: 2, createdAt: new Date(T0 + HOUR) }),
    // a 45 that halved
    fill({ tokenId: "b", side: "buy", amountToken: 10, priceUsd: 1, entryScore: 45, createdAt: new Date(T0) }),
    fill({ tokenId: "b", side: "sell", amountToken: 10, priceUsd: 0.5, createdAt: new Date(T0 + HOUR) }),
    // an unscored legacy row
    fill({ tokenId: "c", side: "buy", amountToken: 10, priceUsd: 1, entryScore: null, createdAt: new Date(T0) }),
    fill({ tokenId: "c", side: "sell", amountToken: 10, priceUsd: 3, createdAt: new Date(T0 + HOUR) }),
  ]);

  it("buckets realized return by the score at entry", () => {
    const bands = calibration(closed);
    const strong = bands.find((b) => b.band === "80-100")!;
    const watch = bands.find((b) => b.band === "40-59")!;
    expect(strong.trades).toBe(1);
    expect(strong.avgReturnPct).toBeCloseTo(100, 6);
    expect(strong.totalPnlUsd).toBeCloseTo(10, 6);
    expect(watch.trades).toBe(1);
    expect(watch.avgReturnPct).toBeCloseTo(-50, 6);
  });

  it("leaves a round trip with no entry score out entirely", () => {
    const bands = calibration(closed);
    expect(bands.reduce((n, b) => n + b.trades, 0)).toBe(2);
    // The +200% unscored trade must not inflate the bottom band.
    expect(bands.find((b) => b.band === "0-39")!.trades).toBe(0);
  });

  it("always returns all four bands, empty ones included", () => {
    expect(calibration([]).map((b) => b.band)).toEqual(["0-39", "40-59", "60-79", "80-100"]);
    expect(calibration([]).every((b) => b.trades === 0 && b.avgReturnPct === null)).toBe(true);
  });

  it("writes the operator's sentence from the best and worst populated band", () => {
    const sentence = calibrationSentence(calibration(closed));
    expect(sentence).toMatch(/^Your 80-100 picks averaged \+100\.0%/);
    expect(sentence).toContain("40-59");
    expect(sentence).toMatch(/lost \d/);
    expect(sentence).not.toContain("lost −");
  });

  it("addresses a visitor as the agent, not as its owner", () => {
    const sentence = calibrationSentence(calibration(closed), { owner: false });
    expect(sentence).toMatch(/^This agent's 80-100 picks/);
  });

  it("has no sentence with nothing closed", () => {
    expect(calibrationSentence(calibration([]))).toBeNull();
  });
});

describe("maxDrawdownPct", () => {
  it("measures the deepest peak-to-trough fall", () => {
    const points = [100, 120, 90, 110, 60, 80].map((equityUsd, i) => ({ at: T0 + i * HOUR, equityUsd }));
    // peak 120 → trough 60 = 50%
    expect(maxDrawdownPct(points)).toBeCloseTo(50, 6);
  });

  it("is zero for a curve that only rises", () => {
    expect(maxDrawdownPct([100, 110, 120].map((equityUsd, i) => ({ at: T0 + i * HOUR, equityUsd })))).toBe(0);
  });

  it("is null without two points", () => {
    expect(maxDrawdownPct([])).toBeNull();
    expect(maxDrawdownPct([{ at: T0, equityUsd: 100 }])).toBeNull();
  });

  it("sorts unordered snapshots before measuring", () => {
    const points = [
      { at: T0 + 2 * HOUR, equityUsd: 50 },
      { at: T0, equityUsd: 100 },
      { at: T0 + HOUR, equityUsd: 200 },
    ];
    expect(maxDrawdownPct(points)).toBeCloseTo(75, 6);
  });
});

describe("computeAnalytics", () => {
  const now = T0 + 40 * 24 * HOUR;
  const fills: AnalyticsFill[] = [
    // closed 35 days ago — inside "all" and "30d"? no: 35 > 30
    fill({ tokenId: "a", side: "buy", amountToken: 10, priceUsd: 1, entryScore: 90, createdAt: new Date(now - 38 * 24 * HOUR) }),
    fill({ id: "old-sell", tokenId: "a", side: "sell", amountToken: 10, priceUsd: 2, createdAt: new Date(now - 35 * 24 * HOUR) }),
    // closed 3 days ago, opened 20 days ago
    fill({ tokenId: "b", side: "buy", amountToken: 10, priceUsd: 2, entryScore: 70, createdAt: new Date(now - 20 * 24 * HOUR) }),
    fill({
      id: "recent-sell",
      tokenId: "b",
      side: "sell",
      amountToken: 10,
      priceUsd: 1,
      exitReason: "stop_loss",
      createdAt: new Date(now - 3 * 24 * HOUR),
    }),
  ];

  it("windows by the exit, not the entry", () => {
    const week = computeAnalytics({ agentId: "a1", window: "7d", fills, equity: [], unrealizedPnlUsd: 0, dataSpendUsd: 0, now });
    expect(week.closed).toHaveLength(1);
    expect(week.closed[0].sellId).toBe("recent-sell");
    // the position was opened 17 days before the window opened and still counts
    expect(week.closed[0].holdHours).toBeCloseTo(17 * 24, 6);
    expect(week.realizedPnlUsd).toBeCloseTo(-10, 6);
  });

  it("includes everything over all time", () => {
    const all = computeAnalytics({ agentId: "a1", window: "all", fills, equity: [], unrealizedPnlUsd: 0, dataSpendUsd: 0, now });
    expect(all.closed).toHaveLength(2);
    expect(all.realizedPnlUsd).toBeCloseTo(0, 6);
    expect(all.winRate).toBeCloseTo(0.5, 6);
  });

  it("names the best and worst exit, and never the same row twice", () => {
    const all = computeAnalytics({ agentId: "a1", window: "all", fills, equity: [], unrealizedPnlUsd: 0, dataSpendUsd: 0, now });
    expect(all.bestTradeId).toBe("old-sell");
    expect(all.worstTradeId).toBe("recent-sell");

    const one = computeAnalytics({ agentId: "a1", window: "7d", fills, equity: [], unrealizedPnlUsd: 0, dataSpendUsd: 0, now });
    expect(one.bestTradeId).toBe("recent-sell");
    expect(one.worstTradeId).toBeNull();
  });

  it("splits by chain, origin and exit reason", () => {
    const all = computeAnalytics({ agentId: "a1", window: "all", fills, equity: [], unrealizedPnlUsd: 0, dataSpendUsd: 0, now });
    expect(all.byChain).toEqual([{ chain: "solana", trades: 2, pnlUsd: 0 }]);
    expect(all.byOrigin).toEqual([{ origin: "agent", trades: 2, pnlUsd: 0 }]);
    expect(all.exits).toEqual([{ reason: "stop_loss", count: 1, pnlUsd: -10 }]);
  });

  it("reports no exits at all before the exit engine has fired", () => {
    const noExits = computeAnalytics({
      agentId: "a1",
      window: "all",
      fills: fills.map((f) => ({ ...f, exitReason: null })),
      equity: [],
      unrealizedPnlUsd: 0,
      dataSpendUsd: 0,
      now,
    });
    expect(noExits.exits).toEqual([]);
  });

  it("passes unrealized PnL and data spend through untouched", () => {
    const out = computeAnalytics({
      agentId: "a1",
      window: "30d",
      fills,
      equity: [],
      unrealizedPnlUsd: 42.5,
      dataSpendUsd: 0.37,
      now,
    });
    expect(out.unrealizedPnlUsd).toBeCloseTo(42.5, 6);
    expect(out.dataSpendUsd).toBeCloseTo(0.37, 6);
    expect(out.maxDrawdownPct).toBeNull();
  });
});

describe("headline numbers agree with the average-cost ledger", () => {
  // Buy 10 @ $1, buy 10 @ $3, sell 10 @ $2.50, and 10 are still open. FIFO books the
  // sell against the $1 lot (+$15, a win); average cost ($2) books it at +$5. Both are
  // "right", but the stat card, the positions table and the unrealized number handed
  // in are average cost, and a Performance tab on FIFO printed a different realized
  // total and win rate for the same agent.
  const now = T0 + 10 * 24 * HOUR;
  const fills: AnalyticsFill[] = [
    fill({ tokenId: "x", side: "buy", amountToken: 10, priceUsd: 1, feeUsd: 0.1, createdAt: new Date(T0) }),
    fill({ tokenId: "x", side: "buy", amountToken: 10, priceUsd: 3, feeUsd: 0.1, createdAt: new Date(T0 + HOUR) }),
    fill({ id: "part", tokenId: "x", side: "sell", amountToken: 10, priceUsd: 2.5, feeUsd: 0.1, createdAt: new Date(T0 + 2 * HOUR) }),
    fill({ tokenId: "y", side: "buy", amountToken: 5, priceUsd: 2, createdAt: new Date(T0) }),
    fill({ id: "loss", tokenId: "y", side: "sell", amountToken: 5, priceUsd: 1, createdAt: new Date(T0 + 3 * HOUR) }),
  ];

  it("books one row per exit at the weighted-average basis", () => {
    const sells = closedSells(fills);
    expect(sells.map((s) => s.sellId)).toEqual(["part", "loss"]);
    // avg cost (10 + 0.1 + 30 + 0.1) / 20 = 2.01 → 10 × (2.5 − 2.01) − 0.1
    expect(sells[0].realizedPnlUsd).toBeCloseTo(4.8, 6);
    expect(sells[1].realizedPnlUsd).toBeCloseTo(-5, 6);
  });

  it("reports the same realized total and win rate as lib/pnl", () => {
    const out = computeAnalytics({ agentId: "a", window: "all", fills, equity: [], unrealizedPnlUsd: 0, dataSpendUsd: 0, now });
    const ledger = winRate(fills);
    expect(out.realizedPnlUsd).toBeCloseTo(ledger.realizedPnlUsd, 6);
    expect(out.winRate).toBe(ledger.rate);
    expect(out.byChain).toEqual([{ chain: "solana", trades: 2, pnlUsd: expect.closeTo(-0.2, 6) }]);
  });

  it("still attributes calibration and hold time to the FIFO lot that was closed", () => {
    const out = computeAnalytics({ agentId: "a", window: "all", fills, equity: [], unrealizedPnlUsd: 0, dataSpendUsd: 0, now });
    const part = out.closed.filter((c) => c.sellId === "part");
    expect(part).toHaveLength(1);
    expect(part[0].entryPriceUsd).toBe(1);
    expect(part[0].holdHours).toBeCloseTo(2, 6);
  });
});
