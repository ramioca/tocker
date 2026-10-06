import { describe, expect, it } from "vitest";
import { DEFAULT_AGENT_CONFIG, DEFAULT_MODELS } from "@/lib/agent/config";
import { DEFAULT_PLATFORM_FEE_USD } from "@/lib/platform/fee";
import {
  INTERVAL_PRESETS,
  MAX_TRADE_LADDER,
  RISK_BOUNDS,
  STRATEGY_PRESETS,
  emptyDraft,
  feeSharePct,
  ladderStops,
  nearestStopIndex,
  withDefaultKey,
} from "./types";

describe("max-trade ladder", () => {
  it("spans exactly the risk bounds", () => {
    expect(MAX_TRADE_LADDER[0]).toBe(RISK_BOUNDS.maxTradeUsd.min);
    expect(MAX_TRADE_LADDER.at(-1)).toBe(RISK_BOUNDS.maxTradeUsd.max);
  });

  it("keeps an on-ladder value as-is", () => {
    expect(ladderStops(MAX_TRADE_LADDER, 100)).toEqual(MAX_TRADE_LADDER);
  });

  it("adds an off-ladder value as its own stop, in order", () => {
    const stops = ladderStops(MAX_TRADE_LADDER, 400);
    expect(stops).toHaveLength(MAX_TRADE_LADDER.length + 1);
    expect(stops[nearestStopIndex(stops, 400)]).toBe(400);
    expect(stops.slice(7, 10)).toEqual([250, 400, 500]);
  });

  it("finds the nearest stop", () => {
    expect(MAX_TRADE_LADDER[nearestStopIndex(MAX_TRADE_LADDER, 30)]).toBe(25);
    expect(MAX_TRADE_LADDER[nearestStopIndex(MAX_TRADE_LADDER, 9_999)]).toBe(5_000);
  });
});

describe("withDefaultKey", () => {
  const anthropic = { id: "key_a", provider: "anthropic" as const };
  const openrouter = { id: "key_or", provider: "openrouter" as const };
  const openai = { id: "key_oa", provider: "openai" as const };

  it("leaves a keyless account on the default provider with nothing chosen", () => {
    const draft = emptyDraft();
    expect(withDefaultKey(draft, [])).toBe(draft);
  });

  it("chooses the account's key for the draft's provider instead of leaving 'Choose a key'", () => {
    const next = withDefaultKey(emptyDraft(), [openrouter, anthropic]);
    expect(next.llmKeyId).toBe("key_a");
    expect(next.config.llm.provider).toBe("anthropic");
    expect(next.config.llm.model).toBe(DEFAULT_AGENT_CONFIG.llm.model);
  });

  /** The OpenRouter key onboarding recommends, then a builder that said "No Anthropic key on file yet". */
  it("moves to the provider of the only key the account has, with that provider's first model", () => {
    const next = withDefaultKey(emptyDraft(), [openrouter]);
    expect(next.llmKeyId).toBe("key_or");
    expect(next.config.llm.provider).toBe("openrouter");
    expect(next.config.llm.model).toBe(DEFAULT_MODELS.openrouter[0].id);
    // Nothing else about the model settings moves.
    expect(next.config.llm.temperature).toBe(DEFAULT_AGENT_CONFIG.llm.temperature);
    expect(next.config.llm.maxSteps).toBe(DEFAULT_AGENT_CONFIG.llm.maxSteps);
  });

  it("keeps a selection that is still usable, whatever else is on the account", () => {
    const draft = { ...emptyDraft(), llmKeyId: "key_a" };
    expect(withDefaultKey(draft, [openrouter, openai, anthropic])).toBe(draft);
  });

  it("replaces a key that has been removed, and one that belongs to another provider", () => {
    expect(withDefaultKey({ ...emptyDraft(), llmKeyId: "gone" }, [anthropic]).llmKeyId).toBe("key_a");
    // An Anthropic draft pointing at an OpenAI key could be kept but never run.
    expect(withDefaultKey({ ...emptyDraft(), llmKeyId: "key_oa" }, [openai, anthropic]).llmKeyId).toBe("key_a");
  });

  it("clears a stale key when the account has none left", () => {
    expect(withDefaultKey({ ...emptyDraft(), llmKeyId: "gone" }, []).llmKeyId).toBeNull();
  });

  it("does not mutate the draft it was given", () => {
    const draft = emptyDraft();
    withDefaultKey(draft, [openrouter]);
    expect(draft.llmKeyId).toBeNull();
    expect(draft.config.llm.provider).toBe("anthropic");
  });
});

describe("feeSharePct", () => {
  it("is the flat fee as a whole percent of the ticket", () => {
    expect(feeSharePct(2, 0.1)).toBe(5);
    expect(feeSharePct(1, 0.1)).toBe(10);
    expect(feeSharePct(10, 0.1)).toBe(1);
  });

  it("stays silent once the fee is under 1% of the ticket, or off", () => {
    expect(feeSharePct(100, 0.1)).toBeNull();
    expect(feeSharePct(11, 0.1)).toBeNull();
    expect(feeSharePct(2, 0)).toBeNull();
    expect(feeSharePct(0, 0.1)).toBeNull();
  });

  /** The preset the audit named: $2 clips, where the default fee is 5% a side. */
  it("flags the small-ticket preset at the fee the product charges by default", () => {
    const preset = STRATEGY_PRESETS.find((entry) => entry.id === "first-fifteen");
    expect(preset?.risk?.maxTradeUsd).toBe(2);
    expect(feeSharePct(preset!.risk!.maxTradeUsd!, DEFAULT_PLATFORM_FEE_USD)).toBe(5);
  });
});

/** Every run bills the owner's key, so a hint that counts runs has to count them right. */
describe("interval hints", () => {
  it("state the runs a day the interval really is", () => {
    for (const preset of INTERVAL_PRESETS) {
      const stated = preset.hint.match(/(\d+) runs a day/);
      if (!stated) continue;
      expect(Number(stated[1]), preset.label).toBe(1_440 / preset.minutes);
    }
    // The three a newcomer is most likely to pick all carry the count.
    for (const minutes of [5, 15, 60]) {
      expect(INTERVAL_PRESETS.find((preset) => preset.minutes === minutes)?.hint).toMatch(/\d+ runs a day/);
    }
  });

  it("calls the shipped default the default, and nothing else", () => {
    const named = INTERVAL_PRESETS.filter((preset) => preset.hint.startsWith("The default"));
    expect(named.map((preset) => preset.minutes)).toEqual([DEFAULT_AGENT_CONFIG.schedule.intervalMinutes]);
  });

  it("compares the hourly bill with the default's honestly", () => {
    const hourly = INTERVAL_PRESETS.find((preset) => preset.minutes === 60);
    expect(hourly?.hint).toContain("a quarter of the default's model bill");
    expect(60 / DEFAULT_AGENT_CONFIG.schedule.intervalMinutes).toBe(4);
  });
});
