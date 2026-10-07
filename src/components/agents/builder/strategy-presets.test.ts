/**
 * What a strategy preset writes, held still.
 *
 * A preset is one tap that rewrites chains, sources, the universe, the risk limits, the
 * schedule and how the agent trades, on a form whose cards are closed. The merge is
 * written out here by hand, value by value, so a change to it has to be made twice.
 */
import { describe, expect, it } from "vitest";
import { agentConfigSchema } from "@/lib/agent/config";
import {
  CUSTOM_STRATEGY,
  applyCustomTo,
  applyPresetTo,
  isCustomPressed,
  presetChanges,
  presetFacts,
} from "./strategy-presets";
import { STRATEGY_PRESETS, UNIVERSE_PRESETS, emptyDraft, type BuilderDraft, type StrategyPreset } from "./types";

type Config = BuilderDraft["config"];

/**
 * The two labels the builder passes in, restated: `intervalLabel` and `ttlLabel` live in
 * component files a node test does not load.
 */
const labels = {
  interval: (minutes: number) => {
    if (minutes === 0) return "Manual only";
    if (minutes < 60) return `Every ${minutes} min`;
    if (minutes % 1440 === 0) return `Every ${minutes / 1440}d`;
    if (minutes % 60 === 0) return `Every ${minutes / 60}h`;
    return `Every ${minutes} min`;
  },
  ttl: (minutes: number) => (minutes < 60 || minutes % 60 !== 0 ? `${minutes} min` : `${minutes / 60} h`),
};

function preset(id: string): StrategyPreset {
  const found = STRATEGY_PRESETS.find((entry) => entry.id === id);
  if (!found) throw new Error(`no preset ${id}`);
  return found;
}

/** A draft nobody would call default: every section a preset can touch has been changed. */
function tuned(): Config {
  const base = emptyDraft().config;
  return {
    ...base,
    strategyPrompt: "Buy only what I would hold for a week, and never anything I cannot explain.",
    chains: ["base"],
    dataSources: ["cmc-quotes"],
    universe: {
      ...base.universe,
      discovery: ["trending", "top_organic"],
      minScore: 71,
      minLiquidityUsd: 80_000,
      minHolderCount: 900,
      minAgeMinutes: 240,
      maxAgeHours: 720,
      maxTop10HolderPct: 45,
      maxBuyTaxPct: 2,
      requireMintRevoked: false,
      requireFreezeRevoked: false,
      blocklist: [{ chain: "base", address: "0x1111111111111111111111111111111111111111", symbol: "NOPE" }],
    },
    risk: {
      ...base.risk,
      maxTradeUsd: 250,
      maxDailyTrades: 4,
      maxPositionPct: 10,
      maxDataSpendUsdPerRun: 0.5,
      stopLossPct: 8,
      takeProfitPct: 22,
      slippageBps: 150,
      trailingStopPct: 12,
      maxHoldHours: 48,
      exitScoreBelow: 55,
      exitOnLiquidityDropPct: 35,
    },
    execution: { mode: "auto", proposalTtlMinutes: 240 },
    schedule: { intervalMinutes: 240 },
    llm: { provider: "openai", model: "gpt-test-model", temperature: 0.9, maxSteps: 12 },
  };
}

