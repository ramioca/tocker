/**
 * The words the builder's parts agree on: the four steps, the five cards, a place on the
 * page, and the shapes the summaries hand to the agent card. Pure, no React, so the flow
 * and the summaries can be tested in node.
 *
 * Nothing here is saved. The draft, its storage and the payload sent on create are
 * `./types` and `./use-draft`, and this file does not touch them.
 */
import type { LlmKeyRow } from "@/server/types";
import type { UsdcEstimate } from "@/components/agents/thinking";

/** The steps, in the order the stepper shows them. Also the values `?step=` accepts. */
export const BUILDER_STEPS = ["strategy", "rules", "brain", "create"] as const;
export type BuilderStepId = (typeof BUILDER_STEPS)[number];

/** The cards that open and close. Also the values `?open=` accepts. */
export const CARD_IDS = ["universe", "data", "risk", "schedule", "funding"] as const;
export type CardId = (typeof CARD_IDS)[number];

/** The step each card sits on. Funding is on the last one, beside the Create button. */
export const CARD_STEP: Record<CardId, BuilderStepId> = {
  universe: "rules",
  data: "rules",
  risk: "rules",
  schedule: "rules",
  funding: "create",
};

/**
 * Somewhere the page can take the user: a step, a card to open on it, and the DOM ids to
 * try for focus, first one that exists wins.
 */
export interface Place {
  step: BuilderStepId;
  card?: CardId;
  focusIds?: string[];
}

/** How a step change was made. Only a pointer move animates the panel. */
export type Via = "pointer" | "keyboard" | "auto";

export type StepStatus = "needed" | "ready" | "defaults" | "edited" | "fix";

/** The three things only the user can decide. */
export type RequiredId = "strategy" | "think" | "name";
export const REQUIRED_ORDER: readonly RequiredId[] = ["strategy", "think", "name"];

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
  name: { step: "create", focusIds: ["agent-name"] },
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

/** Where a click on each row goes. */
export const ROW_PLACE: Record<PreviewRowId, Place> = {
  hunts: { step: "rules", card: "universe", focusIds: ["rule-card-universe"] },
  data: { step: "rules", card: "data", focusIds: ["rule-card-data"] },
  limits: { step: "rules", card: "risk", focusIds: ["rule-card-risk"] },
  exits: { step: "rules", card: "risk", focusIds: ["risk-exits"] },
  runs: { step: "rules", card: "schedule", focusIds: ["rule-card-schedule"] },
  thinks: { step: "brain" },
  money: { step: "create", card: "funding", focusIds: ["rule-card-funding"] },
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
 * Every figure the cost sentence, the card summaries and the agent card quote, worked
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

/** A card id from an `?open=` value. Exact string match only; anything else is null. */
export function parseCard(value: unknown): CardId | null {
  return typeof value === "string" && (CARD_IDS as readonly string[]).includes(value) ? (value as CardId) : null;
}
