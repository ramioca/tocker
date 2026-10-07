/**
 * Where the builder takes the user: which step an error belongs to, what each step's
 * status word is, where a restored draft resumes, and the address of a step. Pure, no
 * React, so every rule here is tested in node (`flow.test.ts`).
 *
 * Nothing here decides whether a draft may be created. That is `./validate.ts`; this
 * file only reads its result.
 */
import { DEFAULT_AGENT_CONFIG } from "@/lib/agent/config";
import {
  BUILDER_STEPS,
  CARD_STEP,
  LEGACY_RULES_STEP,
  LEGACY_RULES_TARGET,
  parseCard,
  parseStep,
  REQUIRED_ERROR_KEYS,
  REQUIRED_ORDER,
  REQUIRED_PLACE,
  type BuilderStepId,
  type Place,
  type StepStatus,
} from "./contract";
import type { BuilderDraft } from "./types";

type Config = BuilderDraft["config"];

/**
 * Every `validateDraft` key with a home, in the order errors are visited: step order,
 * then top to bottom within the step. A key that is not listed lands on the last step
 * with nothing to focus, and is reported by a toast.
 *
 * A rule error names a whole section of the config ("risk"), not one control, so its
 * place is the step that holds the section and focus goes to that step's heading.
 */
const ERROR_PLACES: ReadonlyArray<readonly [key: string, place: Place]> = [
  ["name", { step: "name", focusIds: ["agent-name"] }],
  ["strategyPrompt", { step: "strategy", focusIds: ["strategy-prompt"] }],
  // The chain picker sits with the hunting ground, so a missing Solana wallet goes there.
  ["chains", { step: "hunts" }],
  ["universe", { step: "hunts" }],
  ["dataSources", { step: "data" }],
  ["risk", { step: "limits" }],
  ["schedule", { step: "schedule" }],
  ["execution", { step: "schedule" }],
  // Not a config key and not checked today; the paper balance is chosen on this step.
  ["paperStartingUsd", { step: "schedule" }],
  // The key select when there is a key to choose; otherwise the way to add one.
  ["llmKeyId", { step: "brain", focusIds: ["llm-key", "llm-key-add"] }],
  // A pay-per-use draft has no key field; what can be wrong is its model or its limits.
  ["thinking", { step: "brain", focusIds: ["builder-usdc-model"] }],
  ["llm", { step: "brain", focusIds: ["llm-model"] }],
];

/** The four steps whose settings start on a default, and are judged against it. */
type RuleStepId = "hunts" | "data" | "limits" | "schedule";

/** The keys that make each of them read "Fix": the sections its controls write. */
const RULE_ERROR_KEYS: Record<RuleStepId, readonly string[]> = {
  hunts: ["chains", "universe"],
  data: ["dataSources"],
  limits: ["risk"],
  schedule: ["schedule", "execution", "paperStartingUsd"],
};

/** Funding is checked against live balances, not the draft, so it has no key of its own. */
const FUNDING_PLACE: Place = { step: "create" };

const copyOf = (place: Place): Place => ({
  ...place,
  ...(place.focusIds ? { focusIds: [...place.focusIds] } : {}),
});

/** The step and the control to focus for one `validateDraft` key. */
export function placeOfError(key: string): Place {
  const known = ERROR_PLACES.find(([name]) => name === key);
  return known ? copyOf(known[1]) : { step: "create" };
}

/**
 * The error to send the user to first: the earliest step that has one, then the first
 * key within it in page order. Null when there is none.
 */
export function firstErrorKey(errors: Record<string, string>): string | null {
  const known = ERROR_PLACES.find(([key]) => errors[key]);
  if (known) return known[0];
  return Object.keys(errors).find((key) => errors[key]) ?? null;
}

/**
 * Where a failed Create takes the user. Validation errors come before the funding
 * blocker, as they always have: there is no point reading balances for a draft that
 * cannot be created.
 */
export function firstErrorPlace(errors: Record<string, string>, fundingBlocker: string | null): Place | null {
  const key = firstErrorKey(errors);
  if (key !== null) return placeOfError(key);
  return fundingBlocker ? copyOf(FUNDING_PLACE) : null;
}

/** Order does not matter for a list of chains, feeds or sources. */
function sameSet(a: readonly unknown[], b: readonly unknown[]): boolean {
  return a.length === b.length && a.every((item) => b.includes(item));
}

/** Structural equality for plain config values. A key set to undefined counts as absent. */
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((item, i) => same(item, b[i]));
  }
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const key of keys) if (!same(left[key], right[key])) return false;
  return true;
}

