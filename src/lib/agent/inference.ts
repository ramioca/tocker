/**
 * Where an agent's thinking comes from, decided in one place.
 *
 * An agent thinks on its owner's own LLM key, or, when its config says `source: "usdc"`,
 * on a model it pays for itself per step (src/lib/x402/inference-types.ts). Every part
 * of the app that used to ask "does this agent have a key?" asks this file instead: the
 * mode is the config's own word, never a guess from a missing key.
 *
 * This file is pure (no database, no network, no clock but the one handed in), so a
 * client component may import it. The half that reads and writes (the check before a
 * run, the holds, the SQL twin of the predicate below) is `./inference-gate.ts`, which
 * is server only.
 */
import type { AgentConfig } from "@/db/schema";
import { HOLD_BACKOFF_MINUTES, holdUntil } from "@/lib/x402/inference-budget";
import {
  DEFAULT_PAY_PER_USE_MODEL,
  INFERENCE_STOPS,
  MAX_PAID_STEPS,
  MIN_INVOCATION_REMAINING_MS,
  SIGN_MIN_REMAINING_MS,
  USDC_RUN_CAP,
  WALLET_FLOOR_USD,
  describeInferenceStop,
  payPerUseModel,
  roundUsd,
  type InferenceStopReason,
  type ThinkSource,
} from "@/lib/x402/inference-types";

type LlmConfig = Pick<AgentConfig, "llm"> | null | undefined;

// ---------- the mode ----------

/** A config with no `source` was written before the field existed, and is a key agent. */
export function thinkSource(config: LlmConfig): ThinkSource {
  return config?.llm?.source === "usdc" ? "usdc" : "key";
}

/**
 * The model id the agent thinks on: the pay-per-use model for a usdc agent, the key's
 * model otherwise. Never throws on a stored config that is missing a piece: this is read
 * for public cards, where a malformed row must show nothing, not break the page.
 */
export function thinkingModel(config: LlmConfig): string {
  if (!config?.llm) return "";
  return thinkSource(config) === "usdc" ? (config.llm.usdc?.model ?? DEFAULT_PAY_PER_USE_MODEL) : (config.llm.model ?? "");
}

/**
 * What an agent thinks on.
 *
 *  - `usdc`: it pays per step. It needs no key, and a key left on its row is not used.
 *  - `mock`: the scripted model (`LLM_MOCK=1`), which needs no key either.
 *  - `key`:  its owner's key.
 *  - `none`: a key agent with no key. It cannot run.
 *
 * `usdc` is asked first on purpose: under the scripted model a pay-per-use agent still
 * goes through its own check, its holds and its (simulated) ledger.
 */
export type Brain = "usdc" | "mock" | "key" | "none";

export function brainOf(agent: { llmKeyId: string | null; config: LlmConfig }, llmMock: boolean): Brain {
  if (thinkSource(agent.config) === "usdc") return "usdc";
  if (llmMock) return "mock";
  return agent.llmKeyId ? "key" : "none";
}

/** The one question every gate asks: does this agent have something to think on. */
export function canThink(agent: { llmKeyId: string | null; config: LlmConfig }, llmMock: boolean): boolean {
  return brainOf(agent, llmMock) !== "none";
}

// ---------- choosing pay-per-use ----------

/** Said when an account that may not use pay-per-use asks for it. */
export const USDC_NOT_AVAILABLE = "Pay-per-use thinking is not available for this account. Use your own API key.";

/**
 * Why a config that asks for pay-per-use cannot be saved, or null when it can. The schema
 * already holds the two limits inside their ranges; this is what a range cannot say.
 *
 * One refusal the settings form makes is NOT made here: a schedule whose estimated cost
 * for a day is more than the daily limit (`checkUsdc` in components/agents/thinking.ts).
 * That is an estimate from list prices, and it is the form's alone. A config saved some
 * other way with such a schedule is accepted; the daily limit is still what is enforced
 * (when each payment is reserved), so the agent stops for the day when it is reached,
 * and the form asks for the limit or the schedule to be changed at the next save.
 */
