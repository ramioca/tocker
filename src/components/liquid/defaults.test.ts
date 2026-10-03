import { describe, expect, it } from "vitest";
import { DEFAULT_AGENT_CONFIG as C } from "@/lib/agent/config";
import { DEFAULT_ROWS, LANDING_DEFAULTS } from "./defaults";

/** The Guardrails card quotes a new agent's defaults; the agent config is the truth. */
describe("the landing's defaults card", () => {
  it("quotes DEFAULT_AGENT_CONFIG", () => {
    expect(LANDING_DEFAULTS).toEqual({
      mode: C.execution.mode,
      intervalMinutes: C.schedule.intervalMinutes,
      chains: C.chains,
      minScore: C.universe.minScore,
      maxTradeUsd: C.risk.maxTradeUsd,
      maxDailyTrades: C.risk.maxDailyTrades,
      stopLossPct: C.risk.stopLossPct,
      takeProfitPct: C.risk.takeProfitPct,
      slippageBps: C.risk.slippageBps,
      maxDataSpendUsdPerRun: C.risk.maxDataSpendUsdPerRun,
      minLiquidityUsd: C.universe.minLiquidityUsd,
      minAgeMinutes: C.universe.minAgeMinutes,
    });
  });

  it("prints an even number of rows, so the two-column card has no hole", () => {
    expect(DEFAULT_ROWS.length % 2).toBe(0);
    expect(DEFAULT_ROWS.find(([k]) => k === "Mode")?.[1]).toBe("paper · asks first");
  });
});
