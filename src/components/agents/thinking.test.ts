/**
 * The decisions the builder, the settings form, the status rows and the runs list make
 * about pay-per-use thinking, with no browser and no database in the way.
 *
 * Two things matter most here. A key agent must come through every one of these
 * functions exactly as it went in, because the feature ships switched off. And nothing
 * in a form may raise a spending limit, or let one be saved that the schedule is
 * expected to break, without the owner having done it.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_AGENT_CONFIG } from "@/lib/agent/config";
import { paidStepLimit, runFundsNeededUsd, thinkSource, usdcChoiceProblem } from "@/lib/agent/inference";
import {
  DEFAULT_PAY_PER_USE_MODEL,
  INFERENCE_STOPS,
  MAX_PAID_STEPS,
  PAY_PER_USE_MODELS,
  USDC_DAY_CAP,
  USDC_DEFAULT_INTERVAL_MINUTES,
  USDC_RUN_CAP,
  WALLET_FLOOR_USD,
  describeInferenceStop,
  estimateRunUsd,
  suggestUsdcLimits,
  type InferenceStopReason,
} from "@/lib/x402/inference-types";
import type { AgentConfig } from "@/db/schema";
import {
  PAID_STEP_NOT_REFUNDED,
  PAY_PER_USE_DISCLOSURE,
  checkUsdc,
  chooseSource,
  defaultUsdc,
  firstUsdcError,
  holdChipLabel,
  limitCents,
  payPerUseModelLabel,
  readRunThinking,
  runThinking,
  shownSource,
  stepsAllowed,
  stopFix,
  stopWords,
  stripPayPerUse,
  suggestedLimits,
  thinkChoice,
  thinkingUsd,
  usdcEstimate,
  walletNeedUsd,
  type UsdcSettings,
  NO_ANSWER_RUN_WORDS,
  RUN_SPEND_NOTE,
  RUN_SPEND_NOT_FINAL_NOTE,
  runThinkingShown,
} from "./thinking";

const KEY_INTERVAL = DEFAULT_AGENT_CONFIG.schedule.intervalMinutes;
const REASONS = Object.keys(INFERENCE_STOPS) as InferenceStopReason[];

function keyConfig(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    ...DEFAULT_AGENT_CONFIG,
    llm: { ...DEFAULT_AGENT_CONFIG.llm },
    schedule: { ...DEFAULT_AGENT_CONFIG.schedule },
    ...overrides,
  };
}

function usdcConfig(usdc: Partial<UsdcSettings> = {}, intervalMinutes = USDC_DEFAULT_INTERVAL_MINUTES): AgentConfig {
  return keyConfig({
    llm: { ...DEFAULT_AGENT_CONFIG.llm, source: "usdc", usdc: { ...defaultUsdc(intervalMinutes), ...usdc } },
    schedule: { intervalMinutes },
  });
}

describe("the words every screen shares", () => {
  it("states the disclosure as the brief wrote it", () => {
    expect(PAY_PER_USE_DISCLOSURE).toBe(
      "In this mode the agent's strategy and transcript are sent to BlockRun and the model provider it uses.",
    );
  });

  it("says a paid step that fails is not refunded", () => {
    expect(PAID_STEP_NOT_REFUNDED).toContain("not refunded");
  });
});

describe("shownSource", () => {
  it("shows a viewer who may not pay per use a key agent, whatever a saved draft says", () => {
    expect(shownSource(usdcConfig(), false)).toBe("key");
    expect(shownSource(usdcConfig(), true)).toBe("usdc");
    expect(shownSource(keyConfig(), true)).toBe("key");
    expect(shownSource(keyConfig(), false)).toBe("key");
  });

  /** The mode is the config's own word. A key agent with limits left in its config is still a key agent. */
  it("is the app's one predicate for an allowed viewer, and never infers pay-per-use from a leftover block", () => {
    const shapes: Array<Pick<AgentConfig, "llm"> | null | undefined> = [
      keyConfig(),
      usdcConfig(),
      keyConfig({ llm: { ...DEFAULT_AGENT_CONFIG.llm, source: "key" } }),
      keyConfig({ llm: { ...DEFAULT_AGENT_CONFIG.llm, usdc: defaultUsdc(60) } }),
      null,
      undefined,
    ];
    for (const shape of shapes) expect(shownSource(shape, true)).toBe(thinkSource(shape));
    expect(shownSource(keyConfig({ llm: { ...DEFAULT_AGENT_CONFIG.llm, usdc: defaultUsdc(60) } }), true)).toBe("key");
  });
});