export function usdcChoiceProblem(config: Pick<AgentConfig, "llm" | "chains">): string | null {
  if (thinkSource(config) !== "usdc") return null;
  const usdc = config.llm.usdc;
  if (!usdc) return "Pay per use needs a model and its two spending limits. Choose them and save again.";
  if (!payPerUseModel(usdc.model)) return describeInferenceStop("model_unavailable", { model: usdc.model }).detail;
  if (usdc.maxUsdPerDay < usdc.maxUsdPerRun) return "The daily thinking limit cannot be lower than the limit for one run.";
  // The payment leaves the agent's Solana wallet, and an agent has a wallet only on the
  // chains it trades.
  if (!config.chains.includes("solana")) return describeInferenceStop("no_wallet").detail;
  return null;
}

/**
 * The owner's limit for one run as a run is held to it (`capsFor` reads it the same way):
 * inside the range the product offers, and zero when it is missing or is not a number.
 */
function runLimitUsd(config: LlmConfig): number {
  const perRun = config?.llm?.usdc?.maxUsdPerRun;
  return typeof perRun === "number" && Number.isFinite(perRun) && perRun > 0 ? Math.min(perRun, USDC_RUN_CAP.max) : 0;
}

/**
 * What the agent's Solana wallet must hold, beyond the trading fees it owes, before a
 * run is started: the limit for one run, and the wallet floor. This is the figure the
 * check before a run asks for (`preflightInference`). Zero for a key agent.
 */
export function runFundsNeededUsd(config: LlmConfig): number {
  if (thinkSource(config) !== "usdc") return 0;
  return roundUsd(runLimitUsd(config) + WALLET_FLOOR_USD);
}

/** How many runs' worth of thinking a live pay-per-use agent keeps out of its trades. */
export const RESERVED_RUNS = 2;

/**
 * What a live pay-per-use agent keeps out of its trades: TWO runs' worth of thinking and
 * the wallet floor. Zero for a key agent. A limit that is missing or is not a number
 * holds back the floor alone.
 *
 * Two, not one, because a buy is placed in the middle of a run. One limit is what the
 * run in hand may still spend after the buy (the steps that follow it, `finish` among
 * them); the other, with the floor, is what the check before the next run asks for
 * ({@link runFundsNeededUsd}). Holding back that second figure alone meant a buy that
 * used every spendable dollar left the wallet at exactly what the next run needs, the
 * rest of the run then paid for a step out of it, and the agent's own trade put it on a
 * `needs_funds` hold. Every place that says what a buy may spend reads this one function.
 */
export function thinkingReserveUsd(config: LlmConfig): number {
  if (thinkSource(config) !== "usdc") return 0;
  return roundUsd(RESERVED_RUNS * runLimitUsd(config) + WALLET_FLOOR_USD);
}

// ---------- one run's clocks and steps ----------

/** Every route that runs an agent is allowed this long (`maxDuration` 300). */
export const INVOCATION_LIMIT_MS = 300_000;
/** A pay-per-use run stops paying this long after its invocation began, whatever its own clock says. */
export const INVOCATION_PAY_UNTIL_MS = 285_000;

/** Whether enough of the invocation is left to start a pay-per-use run in it. */
export function fitsInvocation(invocationStartedAt: number, now: number): boolean {
  return invocationStartedAt + INVOCATION_LIMIT_MS - now >= MIN_INVOCATION_REMAINING_MS;
}

/**
 * The moment after which a run signs nothing more: the earlier of its own cut-off and the
 * invocation's. The second is what stops a run started late in a cron pass from being
 * frozen by the platform with a payment in flight.
 */
export function payDeadlineAt(modelStartedAt: number, invocationStartedAt: number, runTimeoutMs: number): number {
  return Math.min(modelStartedAt + runTimeoutMs, invocationStartedAt + INVOCATION_PAY_UNTIL_MS);
}

