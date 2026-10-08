import { describe, expect, it } from "vitest";
import { DEFAULT_AGENT_CONFIG, DEFAULT_MODEL_ID } from "@/lib/agent/config";
import { chooseSource, defaultUsdc, usdcEstimate } from "@/components/agents/thinking";
import { DEFAULT_PAY_PER_USE_MODEL, PAY_PER_USE_MODELS, USDC_DEFAULT_INTERVAL_MINUTES } from "@/lib/x402/inference-types";
import { CATALOGUE, CATALOGUE_IDS, PROVIDER_IDS, isProvider, type LlmProvider } from "@/lib/agent/providers";
import {
  INTERVAL_PRESETS,
  MAX_TRADE_LADDER,
  RISK_BOUNDS,
  emptyDraft,
  firstKeyFor,
  intervalHint,
  ladderStops,
  nearestStopIndex,
  onProvider,
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
  it("moves to the provider of the only key the account has, with that provider's default model", () => {
    const next = withDefaultKey(emptyDraft(), [openrouter]);
    expect(next.llmKeyId).toBe("key_or");
    expect(next.config.llm.provider).toBe("openrouter");
    expect(next.config.llm.model).toBe(DEFAULT_MODEL_ID.openrouter);
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

/**
 * A draft is read back from localStorage and a key from its row: neither is checked by
 * the types that describe them. A provider can be switched off after a draft was saved
 * or a key was added, and a stored value can be anything.
 */
describe("withDefaultKey and a provider that is not offered", () => {
  const anthropic = { id: "key_a", provider: "anthropic" as const };
  const stale = (provider: string) => {
    const draft = emptyDraft();
    return {
      ...draft,
      llmKeyId: "key_x",
      config: { ...draft.config, llm: { ...draft.config.llm, provider: provider as LlmProvider, model: "some-model" } },
    };
  };
  /** A key row as the database could hold it: the column is plain text. */
  const keyFor = (provider: string) => ({ id: "key_x", provider: provider as LlmProvider });

  it("starts a draft that names no offered provider on the default one, with its model", () => {
    for (const provider of ["retired-provider", "", "constructor", "Anthropic"]) {
      const next = withDefaultKey(stale(provider), []);
      expect(next.config.llm.provider, provider).toBe(DEFAULT_AGENT_CONFIG.llm.provider);
      expect(next.config.llm.model, provider).toBe(DEFAULT_AGENT_CONFIG.llm.model);
      expect(next.llmKeyId, provider).toBeNull();
      // The rest of its model settings are the owner's and stay.
      expect(next.config.llm.temperature).toBe(DEFAULT_AGENT_CONFIG.llm.temperature);
      // And then it is put on a key like any other draft.
      expect(withDefaultKey(stale(provider), [anthropic]).llmKeyId, provider).toBe("key_a");
    }
  });

  it("never chooses a key whose provider is not offered", () => {
    for (const provider of ["retired-provider", "", "constructor"]) {
      const draft = emptyDraft();
      expect(withDefaultKey(draft, [keyFor(provider)]), provider).toBe(draft);
      expect(withDefaultKey({ ...draft, llmKeyId: "key_x" }, [keyFor(provider)]).llmKeyId, provider).toBeNull();
      expect(withDefaultKey(draft, [keyFor(provider), anthropic]).llmKeyId, provider).toBe("key_a");
    }
  });

  /** Holds before and after the other providers are switched on: each id is asked whether it is. */
  it("uses a key for any provider that is switched on, and none for one that is not", () => {
    for (const id of CATALOGUE_IDS) {
      const next = withDefaultKey(emptyDraft(), [keyFor(id)]);
      if (id === "anthropic") continue;
      if (isProvider(id)) {
        expect(next.llmKeyId, id).toBe("key_x");
        expect(next.config.llm.provider, id).toBe(id);
        expect(next.config.llm.model, id).toBe(CATALOGUE[id].defaultModel);
      } else {
        expect(next.llmKeyId, id).toBeNull();
        expect(next.config.llm.provider, id).toBe("anthropic");
      }
    }
  });
});

describe("choosing a provider", () => {
  const llm = { ...DEFAULT_AGENT_CONFIG.llm, temperature: 0.9, maxSteps: 14, model: "the-model-being-left" };

  it("starts Anthropic, OpenAI and OpenRouter on the models they always started on", () => {
    expect(onProvider(llm, "anthropic").model).toBe("claude-sonnet-5-5");
    expect(onProvider(llm, "openai").model).toBe("gpt-5");
    expect(onProvider(llm, "openrouter").model).toBe("anthropic/claude-sonnet-5.5");
  });

  it("moves to that provider on its own default model and keeps every other setting", () => {
    for (const id of PROVIDER_IDS) {
      const next = onProvider(llm, id);
      expect(next, id).toEqual({ ...llm, provider: id, model: CATALOGUE[id].defaultModel });
      expect(next.model, id).toBe(DEFAULT_MODEL_ID[id]);
      // The model it starts on is one its own list offers.
      expect(CATALOGUE[id].models.some((model) => model.id === next.model), id).toBe(true);
    }
    expect(llm.model).toBe("the-model-being-left");
  });

  it("leaves how the agent thinks, and its pay-per-use limits, exactly as they were", () => {
    const usdc = defaultUsdc(USDC_DEFAULT_INTERVAL_MINUTES);
    const paying = { ...llm, source: "usdc" as const, usdc };
    const next = onProvider(paying, "openai");
    expect(next.source).toBe("usdc");
    expect(next.usdc).toBe(usdc);
  });

  it("picks the first of the account's keys for that provider, or none", () => {
    const keys = [
      { id: "key_or", provider: "openrouter" as const },
      { id: "key_a1", provider: "anthropic" as const },
      { id: "key_a2", provider: "anthropic" as const },
    ];
    expect(firstKeyFor(keys, "anthropic")).toBe("key_a1");
    expect(firstKeyFor(keys, "openrouter")).toBe("key_or");
    // A key of the provider being left is never carried over.
    expect(firstKeyFor(keys, "openai")).toBeNull();
    expect(firstKeyFor([], "anthropic")).toBeNull();
  });
});

/**
 * A draft set to pay per use has no key on purpose. Before this rule a restored one was
 * moved onto the account's first key, which undid the choice without a word.
 */
describe("withDefaultKey and a pay-per-use draft", () => {
  const anthropic = { id: "key_a", provider: "anthropic" as const };
  const payPerUseDraft = () => {
    const draft = emptyDraft();
    return { ...draft, config: chooseSource(draft.config, "usdc").config };
  };

  it("leaves it exactly as it is while the viewer may pay per use, keys or no keys", () => {
    const draft = payPerUseDraft();
    expect(withDefaultKey(draft, [], { payPerUseAllowed: true })).toBe(draft);
    expect(withDefaultKey(draft, [anthropic], { payPerUseAllowed: true })).toBe(draft);
    expect(draft.llmKeyId).toBeNull();
  });

  it("turns it back into a key draft for a viewer who may not, and then picks their key", () => {
    const next = withDefaultKey(payPerUseDraft(), [anthropic]);
    expect(next.config.llm.source).toBeUndefined();
    expect(next.config.llm.usdc).toBeUndefined();
    expect(next.llmKeyId).toBe("key_a");
    // The same with the option spelled out, and with no key to pick.
    const keyless = withDefaultKey(payPerUseDraft(), [], { payPerUseAllowed: false });
    expect(keyless.config.llm.source).toBeUndefined();
    expect(keyless.llmKeyId).toBeNull();
  });

  it("gives a draft that names the mode without its limits the defaults", () => {
    const draft = emptyDraft();
    const bare = { ...draft, config: { ...draft.config, llm: { ...draft.config.llm, source: "usdc" as const } } };
    const next = withDefaultKey(bare, [], { payPerUseAllowed: true });
    expect(next.config.llm.usdc).toEqual(defaultUsdc(USDC_DEFAULT_INTERVAL_MINUTES));
  });

  /** The feature ships switched off: a key draft is defaulted the same way either way. */
  it("treats a key draft the same whether or not the viewer may pay per use", () => {
    const openrouter = { id: "key_or", provider: "openrouter" as const };
    for (const keys of [[], [anthropic], [openrouter], [openrouter, anthropic]]) {
      for (const llmKeyId of [null, "key_a", "gone"]) {
        const draft = { ...emptyDraft(), llmKeyId };
        const off = withDefaultKey(draft, keys);
        expect(withDefaultKey(draft, keys, { payPerUseAllowed: true })).toEqual(off);
        expect(withDefaultKey(draft, keys, { payPerUseAllowed: false })).toEqual(off);
      }
    }
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

/** On pay per use the cost of a schedule is a number, so the hint under each choice is that number. */
describe("interval hints on pay per use", () => {
  it("are the fixed key hints when the agent thinks on a key", () => {
    for (const preset of INTERVAL_PRESETS) {
      expect(intervalHint(preset)).toBe(preset.hint);
      expect(intervalHint(preset, null)).toBe(preset.hint);
    }
  });

  it("state the runs a day and the day's thinking, from the same estimate as the panel", () => {
    for (const model of PAY_PER_USE_MODELS) {
      for (const preset of INTERVAL_PRESETS) {
        const hint = intervalHint(preset, model.id);
        if (preset.minutes === 0) {
          expect(hint).toBe("Only runs when you press Run now. Nothing is spent until then.");
          continue;
        }
        const estimate = usdcEstimate(model.id, preset.minutes);
        expect(hint, `${model.id} ${preset.label}`).toContain(`About ${estimate.runsPerDay} run`);
        expect(hint).toContain(`$${estimate.dayUsd.toFixed(2)} of thinking`);
        // Never the key wording: nothing on this schedule is billed to a key.
        expect(hint).not.toContain("on your key");
      }
    }
  });

  it("says one run, not one runs, for a daily schedule", () => {
    const daily = INTERVAL_PRESETS.find((preset) => preset.minutes === 1_440)!;
    expect(intervalHint(daily, DEFAULT_PAY_PER_USE_MODEL)).toMatch(/^About 1 run a day, about \$\d+\.\d{2} of thinking\.$/);
  });

  it("quotes no price for a model that is not offered, and never the key wording", () => {
    const hourly = INTERVAL_PRESETS.find((preset) => preset.minutes === 60)!;
    expect(intervalHint(hourly, "vendor/unknown")).toBe("Every run pays for its own thinking.");
  });
});