/** What is shown for which viewer and which agent: the whole table. */
describe("thinkChoice", () => {
  const key = keyConfig();
  const usdc = usdcConfig();

  it("offers nothing and shows a key form to a viewer who may not pay per use", () => {
    // The builder (nothing saved yet), and the settings of a key agent.
    expect(thinkChoice({ allowed: false, working: key })).toEqual({ offered: false, source: "key" });
    expect(thinkChoice({ allowed: false, saved: key, working: key })).toEqual({ offered: false, source: "key" });
    // Whatever the working config says: a draft saved when they were allowed.
    expect(thinkChoice({ allowed: false, working: usdc })).toEqual({ offered: false, source: "key" });
    expect(thinkChoice({ allowed: false, saved: key, working: usdc })).toEqual({ offered: false, source: "key" });
  });

  it("offers the choice to a viewer who may, in whichever mode the form is in", () => {
    expect(thinkChoice({ allowed: true, working: key })).toEqual({ offered: true, source: "key" });
    expect(thinkChoice({ allowed: true, working: usdc })).toEqual({ offered: true, source: "usdc" });
    expect(thinkChoice({ allowed: true, saved: key, working: usdc })).toEqual({ offered: true, source: "usdc" });
    expect(thinkChoice({ allowed: true, saved: usdc, working: key })).toEqual({ offered: true, source: "key" });
  });

  /** The switch was turned off after the agent was put on pay-per-use: it must still be able to leave. */
  it("still offers it on an agent already saved on pay-per-use, so it can be moved to a key", () => {
    expect(thinkChoice({ allowed: false, saved: usdc, working: usdc })).toEqual({ offered: true, source: "usdc" });
    expect(thinkChoice({ allowed: false, saved: usdc, working: key })).toEqual({ offered: true, source: "key" });
  });

  it("treats a missing config as a key agent", () => {
    expect(thinkChoice({ allowed: true, working: null })).toEqual({ offered: true, source: "key" });
    expect(thinkChoice({ allowed: false, saved: null, working: undefined })).toEqual({ offered: false, source: "key" });
  });
});

describe("usdcEstimate", () => {
  it("is the contract's own figures for a run and a day", () => {
    for (const model of PAY_PER_USE_MODELS) {
      const hourly = usdcEstimate(model.id, 60);
      expect(hourly.model).toBe(model);
      expect(hourly.runUsd).toBe(estimateRunUsd(model));
      expect(hourly.runsPerDay).toBe(22);
      expect(hourly.dayUsd).toBeCloseTo(22 * estimateRunUsd(model), 6);
    }
  });

  it("costs nothing in a day on a manual schedule", () => {
    const manual = usdcEstimate(DEFAULT_PAY_PER_USE_MODEL, 0);
    expect(manual.runsPerDay).toBe(0);
    expect(manual.dayUsd).toBe(0);
    expect(manual.runUsd).toBeGreaterThan(0);
  });

  /** The contract rounds a daily schedule down to no runs; an agent that runs daily is not free. */
  it("counts a daily schedule as one run a day, never as none", () => {
    const daily = usdcEstimate(DEFAULT_PAY_PER_USE_MODEL, 1_440);
    expect(daily.runsPerDay).toBe(1);
    expect(daily.dayUsd).toBe(daily.runUsd);
  });

  it("estimates nothing for a model that is not offered", () => {
    expect(usdcEstimate("openai/not-a-model", 60)).toEqual({ model: null, runUsd: 0, runsPerDay: 0, dayUsd: 0 });
    expect(usdcEstimate(null, 60).model).toBeNull();
  });
});

