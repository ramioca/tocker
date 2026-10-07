/**
 * Pay-per-use thinking: the shared contract.
 *
 * An agent normally thinks on its owner's own LLM key. An agent whose
 * `config.llm.source` is `"usdc"` has no key: each model step is bought from an inference
 * gateway over x402 and paid in USDC by the agent's own Solana wallet. Tocker never
 * fronts, holds or forwards that money.
 *
 * This file is the vocabulary every part of that feature shares: the reasons a payment
 * or a run can stop, the caps, the ledger's interface, the gateway's pinned identity and
 * the price table the estimates are made from. It is pure (no database, no network, no
 * secrets), so it is safe to import from a client component.
 *
 * The rules, in one place:
 *  - Nothing is signed that is not first written to the ledger and counted against every
 *    cap (`InferenceLedger.reserve`).
 *  - Only the pinned counterparty can be paid: scheme `exact`, Solana mainnet, real USDC,
 *    the gateway's own pay-to address.
 *  - A paid request is sent at most once. Nothing is ever paid twice automatically.
 *  - A stop is a named reason, never a bare failure: the owner is told what happened and
 *    what fixes it.
 */

// ---------- mode ----------

/** Where an agent's thinking comes from. A config with no `source` is a key agent. */
export type ThinkSource = "key" | "usdc";

// ---------- the gateway, pinned ----------

/**
 * The one gateway a payment may go to, per chain. These are read from code review, not
 * from the gateway's 402: a 402 that names another network, asset or pay-to address is
 * refused and nothing is signed.
 */
export const INFERENCE_GATEWAY = {
  solana: {
    name: "BlockRun",
    host: "sol.blockrun.ai",
    baseUrl: "https://sol.blockrun.ai/api/v1",
    url: "https://sol.blockrun.ai/api/v1/chat/completions",
    /** CAIP-2 id of Solana mainnet. */
    network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
    /** USDC mint. */
    asset: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    decimals: 6,
    /** BlockRun's published Solana treasury. */
    payTo: ["AQqnMFBwGZEoti85aTVRy8XYpKrho7GaMDx9ZB3CEeKA"],
  },
} as const;

export type InferenceChain = keyof typeof INFERENCE_GATEWAY;

/** What the gateway is asked to cap each answer at. Its quote is priced on this number. */
export const INFERENCE_MAX_OUTPUT_TOKENS = 2048;

// ---------- models ----------

export interface PayPerUseModel {
  /** The gateway's model id, sent as it stands. */
  id: string;
  label: string;
  /** List price per million tokens, USD. The estimates below are made from these. */
  inputPerMTok: number;
  outputPerMTok: number;
  /** One short line for the picker. */
  note: string;
}

/**
 * The models offered for pay-per-use. A short, fixed list on purpose: each must answer
 * many tool-calling steps inside one run's time limit, and none is a reasoning model
 * (those need their reasoning echoed back and reject a temperature).
 */
export const PAY_PER_USE_MODELS: readonly PayPerUseModel[] = [
  { id: "google/gemini-2.5-flash", label: "Gemini 2.5 Flash", inputPerMTok: 0.3, outputPerMTok: 2.5, note: "Fast and inexpensive. The default." },
  { id: "anthropic/claude-haiku-4.5", label: "Claude Haiku 4.5", inputPerMTok: 1, outputPerMTok: 5, note: "Most careful with tools. About three times the price." },
  { id: "openai/gpt-4.1-mini", label: "GPT-4.1 mini", inputPerMTok: 0.4, outputPerMTok: 1.6, note: "A steady middle choice." },
  { id: "openai/gpt-4o-mini", label: "GPT-4o mini", inputPerMTok: 0.15, outputPerMTok: 0.6, note: "Cheapest of the OpenAI models." },
  { id: "google/gemini-2.5-flash-lite", label: "Gemini 2.5 Flash-Lite", inputPerMTok: 0.1, outputPerMTok: 0.4, note: "Cheapest overall. Weakest judgement." },
];

export const DEFAULT_PAY_PER_USE_MODEL = "google/gemini-2.5-flash";

