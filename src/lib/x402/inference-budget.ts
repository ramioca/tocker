/**
 * Pay-per-use thinking: the numbers a run is held to, and when a stopped agent is looked
 * at again.
 *
 * Everything here is pure: no database, no network, no clock but the one handed in. The
 * ledger (`./inference-ledger.ts`) applies these rules inside its transactions; the run
 * loop, the preflight and the status screens read the same functions, so a limit means
 * the same thing wherever it is shown. Safe to import from a client component.
 */
import type { AgentConfig } from "@/db/schema";
import {
  AGENT_DAY_REQUESTS,
  INFERENCE_STOPS,
  MAX_PAID_STEPS,
  USDC_DAY_CAP,
  USDC_RUN_CAP,
  type InferenceCaps,
  type InferenceFlags,
  type InferenceStopReason,
} from "./inference-types";

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

// ---------- caps ----------

/**
 * An owner's limit as stored, held inside the range the product offers. A limit that is
 * missing or is not a number reads as zero, which pays for nothing: a config that asks
 * for pay-per-use without saying how much is never given a default to spend.
 */
function ownerLimit(value: unknown, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return 0;
  return Math.min(value, max);
}

/**
 * The limits one run is held to. The owner's two limits come from `config.llm.usdc`; the
 * account and platform limits come from the environment's switches; the rest are the
 * product's constants. Resolved once, before the run starts, and passed to every
 * `reserve`.
 */
export function capsFor(config: Pick<AgentConfig, "llm">, flags: InferenceFlags): InferenceCaps {
  const usdc = config.llm?.usdc;
  const maxSteps = Number.isFinite(config.llm?.maxSteps) ? Math.max(1, Math.floor(config.llm.maxSteps)) : 1;
  return {
    stepUsd: flags.hardStepUsd,
    runUsd: ownerLimit(usdc?.maxUsdPerRun, USDC_RUN_CAP.max),
    agentDayUsd: ownerLimit(usdc?.maxUsdPerDay, USDC_DAY_CAP.max),
    ownerDayUsd: flags.ownerDayUsd,
    platformDayUsd: flags.platformDayUsd,
    agentDayRequests: AGENT_DAY_REQUESTS,
    // The steps the run may take, plus the one request that wraps it up.
    maxRequestsPerRun: Math.min(maxSteps, MAX_PAID_STEPS) + 1,
  };
}

// ---------- the day counters ----------

/** What has been reserved or spent today, as the three counters hold it. */
export interface InferenceDayUsage {
  /** The UTC day, `YYYY-MM-DD`. */
  day: string;
  platform: { usd: number; requests: number };
  owner: { usd: number; requests: number; manualRuns: number };
  agent: { usd: number; requests: number };
}

/**
 * Sums of six-decimal amounts are exact enough that a millionth of a cent is noise, not
 * money. The database compares in `numeric`; this is for the same comparison in JS.
 */
const EPSILON_USD = 1e-9;

/**
 * Which day limit, if any, has no room left for a step of `stepUsd`. Checked in the order
 * the ledger's `reserve` checks them, so the preflight names the same reason the first
 * step would have stopped on.
 */
export function dayCapStop(usage: InferenceDayUsage, caps: InferenceCaps, stepUsd: number): InferenceStopReason | null {
  const step = Math.max(0, stepUsd);
  if (caps.platformDayUsd <= 0 || usage.platform.usd + step > caps.platformDayUsd + EPSILON_USD) return "platform_day_cap";
  if (usage.owner.usd + step > caps.ownerDayUsd + EPSILON_USD) return "owner_day_cap";
  if (usage.agent.requests >= caps.agentDayRequests) return "request_limit";
  if (usage.agent.usd + step > caps.agentDayUsd + EPSILON_USD) return "agent_day_cap";
  return null;
}

// ---------- the switches ----------

/** The control row, as read. A deployment that has never written one reads as all clear. */
export interface InferenceControlState {
  halted: boolean;
  /** Why the halt is on. Null when it is not. */
  haltReason: string | null;
  /**
   * When an admin last cleared a halt. Whoever cleared it has dealt with everything up
   * to that moment, so evidence older than this does not throw the halt again.
   */
  haltClearedAt: Date | null;
  pausedUntil: Date | null;
  pauseReason: string | null;
  updatedBy: string | null;
  updatedAt: Date | null;
}

