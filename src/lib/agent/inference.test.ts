/**
 * The rules of pay-per-use thinking that need no database: which mode an agent is in,
 * whether a choice of pay-per-use may be saved, when a run is told to wrap up, how a
 * stop ends it, and how a hold backs off and when its owner is told.
 */
import { describe, expect, it } from "vitest";
import type { AgentConfig } from "@/db/schema";
import { DEFAULT_AGENT_CONFIG } from "./config";
import {
  INVOCATION_LIMIT_MS,
  INVOCATION_PAY_UNTIL_MS,
  NO_INFERENCE_HOLD,
  USDC_NOT_AVAILABLE,
  brainOf,
  canThink,
  fitsInvocation,
  holdsAgent,
  isHeldAt,
  nextHold,
  paidStepLimit,
  payDeadlineAt,
  stopOutcome,
  thinkSource,
  thinkingModel,
  thinkingReserveUsd,
  usdcChoiceProblem,
  wrapUpReason,
  type HoldState,
} from "./inference";
import {
  DEFAULT_PAY_PER_USE_MODEL,
  INFERENCE_STOPS,
  MAX_PAID_STEPS,
  MIN_INVOCATION_REMAINING_MS,
  SIGN_MIN_REMAINING_MS,
  WALLET_FLOOR_USD,
  type InferenceStopReason,
} from "@/lib/x402/inference-types";

const KEY: AgentConfig = DEFAULT_AGENT_CONFIG;
const usdc = (overrides: Partial<NonNullable<AgentConfig["llm"]["usdc"]>> = {}, config: Partial<AgentConfig> = {}): AgentConfig => ({
  ...DEFAULT_AGENT_CONFIG,
  ...config,
  llm: {
    ...DEFAULT_AGENT_CONFIG.llm,
    source: "usdc",
    usdc: { model: DEFAULT_PAY_PER_USE_MODEL, maxUsdPerRun: 0.3, maxUsdPerDay: 3, ...overrides },
  },
});

const REASONS = Object.keys(INFERENCE_STOPS) as InferenceStopReason[];
const NOW = new Date("2026-10-06T12:00:00.000Z");
const minutesFrom = (from: Date, to: Date) => (to.getTime() - from.getTime()) / 60_000;

describe("the mode", () => {
  it("is the config's own word, and a config that says nothing is a key agent", () => {
    expect(thinkSource(KEY)).toBe("key");
    expect(thinkSource({ llm: { ...KEY.llm, source: "key" } })).toBe("key");
    expect(thinkSource(usdc())).toBe("usdc");
    expect(thinkSource(null)).toBe("key");
    expect(thinkSource(undefined)).toBe("key");
    // A block of limits without the word is not a choice.
    expect(thinkSource({ llm: { ...KEY.llm, usdc: { model: DEFAULT_PAY_PER_USE_MODEL, maxUsdPerRun: 0.3, maxUsdPerDay: 3 } } })).toBe("key");
  });

  it("names the model the agent really thinks on, and nothing for a row with no llm block", () => {
    expect(thinkingModel(KEY)).toBe(KEY.llm.model);
    expect(thinkingModel(usdc({ model: "openai/gpt-4o-mini" }))).toBe("openai/gpt-4o-mini");
    expect(thinkingModel({ llm: { ...KEY.llm, source: "usdc" } })).toBe(DEFAULT_PAY_PER_USE_MODEL);
    expect(thinkingModel(null)).toBe("");
    expect(thinkingModel({} as unknown as AgentConfig)).toBe("");
  });

  it("gives every gate one answer about what an agent thinks on", () => {
    // A key agent: its key, or nothing; the scripted model thinks for it either way.
    expect(brainOf({ llmKeyId: "key_1", config: KEY }, false)).toBe("key");
    expect(brainOf({ llmKeyId: null, config: KEY }, false)).toBe("none");
    expect(brainOf({ llmKeyId: null, config: KEY }, true)).toBe("mock");
    // A pay-per-use agent needs no key, and a key left on its row changes nothing.
    expect(brainOf({ llmKeyId: null, config: usdc() }, false)).toBe("usdc");
    expect(brainOf({ llmKeyId: "key_1", config: usdc() }, false)).toBe("usdc");
    // Still pay-per-use under the scripted model: it keeps its own check and its holds.
    expect(brainOf({ llmKeyId: null, config: usdc() }, true)).toBe("usdc");

    expect(canThink({ llmKeyId: null, config: KEY }, false)).toBe(false);
    expect(canThink({ llmKeyId: null, config: KEY }, true)).toBe(true);
    expect(canThink({ llmKeyId: "key_1", config: KEY }, false)).toBe(true);
    expect(canThink({ llmKeyId: null, config: usdc() }, false)).toBe(true);
    expect(canThink({ llmKeyId: null, config: null }, false)).toBe(false);
  });
});