export function payPerUseModel(id: string | null | undefined): PayPerUseModel | null {
  return PAY_PER_USE_MODELS.find((model) => model.id === id) ?? null;
}

// ---------- estimates ----------

/** The gateway's flat fee and its floor, per request, USD. */
const GATEWAY_FLAT_FEE_USD = 0.001;
const GATEWAY_FLOOR_USD = 0.001;

/**
 * Pure: what the gateway is expected to quote for one request, by its published rule.
 * It prices characters, not tokens: about 0.48 tokens per character of message content
 * plus 16 per message, then 10% of the output cap at the output rate, a floor and a flat
 * fee. This is an upper estimate for the Solana host, which quotes at or under it.
 */
export function estimateStepUsd(model: PayPerUseModel, contentChars: number, messages: number, maxOutputTokens = INFERENCE_MAX_OUTPUT_TOKENS): number {
  const inputTokens = 0.48 * Math.max(0, contentChars) + 16 * Math.max(1, messages);
  const variable = (inputTokens * model.inputPerMTok + 0.1 * maxOutputTokens * model.outputPerMTok) / 1_000_000;
  return roundUsd(Math.max(variable, GATEWAY_FLOOR_USD) + GATEWAY_FLAT_FEE_USD);
}

/** How a typical run grows: the prompt it opens with, and what each step adds, in characters. */
export const TYPICAL_RUN = { steps: 11, openingChars: 14_500, charsPerStep: 4_200 } as const;

/** Pure: the expected cost of one whole run of `steps` requests on a model. For the builder. */
export function estimateRunUsd(model: PayPerUseModel, steps: number = TYPICAL_RUN.steps): number {
  let total = 0;
  for (let step = 0; step < steps; step += 1) {
    total += estimateStepUsd(model, TYPICAL_RUN.openingChars + step * TYPICAL_RUN.charsPerStep, 2 + step * 2);
  }
  return roundUsd(total);
}

/** Pure: runs a day at a schedule. 0 minutes is manual only. The cron adds about five minutes to every interval. */
export function runsPerDay(intervalMinutes: number): number {
  if (intervalMinutes <= 0) return 0;
  // Never fewer than one: a daily or weekly schedule still runs, and an estimate of
  // nothing would be the wrong side to err on.
  return Math.max(1, Math.floor(1440 / (intervalMinutes + 5)));
}

export function roundUsd(usd: number): number {
  return Math.round(usd * 1_000_000) / 1_000_000;
}

// ---------- caps ----------

/** The limits an owner sets on one agent. Stored in `config.llm.usdc`. */
export const USDC_RUN_CAP = { min: 0.05, max: 2, default: 0.3 } as const;
export const USDC_DAY_CAP = { min: 0.5, max: 50, default: 3 } as const;

/** The schedule a new pay-per-use agent starts on, in minutes. Every step costs money. */
export const USDC_DEFAULT_INTERVAL_MINUTES = 60;

/** No single request is ever paid above this, whatever the estimate says. USD. */
export const HARD_STEP_CAP_USD = 0.25;
/** What one owner's agents may spend on thinking in a UTC day, unless the environment says otherwise. */
export const DEFAULT_OWNER_DAY_USD = 25;
/** What every agent together may spend in a UTC day when the environment names no figure. Deliberately small. */
export const DEFAULT_PLATFORM_DAY_USD = 2;
/** Paid requests one agent may make in a UTC day. */
export const AGENT_DAY_REQUESTS = 600;
/** Manual pay-per-use runs one owner may start in a UTC day. */
export const OWNER_DAY_MANUAL_RUNS = 20;
/** Left in the wallet untouched: a run does not start unless USDC covers its cap plus this. */
export const WALLET_FLOOR_USD = 0.25;
/** A pay-per-use run makes at most this many requests, plus one to wrap up. */
export const MAX_PAID_STEPS = 20;

/** The numbers one run is held to, resolved once before it starts. All USD unless named. */
export interface InferenceCaps {
  /** Hard ceiling on a single request. */
  stepUsd: number;
  runUsd: number;
  agentDayUsd: number;
  ownerDayUsd: number;
  platformDayUsd: number;
  agentDayRequests: number;
  maxRequestsPerRun: number;
}