describe("applyPresetTo", () => {
  it.each(STRATEGY_PRESETS.map((entry) => [entry.id, entry] as const))(
    "%s leaves a config the server accepts",
    (_id, entry) => {
      const result = agentConfigSchema.safeParse(applyPresetTo(emptyDraft().config, entry));
      expect(result.success).toBe(true);
    },
  );

  it.each(UNIVERSE_PRESETS.map((entry) => [entry.id, entry] as const))(
    "the %s posture leaves a config the server accepts",
    (_id, entry) => {
      const config = emptyDraft().config;
      const result = agentConfigSchema.safeParse({
        ...config,
        universe: { ...config.universe, ...entry.values, discovery: [...entry.values.discovery] },
      });
      expect(result.success).toBe(true);
    },
  );

  it("Momentum replaces the prompt, chains and sources and nothing else", () => {
    const before = tuned();
    expect(applyPresetTo(before, preset("momentum"))).toEqual({
      strategyPrompt: preset("momentum").prompt,
      chains: ["solana"],
      dataSources: ["x-search", "cmc-quotes"],
      universe: before.universe,
      risk: before.risk,
      execution: { mode: "auto", proposalTtlMinutes: 240 },
      schedule: { intervalMinutes: 240 },
      llm: before.llm,
    });
  });

  it("Sentiment contrarian replaces the prompt, chains and sources and nothing else", () => {
    const before = tuned();
    expect(applyPresetTo(before, preset("sentiment-contrarian"))).toEqual({
      strategyPrompt: preset("sentiment-contrarian").prompt,
      chains: ["solana", "base"],
      dataSources: ["x-search", "cmc-quotes", "deepnets-token-safety"],
      universe: before.universe,
      risk: before.risk,
      execution: { mode: "auto", proposalTtlMinutes: 240 },
      schedule: { intervalMinutes: 240 },
      llm: before.llm,
    });
  });

  it("Fresh launch hunter replaces the prompt, chains and sources and nothing else", () => {
    const before = tuned();
    expect(applyPresetTo(before, preset("fresh-launch"))).toEqual({
      strategyPrompt: preset("fresh-launch").prompt,
      chains: ["solana"],
      dataSources: ["deepnets-token-safety", "solenrich-launches", "x-search"],
      universe: before.universe,
      risk: before.risk,
      execution: { mode: "auto", proposalTtlMinutes: 240 },
      schedule: { intervalMinutes: 240 },
      llm: before.llm,
    });
  });

  it("First fifteen minutes sets its whole way of trading over the current values", () => {
    const before = tuned();
    expect(applyPresetTo(before, preset("first-fifteen"))).toEqual({
      strategyPrompt: preset("first-fifteen").prompt,
      chains: ["solana"],
      dataSources: ["deepnets-token-safety", "solenrich-launches", "x-search"],
      universe: {
        discovery: ["gecko_launches", "paid_launches", "new_launches"],
        minScore: 45,
        minLiquidityUsd: 2_000,
        minHolderCount: 0,
        minAgeMinutes: 0,
        maxAgeHours: 0.25,
        maxTop10HolderPct: 30,
        // The preset says nothing about the buy tax, so the owner's 2% stands.
        maxBuyTaxPct: 2,
        requireMintRevoked: true,
        requireFreezeRevoked: true,
        // Personal, and never overwritten.
        blocklist: [{ chain: "base", address: "0x1111111111111111111111111111111111111111", symbol: "NOPE" }],
      },
      risk: {
        maxTradeUsd: 2,
        maxDailyTrades: 40,
        maxPositionPct: 25,
        maxDataSpendUsdPerRun: 1,
        stopLossPct: 40,
        takeProfitPct: 100,
        slippageBps: 1_000,
        trailingStopPct: 30,
        maxHoldHours: 0.5,
        // Nor about the score floor or the sizing mode.
        exitScoreBelow: 55,
        exitOnLiquidityDropPct: 30,
        sizing: before.risk.sizing,
      },
      execution: { mode: "approve", proposalTtlMinutes: 5 },
      schedule: { intervalMinutes: 5 },
      llm: { provider: "openai", model: "gpt-test-model", temperature: 0.9, maxSteps: 12 },
    });
  });

  it("does not change the config it is given", () => {
    for (const entry of STRATEGY_PRESETS) {
      const before = tuned();
      const snapshot = structuredClone(before);
      applyPresetTo(before, entry);
      expect(before).toEqual(snapshot);
    }
  });
});

describe("presetChanges", () => {
  it("lists everything First fifteen minutes sets on a fresh draft", () => {
    const before = emptyDraft().config;
    expect(presetChanges(before, applyPresetTo(before, preset("first-fifteen")), labels)).toEqual([
      "3 data sources",
      "its universe",
      "its risk limits",
      "every 5 min",
      "ask first, 5 min window",
    ]);
  });

  it("lists only the sources for Momentum on a fresh draft", () => {
    const before = emptyDraft().config;
    expect(presetChanges(before, applyPresetTo(before, preset("momentum")), labels)).toEqual(["2 data sources"]);
  });

  it("names the chains when they change", () => {
    const before = emptyDraft().config;
    expect(presetChanges(before, applyPresetTo(before, preset("sentiment-contrarian")), labels)).toEqual([
      "Solana and Base",
    ]);
    expect(presetChanges(tuned(), applyPresetTo(tuned(), preset("momentum")), labels)).toEqual([
      "Solana only",
      "2 data sources",
    ]);
  });

  it("has nothing to say when the same preset is applied twice", () => {
    for (const entry of STRATEGY_PRESETS) {
      const once = applyPresetTo(tuned(), entry);
      expect(presetChanges(once, applyPresetTo(once, entry), labels)).toEqual([]);
    }
  });
});