/**
 * Whether one step's settings differ from the shipped defaults. Display only: it picks
 * between the words "Defaults" and "Edited" and decides nothing else. Each step answers
 * for the sections of the config its own controls write, so moving a risk slider never
 * marks the schedule as edited.
 */
export function stepEdited(step: RuleStepId, config: Config): boolean {
  const base = DEFAULT_AGENT_CONFIG;
  switch (step) {
    case "hunts": {
      // The chain picker is drawn with the hunting ground, so the chains count here.
      if (!sameSet(config.chains, base.chains)) return true;
      const { discovery, ...universe } = config.universe;
      const { discovery: baseDiscovery, ...baseUniverse } = base.universe;
      return !sameSet(discovery, baseDiscovery) || !same(universe, baseUniverse);
    }
    case "data":
      return !sameSet(config.dataSources, base.dataSources);
    case "limits":
      // The exit rules and the per-run data cap are part of `risk`, and of this step.
      return !same(config.risk, base.risk);
    case "schedule":
      return !same(config.schedule, base.schedule) || !same(config.execution, base.execution);
  }
}

const RULE_STEPS = ["hunts", "data", "limits", "schedule"] as const satisfies readonly RuleStepId[];

/** Whether any rule on any step differs from the shipped defaults. */
export function rulesEdited(config: Config): boolean {
  return RULE_STEPS.some((step) => stepEdited(step, config));
}

/**
 * The status word of one step, from `validateDraft`'s result. `attempted` is whether a
 * Create has failed; only then does a blocked funding plan count against the last step,
 * because until then nobody has asked for the money.
 */
export function stepStatus(
  step: BuilderStepId,
  errors: Record<string, string>,
  ctx: { config: Config; attempted: boolean; fundingBlocked: boolean },
): StepStatus {
  const missing = (keys: readonly string[]) => keys.some((key) => errors[key]);
  switch (step) {
    case "name":
      return missing(REQUIRED_ERROR_KEYS.name) ? "needed" : "ready";
    case "strategy":
      // One is written on arrival, so a strategy that fails a Create is one the user
      // cleared or cut short: by then it is a thing to fix, not a thing still to do.
      if (!missing(REQUIRED_ERROR_KEYS.strategy)) return "ready";
      return ctx.attempted ? "fix" : "needed";
    case "hunts":
    case "data":
    case "limits":
    case "schedule":
      if (missing(RULE_ERROR_KEYS[step])) return "fix";
      return stepEdited(step, ctx.config) ? "edited" : "defaults";
    case "brain":
      return missing(REQUIRED_ERROR_KEYS.think) ? "needed" : "ready";
    case "create":
      if (ctx.attempted && ctx.fundingBlocked) return "fix";
      // Not ready to create while one of the three required things is still missing,
      // whichever step holds it.
      return REQUIRED_ORDER.some((id) => missing(REQUIRED_ERROR_KEYS[id])) ? "needed" : "ready";
  }
}

/**
 * Where a restored draft picks up: the first step, in order, with a required thing still
 * missing (a name, a strategy, a way to think), or the last step when nothing is. Someone
 * who had named the agent and left to fetch a key comes back to the key.
 */
export function resumeStep(errors: Record<string, string>): BuilderStepId {
  const missing = REQUIRED_ORDER.find((id) => REQUIRED_ERROR_KEYS[id].some((key) => errors[key]));
  return missing ? REQUIRED_PLACE[missing].step : "create";
}

/** The steps on either side of one, null at the ends. */
export function neighbours(step: BuilderStepId): { back: BuilderStepId | null; next: BuilderStepId | null } {
  const index = BUILDER_STEPS.indexOf(step);
  return { back: BUILDER_STEPS[index - 1] ?? null, next: BUILDER_STEPS[index + 1] ?? null };
}

/**
 * The step an address names, or null when it names none. A step id wins. Without one,
 * an old link still lands: `?open=risk` (with or without `?step=rules`) is the step that
 * holds what that card held, and a bare `?step=rules` is the first of the rule steps.
 */
export function requestedStep(params: Pick<URLSearchParams, "get">): BuilderStepId | null {
  const raw = params.get("step");
  const step = parseStep(raw);
  if (step) return step;
  const card = parseCard(params.get("open"));
  if (card) return CARD_STEP[card];
  return raw === LEGACY_RULES_STEP ? LEGACY_RULES_TARGET : null;
}

/** The step an address asks for: the one it names, or the first step. */
export function stepOf(params: Pick<URLSearchParams, "get">): BuilderStepId {
  return requestedStep(params) ?? BUILDER_STEPS[0];
}

/** The address of a step. */
export function stepHref(step: BuilderStepId): string {
  return `/agents/new?${new URLSearchParams({ step }).toString()}`;
}
