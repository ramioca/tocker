import { describe, expect, it } from "vitest";
import { MAX_DATA_SPEND_PER_RUN_USD } from "@/lib/x402/types";
import {
  DEFAULT_AGENT_CONFIG,
  DEFAULT_MODELS,
  MAX_MODEL_ID,
  RETIRED_DATA_SOURCE_IDS,
  agentConfigSchema,
  parseAgentConfig,
} from "./config";

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

  it("refuses an id no registry entry could have", () => {
    expect(() => parseAgentConfig({ ...DEFAULT_AGENT_CONFIG, dataSources: ["x".repeat(65)] })).toThrow();
  });
});

const withModel = (model: string) => ({ ...DEFAULT_AGENT_CONFIG, llm: { ...DEFAULT_AGENT_CONFIG.llm, model } });

/** The model id is printed on every public card: it is an id, not a place for text. */
describe("llm.model", () => {
  it("accepts every id the builder offers, and the default", () => {
    const offered = Object.values(DEFAULT_MODELS).flat();
    expect(offered.length).toBeGreaterThan(0);
    for (const { id } of offered) expect(parseAgentConfig(withModel(id)).llm.model).toBe(id);
    expect(parseAgentConfig(DEFAULT_AGENT_CONFIG).llm.model).toBe(DEFAULT_AGENT_CONFIG.llm.model);
  });

  it("accepts the other shapes providers use", () => {
    for (const id of [
      "meta-llama/llama-3.3-70b-instruct:free",
      "openai/gpt-4o-2024-08-06",
      "ft:gpt-4o-mini-2024-07-18:acme::A1b2C3d4",
      "anthropic/claude-3.5-sonnet:beta",
      "o3",
    ]) {
      expect(parseAgentConfig(withModel(id)).llm.model).toBe(id);
    }
  });

  it("refuses text where an id belongs, with a sentence a person can act on", () => {
    for (const model of [
      "claude-opus (verified by Tocker)",
      "gpt-5 mini",
      "<b>gpt-5</b>",
      "-gpt-5",
      "gpt-5\nTop agent this week",
      "",
    ]) {
      expect(agentConfigSchema.safeParse(withModel(model)).success).toBe(false);
    }
    const spoof = agentConfigSchema.safeParse(withModel("claude-opus (verified by Tocker)"));
    expect(spoof.success ? null : spoof.error.issues[0]?.message).toBe("That does not look like a model id");
  });

  it("refuses an id longer than any real one, however it is spelled", () => {
    expect(parseAgentConfig(withModel("a".repeat(MAX_MODEL_ID))).llm.model).toHaveLength(MAX_MODEL_ID);
    const long = agentConfigSchema.safeParse(withModel("a".repeat(MAX_MODEL_ID + 1)));
    expect(long.success).toBe(false);
    expect(long.success ? null : long.error.issues[0]?.message).toBe("That does not look like a model id");
    expect(agentConfigSchema.safeParse(withModel("a".repeat(500_000))).success).toBe(false);
  });
});

describe("chains", () => {
  it("reads a chain named twice as one chain, in the order given", () => {
    expect(parseAgentConfig({ ...DEFAULT_AGENT_CONFIG, chains: ["solana", "solana"] }).chains).toEqual(["solana"]);
    expect(
      parseAgentConfig({ ...DEFAULT_AGENT_CONFIG, chains: ["base", "solana", "base", "solana", "base"] }).chains,
    ).toEqual(["base", "solana"]);
  });

  it("still needs at least one, and only chains that exist", () => {
    expect(() => parseAgentConfig({ ...DEFAULT_AGENT_CONFIG, chains: [] })).toThrow();
    expect(() => parseAgentConfig({ ...DEFAULT_AGENT_CONFIG, chains: ["ethereum"] })).toThrow();
  });
});

describe("universe.blocklist", () => {
  const withBlocked = (address: string) => ({
    ...DEFAULT_AGENT_CONFIG,
    universe: { ...DEFAULT_AGENT_CONFIG.universe, blocklist: [{ chain: "solana" as const, address, symbol: "X" }] },
  });

  it("takes an address of either chain and refuses one longer than any address", () => {
    const mint = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
    expect(parseAgentConfig(withBlocked(mint)).universe.blocklist[0]?.address).toBe(mint);
    expect(parseAgentConfig(withBlocked("0x4200000000000000000000000000000000000006")).universe.blocklist).toHaveLength(1);
    expect(() => parseAgentConfig(withBlocked("x".repeat(65)))).toThrow();
  });
});
