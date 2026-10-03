import { describe, expect, it } from "vitest";
import { DEFAULT_AGENT_CONFIG } from "@/lib/agent/config";
import { COINS } from "./coins";
import {
  SAMPLE_EVERY_MIN,
  SAMPLE_FLOOR,
  SAMPLE_ROWS,
  SAMPLE_STOP_PCT,
  SAMPLE_TAKE_PROFIT_PCT,
  SAMPLE_TRADE_USD,
  clearsFloor,
} from "./sample";

/** The sample agent runs on the defaults a new agent gets, so its numbers can't drift from the app's. */
describe("the landing's sample agent uses the real defaults", () => {
  it("matches DEFAULT_AGENT_CONFIG", () => {
    expect(SAMPLE_FLOOR).toBe(DEFAULT_AGENT_CONFIG.universe.minScore);
    expect(SAMPLE_TRADE_USD).toBe(DEFAULT_AGENT_CONFIG.risk.maxTradeUsd);
    expect(SAMPLE_STOP_PCT).toBe(DEFAULT_AGENT_CONFIG.risk.stopLossPct);
    expect(SAMPLE_TAKE_PROFIT_PCT).toBe(DEFAULT_AGENT_CONFIG.risk.takeProfitPct);
    expect(SAMPLE_EVERY_MIN).toBe(DEFAULT_AGENT_CONFIG.schedule.intervalMinutes);
    expect(DEFAULT_AGENT_CONFIG.execution.mode).toBe("approve");
  });

  it("shows two tokens that clear the floor and one that doesn't, each a known coin", () => {
    expect(SAMPLE_ROWS.filter((r) => clearsFloor(r.score))).toHaveLength(2);
    for (const r of SAMPLE_ROWS) expect(COINS[r.coin]).toBeDefined();
  });
});