describe("the limits a form starts with", () => {
  it("prefills the default model and the contract's suggested limits", () => {
    const model = PAY_PER_USE_MODELS.find((entry) => entry.id === DEFAULT_PAY_PER_USE_MODEL)!;
    expect(defaultUsdc(60)).toEqual({ model: DEFAULT_PAY_PER_USE_MODEL, ...suggestUsdcLimits(model, 60) });
  });

  it("suggests limits inside the ranges the product offers, for every model and schedule", () => {
    for (const model of PAY_PER_USE_MODELS) {
      for (const minutes of [0, 5, 15, 60, 240, 1_440]) {
        const limits = suggestedLimits(model.id, minutes);
        expect(limits.maxUsdPerRun).toBeGreaterThanOrEqual(USDC_RUN_CAP.min);
        expect(limits.maxUsdPerRun).toBeLessThanOrEqual(USDC_RUN_CAP.max);
        expect(limits.maxUsdPerDay).toBeGreaterThanOrEqual(USDC_DAY_CAP.min);
        expect(limits.maxUsdPerDay).toBeLessThanOrEqual(USDC_DAY_CAP.max);
        // What is offered must itself be saveable.
        const check = checkUsdc({
          usdc: { model: model.id, ...limits },
          intervalMinutes: minutes,
          chains: ["solana"],
        });
        expect(check.errors, `${model.id} at ${minutes} min`).toEqual({});
      }
    }
  });

  it("stores a limit a slider hands back in whole cents", () => {
    expect(limitCents(0.05 + 2 * 0.05)).toBe(0.15);
    expect(limitCents(0.1 + 0.2)).toBe(0.3);
    expect(limitCents(0.049999999999)).toBe(USDC_RUN_CAP.min);
    expect(limitCents(3)).toBe(3);
  });

  it("falls back to the default model's limits for a model it does not know", () => {
    expect(suggestedLimits("openai/not-a-model", 60)).toEqual(suggestedLimits(DEFAULT_PAY_PER_USE_MODEL, 60));
  });

  it("says what the wallet must hold: the run limit plus the amount always left in it", () => {
    expect(walletNeedUsd({ maxUsdPerRun: 0.15 })).toBe(Number((0.15 + WALLET_FLOOR_USD).toFixed(2)));
    expect(walletNeedUsd({ maxUsdPerRun: 2 })).toBe(2 + WALLET_FLOOR_USD);
  });

  /**
   * The form quotes this figure; the check before a run asks for the same one
   * (`runFundsNeededUsd`: the run limit plus the floor). They must be one number. What a
   * live agent keeps out of its trades is a different, larger figure (two runs' worth),
   * and is not what the wallet has to hold for a run to start.
   */
  it("quotes the same wallet figure the check before a run asks for", () => {
    for (const maxUsdPerRun of [USDC_RUN_CAP.min, 0.15, 0.45, 1, USDC_RUN_CAP.max]) {
      expect(walletNeedUsd({ maxUsdPerRun })).toBe(runFundsNeededUsd(usdcConfig({ maxUsdPerRun })));
    }
  });

  it("cuts a pay-per-use run's steps at the product's ceiling and leaves a key run's alone", () => {
    expect(stepsAllowed(40, "usdc")).toBe(MAX_PAID_STEPS);
    expect(stepsAllowed(12, "usdc")).toBe(12);
    expect(stepsAllowed(40, "key")).toBe(40);
  });

  it("states the same step limit the run applies", () => {
    for (const maxSteps of [2, 12, 20, 21, 40]) {
      const config = keyConfig({ llm: { ...DEFAULT_AGENT_CONFIG.llm, maxSteps } });
      expect(stepsAllowed(maxSteps, "usdc")).toBe(paidStepLimit(config));
    }
  });
});