/**
 * Pure: the cap on one request. Twice the estimate plus a little, so a quote that is
 * merely different passes and one that is many times the price does not; never above the
 * hard ceiling.
 */
export function stepCapUsd(estimateUsd: number, hardCapUsd: number = HARD_STEP_CAP_USD): number {
  return roundUsd(Math.min(hardCapUsd, 2 * estimateUsd + 0.002));
}

/**
 * Pure: limits that fit a model and a schedule, for the builder to offer. The run cap
 * leaves room for a run twice the typical size; the day cap covers every scheduled run
 * with a quarter to spare.
 */
export function suggestUsdcLimits(model: PayPerUseModel, intervalMinutes: number): { maxUsdPerRun: number; maxUsdPerDay: number } {
  const run = estimateRunUsd(model);
  const perRun = clamp(roundUp(2 * run, 0.05), USDC_RUN_CAP.min, USDC_RUN_CAP.max);
  const scheduled = runsPerDay(intervalMinutes) * run * 1.25;
  const perDay = clamp(roundUp(Math.max(scheduled, 4 * run, USDC_DAY_CAP.default), 0.5), USDC_DAY_CAP.min, USDC_DAY_CAP.max);
  return { maxUsdPerRun: perRun, maxUsdPerDay: perDay };
}

/** Pure: what a schedule is expected to cost in a day on a model. */
export function estimateDayUsd(model: PayPerUseModel, intervalMinutes: number): number {
  return roundUsd(runsPerDay(intervalMinutes) * estimateRunUsd(model));
}

