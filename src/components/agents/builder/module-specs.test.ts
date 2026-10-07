/**
 * The specs against the schema that saves an agent. A value a module lets somebody type
 * must be one `agentConfigSchema` accepts, unchanged, in the field's own unit.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_AGENT_CONFIG, DEFAULT_MODEL_ID, agentConfigSchema } from "@/lib/agent/config";
import {
  HOLDER_LADDER,
  LIQUIDITY_LADDER,
  MAX_AGE_LADDER,
  MIN_AGE_LADDER,
  SPECS,
  type SpecId,
} from "./module-specs";
import { LLM_BOUNDS, MAX_TRADE_LADDER, RISK_BOUNDS } from "./types";
import { roundTo, settle, type ValueSpec } from "./typed-value";

type Config = typeof DEFAULT_AGENT_CONFIG;

/** A pay-per-use block, which the two thinking limits live in. */
const usdc = (limits: { maxUsdPerRun?: number; maxUsdPerDay?: number }): Config["llm"] => ({
  ...DEFAULT_AGENT_CONFIG.llm,
  source: "usdc",
  usdc: { model: DEFAULT_MODEL_ID.anthropic, maxUsdPerRun: 0.3, maxUsdPerDay: 3, ...limits },
});

const universe = (patch: Partial<Config["universe"]>): Config => ({
  ...DEFAULT_AGENT_CONFIG,
  universe: { ...DEFAULT_AGENT_CONFIG.universe, ...patch },
});
const risk = (patch: Partial<Config["risk"]>): Config => ({
  ...DEFAULT_AGENT_CONFIG,
  risk: { ...DEFAULT_AGENT_CONFIG.risk, ...patch },
});
const llm = (patch: Partial<Config["llm"]>): Config => ({
  ...DEFAULT_AGENT_CONFIG,
  llm: { ...DEFAULT_AGENT_CONFIG.llm, ...patch },
});

/**
 * Where each spec's value is written in a config, and where to read it back. Paper
 * starting balance is not here: it is not part of the config (the create action checks
 * it), so it has its own test below.
 */
const FIELDS: Record<Exclude<SpecId, "paperStart">, { write: (value: number) => Config; read: (config: Config) => unknown }> = {
  minScore: { write: (v) => universe({ minScore: v }), read: (c) => c.universe.minScore },
  minLiquidityUsd: { write: (v) => universe({ minLiquidityUsd: v }), read: (c) => c.universe.minLiquidityUsd },
  minHolderCount: { write: (v) => universe({ minHolderCount: v }), read: (c) => c.universe.minHolderCount },
  minAgeMinutes: { write: (v) => universe({ minAgeMinutes: v }), read: (c) => c.universe.minAgeMinutes },
  maxAgeHours: { write: (v) => universe({ maxAgeHours: v }), read: (c) => c.universe.maxAgeHours },
  maxTop10HolderPct: { write: (v) => universe({ maxTop10HolderPct: v }), read: (c) => c.universe.maxTop10HolderPct },
  maxBuyTaxPct: { write: (v) => universe({ maxBuyTaxPct: v }), read: (c) => c.universe.maxBuyTaxPct },
  maxTradeUsd: { write: (v) => risk({ maxTradeUsd: v }), read: (c) => c.risk.maxTradeUsd },
  maxDailyTrades: { write: (v) => risk({ maxDailyTrades: v }), read: (c) => c.risk.maxDailyTrades },
  maxPositionPct: { write: (v) => risk({ maxPositionPct: v }), read: (c) => c.risk.maxPositionPct },
  maxDataSpendUsdPerRun: {
    write: (v) => risk({ maxDataSpendUsdPerRun: v }),
    read: (c) => c.risk.maxDataSpendUsdPerRun,
  },
  slippageBps: { write: (v) => risk({ slippageBps: v }), read: (c) => c.risk.slippageBps },
  stopLossPct: { write: (v) => risk({ stopLossPct: v }), read: (c) => c.risk.stopLossPct },
  takeProfitPct: { write: (v) => risk({ takeProfitPct: v }), read: (c) => c.risk.takeProfitPct },
  trailingStopPct: { write: (v) => risk({ trailingStopPct: v }), read: (c) => c.risk.trailingStopPct },
  maxHoldHours: { write: (v) => risk({ maxHoldHours: v }), read: (c) => c.risk.maxHoldHours },
  exitScoreBelow: { write: (v) => risk({ exitScoreBelow: v }), read: (c) => c.risk.exitScoreBelow },
  exitOnLiquidityDropPct: {
    write: (v) => risk({ exitOnLiquidityDropPct: v }),
    read: (c) => c.risk.exitOnLiquidityDropPct,
  },
  temperature: { write: (v) => llm({ temperature: v }), read: (c) => c.llm.temperature },
  maxSteps: { write: (v) => llm({ maxSteps: v }), read: (c) => c.llm.maxSteps },
  usdcPerRun: {
    write: (v) => ({ ...DEFAULT_AGENT_CONFIG, llm: usdc({ maxUsdPerRun: v }) }),
    read: (c) => c.llm.usdc?.maxUsdPerRun,
  },
  usdcPerDay: {
    write: (v) => ({ ...DEFAULT_AGENT_CONFIG, llm: usdc({ maxUsdPerDay: v }) }),
    read: (c) => c.llm.usdc?.maxUsdPerDay,
  },
  interval: {
    write: (v) => ({ ...DEFAULT_AGENT_CONFIG, schedule: { intervalMinutes: v } }),
    read: (c) => c.schedule.intervalMinutes,
  },
  proposalTtl: {
    write: (v) => ({ ...DEFAULT_AGENT_CONFIG, execution: { ...DEFAULT_AGENT_CONFIG.execution, proposalTtlMinutes: v } }),
    read: (c) => c.execution.proposalTtlMinutes,
  },
};

