import { describe, expect, it } from "vitest";
import { scoreTrend } from "./history";
import type { ScoreHistoryPoint } from "@/server/types";

const now = Date.parse("2026-09-22T12:00:00Z");
const point = (minutesAgo: number, total: number, priceUsd: number, holderCount: number): ScoreHistoryPoint => ({
  at: new Date(now - minutesAgo * 60_000).toISOString(),
  total,
  verdict: "candidate",
  priceUsd,
  liquidityUsd: 50_000,
  holderCount,
});

describe("scoreTrend", () => {
  it("is a first look when the only history is this tick's own write", () => {
    const trend = scoreTrend([point(1, 80, 1, 100)], { total: 80, priceUsd: 1, holderCount: 100, liquidityUsd: 50_000 }, now);
    expect(trend.velocity).toBe("first_look");
    expect(trend.previous).toBeNull();
  });

  it("reads rising when price and holders both grew since the last tick, and counts consecutive rises", () => {
    const history = [point(10, 70, 0.8, 80), point(5, 75, 0.9, 90), point(1, 84, 1.0, 100)];
    const trend = scoreTrend(history, { total: 84, priceUsd: 1.0, holderCount: 100, liquidityUsd: 55_000 }, now);
    expect(trend.velocity).toBe("rising");
    expect(trend.consecutiveRises).toBe(2);
    expect(trend.previous).toMatchObject({ minutesAgo: 5, totalDelta: 9, pricePct: 11.1, holdersDelta: 10, liquidityPct: 10 });
    expect(trend.readings.map((r) => r.minutesAgo)).toEqual([5, 10]);
  });

  it("reads falling when both shrink, flat when they disagree", () => {
    expect(scoreTrend([point(5, 80, 1.2, 120)], { total: 70, priceUsd: 1.0, holderCount: 110, liquidityUsd: null }, now).velocity).toBe("falling");
    expect(scoreTrend([point(5, 80, 1.2, 90)], { total: 82, priceUsd: 1.0, holderCount: 110, liquidityUsd: null }, now).velocity).toBe("flat");
  });
});