/** The steps a pay-per-use run may take before the one that wraps it up. */
export function paidStepLimit(config: LlmConfig): number {
  const steps = config?.llm?.maxSteps;
  const wanted = typeof steps === "number" && Number.isFinite(steps) ? Math.max(1, Math.floor(steps)) : 1;
  return Math.min(wanted, MAX_PAID_STEPS);
}

export interface WrapUpInput {
  /** The step about to start, from 0. */
  stepNumber: number;
  /** {@link paidStepLimit}. */
  stepLimit: number;
  runCapUsd: number;
  spentUsd: number;
  /** The dearest and the slowest step so far. Zero before the first. */
  maxStepUsd: number;
  maxStepMs: number;
  deadlineAt: number;
  /**
   * Epoch ms after which the run starts no new step (its model call's start plus
   * `NO_NEW_STEP_AFTER_MS`). The run is ended there whether or not it was wrapped up.
   */
  noNewStepAt: number;
  now: number;
}

/**
 * The last moment a step can still start and be paid for: the run starts none after
 * `noNewStepAt`, and the paying fetch signs nothing with less than
 * `SIGN_MIN_REMAINING_MS` left before the deadline. Whichever comes first.
 */
export function lastStepStartAt(input: Pick<WrapUpInput, "deadlineAt" | "noNewStepAt">): number {
  return Math.min(input.noNewStepAt, input.deadlineAt - SIGN_MIN_REMAINING_MS);
}

/**
 * Whether the next step must be the model's last, and which limit says so.
 *
 * A run that simply hits a limit stops mid-thought with nothing written down. So a step
 * or two before that, the model is told to call `finish`: when the budget left would not
 * cover two and a half of the dearest step so far, when the time left before the last
 * moment a step can start ({@link lastStepStartAt}) would not cover two of the slowest
 * step so far, or when its ordinary steps are used up.
 *
 * The time rule is measured to that last moment, not to the deadline. Measured to the
 * deadline alone it could not fire before the run's own "no new step" rule for any run
 * whose steps took under about eleven seconds, which is most of them: such a run paid
 * for fifteen steps and was then cut with no `finish`. Measured this way it fires at a
 * step that starts before that moment, as long as no step takes twice as long as the
 * slowest before it (and the first one does not use up the run on its own).
 */
export function wrapUpReason(input: WrapUpInput): Extract<InferenceStopReason, "run_cap" | "deadline" | "step_limit"> | null {
  if (input.maxStepUsd > 0 && input.runCapUsd - input.spentUsd < 2.5 * input.maxStepUsd) return "run_cap";
  if (lastStepStartAt(input) - input.now < 2 * Math.max(0, input.maxStepMs)) return "deadline";
  if (input.stepNumber >= input.stepLimit) return "step_limit";
  return null;
}

/**
 * How a stop ends the run it happened in. A limit the owner set (or the clock) is a
 * normal end: the run succeeded as far as it went. Anything else is a failed run and puts
 * the agent on hold, so the same thing is not tried, and paid for, on every tick.
 */
export function stopOutcome(reason: InferenceStopReason): { status: "succeeded" | "failed"; hold: boolean } {
  return INFERENCE_STOPS[reason] === "limit" ? { status: "succeeded", hold: false } : { status: "failed", hold: true };
}

// ---------- holds ----------

/** The hold columns of an agent row. */
export interface HoldState {
  inferenceHold: string | null;
  inferenceHoldSince: Date | null;
  inferenceHoldUntil: Date | null;
  inferenceStrikes: number;
  inferenceNotifiedAt: Date | null;
}

/** The hold columns of a row with nothing held: no hold, no strikes, nothing said. */
export const NO_INFERENCE_HOLD = {
  inferenceHold: null,
  inferenceHoldSince: null,
  inferenceHoldUntil: null,
  inferenceStrikes: 0,
  inferenceNotifiedAt: null,
} as const satisfies HoldState;

/** Held, and not yet due another look. A hold with no time on it is looked at now. */
export function isHeldAt(agent: Pick<HoldState, "inferenceHold" | "inferenceHoldUntil">, now: Date): boolean {
  if (!agent.inferenceHold) return false;
  return agent.inferenceHoldUntil !== null && agent.inferenceHoldUntil.getTime() > now.getTime();
}

