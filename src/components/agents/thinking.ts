/**
 * How an agent thinks, as the screens decide it.
 *
 * An agent thinks on its owner's own API key, or pays for each model step itself in USDC
 * from its own Solana wallet (src/lib/x402/inference-types.ts). The builder, the settings
 * form, the status rows and the runs list all ask the same questions about that choice:
 * which mode is this, what will it cost, are its limits sane, what fixes a stop. The
 * answers live here, once, so the two forms cannot disagree and every one of them can be
 * tested without a browser.
 *
 * Pure: no database, no network, no environment. Whether a viewer MAY use pay-per-use is
 * decided on the server (`payPerUseAllowedFor` in src/server/queries/agents.ts) and
 * arrives here as a boolean. Which mode a config is in is `thinkSource`
 * (src/lib/agent/inference.ts), the one predicate the whole app asks; nothing here
 * decides that a second time.
 */
import type { AgentConfig } from "@/db/schema";
import { DEFAULT_AGENT_CONFIG } from "@/lib/agent/config";
import { thinkSource } from "@/lib/agent/inference";
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
  estimateDayUsd,
  estimateRunUsd,
  isInferenceStopReason,
  payPerUseModel,
  runsPerDay,
  suggestUsdcLimits,
  type InferenceStopKind,
  type InferenceStopReason,
  type PayPerUseModel,
  type ThinkSource,
} from "@/lib/x402/inference-types";

// ---------- the words ----------

/** Shown wherever the mode is chosen. The sentence is the brief's, word for word. */
export const PAY_PER_USE_DISCLOSURE =
  "In this mode the agent's strategy and transcript are sent to BlockRun and the model provider it uses.";

/** A step is bought before it is answered, so a failed one is still paid for. */
export const PAID_STEP_NOT_REFUNDED =
  "Each step is paid for before it is answered. A step that is paid for and then fails is not refunded, and the run stops instead of paying again.";

export const THINK_SOURCE_LABELS: Record<ThinkSource, string> = {
  key: "Your own API key",
  usdc: "Pay per use in USDC",
};

/** Dollars and cents, the way `describeInferenceStop` writes a limit. */
function usd(value: number): string {
  return `$${value.toFixed(2)}`;
}

// ---------- the mode ----------

/** The limits and the model of a pay-per-use agent, as `config.llm.usdc` stores them. */
export interface UsdcSettings {
  model: string;
  maxUsdPerRun: number;
  maxUsdPerDay: number;
}

/** The part of a config these rules read. The stored config and the builder's draft both fit. */
export interface ThinkingConfig {
  llm: AgentConfig["llm"];
  schedule: { intervalMinutes: number };
}

/**
 * What a form shows about how an agent thinks: whether the two-card choice is offered at
 * all, and which mode the form is in.
 *
 * The choice is offered to a viewer the server allows pay-per-use. It is also offered on
 * an agent that is already saved in that mode (`saved`), whoever is allowed what today,
 * so such an agent can always be moved to its owner's key. Where it is not offered the
 * form is a key form: the key fields, and nothing about any other mode, exactly as it
 * was before pay-per-use existed.
 */
export function thinkChoice(input: {
  /** The server's answer for this viewer. */
  allowed: boolean;
  /** The config as last saved. Absent in the builder, where nothing is saved yet. */
  saved?: Pick<AgentConfig, "llm"> | null;
  /** The config the form is editing. */
  working: Pick<AgentConfig, "llm"> | null | undefined;
}): { offered: boolean; source: ThinkSource } {
  const offered = input.allowed || thinkSource(input.saved) === "usdc";
  return { offered, source: offered ? thinkSource(input.working) : "key" };
}

/**
 * The mode the builder shows. A viewer who may not use pay-per-use is only ever shown,
 * and only ever creates, a key agent, whatever a saved draft says.
 */
export function shownSource(config: Pick<AgentConfig, "llm"> | null | undefined, allowed: boolean): ThinkSource {
  return thinkChoice({ allowed, working: config }).source;
}

/** The model a pay-per-use agent thinks on, by its list name; the id when it is not listed. */
export function payPerUseModelLabel(id: string | null | undefined): string {
  return payPerUseModel(id)?.label ?? id ?? "";
}

