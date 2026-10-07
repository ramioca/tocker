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
  RESERVED_RUNS,
  brainOf,
  canThink,
  countsAsStrike,
  fitsInvocation,
  holdsAgent,
  isHeldAt,
  lastStepStartAt,
  nextHold,
  paidStepLimit,
  payDeadlineAt,
  runFundsNeededUsd,
  stopOutcome,
  thinkSource,
  thinkingModel,
  thinkingReserveUsd,
  usdcChoiceProblem,
  wrapUpReason,
  type HoldState,
} from "./inference";
import { capsFor } from "@/lib/x402/inference-budget";
import {
  DEFAULT_PAY_PER_USE_MODEL,
  INFERENCE_STOPS,
  MAX_PAID_STEPS,
  MIN_INVOCATION_REMAINING_MS,
  NO_NEW_STEP_AFTER_MS,
  SIGN_MIN_REMAINING_MS,
  USDC_RUN_CAP,
  WALLET_FLOOR_USD,
  inferenceFlags,
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

  it("is two runs' limits plus the wallet floor: the rest of this run, and the next one", () => {
    expect(RESERVED_RUNS).toBe(2);
    expect(thinkingReserveUsd(usdc({ maxUsdPerRun: 0.3 }))).toBeCloseTo(2 * 0.3 + WALLET_FLOOR_USD, 6);
    expect(thinkingReserveUsd(usdc({ maxUsdPerRun: 2 }))).toBeCloseTo(2 * 2 + WALLET_FLOOR_USD, 6);
  });

  it("is the floor alone when the limit is missing, and never more than the product's ceiling", () => {
    expect(thinkingReserveUsd({ llm: { ...KEY.llm, source: "usdc" } })).toBeCloseTo(WALLET_FLOOR_USD, 6);
    expect(thinkingReserveUsd(usdc({ maxUsdPerRun: Number.NaN }))).toBeCloseTo(WALLET_FLOOR_USD, 6);
    expect(thinkingReserveUsd(usdc({ maxUsdPerRun: 500 }))).toBeCloseTo(2 * USDC_RUN_CAP.max + WALLET_FLOOR_USD, 6);
  });

  describe("what a run needs in the wallet before it starts", () => {
    it("is the run limit plus the floor, the sum the check before a run makes from the run's caps", () => {
      expect(runFundsNeededUsd(KEY)).toBe(0);
      expect(runFundsNeededUsd(null)).toBe(0);
      for (const maxUsdPerRun of [USDC_RUN_CAP.min, 0.15, 0.3, 0.45, 1, USDC_RUN_CAP.max, 500, Number.NaN]) {
        const config = usdc({ maxUsdPerRun });
        expect(runFundsNeededUsd(config)).toBeCloseTo(capsFor(config, inferenceFlags({})).runUsd + WALLET_FLOOR_USD, 9);
      }
    });

    /**
     * The point of holding back two runs. A buy is placed mid-run with every dollar a buy
     * may spend, so the wallet is left at exactly the reserve; the run then goes on
     * thinking, by as much as its whole limit; and the next run must still be let in.
     * With one run held back (the reserve equal to what the next run needs) the last
     * line fails by whatever the run spent after its buy.
     */
    it("is still there after a buy that used all the spendable cash and a whole run's thinking on top", () => {
      for (const maxUsdPerRun of [USDC_RUN_CAP.min, 0.15, 0.3, 0.45, 1, USDC_RUN_CAP.max]) {
        const config = usdc({ maxUsdPerRun });
        const leftAfterTheBuy = thinkingReserveUsd(config);
        const leftAfterTheRun = leftAfterTheBuy - maxUsdPerRun;
        expect(leftAfterTheRun + 1e-9).toBeGreaterThanOrEqual(runFundsNeededUsd(config));
      }
    });
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
    // A run whose model call began at 0: no new step after 150 s, nothing signed after 165 s.
    const base = {
      stepNumber: 3,
      stepLimit: 20,
      runCapUsd: 0.3,
      spentUsd: 0.05,
      maxStepUsd: 0.01,
      maxStepMs: 8_000,
      now: 0,
      deadlineAt: 240_000,
      noNewStepAt: NO_NEW_STEP_AFTER_MS,
    };

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

    it("knows the last moment a step can start: no new step, or no signature, whichever is first", () => {
      expect(lastStepStartAt(base)).toBe(NO_NEW_STEP_AFTER_MS);
      // A run started late in its invocation: the deadline, less the time a signature needs, comes first.
      expect(lastStepStartAt({ deadlineAt: 200_000, noNewStepAt: NO_NEW_STEP_AFTER_MS })).toBe(200_000 - SIGN_MIN_REMAINING_MS);
    });

    it("is when the time left before that moment would not cover two of the slowest step", () => {
      const last = NO_NEW_STEP_AFTER_MS;
      expect(wrapUpReason({ ...base, now: last - 2 * 8_000 })).toBeNull();
      expect(wrapUpReason({ ...base, now: last - 2 * 8_000 + 1 })).toBe("deadline");
      // A slow run wraps up earlier.
      expect(wrapUpReason({ ...base, maxStepMs: 40_000, now: last - 2 * 8_000 })).toBe("deadline");
    });

    it("is measured to the deadline when that, less a signature's time, comes before the no-new-step moment", () => {
      const late = { ...base, deadlineAt: 200_000 };
      const last = 200_000 - SIGN_MIN_REMAINING_MS;
      expect(wrapUpReason({ ...late, now: last - 2 * 8_000 })).toBeNull();
      expect(wrapUpReason({ ...late, now: last - 2 * 8_000 + 1 })).toBe("deadline");
      // Before the first step nothing is known about how long one takes: only a run with no time at all is wrapped up.
      expect(wrapUpReason({ ...late, stepNumber: 0, maxStepMs: 0, maxStepUsd: 0, spentUsd: 0, now: last })).toBeNull();
      expect(wrapUpReason({ ...late, stepNumber: 0, maxStepMs: 0, maxStepUsd: 0, spentUsd: 0, now: last + 1 })).toBe("deadline");
    });

    /**
     * The run loop asks before every step, and ends the run once a step finishes at or
     * after the no-new-step moment. Measured to the deadline alone, the wrap-up never
     * came first for steps under about eleven seconds: fifteen ten-second steps were paid
     * for and the run was cut with no `finish`. Here every pace is walked the way the
     * loop walks it, and the model is always told to finish before the run is cut.
     */
    it.each([1, 2, 5, 7.5, 8, 10, 11, 12, 14, 15, 20, 30, 45, 60, 74, 100, 149])("tells the model to finish before the run is cut, at %s s a step", (seconds) => {
      const stepMs = seconds * 1_000;
      let wrapUp: string | null = null;
      let slowest = 0;
      let cutWithoutFinish = false;
      for (let stepNumber = 0, now = 0; ; stepNumber += 1) {
        // prepareStep
        wrapUp = wrapUpReason({ ...base, stepNumber, spentUsd: 0, maxStepUsd: 0, maxStepMs: slowest, now });
        if (wrapUp) break;
        // the step itself, then the loop's own rule
        now += stepMs;
        slowest = stepMs;
        if (now >= NO_NEW_STEP_AFTER_MS) {
          cutWithoutFinish = true;
          break;
        }
      }
      expect(cutWithoutFinish).toBe(false);
      expect(wrapUp === "deadline" || wrapUp === "step_limit").toBe(true);
    });

    it("the ten-second run of the report: told to finish at the step that starts at 140 s", () => {
      const asked = Array.from({ length: 15 }, (_, step) => wrapUpReason({ ...base, stepNumber: step, spentUsd: 0, maxStepUsd: 0, maxStepMs: step === 0 ? 0 : 10_000, now: step * 10_000 }));
      expect(asked.slice(0, 14).every((reason) => reason === null)).toBe(true);
      expect(asked[14]).toBe("deadline");
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

  describe("a hold that is nobody's fault", () => {
    const NO_FAULT = ["halted", "paused", "flag_off", "platform_day_cap"] as const;

    it("is an admin's halt, a breaker's pause, the switch being off, and the platform's day: nothing else", () => {
      expect(REASONS.filter((reason) => holdsAgent(reason) && !countsAsStrike(reason)).sort()).toEqual([...NO_FAULT].sort());
    });

    it("adds no strike, however many times it is looked at", () => {
      for (const reason of NO_FAULT) {
        let state: HoldState = { ...none, inferenceStrikes: 1 };
        let at = NOW;
        for (let look = 0; look < 8; look += 1) {
          const next = nextHold(state, reason, at);
          expect(next.inferenceStrikes).toBe(1);
          state = { ...state, ...next, inferenceNotifiedAt: NOW };
          at = new Date(next.inferenceHoldUntil.getTime() + 1_000);
        }
      }
    });

    /** The report's case: a two-hour halt, eight looks, then one ordinary hiccup. */
    it("leaves the first ordinary failure after it fifteen minutes from its next try, not six hours", () => {
      let state: HoldState = none;
      let at = NOW;
      for (let look = 0; look < 8; look += 1) {
        const next = nextHold(state, "halted", at);
        state = { ...state, ...next, inferenceNotifiedAt: NOW };
        at = new Date(next.inferenceHoldUntil.getTime() + 1_000);
      }
      // The halt is cleared and the re-check lifts the hold; the strikes are kept, as ever.
      const lifted: HoldState = { ...state, inferenceHold: null, inferenceHoldSince: null, inferenceHoldUntil: null };
      const hiccup = nextHold(lifted, "quote_failed", at);
      expect(hiccup.inferenceStrikes).toBe(1);
      expect(minutesFrom(at, hiccup.inferenceHoldUntil)).toBe(15);
    });

    it("still counts the strikes an agent earned before it, and after", () => {
      const struck: HoldState = { ...none, inferenceHold: "quote_failed", inferenceHoldSince: NOW, inferenceStrikes: 2, inferenceNotifiedAt: NOW };
      const paused = nextHold(struck, "paused", NOW);
      expect(paused.inferenceStrikes).toBe(2);
      const after = nextHold({ ...struck, ...paused }, "quote_failed", NOW);
      expect(after.inferenceStrikes).toBe(3);
      expect(minutesFrom(NOW, after.inferenceHoldUntil)).toBe(60);
    });

    it("still looks less and less often at an account the switch is off for: 15, 30, 60, 120, then 360 minutes", () => {
      let state: HoldState = none;
      let at = NOW;
      const waits: number[] = [];
      for (let look = 0; look < 7; look += 1) {
        const next = nextHold(state, "flag_off", at);
        waits.push(minutesFrom(at, next.inferenceHoldUntil));
        expect(next.inferenceStrikes).toBe(0);
        state = { ...state, ...next, inferenceNotifiedAt: NOW };
        // The next look comes when this hold's time has, as the re-check pass makes it.
        at = next.inferenceHoldUntil;
      }
      expect(waits).toEqual([15, 30, 60, 120, 360, 360, 360]);
    });

    it("starts that count again for a hold that was lifted and came back", () => {
      const lifted: HoldState = { ...none, inferenceHoldSince: new Date(NOW.getTime() - 5 * 3_600_000), inferenceNotifiedAt: NOW };
      expect(minutesFrom(NOW, nextHold(lifted, "flag_off", NOW).inferenceHoldUntil)).toBe(15);
    });

    /**
     * "Held since" is when the agent went on hold and is kept when the reason changes. An
     * agent held for an empty wallet three hours ago, for which the switch then goes off,
     * is looked at in fifteen minutes the first time and from then on by how long it has
     * been held in all: it waits longer, never past the table's last wait, and its strikes
     * are what they were.
     */
    it("waits the first wait when the reason has just changed to the switch, then by how long it has been held", () => {
      const since = new Date(NOW.getTime() - 3 * 3_600_000);
      const held: HoldState = { ...none, inferenceHold: "needs_funds", inferenceHoldSince: since, inferenceStrikes: 2, inferenceNotifiedAt: since };

      const first = nextHold(held, "flag_off", NOW);
      expect(minutesFrom(NOW, first.inferenceHoldUntil)).toBe(15);
      expect(first).toMatchObject({ inferenceHoldSince: since, inferenceStrikes: 2, notify: false });

      const at = first.inferenceHoldUntil;
      const second = nextHold({ ...held, ...first }, "flag_off", at);
      expect(minutesFrom(at, second.inferenceHoldUntil)).toBe(120);
      expect(second.inferenceStrikes).toBe(2);

      const aWeekOn = new Date(NOW.getTime() + 7 * 86_400_000);
      expect(minutesFrom(aWeekOn, nextHold({ ...held, ...first }, "flag_off", aWeekOn).inferenceHoldUntil)).toBe(360);
    });
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
