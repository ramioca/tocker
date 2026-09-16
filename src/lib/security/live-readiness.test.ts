import { describe, expect, it } from "vitest";
import { FIRST_TRADE_PRESET, evaluateFirstTradeRisk, withFirstTradePreset } from "./live-readiness";
import type { AgentConfig } from "@/db/schema";

function config(overrides: Partial<AgentConfig["risk"]> = {}, chains: AgentConfig["chains"] = ["base"]): AgentConfig {
  return {
    strategyPrompt: "buy low",
    dataSources: [],
    chains,
    universe: {
      discovery: ["trending"],
      minScore: 60,
      minLiquidityUsd: 25_000,
      minHolderCount: 200,
      minAgeMinutes: 30,
      maxAgeHours: null,
      maxTop10HolderPct: 40,
      maxBuyTaxPct: 5,
      requireMintRevoked: true,
      requireFreezeRevoked: true,
      blocklist: [],
    },
    risk: {
      maxTradeUsd: 2,
      maxDailyTrades: 1,
      maxPositionPct: 10,
      maxDataSpendUsdPerRun: 0.25,
      stopLossPct: 25,
      takeProfitPct: null,
      slippageBps: 100,
      trailingStopPct: null,
      maxHoldHours: null,
      exitScoreBelow: null,
      exitOnLiquidityDropPct: null,
      ...overrides,
    },
    execution: { mode: "auto", proposalTtlMinutes: 30 },
    schedule: { intervalMinutes: 60 },
    llm: { provider: "anthropic", model: "claude-sonnet-5", temperature: 0.2, maxSteps: 12 },
  };
}

describe("evaluateFirstTradeRisk", () => {
  it("passes the intended first-trade shape", () => {
    expect(evaluateFirstTradeRisk(config(), 2)).toEqual({ ok: true, problems: [] });
  });

  it("refuses more than one chain", () => {
    const verdict = evaluateFirstTradeRisk(config({}, ["base", "solana"]), 2);
    expect(verdict.ok).toBe(false);
    expect(verdict.problems.join(" ")).toMatch(/one chain/);
  });

  /** The cap the operator typed is the ceiling, even when it is below the preset. */
  it("refuses a config whose per-trade cap exceeds what the operator typed", () => {
    const verdict = evaluateFirstTradeRisk(config({ maxTradeUsd: 2 }), 1);
    expect(verdict.ok).toBe(false);
    expect(verdict.problems.join(" ")).toMatch(/cap of \$1/);
  });

  it("refuses a per-trade size above the first-trade ceiling", () => {
    expect(evaluateFirstTradeRisk(config({ maxTradeUsd: 50 }), 100).ok).toBe(false);
  });

  it("refuses more than one trade a day", () => {
    const verdict = evaluateFirstTradeRisk(config({ maxDailyTrades: 5 }), 2);
    expect(verdict.problems.join(" ")).toMatch(/trades a day/);
  });

  /** Without any exit rule the exit engine has nothing to enforce. */
  it("refuses a config with no exit rule at all", () => {
    const verdict = evaluateFirstTradeRisk(
      config({ stopLossPct: null, takeProfitPct: null, trailingStopPct: null }),
      2,
    );
    expect(verdict.problems.join(" ")).toMatch(/no stop loss/);
  });

  it("accepts a trailing stop alone as the exit rule", () => {
    const verdict = evaluateFirstTradeRisk(
      config({ stopLossPct: null, takeProfitPct: null, trailingStopPct: 15 }),
      2,
    );
    expect(verdict.ok).toBe(true);
  });

  it("refuses a zero or negative cap", () => {
    expect(evaluateFirstTradeRisk(config(), 0).ok).toBe(false);
  });
});

describe("withFirstTradePreset", () => {
  it("clamps an aggressive config into the first-trade shape", () => {
    const before = config({ maxTradeUsd: 500, maxDailyTrades: 20, maxPositionPct: 80 }, ["solana", "base"]);
    const after = withFirstTradePreset(before);

    expect(after.chains).toEqual(["solana"]);
    expect(after.risk.maxTradeUsd).toBe(FIRST_TRADE_PRESET.maxTradeUsd);
    expect(after.risk.maxDailyTrades).toBe(FIRST_TRADE_PRESET.maxDailyTrades);
    expect(after.risk.maxPositionPct).toBe(FIRST_TRADE_PRESET.maxPositionPct);
    expect(evaluateFirstTradeRisk(after, FIRST_TRADE_PRESET.maxTradeUsd).ok).toBe(true);
  });

  it("never loosens a config that is already tighter than the preset", () => {
    const before = config({ maxTradeUsd: 1, maxDailyTrades: 1, maxPositionPct: 5 });
    const after = withFirstTradePreset(before);
    expect(after.risk.maxTradeUsd).toBe(1);
    expect(after.risk.maxPositionPct).toBe(5);
  });

  it("gives a config with no floor under it a stop loss", () => {
    const after = withFirstTradePreset(config({ stopLossPct: null }));
    expect(after.risk.stopLossPct).toBe(25);
  });

  it("leaves an existing stop loss alone and changes nothing else", () => {
    const before = config({ stopLossPct: 12 });
    const after = withFirstTradePreset(before);
    expect(after.risk.stopLossPct).toBe(12);
    expect(after.strategyPrompt).toBe(before.strategyPrompt);
    expect(after.universe).toEqual(before.universe);
    expect(after.llm).toEqual(before.llm);
  });
});
