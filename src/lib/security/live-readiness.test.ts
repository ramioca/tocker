import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FIRST_TRADE_PRESET, evaluateFirstTradeRisk, simulateFirstTrade, withFirstTradePreset } from "./live-readiness";
import { dataChainsFor } from "@/lib/data-sources/registry";
import { DEFAULT_AGENT_CONFIG } from "@/lib/agent/config";
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
    expect(evaluateFirstTradeRisk(config(), 2)).toEqual({ ok: true, problems: [], cautions: [] });
  });

  it("allows more than one chain, with a caution", () => {
    const verdict = evaluateFirstTradeRisk(config({}, ["base", "solana"]), 2);
    expect(verdict.ok).toBe(true);
    expect(verdict.cautions.join(" ")).toMatch(/2 chains/);
  });

  it("refuses no chain at all", () => {
    expect(evaluateFirstTradeRisk(config({}, []), 2).ok).toBe(false);
  });

  /** The cap the operator typed is the ceiling, even when it is below the preset. */
  it("refuses a config whose per-trade cap exceeds what the operator typed", () => {
    const verdict = evaluateFirstTradeRisk(config({ maxTradeUsd: 2 }), 1);
    expect(verdict.ok).toBe(false);
    expect(verdict.problems.join(" ")).toMatch(/cap of \$1/);
  });

  /** The $2 preset is advice; the cap the operator typed is the rule. */
  it("allows a per-trade size above the preset when it is within the operator's cap, with a caution", () => {
    const verdict = evaluateFirstTradeRisk(config({ maxTradeUsd: 50 }), 100);
    expect(verdict.ok).toBe(true);
    expect(verdict.cautions.join(" ")).toMatch(/\$50/);
  });

  it("allows more than one trade a day, with a caution", () => {
    const verdict = evaluateFirstTradeRisk(config({ maxDailyTrades: 5 }), 2);
    expect(verdict.ok).toBe(true);
    expect(verdict.cautions.join(" ")).toMatch(/trades a day/);
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
    expect(evaluateFirstTradeRisk(after, FIRST_TRADE_PRESET.maxTradeUsd).ok).toBe(true);
  });

  /**
   * The preset used to clamp this to 10, which made every buy fail at the size it
   * recommends: $2 of a $10 wallet is 20%. It is the operator's call and it is not a
   * first-trade question; `simulateFirstTrade` is what catches an unworkable pair now.
   */
  it("leaves position sizing to the operator", () => {
    expect(withFirstTradePreset(config({ maxPositionPct: 80 })).risk.maxPositionPct).toBe(80);
    expect(withFirstTradePreset(config({ maxPositionPct: 25 })).risk.maxPositionPct).toBe(25);
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

/**
 * The check that replaced the `maxPositionPct` clamp. Every case here is a config the
 * old checklist called green while `place_trade` was going to refuse it.
 */
describe("simulateFirstTrade", () => {
  beforeEach(() => {
    // The fee is capitalised into the buy, so it decides whether a ticket the exact size
    // of the balance clears. Pin it rather than inheriting whatever the environment says.
    vi.stubEnv("PLATFORM_FEE_USD", "0.10");
  });
  afterEach(() => vi.unstubAllEnvs());

  /** The operator's exact scenario: $10 deposited, the $2 preset, the default 25% cap. */
  it("passes the $2 preset against the $10 the wizard tells you to deposit", async () => {
    const preset = withFirstTradePreset(config({ maxTradeUsd: 100, maxPositionPct: 25 }, ["solana"]));
    expect(await simulateFirstTrade(preset, 10)).toBeNull();
  });

  /** The bug this exists to catch: 2/10 = 20%, above a 10% cap. Rejected, silently, forever. */
  it("catches a position cap the funded balance cannot satisfy, in the guard's own words", async () => {
    const refusal = await simulateFirstTrade(config({ maxTradeUsd: 2, maxPositionPct: 10 }, ["solana"]), 10);
    expect(refusal).toMatch(/20\.0% of equity, above maxPositionPct 10%/);
    // And it says what it simulated, so the number is arguable rather than mysterious.
    expect(refusal).toMatch(/\$2\.00 buy against the \$10\.00/);
  });

  it("is happy with the same cap once the wallet is big enough for it", async () => {
    expect(await simulateFirstTrade(config({ maxTradeUsd: 2, maxPositionPct: 10 }, ["solana"]), 25)).toBeNull();
  });

  /** The platform fee is capitalised into the buy, so cash has to cover both. */
  it("catches a ticket that leaves nothing for the platform fee", async () => {
    const refusal = await simulateFirstTrade(config({ maxTradeUsd: 2, maxPositionPct: 100 }, ["solana"]), 2);
    expect(refusal).toMatch(/Insufficient cash/);
    expect(refusal).toMatch(/Tocker fee/);
  });

  it("names the chain the agent actually trades, not a default", async () => {
    // A guard refusal for a chain the agent has enabled can never be a chain mismatch.
    expect(await simulateFirstTrade(config({ maxPositionPct: 100 }, ["base"]), 10)).toBeNull();
    expect(await simulateFirstTrade(config({ maxPositionPct: 100 }, ["solana"]), 10)).toBeNull();
  });
});

/**
 * Which platform wallets a source list spends from. The readiness checklist and the
 * Platform card both hang off this, and it is the thing that was hard-coded to Base.
 */
describe("dataChainsFor", () => {
  it("returns Solana for a Solana-priced source", () => {
    expect(dataChainsFor(["deepnets-token-safety"])).toEqual(["solana"]);
    expect(dataChainsFor(["solenrich-launches"])).toEqual(["solana"]);
  });

  it("returns Base for a Base-priced source", () => {
    expect(dataChainsFor(["x-search"])).toEqual(["base"]);
    expect(dataChainsFor(["cmc-quotes", "nansen-smart-money"])).toEqual(["base"]);
  });

  /** The default list: this is the pair the operator has to fund, and it is not just Base. */
  it("returns both for the default source list", () => {
    expect(dataChainsFor(DEFAULT_AGENT_CONFIG.dataSources)).toEqual(["base", "solana"]);
  });

  it("drops ids that are not in the registry any more", () => {
    expect(dataChainsFor(["token-intel-sol", "rugmunch", "xquik-search"])).toEqual([]);
    expect(dataChainsFor(["x-search", "token-intel-sol"])).toEqual(["base"]);
  });

  it("is empty for an agent that buys no data", () => {
    expect(dataChainsFor([])).toEqual([]);
  });
});