// ---------- estimates ----------

export interface UsdcEstimate {
  /** Null when the id is not one of the offered models: nothing can be estimated for it. */
  model: PayPerUseModel | null;
  /** A typical run, USD. */
  runUsd: number;
  runsPerDay: number;
  /** Every scheduled run of a day, USD. Zero on a manual schedule. */
  dayUsd: number;
}

/**
 * What a model is expected to cost at a schedule. An estimate from list prices, not a
 * quote: the gateway's own price for each step is what is checked before anything is paid.
 *
 * A schedule longer than a day counts as one run a day, never as none: "$0.00 a day"
 * under an agent that does run would be untrue.
 */
export function usdcEstimate(modelId: string | null | undefined, intervalMinutes: number): UsdcEstimate {
  const model = payPerUseModel(modelId);
  if (!model) return { model: null, runUsd: 0, runsPerDay: 0, dayUsd: 0 };
  const runUsd = estimateRunUsd(model);
  if (!(intervalMinutes > 0)) return { model, runUsd, runsPerDay: 0, dayUsd: 0 };
  const runs = Math.max(1, runsPerDay(intervalMinutes));
  return { model, runUsd, runsPerDay: runs, dayUsd: Math.max(estimateDayUsd(model, intervalMinutes), runUsd) };
}

/** The limits offered for a model and a schedule. An unlisted model gets the default model's. */
export function suggestedLimits(
  modelId: string | null | undefined,
  intervalMinutes: number,
): Pick<UsdcSettings, "maxUsdPerRun" | "maxUsdPerDay"> {
  const model = payPerUseModel(modelId) ?? payPerUseModel(DEFAULT_PAY_PER_USE_MODEL) ?? PAY_PER_USE_MODELS[0];
  return suggestUsdcLimits(model, intervalMinutes);
}

/** What a draft starts with the moment pay-per-use is chosen: the default model and limits that fit it. */
export function defaultUsdc(intervalMinutes: number): UsdcSettings {
  return { model: DEFAULT_PAY_PER_USE_MODEL, ...suggestedLimits(DEFAULT_PAY_PER_USE_MODEL, intervalMinutes) };
}

/**
 * A limit as it is stored: whole cents. A slider hands back `min + n * step` in floating
 * point (0.15000000000000002), which would be saved as it came, could fall a hair under
 * the bottom of its range, and would never equal the suggestion it was set from.
 */
export function limitCents(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * What the agent's Solana wallet must hold before a run is started: the run limit, plus
 * the amount that is always left untouched. The same sum the preflight checks.
 */
export function walletNeedUsd(usdc: Pick<UsdcSettings, "maxUsdPerRun">): number {
  return Math.round((usdc.maxUsdPerRun + WALLET_FLOOR_USD) * 100) / 100;
}

/** The steps a run of this agent may take in each mode: pay-per-use stops at `MAX_PAID_STEPS`. */
export function stepsAllowed(maxSteps: number, source: ThinkSource): number {
  return source === "usdc" ? Math.min(maxSteps, MAX_PAID_STEPS) : maxSteps;
}

// ---------- validation ----------

export interface UsdcCheck {
  /** Each of these stops the create or the save. Keyed by the control it sits under. */
  errors: { model?: string; maxUsdPerRun?: string; maxUsdPerDay?: string; chains?: string };
  /** Worth saying, and stops nothing. */
  warnings: { maxUsdPerRun?: string };
}

/** Sums of prices in dollars: a millionth of a cent is rounding, not a limit crossed. */
const EPSILON_USD = 1e-9;

function inRange(value: unknown, range: { min: number; max: number }): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= range.min && value <= range.max;
}

/** Whether a schedule is expected to cost more in a day than the daily limit allows. */
export function dayOverLimit(estimate: Pick<UsdcEstimate, "dayUsd">, usdc: Pick<UsdcSettings, "maxUsdPerDay">): boolean {
  return estimate.dayUsd > usdc.maxUsdPerDay + EPSILON_USD;
}