/** Reasons that never put an agent on hold: the run's own limits, and the cap on runs started by hand. */
export function holdsAgent(reason: InferenceStopReason): boolean {
  return INFERENCE_STOPS[reason] !== "limit" && reason !== "manual_limit";
}

/**
 * Holds that say nothing about the agent: an admin's halt, a breaker's pause, the switch
 * being off for the account, and the platform's own day being used up. The agent, its
 * wallet and its owner did nothing, and no run of its own stopped.
 */
const NO_FAULT_HOLDS: ReadonlySet<InferenceStopReason> = new Set<InferenceStopReason>(["halted", "paused", "flag_off", "platform_day_cap", "transfer_check"]);

/**
 * Whether a hold for `reason` counts against the agent. A hold that is nobody's fault
 * does not: an agent that sat through a two-hour halt was looked at eight times, and
 * counting each look left it six hours from its next try after one ordinary hiccup.
 */
export function countsAsStrike(reason: InferenceStopReason): boolean {
  return !NO_FAULT_HOLDS.has(reason);
}

/**
 * Which look at a hold this is, told from how long the agent has been held: the first
 * when the hold is new or its reason has just changed to this one, the second once it
 * has lasted the first wait in the back-off table, the third once it has lasted the
 * first two, and so on.
 *
 * This is how a hold that adds no strikes still backs off. Only `flag_off` uses it (a
 * halt, a pause and a day limit have waits of their own): an account the switch is off
 * for is looked at less and less often, as before, without the looks being held against
 * the agent when the switch comes back.
 *
 * `inferenceHoldSince` is when the agent went on hold, and it is kept when the reason
 * changes. So an agent that was already held for something else when the switch went
 * off starts further along the table from its second look. It only ever waits longer,
 * never past the table's last wait, and nothing is counted against it for that.
 */
function looksAtSameHold(current: HoldState, reason: InferenceStopReason, now: Date): number {
  if (current.inferenceHold !== reason || !current.inferenceHoldSince) return 1;
  const heldMinutes = (now.getTime() - current.inferenceHoldSince.getTime()) / 60_000;
  let looks = 1;
  let waited = 0;
  for (const wait of HOLD_BACKOFF_MINUTES) {
    waited += wait;
    if (heldMinutes < waited) break;
    looks += 1;
  }
  return looks;
}

/**
 * The hold an agent goes on (or stays on) after `reason`, and whether its owner is told.
 *
 * Strikes count the holds since the agent last finished a run, this one included, and
 * set how long until the next look. They are not reset when a hold is lifted by a
 * re-check, only by a run that works: otherwise an agent whose runs keep stopping would
 * be tried again every fifteen minutes for ever. A hold that is nobody's fault
 * ({@link countsAsStrike}) adds none, and leaves the count as it found it.
 *
 * The owner is told once: when nothing has been said since the last run that worked.
 * They are told again only when the reason changes to one they can fix themselves,
 * because "add USDC" is news to someone who was last told the provider was down.
 */
export function nextHold(
  current: HoldState,
  reason: InferenceStopReason,
  now: Date,
): { inferenceHold: InferenceStopReason; inferenceHoldSince: Date; inferenceHoldUntil: Date; inferenceStrikes: number; notify: boolean } {
  const before = Math.max(0, Math.floor(current.inferenceStrikes) || 0);
  const counted = countsAsStrike(reason);
  const strikes = counted ? before + 1 : before;
  const told = current.inferenceNotifiedAt !== null;
  return {
    inferenceHold: reason,
    inferenceHoldSince: current.inferenceHold && current.inferenceHoldSince ? current.inferenceHoldSince : now,
    inferenceHoldUntil: holdUntil(reason, counted ? strikes : looksAtSameHold(current, reason, now), now),
    inferenceStrikes: strikes,
    notify: !told || (INFERENCE_STOPS[reason] === "owner" && current.inferenceHold !== reason),
  };
}