describe("presetFacts", () => {
  it("reads the defaults", () => {
    expect(presetFacts(emptyDraft().config, labels)).toBe(
      "Solana · every 15 min · up to $100.00 a trade · asks first",
    );
  });

  it("reads what First fifteen minutes would leave behind", () => {
    expect(presetFacts(applyPresetTo(emptyDraft().config, preset("first-fifteen")), labels)).toBe(
      "Solana · every 5 min · up to $2.00 a trade · asks first",
    );
  });

  it("names both chains", () => {
    expect(presetFacts(applyPresetTo(emptyDraft().config, preset("sentiment-contrarian")), labels)).toBe(
      "Solana and Base · every 15 min · up to $100.00 a trade · asks first",
    );
    expect(presetFacts({ ...emptyDraft().config, chains: ["base"] }, labels)).toBe(
      "Base · every 15 min · up to $100.00 a trade · asks first",
    );
  });

  it("says when it trades on its own", () => {
    const config = emptyDraft().config;
    expect(presetFacts({ ...config, execution: { ...config.execution, mode: "auto" } }, labels)).toBe(
      "Solana · every 15 min · up to $100.00 a trade · trades on its own",
    );
  });

  it("says when the schedule is manual", () => {
    expect(presetFacts({ ...emptyDraft().config, schedule: { intervalMinutes: 0 } }, labels)).toBe(
      "Solana · manual only · up to $100.00 a trade · asks first",
    );
  });
});

describe("applyCustomTo", () => {
  it("empties the prompt and changes nothing else", () => {
    const before = tuned();
    const { strategyPrompt, ...rest } = applyCustomTo(before);
    const { strategyPrompt: previous, ...restBefore } = before;
    expect(strategyPrompt).toBe("");
    expect(previous).not.toBe("");
    expect(rest).toEqual(restBefore);
  });

  it("keeps what a preset set, whichever preset came first", () => {
    for (const entry of STRATEGY_PRESETS) {
      const after = applyPresetTo(emptyDraft().config, entry);
      expect(applyCustomTo(after)).toEqual({ ...after, strategyPrompt: "" });
    }
  });

  it("does not change the config it is given", () => {
    const before = tuned();
    const frozen = structuredClone(before);
    applyCustomTo(before);
    expect(before).toEqual(frozen);
  });

  it("leaves a prompt the server refuses, as clearing the box by hand does", () => {
    expect(agentConfigSchema.safeParse(applyCustomTo(emptyDraft().config)).success).toBe(false);
  });
});

describe("isCustomPressed", () => {
  it("is not pressed on a fresh draft", () => {
    expect(isCustomPressed(emptyDraft().config.strategyPrompt)).toBe(false);
  });

  it("is pressed once Custom has emptied the prompt", () => {
    expect(isCustomPressed(applyCustomTo(emptyDraft().config).strategyPrompt)).toBe(true);
    expect(isCustomPressed("  \n")).toBe(true);
  });

  it("is pressed on the owner's own words", () => {
    expect(isCustomPressed(tuned().strategyPrompt)).toBe(true);
  });

  it.each(STRATEGY_PRESETS.map((entry) => [entry.id, entry] as const))(
    "is not pressed while %s is",
    (_id, entry) => {
      expect(isCustomPressed(entry.prompt)).toBe(false);
    },
  );

  it("is pressed as soon as a preset's prompt is edited", () => {
    expect(isCustomPressed(`${preset("momentum").prompt} Never buy on a Sunday.`)).toBe(true);
    expect(isCustomPressed(`${emptyDraft().config.strategyPrompt} Never buy on a Sunday.`)).toBe(true);
  });
});

describe("CUSTOM_STRATEGY", () => {
  it("does not share an id with a preset", () => {
    expect(STRATEGY_PRESETS.map((entry) => entry.id)).not.toContain(CUSTOM_STRATEGY.id);
  });

  it("says what the card says", () => {
    expect(CUSTOM_STRATEGY).toEqual({
      id: "custom",
      label: "Custom",
      blurb: "Write your own from scratch.",
      facts: "Keeps every rule as it is",
    });
  });
});
