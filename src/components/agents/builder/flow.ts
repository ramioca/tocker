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
  parseCard,
  parseStep,
  REQUIRED_ERROR_KEYS,
  REQUIRED_ORDER,
  REQUIRED_PLACE,
  type BuilderStepId,
  type CardId,
  type Place,
  type StepStatus,
} from "./contract";
import type { BuilderDraft } from "./types";

type Config = BuilderDraft["config"];

/**
 * Every `validateDraft` key with a home, in the order errors are visited: step order,
 * then top to bottom within the step. A key that is not listed lands on the last step
 * with nothing to focus, and is reported by a toast.
 */
const ERROR_PLACES: ReadonlyArray<readonly [key: string, place: Place]> = [
  ["strategyPrompt", { step: "strategy", focusIds: ["strategy-prompt"] }],
  ["chains", { step: "rules", card: "universe", focusIds: ["rule-card-universe"] }],
  ["universe", { step: "rules", card: "universe", focusIds: ["rule-card-universe"] }],
  ["dataSources", { step: "rules", card: "data", focusIds: ["rule-card-data"] }],
  ["risk", { step: "rules", card: "risk", focusIds: ["rule-card-risk"] }],
  ["schedule", { step: "rules", card: "schedule", focusIds: ["rule-card-schedule"] }],
  ["execution", { step: "rules", card: "schedule", focusIds: ["rule-card-schedule"] }],
  // The key select when there is a key to choose; otherwise the way to add one.
  ["llmKeyId", { step: "brain", focusIds: ["llm-key", "llm-key-add"] }],
  // A pay-per-use draft has no key field; what can be wrong is its model or its limits.
  ["thinking", { step: "brain", focusIds: ["builder-usdc-model"] }],
  ["llm", { step: "brain", focusIds: ["llm-model"] }],
  ["name", { step: "create", focusIds: ["agent-name"] }],
];

/** The keys that make the Rules step read "Fix". */
const RULES_ERROR_KEYS = ["chains", "universe", "dataSources", "risk", "schedule", "execution"] as const;

/** Funding is checked against live balances, not the draft, so it has no key of its own. */
const FUNDING_PLACE: Place = { step: "create", card: "funding", focusIds: ["rule-card-funding"] };

const copyOf = (place: Place): Place => ({
  ...place,
  ...(place.focusIds ? { focusIds: [...place.focusIds] } : {}),
});

/** The step, the card to open and the control to focus for one `validateDraft` key. */
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
 * Whether any rule differs from the shipped defaults. Display only: it picks between the
 * words "Defaults" and "Edited" and decides nothing else.
 */
export function rulesEdited(config: Config): boolean {
  const base = DEFAULT_AGENT_CONFIG;
  if (!sameSet(config.chains, base.chains)) return true;
  if (!sameSet(config.dataSources, base.dataSources)) return true;
  const { discovery, ...universe } = config.universe;
  const { discovery: baseDiscovery, ...baseUniverse } = base.universe;
  if (!sameSet(discovery, baseDiscovery)) return true;
  if (!same(universe, baseUniverse)) return true;
  if (!same(config.risk, base.risk)) return true;
  if (!same(config.schedule, base.schedule)) return true;
  return !same(config.execution, base.execution);
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
    case "strategy":
      return missing(REQUIRED_ERROR_KEYS.strategy) ? "needed" : "ready";
    case "rules":
      if (missing(RULES_ERROR_KEYS)) return "fix";
      return rulesEdited(ctx.config) ? "edited" : "defaults";
    case "brain":
      return missing(REQUIRED_ERROR_KEYS.think) ? "needed" : "ready";
    case "create":
      if (missing(REQUIRED_ERROR_KEYS.name)) return "needed";
      return ctx.attempted && ctx.fundingBlocked ? "fix" : "ready";
  }
}

/**
 * Where a restored draft picks up: the first step, in order, with a required thing still
 * missing, or the last step when nothing is. Someone who left to fetch a key comes back
 * to the key.
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
 * The step an address asks for. `?step=` wins; without it a valid `?open=` means the
 * step its card sits on; without either, the first step.
 */
export function stepOf(params: Pick<URLSearchParams, "get">): BuilderStepId {
  const card = parseCard(params.get("open"));
  return parseStep(params.get("step")) ?? (card ? CARD_STEP[card] : "strategy");
}

/** The address of a step, with a card to open on arrival when one is given. */
export function stepHref(step: BuilderStepId, card?: CardId): string {
  const params = new URLSearchParams({ step });
  if (card) params.set("open", card);
  return `/agents/new?${params.toString()}`;
}
