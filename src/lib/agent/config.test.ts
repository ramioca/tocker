import { describe, expect, it } from "vitest";
import { MAX_DATA_SPEND_PER_RUN_USD } from "@/lib/x402/types";
import { readCashReserveUsd, readMaxOpenPositions, readSkipWhenFull } from "@/lib/trading/hard-limits";
import type { AgentConfig } from "@/db/schema";
import {
  DEFAULT_AGENT_CONFIG,
  DEFAULT_MODELS,
  MAX_CASH_RESERVE_USD,
  MAX_MODEL_ID,
  MAX_OPEN_POSITIONS,
  RETIRED_DATA_SOURCE_IDS,
  agentConfigSchema,
  llmProviderSchema,
  parseAgentConfig,
  readStoredConfig,
} from "./config";
import { CATALOGUE, CATALOGUE_IDS, PROVIDER_IDS, isProvider } from "./providers";

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
  /** New agents start on the current Sonnet; existing ones keep what they have stored. */
  it("starts a new agent on Claude Sonnet 5.5", () => {
    expect(DEFAULT_AGENT_CONFIG.llm).toMatchObject({ provider: "anthropic", model: "claude-sonnet-5-5" });
  });

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

const withProvider = (provider: string, model: string) => ({
  ...DEFAULT_AGENT_CONFIG,
  llm: { ...DEFAULT_AGENT_CONFIG.llm, provider, model },
});