describe("choosing pay-per-use", () => {
  it("has nothing to say about a key agent, or a complete choice", () => {
    expect(usdcChoiceProblem(KEY)).toBeNull();
    expect(usdcChoiceProblem(usdc())).toBeNull();
    expect(usdcChoiceProblem(usdc({ maxUsdPerRun: 3, maxUsdPerDay: 3 }))).toBeNull();
  });

  it("refuses the word without the model and limits", () => {
    expect(usdcChoiceProblem({ ...KEY, llm: { ...KEY.llm, source: "usdc" } })).toMatch(/needs a model/);
  });

  it("refuses a model that is not offered", () => {
    expect(usdcChoiceProblem(usdc({ model: "anthropic/claude-opus-5.5" }))).toMatch(/no longer offered/);
  });

  it("refuses a day limit under the limit for one run", () => {
    expect(usdcChoiceProblem(usdc({ maxUsdPerRun: 2, maxUsdPerDay: 1 }))).toMatch(/daily thinking limit/);
  });

  it("refuses an agent with no Solana wallet to pay from", () => {
    expect(usdcChoiceProblem(usdc({}, { chains: ["base"] }))).toMatch(/Solana wallet/);
    expect(usdcChoiceProblem(usdc({}, { chains: ["base", "solana"] }))).toBeNull();
  });

  it("says a sentence, not a flag name, to an account that may not use it", () => {
    expect(USDC_NOT_AVAILABLE).not.toMatch(/INFERENCE_USDC/);
  });
});

describe("what a live pay-per-use agent keeps out of its trades", () => {
  it("is nothing for a key agent", () => {
    expect(thinkingReserveUsd(KEY)).toBe(0);
    expect(thinkingReserveUsd(null)).toBe(0);
  });

  it("is one run's limit plus the wallet floor", () => {
    expect(thinkingReserveUsd(usdc({ maxUsdPerRun: 0.3 }))).toBeCloseTo(0.3 + WALLET_FLOOR_USD, 6);
    expect(thinkingReserveUsd(usdc({ maxUsdPerRun: 2 }))).toBeCloseTo(2 + WALLET_FLOOR_USD, 6);
  });

  it("is the floor alone when the limit is missing, and never more than the product's ceiling", () => {
    expect(thinkingReserveUsd({ llm: { ...KEY.llm, source: "usdc" } })).toBeCloseTo(WALLET_FLOOR_USD, 6);
    expect(thinkingReserveUsd(usdc({ maxUsdPerRun: Number.NaN }))).toBeCloseTo(WALLET_FLOOR_USD, 6);
    expect(thinkingReserveUsd(usdc({ maxUsdPerRun: 500 }))).toBeCloseTo(2 + WALLET_FLOOR_USD, 6);
  });
});