describe("checkUsdc", () => {
  const good = defaultUsdc(60);
  const check = (usdc: UsdcSettings | undefined, intervalMinutes = 60, chains: string[] = ["solana"]) =>
    checkUsdc({ usdc, intervalMinutes, chains });

  it("passes the defaults on the default schedule", () => {
    expect(check(good)).toEqual({ errors: {}, warnings: {} });
  });

  it("refuses a schedule expected to cost more in a day than the daily limit", () => {
    // Every five minutes on the default model is about ten dollars a day; the default limit is three.
    const result = check(good, 5);
    expect(result.errors.maxUsdPerDay).toContain("more than its $3.00 daily limit");
    expect(result.errors.maxUsdPerDay).toContain("Raise the limit, run it less often, or pick a cheaper model.");
    expect(firstUsdcError(result)).toBe(result.errors.maxUsdPerDay);
  });

  it("accepts the same schedule once the limit covers it, and a manual schedule at any limit", () => {
    expect(check({ ...good, ...suggestedLimits(good.model, 5) }, 5).errors).toEqual({});
    expect(check({ ...good, maxUsdPerDay: USDC_DAY_CAP.min }, 0).errors).toEqual({});
  });

  it("refuses a dearer model on limits that fitted a cheaper one", () => {
    const haiku = check({ ...good, model: "anthropic/claude-haiku-4.5" }, 60);
    expect(haiku.errors.maxUsdPerDay).toBeDefined();
    // The run limit is under a typical run on it too. That is worth saying and stops nothing.
    expect(haiku.warnings.maxUsdPerRun).toContain("most runs will stop before they finish");
    expect(haiku.errors.maxUsdPerRun).toBeUndefined();
  });

  it("refuses a model that is not offered, and a choice with no model at all", () => {
    expect(check({ ...good, model: "anthropic/claude-opus-5.5" }).errors.model).toContain("not offered");
    expect(check(undefined).errors.model).toBe("Pick a model for pay-per-use thinking.");
  });

  it("refuses limits outside their ranges, and ones that are not numbers", () => {
    expect(check({ ...good, maxUsdPerRun: USDC_RUN_CAP.min - 0.01 }).errors.maxUsdPerRun).toContain("between $0.05 and $2.00");
    expect(check({ ...good, maxUsdPerRun: USDC_RUN_CAP.max + 0.01 }).errors.maxUsdPerRun).toBeDefined();
    expect(check({ ...good, maxUsdPerDay: USDC_DAY_CAP.min - 0.01 }).errors.maxUsdPerDay).toContain("between $0.50 and $50.00");
    expect(check({ ...good, maxUsdPerDay: USDC_DAY_CAP.max + 1 }).errors.maxUsdPerDay).toBeDefined();
    expect(check({ ...good, maxUsdPerRun: Number.NaN }).errors.maxUsdPerRun).toBeDefined();
    expect(check({ ...good, maxUsdPerDay: Number.POSITIVE_INFINITY }).errors.maxUsdPerDay).toBeDefined();
  });

  it("refuses a run limit above the whole day's", () => {
    const result = check({ ...good, maxUsdPerRun: 2, maxUsdPerDay: 1 }, 0);
    expect(result.errors.maxUsdPerRun).toContain("One run cannot be allowed more than the whole day");
  });

  it("refuses an agent with no Solana wallet to pay from", () => {
    const result = check(good, 60, ["base"]);
    expect(result.errors.chains).toContain("Add Solana to its chains, or use your own API key.");
    expect(firstUsdcError(result)).toBe(result.errors.chains);
    expect(check(good, 60, ["solana", "base"]).errors.chains).toBeUndefined();
  });

  it("has nothing to report first when nothing is wrong", () => {
    expect(firstUsdcError(check(good))).toBeNull();
  });

  /**
   * The server refuses a save for its own reasons (`usdcChoiceProblem`). The form must
   * never pass what the server will refuse, or the owner is told "check the form" by a
   * form that shows nothing wrong.
   */
  it("never passes a choice the server would refuse", () => {
    const models = [...PAY_PER_USE_MODELS.map((model) => model.id), "vendor/not-offered"];
    const runs = [USDC_RUN_CAP.min, 0.15, 1, USDC_RUN_CAP.max];
    const days = [USDC_DAY_CAP.min, 3, USDC_DAY_CAP.max];
    let passed = 0;
    for (const model of models) {
      for (const maxUsdPerRun of runs) {
        for (const maxUsdPerDay of days) {
          for (const chains of [["solana"], ["base"], ["solana", "base"]] as Array<Array<"solana" | "base">>) {
            for (const intervalMinutes of [0, 5, 60, 1_440]) {
              const usdc = { model, maxUsdPerRun, maxUsdPerDay };
              const errors = checkUsdc({ usdc, intervalMinutes, chains }).errors;
              if (Object.keys(errors).length > 0) continue;
              passed += 1;
              const config = { ...usdcConfig(usdc, intervalMinutes), chains };
              expect(usdcChoiceProblem(config), JSON.stringify({ usdc, chains, intervalMinutes })).toBeNull();
            }
          }
        }
      }
    }
    // The grid really does contain choices that pass, so the loop above is not vacuous.
    expect(passed).toBeGreaterThan(50);
    // And a choice with no limits block at all is refused by both.
    expect(usdcChoiceProblem(keyConfig({ llm: { ...DEFAULT_AGENT_CONFIG.llm, source: "usdc" } }))).not.toBeNull();
    expect(firstUsdcError(check(undefined))).not.toBeNull();
  });
});

