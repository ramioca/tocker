import { describe, expect, it } from "vitest";
import { MAX_DATA_SPEND_PER_RUN_USD } from "@/lib/x402/types";
import { DEFAULT_AGENT_CONFIG, RETIRED_DATA_SOURCE_IDS, parseAgentConfig } from "./config";

const withDataSpend = (usd: number) => ({
  ...DEFAULT_AGENT_CONFIG,
  risk: { ...DEFAULT_AGENT_CONFIG.risk, maxDataSpendUsdPerRun: usd },
});

describe("risk.maxDataSpendUsdPerRun", () => {
  it("leaves a budget under the ceiling alone", () => {
    expect(parseAgentConfig(withDataSpend(0)).risk.maxDataSpendUsdPerRun).toBe(0);
    expect(parseAgentConfig(withDataSpend(1)).risk.maxDataSpendUsdPerRun).toBe(1);
    expect(parseAgentConfig(withDataSpend(MAX_DATA_SPEND_PER_RUN_USD)).risk.maxDataSpendUsdPerRun).toBe(MAX_DATA_SPEND_PER_RUN_USD);
  });

  it("clamps a value above the ceiling instead of rejecting it", () => {
    expect(parseAgentConfig(withDataSpend(5.01)).risk.maxDataSpendUsdPerRun).toBe(MAX_DATA_SPEND_PER_RUN_USD);
    expect(parseAgentConfig(withDataSpend(100)).risk.maxDataSpendUsdPerRun).toBe(MAX_DATA_SPEND_PER_RUN_USD);
  });

  it("still rejects a value that was never a budget", () => {
    expect(() => parseAgentConfig(withDataSpend(-1))).toThrow();
    expect(() => parseAgentConfig(withDataSpend(100.01))).toThrow();
    expect(() => parseAgentConfig(withDataSpend(Number.NaN))).toThrow();
  });

  it("keeps the default inside the ceiling", () => {
    expect(DEFAULT_AGENT_CONFIG.risk.maxDataSpendUsdPerRun).toBeLessThanOrEqual(MAX_DATA_SPEND_PER_RUN_USD);
  });
});

describe("dataSources", () => {
  it("drops a retired source id on parse and keeps everything else in order", () => {
    const parsed = parseAgentConfig({ ...DEFAULT_AGENT_CONFIG, dataSources: ["bazaar", "x-search", "bazaar", "cmc-quotes"] });
    expect(parsed.dataSources).toEqual(["x-search", "cmc-quotes"]);
    expect(parseAgentConfig({ ...DEFAULT_AGENT_CONFIG, dataSources: ["bazaar"] }).dataSources).toEqual([]);
  });

  it("names no retired id in the default config", () => {
    expect(DEFAULT_AGENT_CONFIG.dataSources.filter((id) => RETIRED_DATA_SOURCE_IDS.includes(id))).toEqual([]);
  });
});