/**
 * Whether a pay-per-use choice may be saved, and what to say when it may not.
 *
 * The one refusal that is a judgement and not a range: a schedule expected to cost more
 * in a day than the daily limit allows. Saved like that, the agent would stop part-way
 * through every day having bought runs it could not finish the day with, so the form
 * says so now and asks for one of the three things that fix it.
 */
export function checkUsdc(input: {
  usdc: UsdcSettings | null | undefined;
  intervalMinutes: number;
  chains: readonly string[];
}): UsdcCheck {
  const errors: UsdcCheck["errors"] = {};
  const warnings: UsdcCheck["warnings"] = {};
  const { usdc } = input;

  // The agent's own Solana wallet is the only thing that can pay. Without one the first
  // run is held before it starts, so the form refuses rather than create an agent that
  // cannot think.
  if (!input.chains.includes("solana")) {
    errors.chains =
      "Pay-per-use thinking is paid from the agent's Solana wallet. Add Solana to its chains, or use your own API key.";
  }

  if (!usdc) {
    errors.model = "Pick a model for pay-per-use thinking.";
    return { errors, warnings };
  }

  const estimate = usdcEstimate(usdc.model, input.intervalMinutes);
  if (!estimate.model) {
    errors.model = `${usdc.model || "That model"} is not offered for pay-per-use. Pick one from the list.`;
  }

  const runOk = inRange(usdc.maxUsdPerRun, USDC_RUN_CAP);
  const dayOk = inRange(usdc.maxUsdPerDay, USDC_DAY_CAP);
  if (!runOk) {
    errors.maxUsdPerRun = `Set the limit per run between ${usd(USDC_RUN_CAP.min)} and ${usd(USDC_RUN_CAP.max)}.`;
  }
  if (!dayOk) {
    errors.maxUsdPerDay = `Set the limit per day between ${usd(USDC_DAY_CAP.min)} and ${usd(USDC_DAY_CAP.max)}.`;
  }

  if (runOk && dayOk && usdc.maxUsdPerRun > usdc.maxUsdPerDay + EPSILON_USD) {
    errors.maxUsdPerRun = `One run cannot be allowed more than the whole day (${usd(usdc.maxUsdPerDay)}). Lower this limit or raise the daily one.`;
  }

  if (estimate.model && dayOk && dayOverLimit(estimate, usdc)) {
    errors.maxUsdPerDay = `At this schedule the agent is expected to spend about ${usd(estimate.dayUsd)} a day on thinking, more than its ${usd(usdc.maxUsdPerDay)} daily limit. Raise the limit, run it less often, or pick a cheaper model.`;
  }

  if (estimate.model && runOk && !errors.maxUsdPerRun && estimate.runUsd > usdc.maxUsdPerRun + EPSILON_USD) {
    warnings.maxUsdPerRun = `A typical run on ${estimate.model.label} costs about ${usd(estimate.runUsd)}, more than this limit, so most runs will stop before they finish.`;
  }

  return { errors, warnings };
}

/** The first thing wrong with a pay-per-use choice, or null. Chains last: its control sits furthest away. */
export function firstUsdcError(check: UsdcCheck): string | null {
  return check.errors.model ?? check.errors.maxUsdPerRun ?? check.errors.maxUsdPerDay ?? check.errors.chains ?? null;
}

// ---------- changing the mode ----------

/** The schedule a key agent starts on. A draft still on it has not had its schedule chosen. */
const KEY_DEFAULT_INTERVAL_MINUTES = DEFAULT_AGENT_CONFIG.schedule.intervalMinutes;

function withoutPayPerUse<L extends ThinkingConfig["llm"]>(llm: L): L {
  const rest = { ...llm };
  delete rest.source;
  delete rest.usdc;
  return rest;
}

/** A config with every trace of pay-per-use removed: what a viewer who may not use it submits. */
export function stripPayPerUse<C extends ThinkingConfig>(config: C): C {
  if (config.llm.source === undefined && config.llm.usdc === undefined) return config;
  return { ...config, llm: withoutPayPerUse(config.llm) };
}

export interface SourceChange<C> {
  config: C;
  /**
   * The interval the schedule was on before this change moved it, or null when it was
   * left alone. The form says so on screen, and hands it back as `restoreInterval` if
   * the owner changes their mind.
   */
  scheduleMovedFrom: number | null;
}