function roundUp(value: number, step: number): number {
  return Math.round(Math.ceil(value / step - 1e-9) * step * 100) / 100;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

// ---------- time ----------

/** No new request starts once a run has been thinking this long. */
export const NO_NEW_STEP_AFTER_MS = 150_000;
/** No signature is asked for with less than this left before the run's deadline. */
export const SIGN_MIN_REMAINING_MS = 75_000;
/** The unpaid request (the quote) may take this long, and is retried this many times. */
export const QUOTE_TIMEOUT_MS = 15_000;
export const QUOTE_RETRIES = 2;
/** Privy is given this long to sign. */
export const SIGN_TIMEOUT_MS = 10_000;
/** The paid request runs on its own clock, never the run's abort signal. */
export const PAID_TIMEOUT_MS = 60_000;
/** A larger answer than this is not read. */
export const MAX_RESPONSE_BYTES = 2_000_000;
/** A run needs this much of its invocation left to be started at all. */
export const MIN_INVOCATION_REMAINING_MS = 250_000;

// ---------- stops ----------

/**
 * Every reason a payment, a run, or the decision to start a run can stop.
 *
 *  - `limit`: the run reached a limit its owner set (or the clock). Normal; nothing to fix.
 *  - `owner`: the owner can fix it (fund the wallet, raise a cap, add a key).
 *  - `platform`: Tocker or the gateway is the cause; the agent waits and tries again.
 */
export const INFERENCE_STOPS = {
  run_cap: "limit",
  deadline: "limit",
  step_limit: "limit",
  needs_funds: "owner",
  agent_day_cap: "owner",
  owner_day_cap: "owner",
  request_limit: "owner",
  manual_limit: "owner",
  no_wallet: "owner",
  no_policy: "owner",
  model_unavailable: "owner",
  flag_off: "platform",
  halted: "platform",
  paused: "platform",
  platform_day_cap: "platform",
  no_rpc: "platform",
  step_cap: "platform",
  pin_mismatch: "platform",
  quote_failed: "platform",
  signature_failed: "platform",
  gateway_error: "platform",
  paid_no_answer: "platform",
  rerouted: "platform",
  bad_request: "platform",
} as const;

export type InferenceStopReason = keyof typeof INFERENCE_STOPS;
export type InferenceStopKind = (typeof INFERENCE_STOPS)[InferenceStopReason];

export function isInferenceStopReason(value: unknown): value is InferenceStopReason {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(INFERENCE_STOPS, value);
}

/**
 * Thrown by the inference fetch when it will not, or could not, complete a step. The x402
 * wrapper flattens error classes on the way out, so the same reason is also written to
 * `InferencePayContext.stop`, which is what the run reads.
 */
export class InferenceStop extends Error {
  readonly reason: InferenceStopReason;
  /** The AI SDK must not retry this: a retry could be a second payment. */
  readonly isRetryable = false;

  constructor(reason: InferenceStopReason, detail?: string) {
    super(detail ? `${reason}: ${detail}` : reason);
    this.name = "InferenceStop";
    this.reason = reason;
  }
}

/**
 * What the owner is told. One title and one sentence per reason, written once so the run
 * row, the notification and the status banner say the same thing.
 */
export function describeInferenceStop(
  reason: InferenceStopReason,
  context: { runCapUsd?: number; dayCapUsd?: number; model?: string } = {},
): { title: string; detail: string } {
  // The figures are the owner's own settings. A caller writing text other people can
  // read (a run's summary) leaves them out, and every sentence still reads.
  const limit = (value: number | undefined, noun: string) => (value === undefined ? `its ${noun}` : `its $${value.toFixed(2)} ${noun}`);
  switch (reason) {
    case "run_cap":
      return { title: "Run stopped at its thinking limit", detail: `This run reached ${limit(context.runCapUsd, "thinking limit")} and stopped. Anything it had already done is kept.` };
    case "deadline":
      return { title: "Run stopped at its time limit", detail: "This run used the time one run is allowed and stopped. Anything it had already done is kept." };
    case "step_limit":
      return { title: "Run stopped at its step limit", detail: "This run used every step it is allowed and stopped. Anything it had already done is kept." };
    case "needs_funds":
      return { title: "Add USDC to keep thinking", detail: "This agent pays for its own thinking, and its Solana wallet does not hold enough USDC for a run. Add USDC, or switch it to your own API key." };
    case "agent_day_cap":
      return { title: "Daily thinking limit reached", detail: `This agent has reached ${limit(context.dayCapUsd, "daily thinking limit")}. It starts again at 00:00 UTC, or you can raise the limit.` };
    case "owner_day_cap":
      return { title: "Your daily thinking limit is reached", detail: "Your agents have reached the most one account may spend on pay-per-use thinking in a day. They start again at 00:00 UTC. Your own API key has no such limit." };
    case "request_limit":
      return { title: "Daily request limit reached", detail: "This agent has made the most paid requests one agent may make in a day. It starts again at 00:00 UTC." };
    case "manual_limit":
      return { title: "Manual run limit reached", detail: "You have started the most pay-per-use runs by hand that one account may start in a day. Scheduled runs are not affected." };
    case "no_wallet":
      return { title: "This agent has no Solana wallet", detail: "Pay-per-use thinking is paid from the agent's Solana wallet. Add Solana to this agent's chains, or switch it to your own API key." };
    case "no_policy":
      return { title: "Wallet limit not set", detail: "This agent's wallet has no spending limit applied yet, so it is not allowed to pay for anything. Save the agent's risk settings to apply one." };
    case "model_unavailable":
      return { title: "Model no longer offered", detail: `${context.model ?? "The chosen model"} is no longer offered for pay-per-use. Pick another model in the agent's settings.` };
    case "flag_off":
      return { title: "Pay-per-use is not available", detail: "Pay-per-use thinking is switched off for this account. Switch the agent to your own API key to keep it running." };
    case "halted":
    case "paused":
      return { title: "Pay-per-use is paused", detail: "Tocker has paused pay-per-use thinking for every agent while a problem is checked. Nothing is being charged. The agent starts again on its own." };
    case "platform_day_cap":
      return { title: "Pay-per-use is at capacity today", detail: "Tocker limits how much all agents may spend on pay-per-use thinking in a day, and today's limit is reached. The agent starts again at 00:00 UTC. Your own API key is not affected." };
    case "no_rpc":
      return { title: "Pay-per-use is not set up", detail: "Tocker cannot read the Solana network reliably enough to pay safely, so nothing was charged. The agent tries again later." };
    case "step_cap":
      return { title: "The price was higher than expected", detail: "The model provider asked more for one step than Tocker allows a step to cost, so nothing was paid and the run stopped." };
    case "pin_mismatch":
      return { title: "Payment refused for safety", detail: "The model provider asked to be paid in a way Tocker does not recognise, so nothing was paid and the run stopped." };
    case "quote_failed":
    case "gateway_error":
      return { title: "The model provider is not answering", detail: "The provider that sells pay-per-use thinking did not answer, so the run stopped. The agent tries again later." };
    case "signature_failed":
      return { title: "The wallet did not sign", detail: "The agent's wallet could not sign the payment for this step, so nothing was paid and the run stopped. The agent tries again later." };
    case "paid_no_answer":
      return { title: "A step was paid for but not answered", detail: "The agent paid for one step and the provider did not return an answer. The run stopped so it would not pay again. The charge is listed under Money." };
    case "rerouted":
      return { title: "A different model answered", detail: `The provider answered with a different model than ${context.model ?? "the one chosen"}. The answer was not used and the run stopped. If that step was charged, it is listed under Money.` };
    case "bad_request":
      return { title: "The request was refused", detail: "The provider refused the request before any payment, so nothing was paid and the run stopped." };
  }
}

// ---------- the ledger ----------

/**
 * The life of one payment.
 *
 *  reserved        counted against every cap; nothing signed yet
 *  released        given up before any signature; the caps were given back
 *  signed          a signature exists; the paid request is in flight
 *  settled         paid and answered
 *  paid_no_answer  paid (the chain or the gateway confirms it) and no usable answer came
 *  unconfirmed     signed, the paid request failed, and the chain has not been asked yet;
 *                  counted as charged until the reconciler says otherwise
 *  not_charged     the reconciler proved the payment never landed; the caps were given back
 *  simulated       mock mode: no network, no wallet, no money
 */
export const INFERENCE_PAYMENT_STATUSES = [
  "reserved",
  "released",
  "signed",
  "settled",
  "paid_no_answer",
  "unconfirmed",
  "not_charged",
  "simulated",
] as const;
export type InferencePaymentStatus = (typeof INFERENCE_PAYMENT_STATUSES)[number];

/** The statuses whose amount counts as spent, for a run's total and for display. */
export const CHARGED_STATUSES: readonly InferencePaymentStatus[] = ["signed", "settled", "paid_no_answer", "unconfirmed"];

export interface InferenceReserveInput {
  ownerId: string;
  agentId: string;
  runId: string;
  /** The request's place in its run, from 0. Unique within a run. */
  seq: number;
  /** sha256 of the request body, hex. */
  requestHash: string;
  chain: InferenceChain;
  network: string;
  host: string;
  model: string;
  payerWalletId: string;
  payerAddress: string;
  payTo: string;
  asset: string;
  quotedUsd: number;
  caps: InferenceCaps;
  /** USD already charged in this run, for the run cap. */
  runSpentUsd: number;
  now: Date;
  simulated?: boolean;
}

export type InferenceReserveResult =
  | { ok: true; paymentId: string; budgetDay: string }
  | { ok: false; reason: InferenceStopReason };

export interface InferenceLedger {
  /**
   * All or nothing, across instances: the halt and pause switches are clear, the run cap
   * and the three day counters each have room, and a `reserved` row is written. On any
   * refusal nothing changes and nothing may be signed.
   */
  reserve(input: InferenceReserveInput): Promise<InferenceReserveResult>;
  /** Before any signature only: the row becomes `released` and the caps get the amount back. */
  release(paymentId: string, detail: string): Promise<void>;
  /** The signature exists and has been checked. Must be awaited before the paid request is sent. */
  markSigned(paymentId: string, signed: { memo: string | null; blockhash: string | null; payerSignature: string | null }): Promise<void>;
  settle(
    paymentId: string,
    result: {
      txHash: string | null;
      settledUsd: number;
      servedModel: string | null;
      httpStatus: number;
      gatewayRequestId: string | null;
      inputTokens: number | null;
      outputTokens: number | null;
    },
  ): Promise<void>;
  /** Paid, confirmed by the gateway's own receipt, and no usable answer. */
  markPaidNoAnswer(paymentId: string, result: { txHash: string | null; httpStatus: number | null; detail: string }): Promise<void>;
  /** Signed, the paid request failed, and whether money moved is not yet known. */
  markUnconfirmed(paymentId: string, result: { httpStatus: number | null; detail: string }): Promise<void>;
}

// ---------- the context one run pays through ----------

export interface InferencePayContext {
  ownerId: string;
  agentId: string;
  runId: string;
  /** The only model id the request may carry. */
  model: string;
  chain: InferenceChain;
  /** The agent's own wallet on that chain. */
  payer: { walletId: string; address: string };
  caps: InferenceCaps;
  /** Epoch ms. Nothing is signed with less than `SIGN_MIN_REMAINING_MS` left before it. */
  deadlineAt: number;
  ledger: InferenceLedger;

  // Written by the fetch, read by the run.
  /** Why the fetch stopped, when it did. */
  stop: { reason: InferenceStopReason; detail?: string } | null;
  /** USD charged so far in this run, and requests paid. */
  spentUsd: number;
  requests: number;
  /** The dearest and the slowest step so far, for deciding when to wrap up. */
  maxStepUsd: number;
  maxStepMs: number;
  /** A paid request still resolving its ledger row. The run awaits it before it finishes. */
  inFlight: Promise<void> | null;
}

/** A fresh context's counters. */
export function newPayCounters(): Pick<InferencePayContext, "stop" | "spentUsd" | "requests" | "maxStepUsd" | "maxStepMs" | "inFlight"> {
  return { stop: null, spentUsd: 0, requests: 0, maxStepUsd: 0, maxStepMs: 0, inFlight: null };
}

// ---------- switches ----------

/**
 * Who may use pay-per-use at all. `off` is the default and makes the app behave exactly
 * as it did before the feature existed. `owner` admits the people in `ADMIN_EMAILS` and
 * the user ids in `INFERENCE_USDC_USER_IDS`; `on` admits everyone.
 */
export type InferenceStage = "off" | "owner" | "on";

export interface InferenceFlags {
  stage: InferenceStage;
  userIds: readonly string[];
  hardStepUsd: number;
  ownerDayUsd: number;
  platformDayUsd: number;
}

function usdFrom(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  // A value that is not a number is a typo, not a wish for no limit.
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/** Pure: the switches as the environment sets them. Anything unrecognised reads as `off`. */
export function inferenceFlags(env: Record<string, string | undefined> = process.env): InferenceFlags {
  const raw = env.INFERENCE_USDC?.trim().toLowerCase();
  const stage: InferenceStage = raw === "on" || raw === "owner" ? raw : "off";
  return {
    stage,
    userIds: (env.INFERENCE_USDC_USER_IDS ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean),
    hardStepUsd: Math.min(usdFrom(env.INFERENCE_MAX_STEP_USD, HARD_STEP_CAP_USD), HARD_STEP_CAP_USD),
    ownerDayUsd: usdFrom(env.INFERENCE_OWNER_DAILY_USD, DEFAULT_OWNER_DAY_USD),
    platformDayUsd: usdFrom(env.INFERENCE_PLATFORM_DAILY_USD, DEFAULT_PLATFORM_DAY_USD),
  };
}

/** Pure: may this account use pay-per-use under these switches. */
export function inferenceAllowedFor(owner: { id: string; isAdmin: boolean }, flags: InferenceFlags): boolean {
  if (flags.stage === "on") return true;
  if (flags.stage === "owner") return owner.isAdmin || flags.userIds.includes(owner.id);
  return false;
}

/** The UTC day a moment falls on, as `YYYY-MM-DD`. Day caps are counted per UTC day. */
export function utcDay(at: Date): string {
  return at.toISOString().slice(0, 10);
}