export const INFERENCE_CONTROL_CLEAR: InferenceControlState = {
  halted: false,
  haltReason: null,
  haltClearedAt: null,
  pausedUntil: null,
  pauseReason: null,
  updatedBy: null,
  updatedAt: null,
};

/** Whether the switches stop a payment at `now`. The admin's halt outranks a breaker's pause. */
export function controlStop(control: Pick<InferenceControlState, "halted" | "pausedUntil">, now: Date): "halted" | "paused" | null {
  if (control.halted) return "halted";
  if (control.pausedUntil && control.pausedUntil.getTime() > now.getTime()) return "paused";
  return null;
}

// ---------- holds ----------

/** Minutes until the next look, by how many holds in a row there have been. */
export const HOLD_BACKOFF_MINUTES = [15, 30, 60, 120, 360] as const;
/** A platform pause is short and clears itself, so it is looked at again soon. */
export const HOLD_SWITCH_MINUTES = 15;

/** The first instant of the next UTC day: when the day counters start again. */
export function nextUtcMidnight(now: Date): Date {
  return new Date(Math.floor(now.getTime() / DAY_MS) * DAY_MS + DAY_MS);
}

/**
 * When a held agent is looked at again.
 *
 * `strikes` is the number of holds in a row counting this one, so the first hold waits
 * 15 minutes, the second 30, then 60, 120, and 360 from the fifth on. A caller that
 * passes the count before this hold (0 for the first) gets 15 minutes for the first two,
 * which is the cautious reading of the same table.
 *
 *  - A day limit (agent, owner, platform, requests, manual runs) cannot clear before the
 *    counters start again, so those wait for 00:00 UTC whatever the strikes.
 *  - The admin halt and a breaker pause are looked at again in 15 minutes.
 *  - A reason that only stops the run in hand (its own limit, its time, its steps) is not
 *    a hold: the answer is `now`.
 *  - Everything else backs off by strikes.
 */
export function holdUntil(reason: InferenceStopReason, strikes: number, now: Date): Date {
  if (INFERENCE_STOPS[reason] === "limit") return new Date(now.getTime());
  switch (reason) {
    case "agent_day_cap":
    case "owner_day_cap":
    case "request_limit":
    case "platform_day_cap":
    case "manual_limit":
      return nextUtcMidnight(now);
    case "halted":
    case "paused":
      return new Date(now.getTime() + HOLD_SWITCH_MINUTES * MINUTE_MS);
    default: {
      const count = Number.isFinite(strikes) ? Math.floor(strikes) : 1;
      const index = Math.min(Math.max(count - 1, 0), HOLD_BACKOFF_MINUTES.length - 1);
      return new Date(now.getTime() + HOLD_BACKOFF_MINUTES[index] * MINUTE_MS);
    }
  }
}

// ---------- breakers ----------

/**
 * When pay-per-use is paused for everyone, and for how long.
 *
 *  - `unanswered`: steps that were paid for (or may have been) and got no answer, from
 *    more than one agent, mean the gateway is taking money and not serving.
 *  - `gateway` and `signature`: runs that stopped before any payment because the gateway
 *    or the wallet would not do its part. Nothing was lost, but every further run would
 *    stop the same way.
 *  - `pin_mismatch`: the gateway asked to be paid in a way that is not the pinned one.
 *    One is enough.
 */
export const BREAKER_RULES = {
  unanswered: { rows: 3, agents: 2, windowMinutes: 15, pauseMinutes: 30 },
  gateway: { failures: 5, windowMinutes: 10, pauseMinutes: 15 },
  signature: { failures: 5, windowMinutes: 10, pauseMinutes: 15 },
  pin_mismatch: { failures: 1, windowMinutes: 30, pauseMinutes: 30 },
} as const;

export type BreakerRule = keyof typeof BREAKER_RULES;

/** The furthest back any rule looks. What the applying function has to read. */
export const BREAKER_LOOKBACK_MINUTES = Math.max(...Object.values(BREAKER_RULES).map((rule) => rule.windowMinutes));

/** Payment statuses that count toward `unanswered`. */
export const BREAKER_PAYMENT_STATUSES = ["paid_no_answer", "unconfirmed"] as const;
/** Run stop reasons that count toward `gateway`, `signature` and `pin_mismatch`. */
export const BREAKER_STOP_REASONS = ["quote_failed", "gateway_error", "signature_failed", "pin_mismatch"] as const;

export interface BreakerEvidence {
  /** Ledger rows, by when the payment was signed. Only the two unanswered statuses count. */
  payments: ReadonlyArray<{ status: string; agentId: string | null; at: Date }>;
  /** Runs that stopped, by when they finished, with the reason they recorded. */
  stops: ReadonlyArray<{ reason: string | null; at: Date }>;
}