/**
 * Switch a config between the two modes.
 *
 * To pay-per-use: the mode is written into the config (it is never guessed from a missing
 * key), the model and both limits are filled in, and a schedule still on the key default
 * moves to the pay-per-use default, because every run now costs money. A schedule the
 * owner or a preset chose is left alone; the estimate and the daily-limit check speak
 * for it.
 *
 * To a key: the pay-per-use block is removed. `explicitKey` writes `source: "key"` for an
 * agent whose stored config already names a source; without it the field is left out,
 * which is what every key agent's config looks like today.
 */
export function chooseSource<C extends ThinkingConfig>(
  config: C,
  next: ThinkSource,
  options: {
    /** The limits last used in this form, put back instead of fresh suggestions. */
    remembered?: UsdcSettings | null;
    /** The interval a previous switch moved the schedule from. */
    restoreInterval?: number | null;
    explicitKey?: boolean;
  } = {},
): SourceChange<C> {
  if (thinkSource(config) === next && (next === "key" || config.llm.usdc)) {
    return { config, scheduleMovedFrom: null };
  }

  const current = config.schedule.intervalMinutes;

  if (next === "usdc") {
    const moved = current === KEY_DEFAULT_INTERVAL_MINUTES && current !== USDC_DEFAULT_INTERVAL_MINUTES;
    const intervalMinutes = moved ? USDC_DEFAULT_INTERVAL_MINUTES : current;
    const usdc = options.remembered ?? config.llm.usdc ?? defaultUsdc(intervalMinutes);
    return {
      config: {
        ...config,
        llm: { ...config.llm, source: "usdc", usdc: { ...usdc } },
        schedule: { ...config.schedule, intervalMinutes },
      },
      scheduleMovedFrom: moved ? current : null,
    };
  }

  const llm = withoutPayPerUse(config.llm);
  const restore =
    typeof options.restoreInterval === "number" && current === USDC_DEFAULT_INTERVAL_MINUTES
      ? options.restoreInterval
      : current;
  return {
    config: {
      ...config,
      llm: options.explicitKey ? { ...llm, source: "key" } : llm,
      schedule: { ...config.schedule, intervalMinutes: restore },
    },
    scheduleMovedFrom: null,
  };
}

// ---------- stops, as a screen shows them ----------

/** Where the fix for a stop lives. A `hash` is a section of the agent's settings page. */
export type StopFix = { label: string; hash: string } | { label: string; path: string };

/**
 * The one thing an owner can do about each reason an agent is not thinking. Where
 * nothing of theirs is wrong (Tocker or the provider is the cause), the fix is the place
 * the model and the limits are chosen, and the banner offers their own key beside it.
 */
export function stopFix(reason: InferenceStopReason): StopFix {
  switch (reason) {
    case "needs_funds":
      return { label: "Add USDC", hash: "#wallets" };
    case "agent_day_cap":
    case "run_cap":
      return { label: "Raise the limit", hash: "#thinking" };
    case "no_wallet":
      return { label: "Add Solana", hash: "#universe" };
    case "no_policy":
      return { label: "Set the wallet limit", hash: "#budget" };
    case "wallet_limit_low":
      // The wallet's limit is written from the largest trade size ("Max per trade", under
      // Risk), and saving that form is what writes it again and has the hold looked at.
      return { label: "Raise the trade size", hash: "#risk" };
    case "model_unavailable":
    case "rerouted":
      return { label: "Pick a model", hash: "#thinking" };
    case "paid_no_answer":
      return { label: "See the charge", path: "/money" };
    default:
      return { label: "Open settings", hash: "#thinking" };
  }
}

/** A chip's worth of words for an agent that is on hold, for the owner's own cards. */
export function holdChipLabel(reason: string): string {
  return reason === "needs_funds" ? "Add USDC" : "On hold";
}

export interface StopWords {
  /** Null when the stored reason is not one this build knows. */
  reason: InferenceStopReason | null;
  kind: InferenceStopKind;
  title: string;
  detail: string;
}

/**
 * The owner's words for a stored stop reason. The column is free text, so a reason this
 * build does not know (written by a newer one) still reads as a stop, in general terms,
 * instead of vanishing.
 */