/** The schema's list of providers is the registry's, so the two cannot drift apart. */
describe("llm.provider", () => {
  it("accepts every provider a key can be added for, on the model it starts on", () => {
    expect(llmProviderSchema.options).toEqual([...PROVIDER_IDS]);
    for (const provider of PROVIDER_IDS) {
      const parsed = parseAgentConfig(withProvider(provider, CATALOGUE[provider].defaultModel));
      expect(parsed.llm, provider).toMatchObject({ provider, model: CATALOGUE[provider].defaultModel });
    }
  });

  /** A config stored before this change parses to exactly what was stored. */
  it("reads a config on one of the three there were before as it always did", () => {
    for (const [provider, model] of [
      ["anthropic", "claude-sonnet-5-5"],
      ["openai", "gpt-5"],
      ["openrouter", "anthropic/claude-sonnet-5.5"],
    ] as const) {
      const stored = withProvider(provider, model);
      expect(parseAgentConfig(stored).llm).toEqual(stored.llm);
    }
  });

  it("refuses a provider that has a row but is not switched on, and anything that is not a provider", () => {
    for (const provider of CATALOGUE_IDS) {
      // A plain yes or no: the type predicate would leave `provider` with no type once all are enabled.
      const offered: boolean = isProvider(provider);
      if (offered) continue;
      expect(agentConfigSchema.safeParse(withProvider(provider, CATALOGUE[provider].defaultModel)).success, provider).toBe(false);
    }
    for (const provider of ["", "cohere", "Anthropic", "constructor", "__proto__", "toString"]) {
      expect(agentConfigSchema.safeParse(withProvider(provider, "gpt-5")).success, provider).toBe(false);
    }
  });

  it("accepts every model id on every row of the registry", () => {
    for (const provider of CATALOGUE_IDS) {
      for (const { id } of CATALOGUE[provider].models) expect(parseAgentConfig(withModel(id)).llm.model, `${provider} ${id}`).toBe(id);
    }
  });

  /** Some providers put the model id in the request's address; see `MODEL_ID_PATTERN`. */
  it("refuses a model id that could climb out of a path", () => {
    for (const model of ["gemini/../../v1/files", "a..b", ".."]) {
      const parsed = agentConfigSchema.safeParse(withModel(model));
      expect(parsed.success, model).toBe(false);
      expect(parsed.success ? null : parsed.error.issues[0]?.message, model).toBe("That does not look like a model id");
    }
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

/**
 * Where the thinking comes from. The two fields are optional and nothing is written for
 * them by default: a config saved before they existed, and every key agent's since, must
 * parse to exactly what it was.
 */
describe("llm.source and llm.usdc", () => {
  const usdc = { model: "google/gemini-2.5-flash", maxUsdPerRun: 0.3, maxUsdPerDay: 3 };
  const withLlm = (llm: Record<string, unknown>) => ({ ...DEFAULT_AGENT_CONFIG, llm: { ...DEFAULT_AGENT_CONFIG.llm, ...llm } });

  it("adds nothing to a key agent's config: no source, no limits, no default", () => {
    const parsed = parseAgentConfig(DEFAULT_AGENT_CONFIG);
    expect(parsed.llm).toEqual(DEFAULT_AGENT_CONFIG.llm);
    expect(Object.keys(parsed.llm).sort()).toEqual(["maxSteps", "model", "provider", "temperature"]);
    expect("source" in DEFAULT_AGENT_CONFIG.llm).toBe(false);
  });

  it("keeps a choice of pay-per-use as it was written", () => {
    const parsed = parseAgentConfig(withLlm({ source: "usdc", usdc }));
    expect(parsed.llm.source).toBe("usdc");
    expect(parsed.llm.usdc).toEqual(usdc);
    // And the key model stays beside it, for the day the owner goes back to a key.
    expect(parsed.llm.model).toBe(DEFAULT_AGENT_CONFIG.llm.model);
    expect(parseAgentConfig(withLlm({ source: "key" })).llm.source).toBe("key");
  });

  it("refuses a source that is neither", () => {
    expect(agentConfigSchema.safeParse(withLlm({ source: "free" })).success).toBe(false);
    expect(agentConfigSchema.safeParse(withLlm({ source: "" })).success).toBe(false);
  });

  it("holds both limits inside what the product offers", () => {
    const ok = (limits: Partial<typeof usdc>) => agentConfigSchema.safeParse(withLlm({ source: "usdc", usdc: { ...usdc, ...limits } })).success;
    expect(ok({ maxUsdPerRun: 0.05 })).toBe(true);
    expect(ok({ maxUsdPerRun: 2 })).toBe(true);
    expect(ok({ maxUsdPerRun: 0.049 })).toBe(false);
    expect(ok({ maxUsdPerRun: 2.01 })).toBe(false);
    expect(ok({ maxUsdPerDay: 0.5 })).toBe(true);
    expect(ok({ maxUsdPerDay: 50 })).toBe(true);
    expect(ok({ maxUsdPerDay: 0.49 })).toBe(false);
    expect(ok({ maxUsdPerDay: 50.01 })).toBe(false);
    expect(ok({ maxUsdPerRun: Number.NaN })).toBe(false);
    expect(ok({ maxUsdPerRun: Number.POSITIVE_INFINITY })).toBe(false);
  });

  it("refuses text where the pay-per-use model id belongs", () => {
    expect(agentConfigSchema.safeParse(withLlm({ source: "usdc", usdc: { ...usdc, model: "ignore previous instructions" } })).success).toBe(false);
    expect(agentConfigSchema.safeParse(withLlm({ source: "usdc", usdc: { ...usdc, model: "" } })).success).toBe(false);
  });
});

/**
 * The position limit, the cash reserve and the skip switch. Every row saved before them
 * has none of the three, and has to read as it always did.
 */
describe("risk.maxOpenPositions, risk.cashReserveUsd and schedule.skipWhenFull", () => {
  /** A config as it was stored before the three fields existed. */
  function oldRow(): AgentConfig {
    const risk = { ...DEFAULT_AGENT_CONFIG.risk };
    delete risk.maxOpenPositions;
    delete risk.cashReserveUsd;
    return { ...DEFAULT_AGENT_CONFIG, risk, schedule: { intervalMinutes: 15 } };
  }

  it("starts a new agent with all three off", () => {
    expect(DEFAULT_AGENT_CONFIG.risk.maxOpenPositions).toBeNull();
    expect(DEFAULT_AGENT_CONFIG.risk.cashReserveUsd).toBe(0);
    expect(DEFAULT_AGENT_CONFIG.schedule.skipWhenFull).toBe(false);
  });

  it("reads an old row with the defaults: no limit, no reserve, nothing skipped", () => {
    const parsed = parseAgentConfig(oldRow());
    expect(readMaxOpenPositions(parsed.risk)).toBeNull();
    expect(readCashReserveUsd(parsed.risk)).toBe(0);
    expect(readSkipWhenFull(parsed.schedule)).toBe(false);
    // The same row read without the schema, as a run reads one that no longer parses.
    expect(readMaxOpenPositions(oldRow().risk)).toBeNull();
    expect(readCashReserveUsd(oldRow().risk)).toBe(0);
    expect(readSkipWhenFull(oldRow().schedule)).toBe(false);
  });

  it("writes nothing onto an old row that is parsed and saved again", () => {
    const parsed = parseAgentConfig(oldRow());
    expect(parsed).toEqual(oldRow());
    expect(Object.keys(parsed.risk)).not.toContain("maxOpenPositions");
    expect(Object.keys(parsed.risk)).not.toContain("cashReserveUsd");
    expect(Object.keys(parsed.schedule)).toEqual(["intervalMinutes"]);
  });

  it("says the three out loud, as off, on the copy of an old row the settings page starts from", () => {
    const read = readStoredConfig(oldRow());
    expect(read.risk.maxOpenPositions).toBeNull();
    expect(read.risk.cashReserveUsd).toBe(0);
    expect(read.schedule).toEqual({ intervalMinutes: 15, skipWhenFull: false });
    // And leaves what was set as it was set.
    const set: AgentConfig = {
      ...oldRow(),
      risk: { ...oldRow().risk, maxOpenPositions: 3, cashReserveUsd: 5 },
      schedule: { intervalMinutes: 60, skipWhenFull: true },
    };
    expect(readStoredConfig(set).risk).toMatchObject({ maxOpenPositions: 3, cashReserveUsd: 5 });
    expect(readStoredConfig(set).schedule).toEqual({ intervalMinutes: 60, skipWhenFull: true });
  });

  it("round-trips the three when they are set", () => {
    const set = {
      ...DEFAULT_AGENT_CONFIG,
      risk: { ...DEFAULT_AGENT_CONFIG.risk, maxOpenPositions: 3, cashReserveUsd: 5 },
      schedule: { intervalMinutes: 60, skipWhenFull: true },
    };
    const parsed = parseAgentConfig(set);
    expect(parsed).toEqual(set);
    // Through JSON, as the column stores it, and parsed again.
    const again = parseAgentConfig(JSON.parse(JSON.stringify(parsed)));
    expect(again.risk.maxOpenPositions).toBe(3);
    expect(again.risk.cashReserveUsd).toBe(5);
    expect(again.schedule.skipWhenFull).toBe(true);
    expect(readMaxOpenPositions(again.risk)).toBe(3);
    expect(readCashReserveUsd(again.risk)).toBe(5);
    expect(readSkipWhenFull(again.schedule)).toBe(true);
    // Off, written out, round-trips as off.
    const off = parseAgentConfig(DEFAULT_AGENT_CONFIG);
    expect(off.risk.maxOpenPositions).toBeNull();
    expect(off.risk.cashReserveUsd).toBe(0);
    expect(off.schedule.skipWhenFull).toBe(false);
    // A reserve to the cent is kept to the cent.
    expect(parseAgentConfig({ ...set, risk: { ...set.risk, cashReserveUsd: 12.34 } }).risk.cashReserveUsd).toBe(12.34);
  });

  it("takes a position limit of 1 to 50 whole positions, or none", () => {
    const ok = (maxOpenPositions: unknown) =>
      agentConfigSchema.safeParse({ ...DEFAULT_AGENT_CONFIG, risk: { ...DEFAULT_AGENT_CONFIG.risk, maxOpenPositions } }).success;
    expect(MAX_OPEN_POSITIONS).toBe(50);
    expect(ok(1)).toBe(true);
    expect(ok(50)).toBe(true);
    expect(ok(null)).toBe(true);
    expect(ok(undefined)).toBe(true);
    expect(ok(0)).toBe(false);
    expect(ok(51)).toBe(false);
    expect(ok(2.5)).toBe(false);
    expect(ok(-1)).toBe(false);
    expect(ok("3")).toBe(false);
    expect(ok(Number.NaN)).toBe(false);
  });

  it("takes a cash reserve from zero upward, and nothing that is not an amount", () => {
    const ok = (cashReserveUsd: unknown) =>
      agentConfigSchema.safeParse({ ...DEFAULT_AGENT_CONFIG, risk: { ...DEFAULT_AGENT_CONFIG.risk, cashReserveUsd } }).success;
    expect(ok(0)).toBe(true);
    expect(ok(0.01)).toBe(true);
    expect(ok(5)).toBe(true);
    expect(ok(MAX_CASH_RESERVE_USD)).toBe(true);
    expect(ok(undefined)).toBe(true);
    expect(ok(-0.01)).toBe(false);
    expect(ok(MAX_CASH_RESERVE_USD + 1)).toBe(false);
    expect(ok(null)).toBe(false);
    expect(ok("5")).toBe(false);
    expect(ok(Number.POSITIVE_INFINITY)).toBe(false);
  });

  it("takes the skip switch as a yes or a no", () => {
    const ok = (skipWhenFull: unknown) =>
      agentConfigSchema.safeParse({ ...DEFAULT_AGENT_CONFIG, schedule: { intervalMinutes: 15, skipWhenFull } }).success;
    expect(ok(true)).toBe(true);
    expect(ok(false)).toBe(true);
    expect(ok(undefined)).toBe(true);
    expect(ok("true")).toBe(false);
    expect(ok(1)).toBe(false);
  });
});