describe("chooseSource", () => {
  it("writes the mode, the default model and the suggested limits when pay-per-use is chosen", () => {
    const { config } = chooseSource(keyConfig(), "usdc");
    expect(config.llm.source).toBe("usdc");
    expect(config.llm.usdc).toEqual(defaultUsdc(USDC_DEFAULT_INTERVAL_MINUTES));
    // The key fields are left where they were: nothing about the key model is lost.
    expect(config.llm.provider).toBe(DEFAULT_AGENT_CONFIG.llm.provider);
    expect(config.llm.model).toBe(DEFAULT_AGENT_CONFIG.llm.model);
  });

  it("moves a schedule still on the key default to the pay-per-use default, and says so", () => {
    const change = chooseSource(keyConfig(), "usdc");
    expect(KEY_INTERVAL).not.toBe(USDC_DEFAULT_INTERVAL_MINUTES);
    expect(change.config.schedule.intervalMinutes).toBe(USDC_DEFAULT_INTERVAL_MINUTES);
    expect(change.scheduleMovedFrom).toBe(KEY_INTERVAL);
  });

  it("leaves a schedule somebody chose alone, including a manual one", () => {
    for (const minutes of [0, 5, 240, 1_440]) {
      const change = chooseSource(keyConfig({ schedule: { intervalMinutes: minutes } }), "usdc");
      expect(change.config.schedule.intervalMinutes).toBe(minutes);
      expect(change.scheduleMovedFrom).toBeNull();
      // The limits offered fit the schedule that was kept.
      expect(change.config.llm.usdc).toEqual(defaultUsdc(minutes));
    }
  });

  it("puts back the limits last used in the form instead of fresh suggestions", () => {
    const remembered: UsdcSettings = { model: "openai/gpt-4o-mini", maxUsdPerRun: 0.25, maxUsdPerDay: 4.5 };
    expect(chooseSource(keyConfig(), "usdc", { remembered }).config.llm.usdc).toEqual(remembered);
  });

  it("returns a builder draft to exactly the key config it was", () => {
    const before = keyConfig();
    const there = chooseSource(before, "usdc");
    const back = chooseSource(there.config, "key", { restoreInterval: there.scheduleMovedFrom });
    expect(back.config).toEqual(before);
    expect("source" in back.config.llm).toBe(false);
    expect("usdc" in back.config.llm).toBe(false);
  });

  it("does not undo a schedule the owner changed after the switch", () => {
    const there = chooseSource(keyConfig(), "usdc");
    const edited = { ...there.config, schedule: { intervalMinutes: 240 } };
    expect(chooseSource(edited, "key", { restoreInterval: there.scheduleMovedFrom }).config.schedule.intervalMinutes).toBe(240);
  });

  it("names the key source for an agent whose saved config names one, and drops the limits", () => {
    const back = chooseSource(usdcConfig(), "key", { explicitKey: true });
    expect(back.config.llm.source).toBe("key");
    expect(back.config.llm.usdc).toBeUndefined();
    expect(thinkSource(back.config)).toBe("key");
  });

  it("changes nothing when the mode is already the one asked for", () => {
    const key = keyConfig();
    expect(chooseSource(key, "key").config).toBe(key);
    const usdc = usdcConfig({ maxUsdPerRun: 0.5 });
    expect(chooseSource(usdc, "usdc").config).toBe(usdc);
  });

  it("fills in the limits of a config that names pay-per-use without them", () => {
    const bare = keyConfig({ llm: { ...DEFAULT_AGENT_CONFIG.llm, source: "usdc" }, schedule: { intervalMinutes: 240 } });
    expect(chooseSource(bare, "usdc").config.llm.usdc).toEqual(defaultUsdc(240));
  });

  it("never mutates the config it was given", () => {
    const before = keyConfig();
    const copy = structuredClone(before);
    chooseSource(before, "usdc");
    expect(before).toEqual(copy);
  });
});

