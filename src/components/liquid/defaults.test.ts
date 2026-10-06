import { describe, expect, it } from "vitest";
import { DEFAULT_AGENT_CONFIG as C } from "@/lib/agent/config";
import { DEFAULT_PLATFORM_FEE_USD } from "@/lib/platform/fee";
import { DEFAULT_ROWS, LANDING_DEFAULTS, MODE_WORDS, feeSentence } from "./defaults";

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

/** The FAQ said "a flat fee" and no amount; the amount is the fee module's, not the page's. */
describe("the landing's fee sentence", () => {
  it("states the fee the product charges, to the cent", () => {
    expect(feeSentence(DEFAULT_PLATFORM_FEE_USD)).toBe(
      ` What Tocker charges is a flat $${DEFAULT_PLATFORM_FEE_USD.toFixed(2)} per filled trade, buy or sell, never a percentage of its size.`,
    );
    expect(feeSentence(0.1)).toContain("a flat $0.10 per filled trade");
    expect(feeSentence(0.25)).toContain("a flat $0.25 per filled trade");
  });

  it("prints a sub-cent fee as it is set rather than rounding it to nothing", () => {
    expect(feeSentence(0.001)).toContain("a flat $0.001 per filled trade");
  });

  it("says nothing about a fee when there is none", () => {
    expect(feeSentence(0)).toBe("");
  });
});