describe("one run's clocks and steps", () => {
  it("starts a run only with enough of the invocation left", () => {
    const start = 1_000_000;
    expect(fitsInvocation(start, start)).toBe(true);
    const lastMoment = start + INVOCATION_LIMIT_MS - MIN_INVOCATION_REMAINING_MS;
    expect(fitsInvocation(start, lastMoment)).toBe(true);
    expect(fitsInvocation(start, lastMoment + 1)).toBe(false);
    // The second batch of a cron pass, two minutes in.
    expect(fitsInvocation(start, start + 120_000)).toBe(false);
  });

  it("stops paying at the earlier of the run's cut-off and the invocation's", () => {
    const invocation = 1_000_000;
    // Started at once: the run's own 240 s comes first.
    expect(payDeadlineAt(invocation + 2_000, invocation, 240_000)).toBe(invocation + 242_000);
    // Started late: the invocation's limit comes first, fifteen seconds before the platform's.
    expect(payDeadlineAt(invocation + 80_000, invocation, 240_000)).toBe(invocation + INVOCATION_PAY_UNTIL_MS);
    expect(INVOCATION_PAY_UNTIL_MS).toBeLessThan(INVOCATION_LIMIT_MS);
  });

  it("caps a pay-per-use run's steps, whatever the config asks for", () => {
    expect(paidStepLimit({ llm: { ...KEY.llm, maxSteps: 12 } })).toBe(12);
    expect(paidStepLimit({ llm: { ...KEY.llm, maxSteps: 40 } })).toBe(MAX_PAID_STEPS);
    expect(paidStepLimit({ llm: { ...KEY.llm, maxSteps: Number.NaN } })).toBe(1);
    expect(paidStepLimit(null)).toBe(1);
  });

  describe("when the next step must be the last", () => {
    const base = { stepNumber: 3, stepLimit: 20, runCapUsd: 0.3, spentUsd: 0.05, maxStepUsd: 0.01, maxStepMs: 8_000, now: 0, deadlineAt: 240_000 };

    it("is not yet, with money, time and steps to spare", () => {
      expect(wrapUpReason(base)).toBeNull();
      // Before the first step nothing is known about what a step costs.
      expect(wrapUpReason({ ...base, stepNumber: 0, spentUsd: 0, maxStepUsd: 0, maxStepMs: 0 })).toBeNull();
    });

    it("is when the budget left would not cover two and a half of the dearest step", () => {
      expect(wrapUpReason({ ...base, spentUsd: 0.3 - 0.025 })).toBeNull();
      expect(wrapUpReason({ ...base, spentUsd: 0.3 - 0.0249 })).toBe("run_cap");
      expect(wrapUpReason({ ...base, spentUsd: 0.3 })).toBe("run_cap");
    });

    it("is when the time left would not cover a signature and two of the slowest step", () => {
      const needed = SIGN_MIN_REMAINING_MS + 2 * 8_000;
      expect(wrapUpReason({ ...base, now: 240_000 - needed })).toBeNull();
      expect(wrapUpReason({ ...base, now: 240_000 - needed + 1 })).toBe("deadline");
      // A slow run wraps up earlier.
      expect(wrapUpReason({ ...base, maxStepMs: 40_000, now: 240_000 - needed })).toBe("deadline");
    });

    it("is when its ordinary steps are used up", () => {
      expect(wrapUpReason({ ...base, stepNumber: 19 })).toBeNull();
      expect(wrapUpReason({ ...base, stepNumber: 20 })).toBe("step_limit");
    });
  });
});

describe("how a stop ends its run", () => {
  it("ends a run on its own limit as a run that succeeded, with no hold", () => {
    for (const reason of ["run_cap", "deadline", "step_limit"] as const) {
      expect(stopOutcome(reason)).toEqual({ status: "succeeded", hold: false });
      expect(holdsAgent(reason)).toBe(false);
    }
  });

  it("fails the run and holds the agent for every other reason", () => {
    for (const reason of REASONS.filter((r) => INFERENCE_STOPS[r] !== "limit")) {
      expect(stopOutcome(reason)).toEqual({ status: "failed", hold: true });
    }
  });

  it("never holds an agent over the cap on runs started by hand: its schedule is not affected", () => {
    expect(holdsAgent("manual_limit")).toBe(false);
    expect(REASONS.filter((r) => !holdsAgent(r)).sort()).toEqual(["deadline", "manual_limit", "run_cap", "step_limit"]);
  });
});