const CONFIG_IDS = Object.keys(FIELDS) as Array<keyof typeof FIELDS>;

/** A spec's amount (minutes for a duration) in the unit the config stores. */
const stored = (spec: ValueSpec, amount: number): number =>
  spec.span?.stored === "hours" ? Number((amount / 60).toFixed(4)) : amount;

describe("every spec against agentConfigSchema", () => {
  it("covers every spec but the paper balance", () => {
    expect([...CONFIG_IDS, "paperStart"].sort()).toEqual(Object.keys(SPECS).sort());
  });

  it.each(CONFIG_IDS)("%s: the ends of the range and the values between the slider's steps are saved as typed", (id) => {
    const spec = SPECS[id];
    const between = [3, 7, 11].map((steps) => roundTo(spec.min + spec.precision * steps, spec.precision));
    const middle = roundTo((spec.min + spec.max) / 2 + spec.precision, spec.precision);
    for (const amount of [spec.min, spec.max, middle, ...between]) {
      expect(amount >= spec.min && amount <= spec.max, `${id} ${amount}`).toBe(true);
      const value = stored(spec, amount);
      const parsed = agentConfigSchema.safeParse(FIELDS[id].write(value));
      expect(parsed.success, `${id} ${value}`).toBe(true);
      // Equal, not merely accepted: catches a transform that would rewrite the value.
      if (parsed.success) expect(FIELDS[id].read(parsed.data as Config), `${id} ${value}`).toBe(value);
    }
  });

  it.each(CONFIG_IDS)("%s: whatever settle stores is saved as it is", (id) => {
    const spec = SPECS[id];
    const samples = [
      "0", "1", "2", "5", "7", "7.37", "7,37", "12.5", "15", "20", "36", "42", "90", "150", "155", "1,234",
      "2500", "12,345", "10k", "1.5%", "0.07", "0.3", "1.55%", "70/100", "-20", "+42%", "90m", "1h 7m",
      "36h", "3d", "1w", "1 month", "1y", "20 min", "24.5h",
    ];
    for (const text of samples) {
      const result = settle(spec, text, stored(spec, spec.min));
      if (result.status !== "set" || result.value === null) continue;
      const parsed = agentConfigSchema.safeParse(FIELDS[id].write(result.value));
      expect(parsed.success, `${id} ${text}`).toBe(true);
      if (parsed.success) expect(FIELDS[id].read(parsed.data as Config), `${id} ${text}`).toBe(result.value);
    }
  });

  it("keeps the paper balance inside what the create action accepts", () => {
    // The action takes anything above zero up to ten million dollars.
    expect(SPECS.paperStart.min).toBeGreaterThan(0);
    expect(SPECS.paperStart.max).toBeLessThanOrEqual(10_000_000);
    expect(SPECS.paperStart.precision).toBe(1);
  });
});