export function stopWords(
  reason: string,
  context: { runCapUsd?: number; dayCapUsd?: number; model?: string } = {},
): StopWords {
  if (isInferenceStopReason(reason)) {
    return { reason, kind: INFERENCE_STOPS[reason], ...describeInferenceStop(reason, context) };
  }
  return {
    reason: null,
    kind: "platform",
    title: "Pay-per-use thinking is on hold",
    detail: "This agent is not being run on pay-per-use right now. Nothing is being charged.",
  };
}

// ---------- what a run spent on thinking ----------

/** Owner only. What one pay-per-use run was charged for thinking, and why it ended early if it did. */
export interface RunThinking {
  spendUsd: number;
  /** The model id the run thought on, when the row recorded it. */
  model: string | null;
  stop: { reason: string; kind: InferenceStopKind; title: string; detail: string } | null;
}

/**
 * Pure: the thinking line of a run row, or null for a run that thought on a key. Built on
 * the server from the run's own columns; the title is the same one the banner and the
 * notification use for that reason.
 */
export function runThinking(row: {
  llmSource: string | null;
  model: string | null;
  inferenceSpendUsd: string | number | null;
  stopReason: string | null;
}): RunThinking | null {
  if (row.llmSource !== "usdc") return null;
  const spend = Number(row.inferenceSpendUsd ?? 0);
  const words = row.stopReason ? stopWords(row.stopReason, row.model ? { model: payPerUseModelLabel(row.model) } : {}) : null;
  return {
    spendUsd: Number.isFinite(spend) && spend > 0 ? spend : 0,
    model: row.model,
    stop: words && row.stopReason ? { reason: row.stopReason, kind: words.kind, title: words.title, detail: words.detail } : null,
  };
}

/**
 * The thinking line off a run as it reached the browser. `RunSummary` (src/server/types.ts)
 * does not name the field, so it is read by shape: a run without it, or with something
 * else in its place, has no thinking line.
 */
export function readRunThinking(run: unknown): RunThinking | null {
  if (typeof run !== "object" || run === null) return null;
  const value = (run as { thinking?: unknown }).thinking;
  if (typeof value !== "object" || value === null) return null;
  const { spendUsd, model, stop } = value as { spendUsd?: unknown; model?: unknown; stop?: unknown };
  if (typeof spendUsd !== "number" || !Number.isFinite(spendUsd)) return null;
  let readStop: RunThinking["stop"] = null;
  if (typeof stop === "object" && stop !== null) {
    const { reason, kind, title, detail } = stop as Record<string, unknown>;
    if (
      typeof reason === "string" &&
      typeof title === "string" &&
      typeof detail === "string" &&
      (kind === "limit" || kind === "owner" || kind === "platform")
    ) {
      readStop = { reason, kind, title, detail };
    }
  }
  return { spendUsd, model: typeof model === "string" ? model : null, stop: readStop };
}

/**
 * A small amount of thinking, to the cent when it is cents and finer below that: a run
 * of one step costs a fraction of a cent, and "$0.00 thinking" would read as free.
 */
export function thinkingUsd(value: number): string {
  if (!(value > 0)) return "$0.00";
  if (value < 0.01) return `$${value.toFixed(4)}`;
  return value < 10 ? `$${value.toFixed(3).replace(/0$/, "")}` : usd(value);
}

// ---------- a run's thinking line, as the run list words it ----------

/**
 * The stops after which what a run was charged may still come down. Each ends a run on a
 * step that was signed for and gave no usable answer, and whether that step's payment
 * landed is decided afterwards, against the chain: the reconciler either finds it or
 * proves it never landed, and then nothing was charged for it.
 */
const SPEND_NOT_FINAL_AFTER: ReadonlySet<string> = new Set(["paid_no_answer", "rerouted"]);

