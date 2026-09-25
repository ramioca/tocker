import { describe, expect, it } from "vitest";
import { MAX_TRADE_LADDER, RISK_BOUNDS, ladderStops, nearestStopIndex } from "./types";

describe("max-trade ladder", () => {
  it("spans exactly the risk bounds", () => {
    expect(MAX_TRADE_LADDER[0]).toBe(RISK_BOUNDS.maxTradeUsd.min);
    expect(MAX_TRADE_LADDER.at(-1)).toBe(RISK_BOUNDS.maxTradeUsd.max);
  });

  it("keeps an on-ladder value as-is", () => {
    expect(ladderStops(MAX_TRADE_LADDER, 100)).toEqual(MAX_TRADE_LADDER);
  });

  it("adds an off-ladder value as its own stop, in order", () => {
    const stops = ladderStops(MAX_TRADE_LADDER, 400);
    expect(stops).toHaveLength(MAX_TRADE_LADDER.length + 1);
    expect(stops[nearestStopIndex(stops, 400)]).toBe(400);
    expect(stops.slice(7, 10)).toEqual([250, 400, 500]);
  });

  it("finds the nearest stop", () => {
    expect(MAX_TRADE_LADDER[nearestStopIndex(MAX_TRADE_LADDER, 30)]).toBe(25);
    expect(MAX_TRADE_LADDER[nearestStopIndex(MAX_TRADE_LADDER, 9_999)]).toBe(5_000);
  });
});
