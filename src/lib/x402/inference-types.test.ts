import { describe, expect, it } from "vitest";
import { isModelId } from "@/lib/agent/models";
import {
  DEFAULT_PAY_PER_USE_MODEL,
  HARD_STEP_CAP_USD,
  MAX_PAID_STEPS,
  PAY_PER_USE_MODELS,
  TYPICAL_RUN,
  USDC_RUN_CAP,
  estimateRunUsd,
  estimateStepUsd,
  payPerUseModel,
  stepCapUsd,
} from "./inference-types";

/** The size of a run's last allowed request, as the estimates grow it. */
const lastStep = (step: number) => ({ chars: TYPICAL_RUN.openingChars + step * TYPICAL_RUN.charsPerStep, messages: 2 + step * 2 });

describe("the models offered for pay-per-use", () => {
  it("lists each once, by an id that can be sent, with a name, a note and a list price", () => {
    const ids = PAY_PER_USE_MODELS.map((model) => model.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const model of PAY_PER_USE_MODELS) {
      expect(isModelId(model.id), model.id).toBe(true);
      expect(model.label.length, model.id).toBeGreaterThan(0);
      expect(model.note.length, model.id).toBeGreaterThan(0);
      expect(model.inputPerMTok, model.id).toBeGreaterThan(0);
      expect(model.outputPerMTok, model.id).toBeGreaterThanOrEqual(model.inputPerMTok);
    }
  });

  it("starts a new pay-per-use agent on a model it offers, and that one opens the list", () => {
    expect(payPerUseModel(DEFAULT_PAY_PER_USE_MODEL)).not.toBeNull();
    expect(PAY_PER_USE_MODELS[0].id).toBe(DEFAULT_PAY_PER_USE_MODEL);
  });

  it("offers more than the cheap ones: a strong model from each of the two big providers", () => {
    const ids = PAY_PER_USE_MODELS.map((model) => model.id);
    for (const id of ["openai/gpt-4.1", "openai/gpt-4o", "anthropic/claude-sonnet-5.5", "anthropic/claude-opus-5.5"]) {
      expect(ids, id).toContain(id);
    }
  });

  /**
   * A model whose honest price for a late step is above the ceiling would be refused
   * there on every long run, and one whose typical run is above the top run limit could
   * never finish. Neither belongs in the list.
   */
  it("offers none that the limits themselves would stop", () => {
    for (const model of PAY_PER_USE_MODELS) {
      const { chars, messages } = lastStep(MAX_PAID_STEPS);
      const dearest = estimateStepUsd(model, chars, messages);
      expect(dearest, `${model.id}: a late step`).toBeLessThan(HARD_STEP_CAP_USD);
      // The ceiling is twice the estimate, so an honest quote has room under it.
      expect(stepCapUsd(dearest), model.id).toBeGreaterThan(dearest);
      expect(estimateRunUsd(model), `${model.id}: a typical run`).toBeLessThan(USDC_RUN_CAP.max);
    }
  });

  /** The newest Claude models refuse a request that sets a temperature. */
  it("sends no temperature to the Claude 5 family", () => {
    const family = PAY_PER_USE_MODELS.filter((model) => /^anthropic\/claude-(sonnet|opus|fable)-5/.test(model.id));
    expect(family.length).toBeGreaterThan(0);
    for (const model of family) expect(model.omitTemperature, model.id).toBe(true);
    // And the plain ones keep the agent's own.
    for (const id of ["google/gemini-2.5-flash", "openai/gpt-4.1", "anthropic/claude-haiku-4.5"]) {
      expect(payPerUseModel(id)?.omitTemperature ?? false, id).toBe(false);
    }
  });

  it("counts what the gateway adds per step into a model's estimate", () => {
    const opus = payPerUseModel("anthropic/claude-opus-5.5")!;
    const without = estimateStepUsd({ ...opus, stepSurchargeUsd: undefined }, 14_500, 2);
    expect(estimateStepUsd(opus, 14_500, 2)).toBeCloseTo(without + (opus.stepSurchargeUsd ?? 0), 6);
  });
});