/**
 * What the figure on a run row is: what the ledger COUNTED as charged for the run's
 * steps. Counted is not confirmed. The figure is written when the run ends, from every
 * row the ledger then counts (`CHARGED_STATUSES`), and that includes rows whose payment
 * is not proven: an answered step the gateway gave no proof of payment for, a step whose
 * request failed after it was signed, and a step that was signed for and never sent
 * because the run's clock ran out first. The reconciler can find any of these was never
 * charged, minutes after the run row was written.
 *
 * So the row never says the amount was paid. It says what the figure is and where the
 * confirmed one lives, in words that hold whether or not the stored figure has since been
 * brought down: the reconciler writes a run's figure again when it proves one of its
 * steps was never charged, but that is a best-effort write after the verdict, and this
 * row is read before it as well as after.
 */
export const RUN_SPEND_NOTE =
  "What the ledger counted as charged for this run's steps, in USDC from the agent's own wallet. Counted is not confirmed: a step is counted while its payment is still being checked against the chain, and one the chain shows never landed was not charged. Money has what the chain confirmed.";

/** The same, for a run that ended on a step whose payment was still in question. */
export const RUN_SPEND_NOT_FINAL_NOTE =
  "What the ledger counted as charged for this run's steps. The run ended on a step that was signed for and got no usable answer, and that step is in this figure for as long as the ledger counts it. If the chain shows its payment never landed, it was not charged and the figure is lower. Money has what the chain confirmed.";

/**
 * The owner's words for a run that stopped because a signed step got no answer.
 *
 * `describeInferenceStop("paid_no_answer")` says "The agent paid for one step … The
 * charge is listed under Money". At the moment a run stops that is not known: the step
 * is as often `unconfirmed`, and the reconciler may go on to prove it was never charged.
 * The run's stored sentence is written at that moment and nothing rewrites it, so the run
 * list says only what stays true either way. (The contract's own sentence, which the
 * notification and the banner still use, should say the same; it is not this file's to
 * change.)
 */
export const NO_ANSWER_RUN_WORDS = {
  title: "A step got no answer",
  detail:
    "The agent signed a payment for one step and the provider did not return an answer. The run stopped so it would not pay again. If that payment landed it is listed under Money; if the chain shows it never did, nothing was charged.",
} as const;

/** One run's thinking line, in the words the run list prints. */
export interface RunThinkingShown {
  /** The amount as printed: "$0.073", or "up to $0.073" when it may still come down. */
  amount: string;
  /** What that amount is, for its tooltip. Never "paid". */
  amountNote: string;
  /** True when the run ended on a step whose payment was still in question, so the amount is an upper bound. */
  notFinal: boolean;
  /** Why the run ended early, when it did. */
  stop: { kind: InferenceStopKind; title: string; detail: string } | null;
  /**
   * A sentence to print in place of the run's stored error, or null to print that as it
   * is. Set only for a stop whose stored sentence asserts a payment that may not have
   * been made.
   */
  sentence: string | null;
}

/**
 * Pure: how the run list words a run's thinking.
 *
 * Every other reason keeps the title and sentence the banner and the notification use
 * (`stopWords`). Two things differ from the stored row, both so that a step the chain
 * later showed was never charged is not called paid here: the amount is "counted", never
 * "paid", and is "up to" when its last step was in question (an upper bound, so it stays
 * true once that step has been taken off the figure too); and a `paid_no_answer` stop is
 * worded as {@link NO_ANSWER_RUN_WORDS}.
 */
export function runThinkingShown(thinking: RunThinking): RunThinkingShown {
  const reason = thinking.stop?.reason ?? null;
  const notFinal = reason !== null && SPEND_NOT_FINAL_AFTER.has(reason) && thinking.spendUsd > 0;
  const noAnswer = reason === "paid_no_answer";
  return {
    amount: `${notFinal ? "up to " : ""}${thinkingUsd(thinking.spendUsd)}`,
    amountNote: notFinal ? RUN_SPEND_NOT_FINAL_NOTE : RUN_SPEND_NOTE,
    notFinal,
    stop: thinking.stop
      ? {
          kind: thinking.stop.kind,
          title: noAnswer ? NO_ANSWER_RUN_WORDS.title : thinking.stop.title,
          detail: noAnswer ? NO_ANSWER_RUN_WORDS.detail : thinking.stop.detail,
        }
      : null,
    sentence: noAnswer ? NO_ANSWER_RUN_WORDS.detail : null,
  };
}