describe("ranges", () => {
  it("are what each slider reaches", () => {
    const ends = (ladder: readonly number[]) => [ladder[0], ladder[ladder.length - 1]];
    expect([SPECS.minLiquidityUsd.min, SPECS.minLiquidityUsd.max]).toEqual(ends(LIQUIDITY_LADDER));
    expect([SPECS.minHolderCount.min, SPECS.minHolderCount.max]).toEqual(ends(HOLDER_LADDER));
    expect([SPECS.minAgeMinutes.min, SPECS.minAgeMinutes.max]).toEqual(ends(MIN_AGE_LADDER));
    expect([SPECS.maxTradeUsd.min, SPECS.maxTradeUsd.max]).toEqual(ends(MAX_TRADE_LADDER));
    expect([SPECS.maxTradeUsd.min, SPECS.maxTradeUsd.max]).toEqual([
      RISK_BOUNDS.maxTradeUsd.min,
      RISK_BOUNDS.maxTradeUsd.max,
    ]);
    expect([SPECS.maxSteps.min, SPECS.maxSteps.max]).toEqual([LLM_BOUNDS.maxSteps.min, LLM_BOUNDS.maxSteps.max]);
  });

  it("go under the slider only for the two fields a shipped preset already takes there", () => {
    // Both are checked in minutes. The Maximum age slider starts at an hour and the Max
    // hold slider at an hour; "First fifteen minutes" stores a quarter and a half.
    expect(SPECS.maxAgeHours.min).toBe(15);
    expect(SPECS.maxAgeHours.max).toBe(MAX_AGE_LADDER[MAX_AGE_LADDER.length - 1] * 60);
    expect(MAX_AGE_LADDER[0] * 60).toBeGreaterThan(SPECS.maxAgeHours.min);
    expect(SPECS.maxHoldHours.min).toBe(15);
    expect(SPECS.maxHoldHours.max).toBe(168 * 60);
  });

  it("keep every ladder in ascending order with no stop twice", () => {
    for (const ladder of [LIQUIDITY_LADDER, HOLDER_LADDER, MIN_AGE_LADDER, MAX_AGE_LADDER]) {
      expect(ladder.length).toBeGreaterThan(1);
      expect([...new Set(ladder)].sort((a, b) => a - b)).toEqual([...ladder]);
    }
  });

  it("label every spec and give it an example it can read", () => {
    for (const [id, spec] of Object.entries(SPECS)) {
      expect(spec.label.length, id).toBeGreaterThan(0);
      expect(spec.min, id).toBeLessThan(spec.max);
      // "Try 10k or $12,345": each suggestion must itself be accepted.
      for (const example of spec.example.split(" or ")) {
        const result = settle(spec, example, null);
        expect(result.status, `${id} ${example}`).toBe("set");
      }
    }
  });
});

describe("Maximum age", () => {
  it("refuses a zero ceiling, which would block every token", () => {
    for (const current of [24, null]) {
      const result = settle(SPECS.maxAgeHours, "0", current);
      expect(result.status).toBe("refused");
      if (result.status === "refused") expect(result.message).toContain("0 would block every token.");
    }
  });

  it("stores no ceiling only when it is asked for by name", () => {
    expect(settle(SPECS.maxAgeHours, "any", 24)).toMatchObject({ status: "set", value: null });
    expect(settle(SPECS.maxAgeHours, "", 24)).toEqual({ status: "unchanged" });
    expect(settle(SPECS.maxAgeHours, "any", null)).toEqual({ status: "unchanged" });
  });
});
