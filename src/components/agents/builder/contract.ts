/**
 * The words the builder's parts agree on: the eight steps, a place on the page, and the
 * shapes the summaries hand to the agent card. Pure, no React, so the flow
 * and the summaries can be tested in node.
 *
 * Nothing here is saved. The draft, its storage and the payload sent on create are
 * `./types` and `./use-draft`, and this file does not touch them.
 */
import type { LlmKeyRow } from "@/server/types";
import type { UsdcEstimate } from "@/components/agents/thinking";

/** The steps, in the order the stepper shows them. Also the values `?step=` accepts. */
export const BUILDER_STEPS = [
  "name",
  "strategy",
  "hunts",
  "data",
  "limits",
  "schedule",
  "brain",
  "create",
] as const;
export type BuilderStepId = (typeof BUILDER_STEPS)[number];

/**
 * Old links only. The rules used to be cards that opened on one "rules" step, and an
 * address could name one (`?step=rules&open=risk`). Each is a step of its own now, and
 * nothing on the page opens or closes: these are kept so an old link still lands.
 */
export const CARD_IDS = ["universe", "data", "risk", "schedule", "funding"] as const;
export type CardId = (typeof CARD_IDS)[number];

/** The step that holds what each old card held. */
export const CARD_STEP: Record<CardId, BuilderStepId> = {
  universe: "hunts",
  data: "data",
  risk: "limits",
  schedule: "schedule",
  funding: "create",
};

/** The old step that held the four rule cards, and the step an address naming it gets. */
export const LEGACY_RULES_STEP = "rules";
export const LEGACY_RULES_TARGET: BuilderStepId = "hunts";

/**
 * Somewhere the page can take the user: a step, and the DOM ids to try for focus, first
 * one that exists wins. With none, or none on the page, focus goes to the step's heading.
 */
export interface Place {
  step: BuilderStepId;
  focusIds?: string[];
}

/** How a step change was made. Only a pointer move animates the panel. */
export type Via = "pointer" | "keyboard" | "auto";

export type StepStatus = "needed" | "ready" | "defaults" | "edited" | "fix";

/** The three things only the user can decide. */
export type RequiredId = "strategy" | "think" | "name";
/** In step order, which is also the order of the ready list on the agent card. */
export const REQUIRED_ORDER: readonly RequiredId[] = ["name", "strategy", "think"];

/** The `validateDraft` keys that make each required thing not ready. */
export const REQUIRED_ERROR_KEYS: Record<RequiredId, readonly string[]> = {
  strategy: ["strategyPrompt"],
  think: ["llmKeyId", "thinking", "llm"],
  name: ["name"],
};

/** Where a Fix button takes the user for each required thing. */
export const REQUIRED_PLACE: Record<RequiredId, Place> = {
  strategy: { step: "strategy", focusIds: ["strategy-prompt"] },
  think: { step: "brain", focusIds: ["llm-key", "llm-key-add", "builder-usdc-model"] },
  name: { step: "name", focusIds: ["agent-name"] },
};

/** One row of "Yours to decide" on the agent card. */
export interface ReadyItem {
  id: RequiredId;
  label: string;
  ready: boolean;
  value: string;
  place: Place;
}

/** The seven rows of "Already set" on the agent card, in the order they are shown. */
export type PreviewRowId = "hunts" | "data" | "limits" | "exits" | "runs" | "thinks" | "money";

/**
 * Where a click on each row goes. Only the exit rules have a spot of their own inside a
 * step; every other row is a whole step, so focus goes to its heading.
 */
export const ROW_PLACE: Record<PreviewRowId, Place> = {
  hunts: { step: "hunts" },
  data: { step: "data" },
  limits: { step: "limits" },
  exits: { step: "limits", focusIds: ["risk-exits"] },
  runs: { step: "schedule" },
  thinks: { step: "brain" },
  money: { step: "create" },
};

export interface PreviewRow {
  id: PreviewRowId;
  label: string;
  text: string;
  /** True when the row states something still missing, not a setting. */
  needed: boolean;
  place: Place;
}

/** One line of "A run" on the agent card. */
export interface CostLine {
  id: "runs" | "thinking" | "data" | "fee" | "sign" | "wallet";
  label: string;
  text: string;
}

/**
 * Every figure the cost sentence, the read-back lines and the agent card quote, worked
 * out once from the draft so no two of them can disagree.
 */
export interface CostFacts {
  chosenCount: number;
  sourcesPerRun: number;
  radarPerRun: number;
  costPerRun: number;
  dataCapUsd: number;
  intervalMinutes: number;
  runsPerDay: number;
  payPerUse: boolean;
  thinking: UsdcEstimate | null;
  thinkingNeedUsd: number | null;
  providerLabel: string;
  heldForLive: boolean;
  feeUsd: number;
}

/**
 * The two labels that live in `.tsx` files (`intervalLabel`, `ttlLabel`), passed in so
 * the summaries stay importable from a node test.
 */
export interface SummaryLabels {
  interval: (minutes: number) => string;
  ttl: (minutes: number) => string;
}

/** As much of a saved key as the summaries read. */
export type KeyRef = Pick<LlmKeyRow, "id" | "provider">;

/** A step id from a `?step=` value. Exact string match only; anything else is null. */
export function parseStep(value: unknown): BuilderStepId | null {
  return typeof value === "string" && (BUILDER_STEPS as readonly string[]).includes(value)
    ? (value as BuilderStepId)
    : null;
}

/** An old card id from an `?open=` value. Exact string match only; anything else is null. */
export function parseCard(value: unknown): CardId | null {
  return typeof value === "string" && (CARD_IDS as readonly string[]).includes(value) ? (value as CardId) : null;
}