describe("holds", () => {
  const none: HoldState = { ...NO_INFERENCE_HOLD };

  it("knows a hold that still has time to run from one that is due another look", () => {
    expect(isHeldAt(none, NOW)).toBe(false);
    expect(isHeldAt({ inferenceHold: "needs_funds", inferenceHoldUntil: new Date(NOW.getTime() + 1) }, NOW)).toBe(true);
    expect(isHeldAt({ inferenceHold: "needs_funds", inferenceHoldUntil: NOW }, NOW)).toBe(false);
    // A hold with no time on it must not hold for ever.
    expect(isHeldAt({ inferenceHold: "needs_funds", inferenceHoldUntil: null }, NOW)).toBe(false);
  });

  it("waits longer each time: 15, 30, 60, 120, then 360 minutes", () => {
    let state: HoldState = none;
    const waits: number[] = [];
    for (let i = 0; i < 7; i += 1) {
      const next = nextHold(state, "needs_funds", NOW);
      waits.push(minutesFrom(NOW, next.inferenceHoldUntil));
      expect(next.inferenceStrikes).toBe(i + 1);
      state = { ...state, ...next, inferenceNotifiedAt: NOW };
    }
    expect(waits).toEqual([15, 30, 60, 120, 360, 360, 360]);
  });

  it("waits for the next UTC day on a day limit, and fifteen minutes on a pause, whatever the strikes", () => {
    const struck: HoldState = { ...none, inferenceStrikes: 4 };
    for (const reason of ["agent_day_cap", "owner_day_cap", "request_limit", "platform_day_cap"] as const) {
      expect(nextHold(struck, reason, NOW).inferenceHoldUntil.toISOString()).toBe("2026-10-07T00:00:00.000Z");
    }
    for (const reason of ["halted", "paused"] as const) {
      expect(minutesFrom(NOW, nextHold(struck, reason, NOW).inferenceHoldUntil)).toBe(15);
    }
  });

  it("keeps the moment the hold began while the agent stays held", () => {
    const began = new Date(NOW.getTime() - 3_600_000);
    expect(nextHold(none, "needs_funds", NOW).inferenceHoldSince).toEqual(NOW);
    expect(nextHold({ ...none, inferenceHold: "needs_funds", inferenceHoldSince: began }, "needs_funds", NOW).inferenceHoldSince).toEqual(began);
    // A hold that was lifted and came back began again.
    expect(nextHold({ ...none, inferenceHoldSince: began, inferenceStrikes: 2 }, "needs_funds", NOW).inferenceHoldSince).toEqual(NOW);
  });

  describe("telling the owner", () => {
    const told: HoldState = { ...none, inferenceHold: "quote_failed", inferenceStrikes: 1, inferenceNotifiedAt: NOW };

    it("happens the first time", () => {
      expect(nextHold(none, "needs_funds", NOW).notify).toBe(true);
      expect(nextHold(none, "quote_failed", NOW).notify).toBe(true);
    });

    it("does not happen again for the same reason", () => {
      expect(nextHold({ ...told, inferenceHold: "needs_funds" }, "needs_funds", NOW).notify).toBe(false);
      expect(nextHold(told, "quote_failed", NOW).notify).toBe(false);
    });

    it("does not happen again when one platform reason gives way to another", () => {
      expect(nextHold(told, "paused", NOW).notify).toBe(false);
      expect(nextHold(told, "gateway_error", NOW).notify).toBe(false);
    });

    it("does not happen again when a hold was lifted by a re-check and the same trouble came back", () => {
      const lifted: HoldState = { ...told, inferenceHold: null, inferenceHoldSince: null, inferenceHoldUntil: null };
      expect(nextHold(lifted, "quote_failed", NOW).notify).toBe(false);
      // And the wait keeps growing: the strikes were not reset by the re-check.
      expect(minutesFrom(NOW, nextHold(lifted, "quote_failed", NOW).inferenceHoldUntil)).toBe(30);
    });

    it("happens again when the reason becomes one the owner can fix", () => {
      expect(nextHold(told, "needs_funds", NOW).notify).toBe(true);
      expect(nextHold({ ...told, inferenceHold: "no_policy" }, "needs_funds", NOW).notify).toBe(true);
    });
  });
});