describe("stripPayPerUse", () => {
  it("returns a key config as the same object, untouched", () => {
    const key = keyConfig();
    expect(stripPayPerUse(key)).toBe(key);
  });

  it("removes the mode and the limits, and nothing else", () => {
    const stripped = stripPayPerUse(usdcConfig());
    expect(stripped.llm).toEqual(DEFAULT_AGENT_CONFIG.llm);
    expect(stripped.schedule.intervalMinutes).toBe(USDC_DEFAULT_INTERVAL_MINUTES);
  });
});

describe("what each stop says and where its fix is", () => {
  it("uses describeInferenceStop's words for every reason", () => {
    for (const reason of REASONS) {
      const context = { runCapUsd: 0.15, dayCapUsd: 3, model: "Gemini 2.5 Flash" };
      expect(stopWords(reason, context)).toEqual({
        reason,
        kind: INFERENCE_STOPS[reason],
        ...describeInferenceStop(reason, context),
      });
    }
  });

  it("still reads as a stop when the stored reason is one this build does not know", () => {
    const words = stopWords("a_reason_from_the_future");
    expect(words.reason).toBeNull();
    expect(words.title).toBe("Pay-per-use thinking is on hold");
    // The stored text is never shown as it came.
    expect(`${words.title} ${words.detail}`).not.toContain("a_reason_from_the_future");
  });

  it("has a fix for every reason, pointed at a settings section or a page", () => {
    for (const reason of REASONS) {
      const fix = stopFix(reason);
      expect(fix.label.length, reason).toBeGreaterThan(0);
      if ("hash" in fix) expect(fix.hash, reason).toMatch(/^#[a-z]+$/);
      else expect(fix.path, reason).toMatch(/^\//);
    }
  });

  it("sends each fixable reason to the place that fixes it", () => {
    expect(stopFix("needs_funds")).toEqual({ label: "Add USDC", hash: "#wallets" });
    expect(stopFix("agent_day_cap")).toEqual({ label: "Raise the limit", hash: "#thinking" });
    expect(stopFix("no_wallet")).toEqual({ label: "Add Solana", hash: "#universe" });
    expect(stopFix("no_policy")).toEqual({ label: "Set the wallet limit", hash: "#budget" });
    expect(stopFix("model_unavailable")).toEqual({ label: "Pick a model", hash: "#thinking" });
    expect(stopFix("paid_no_answer")).toEqual({ label: "See the charge", path: "/money" });
    expect(stopFix("paused")).toEqual({ label: "Open settings", hash: "#thinking" });
  });

  it("names an empty wallet on a card, and calls every other hold a hold", () => {
    expect(holdChipLabel("needs_funds")).toBe("Add USDC");
    expect(holdChipLabel("paused")).toBe("On hold");
    expect(holdChipLabel("anything else")).toBe("On hold");
  });
});

describe("what a run spent on thinking", () => {
  const row = { llmSource: "usdc", model: "google/gemini-2.5-flash", inferenceSpendUsd: "0.073400", stopReason: null };

  it("is nothing at all for a run that thought on a key", () => {
    expect(runThinking({ ...row, llmSource: "key" })).toBeNull();
    // Rows written before the column existed are key runs.
    expect(runThinking({ ...row, llmSource: null })).toBeNull();
    // A stop reason alone does not make a run a pay-per-use run.
    expect(runThinking({ ...row, llmSource: null, stopReason: "run_cap" })).toBeNull();
  });

  it("reads the spend and the model off a pay-per-use run", () => {
    expect(runThinking(row)).toEqual({ spendUsd: 0.0734, model: "google/gemini-2.5-flash", stop: null });
  });

  it("gives the reason a run stopped early in the same words as the banner", () => {
    for (const reason of REASONS) {
      const thinking = runThinking({ ...row, stopReason: reason });
      expect(thinking?.stop).toEqual({
        reason,
        kind: INFERENCE_STOPS[reason],
        ...describeInferenceStop(reason, { model: "Gemini 2.5 Flash" }),
      });
    }
  });

  it("reads a spend that is missing or not a number as zero, never as a figure", () => {
    expect(runThinking({ ...row, inferenceSpendUsd: null })?.spendUsd).toBe(0);
    expect(runThinking({ ...row, inferenceSpendUsd: "not-a-number" })?.spendUsd).toBe(0);
    expect(runThinking({ ...row, inferenceSpendUsd: "-1" })?.spendUsd).toBe(0);
  });

  it("is read back in the browser by shape, and refused when the shape is wrong", () => {
    const thinking = runThinking({ ...row, stopReason: "run_cap" });
    expect(readRunThinking({ id: "run_1", thinking })).toEqual(thinking);
    expect(readRunThinking({ id: "run_1" })).toBeNull();
    expect(readRunThinking({ id: "run_1", thinking: null })).toBeNull();
    expect(readRunThinking({ thinking: { spendUsd: "0.07" } })).toBeNull();
    expect(readRunThinking(null)).toBeNull();
    // A stop that is not the expected shape is dropped; the spend still shows.
    expect(readRunThinking({ thinking: { spendUsd: 0.07, model: 4, stop: { title: 1 } } })).toEqual({
      spendUsd: 0.07,
      model: null,
      stop: null,
    });
  });

  it("prints small amounts finely enough that a paid run never reads as free", () => {
    expect(thinkingUsd(0)).toBe("$0.00");
    expect(thinkingUsd(0.0021)).toBe("$0.0021");
    expect(thinkingUsd(0.07)).toBe("$0.07");
    expect(thinkingUsd(0.0734)).toBe("$0.073");
    expect(thinkingUsd(1.5)).toBe("$1.50");
    expect(thinkingUsd(12.345)).toBe("$12.35");
  });

  it("names a listed model by its label and an unlisted one by its id", () => {
    expect(payPerUseModelLabel("google/gemini-2.5-flash")).toBe("Gemini 2.5 Flash");
    expect(payPerUseModelLabel("vendor/unknown")).toBe("vendor/unknown");
    expect(payPerUseModelLabel(null)).toBe("");
  });
});

describe("a run's thinking line, as the run list words it", () => {
  const row = { llmSource: "usdc", model: "google/gemini-2.5-flash", inferenceSpendUsd: "0.073400", stopReason: null };
  /** Anything that says the money was certainly taken. */
  const CLAIMS_PAID = /\bpaid\b|the charge is listed/i;

  it("calls the amount counted, never paid, and says where the confirmed figure is", () => {
    const shown = runThinkingShown(runThinking(row)!);
    expect(shown).toEqual({ amount: "$0.073", amountNote: RUN_SPEND_NOTE, notFinal: false, stop: null, sentence: null });
    // The figure is what the ledger counted as charged, which is more than what is
    // proven paid, so the row does not claim more for it than that.
    expect(RUN_SPEND_NOTE).not.toMatch(/\bpaid\b/i);
    expect(RUN_SPEND_NOTE).toContain("counted as charged");
    expect(RUN_SPEND_NOTE).toContain("Money has what the chain confirmed");
  });

  it("says on every run, not only a stopped one, that counted is not confirmed and a step can turn out not charged", () => {
    // Any counted step can turn out never to have been charged after the run row is
    // written: an answered step the gateway gave no proof of payment for, or a step that
    // was signed for and never sent because the run's clock ran out. Neither leaves a
    // stop reason that says so, so the plain note has to carry it. It is worded to hold
    // both before the reconciler has brought the stored figure down and after.
    for (const stopReason of [null, "deadline", "run_cap", "step_limit", "signature_failed"]) {
      const shown = runThinkingShown(runThinking({ ...row, stopReason })!);
      expect(shown.amountNote, String(stopReason)).toBe(RUN_SPEND_NOTE);
      expect(shown.amountNote, String(stopReason)).toContain("Counted is not confirmed");
      expect(shown.amountNote, String(stopReason)).toContain("one the chain shows never landed was not charged");
      expect(shown.amountNote, String(stopReason)).not.toMatch(CLAIMS_PAID);
      // Nothing in it depends on whether the figure was written again since.
      expect(shown.amountNote, String(stopReason)).not.toMatch(/rewritten|still in it|when it ended/);
    }
  });

  it("does not call a step paid when the run stopped because it got no answer", () => {
    // Signed, the request failed, the run stopped with paid_no_answer and its amount was
    // written including that step. The reconciler may since have proved the payment never
    // landed (not_charged). The stored sentence is never rewritten, and the stored amount
    // only by a best-effort write after that verdict, so the row's words must hold either way.
    const thinking = runThinking({ ...row, inferenceSpendUsd: "0.012000", stopReason: "paid_no_answer" })!;

    const shown = runThinkingShown(thinking);
    expect(shown.notFinal).toBe(true);
    expect(shown.amount).toBe("up to $0.012");
    expect(shown.amountNote).toBe(RUN_SPEND_NOT_FINAL_NOTE);
    expect(shown.stop).toEqual({ kind: "platform", ...NO_ANSWER_RUN_WORDS });
    expect(shown.sentence).toBe(NO_ANSWER_RUN_WORDS.detail);
    // Nothing the row prints asserts the payment. Each says what happens either way.
    for (const text of [shown.amountNote, shown.stop!.title, shown.stop!.detail, shown.sentence!]) {
      expect(text, text).not.toMatch(CLAIMS_PAID);
    }
    expect(shown.stop!.detail).toContain("signed a payment for one step");
    expect(shown.stop!.detail).toContain("if the chain shows it never did, nothing was charged");
    expect(shown.amountNote).toContain("it was not charged and the figure is lower");
    // True before the reconciler has taken that step off the stored figure and after:
    // the note does not say the step is certainly still counted.
    expect(shown.amountNote).toContain("for as long as the ledger counts it");
  });

  it("marks the amount as not final after a rerouted step too, and keeps that stop's own words", () => {
    const thinking = runThinking({ ...row, stopReason: "rerouted" })!;
    const shown = runThinkingShown(thinking);
    expect(shown.amount).toBe("up to $0.073");
    expect(shown.amountNote).toBe(RUN_SPEND_NOT_FINAL_NOTE);
    // The contract's sentence for it is already conditional, and is not replaced.
    expect(shown.stop).toEqual({ kind: thinking.stop!.kind, title: thinking.stop!.title, detail: thinking.stop!.detail });
    expect(shown.sentence).toBeNull();
  });

  it("has nothing in question when the run was charged nothing", () => {
    const shown = runThinkingShown(runThinking({ ...row, inferenceSpendUsd: "0", stopReason: "paid_no_answer" })!);
    expect(shown.amount).toBe("$0.00");
    expect(shown.notFinal).toBe(false);
  });

  it("words every other stop exactly as the banner and the notification do", () => {
    for (const reason of REASONS) {
      if (reason === "paid_no_answer") continue;
      const thinking = runThinking({ ...row, stopReason: reason })!;
      const shown = runThinkingShown(thinking);
      expect(shown.stop, reason).toEqual({ kind: INFERENCE_STOPS[reason], ...describeInferenceStop(reason, { model: "Gemini 2.5 Flash" }) });
      expect(shown.sentence, reason).toBeNull();
      expect(shown.notFinal, reason).toBe(reason === "rerouted");
    }
  });
});
