import { describe, expect, it } from "vitest";
import { DEFAULT_AGENT_CONFIG as C } from "@/lib/agent/config";
import { DEFAULT_ROWS, LANDING_DEFAULTS, MODE_WORDS } from "./defaults";

/** The Guardrails card quotes a new agent's defaults; the agent config is the truth. */
describe("the landing's defaults card", () => {
  it("quotes DEFAULT_AGENT_CONFIG", () => {
    expect(LANDING_DEFAULTS).toEqual({
      mode: C.execution.mode,
      intervalMinutes: C.schedule.intervalMinutes,
      chains: C.chains,
      dataSources: C.dataSources,
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
  });

  it("says what the default mode does, and starts on paper", () => {
    const mode = DEFAULT_ROWS.find(([k]) => k === "Mode")?.[1];
    expect(mode).toBe(`paper · ${MODE_WORDS[C.execution.mode]}`);
    expect(MODE_WORDS.approve).toBe("asks first");
  });

  it("names the default chains, then the opt-in, without a break inside the brackets", () => {
    const chains = DEFAULT_ROWS.find(([k]) => k === "Chains")?.[1] ?? "";
    expect(chains.startsWith("Solana")).toBe(true);
    expect(chains).toContain("(Base opt‑in)");
  });
});