export interface BreakerTrip {
  rule: BreakerRule;
  /** Counted from the event that tripped the rule, not from the moment it was noticed. */
  pauseUntil: Date;
  reason: string;
}

function within(at: Date, now: Date, windowMinutes: number): boolean {
  const age = now.getTime() - at.getTime();
  // An event stamped slightly ahead of this clock is still recent.
  return age < windowMinutes * MINUTE_MS && age > -5 * MINUTE_MS;
}

function latest(times: readonly Date[]): number {
  return times.reduce((max, at) => Math.max(max, at.getTime()), 0);
}

/**
 * Every breaker rule the evidence trips at `now`.
 *
 * Each pause runs from the latest event that counted toward its rule. That makes the
 * decision the same however often it is asked: looking again five minutes later, with
 * nothing new, names the same end and does not push it out.
 */
export function breakerTrips(evidence: BreakerEvidence, now: Date): BreakerTrip[] {
  const trips: BreakerTrip[] = [];

  const unanswered = evidence.payments.filter(
    (payment) =>
      (BREAKER_PAYMENT_STATUSES as readonly string[]).includes(payment.status) && within(payment.at, now, BREAKER_RULES.unanswered.windowMinutes),
  );
  // A row with no agent on it cannot be told apart from another: all such count as one.
  const agents = new Set(unanswered.map((payment) => payment.agentId ?? ""));
  if (unanswered.length >= BREAKER_RULES.unanswered.rows && agents.size >= BREAKER_RULES.unanswered.agents) {
    trips.push({
      rule: "unanswered",
      pauseUntil: new Date(latest(unanswered.map((payment) => payment.at)) + BREAKER_RULES.unanswered.pauseMinutes * MINUTE_MS),
      reason: `${unanswered.length} paid steps from ${agents.size} agents got no answer within ${BREAKER_RULES.unanswered.windowMinutes} minutes`,
    });
  }

  const stopsOf = (reasons: readonly string[], windowMinutes: number) =>
    evidence.stops.filter((stop) => stop.reason !== null && reasons.includes(stop.reason) && within(stop.at, now, windowMinutes));

  const gateway = stopsOf(["quote_failed", "gateway_error"], BREAKER_RULES.gateway.windowMinutes);
  if (gateway.length >= BREAKER_RULES.gateway.failures) {
    trips.push({
      rule: "gateway",
      pauseUntil: new Date(latest(gateway.map((stop) => stop.at)) + BREAKER_RULES.gateway.pauseMinutes * MINUTE_MS),
      reason: `${gateway.length} runs stopped because the gateway did not answer within ${BREAKER_RULES.gateway.windowMinutes} minutes`,
    });
  }

  const signature = stopsOf(["signature_failed"], BREAKER_RULES.signature.windowMinutes);
  if (signature.length >= BREAKER_RULES.signature.failures) {
    trips.push({
      rule: "signature",
      pauseUntil: new Date(latest(signature.map((stop) => stop.at)) + BREAKER_RULES.signature.pauseMinutes * MINUTE_MS),
      reason: `${signature.length} runs stopped because the wallet did not sign within ${BREAKER_RULES.signature.windowMinutes} minutes`,
    });
  }

  const pins = stopsOf(["pin_mismatch"], BREAKER_RULES.pin_mismatch.windowMinutes);
  if (pins.length >= BREAKER_RULES.pin_mismatch.failures) {
    trips.push({
      rule: "pin_mismatch",
      pauseUntil: new Date(latest(pins.map((stop) => stop.at)) + BREAKER_RULES.pin_mismatch.pauseMinutes * MINUTE_MS),
      reason: "the gateway asked to be paid in a way that is not the pinned one",
    });
  }

  return trips;
}

/**
 * The pause to set at `now`, if any: the tripped rule whose pause ends last, and only
 * when that end is still ahead. A rule whose pause has already run out is history.
 */
export function breakerDecision(evidence: BreakerEvidence, now: Date): BreakerTrip | null {
  let chosen: BreakerTrip | null = null;
  for (const trip of breakerTrips(evidence, now)) {
    if (trip.pauseUntil.getTime() <= now.getTime()) continue;
    if (!chosen || trip.pauseUntil.getTime() > chosen.pauseUntil.getTime()) chosen = trip;
  }
  return chosen;
}
