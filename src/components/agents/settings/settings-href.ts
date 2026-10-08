/**
 * Every address of an agent's settings that names a spot on the page, and where each one
 * lands. The page is eight steps, so a link says which step (`?step=`, which the server
 * reads, so that step is the first thing painted) and which control (`#anchor`, which
 * only the browser sees).
 *
 * The anchors are the section names the page had when it was one long scroll, so a link
 * kept from then still lands: `placeOfAnchor` reads a bare `#risk` that has no `?step=`.
 *
 * Pure, no React, and it touches no DOM, so the server queries that write a "fix it in
 * settings" link build it from the same table the page lands it with.
 */
import type { SettingsStepId, StepPlace } from "@/components/agents/builder/contract";

/** A spot on the settings page that a link can name. */
export type SettingsAnchor =
  | "strategy"
  | "brain"
  | "thinking"
  | "universe"
  | "data"
  | "execution"
  | "risk"
  | "exits"
  | "wallets"
  | "withdraw"
  | "budget"
  | "mode"
  | "delete"
  | "status";

/** A place on the settings page: one of its eight steps and, on Manage, the section to show. */
export type SettingsPlace = StepPlace<SettingsStepId>;

/**
 * Where each anchor lands: the step, the ids to try for focus (the first one on the page
 * wins, and with none it is the step's heading), and on Manage the section, as `sub`.
 */
export const ANCHOR_PLACE: Record<SettingsAnchor, SettingsPlace> = {
  // The Pause, Resume or Activate button. It sits above the steps, on every one of them,
  // so the page stays on the first.
  status: { step: "name", focusIds: ["agent-status-toggle"] },
  strategy: { step: "strategy", focusIds: ["strategy-prompt"] },
  // The key select when there is a key to choose, then the way to add one. An agent on
  // pay per use has neither, so last comes the choice that puts it on a key.
  brain: { step: "brain", focusIds: ["llm-key", "llm-key-add", "builder-think-key"] },
  // The pay-per-use model, which its limits sit under.
  thinking: { step: "brain", focusIds: ["builder-usdc-model"] },
  universe: { step: "hunts" },
  data: { step: "data" },
  execution: { step: "schedule", focusIds: ["builder-execution-approve"] },
  risk: { step: "limits" },
  exits: { step: "limits", focusIds: ["risk-exits"] },
  wallets: { step: "manage", sub: "wallets", focusIds: ["manage-wallets"] },
  withdraw: { step: "manage", sub: "withdraw", focusIds: ["manage-withdraw"] },
  // The wallet budget shares the Live mode section, under the mode itself.
  budget: { step: "manage", sub: "live", focusIds: ["budget-per-tx"] },
  mode: { step: "manage", sub: "live", focusIds: ["manage-live"] },
  delete: { step: "manage", sub: "delete", focusIds: ["manage-delete"] },
};

/**
 * The address of an agent's settings, or of one spot on them. With an anchor the step is
 * in the query too, so the page opens on that step and never shows the first one on the
 * way to it.
 */
export function agentSettingsHref(slug: string, anchor?: SettingsAnchor): string {
  const path = `/agents/${slug}/settings`;
  if (anchor === undefined) return path;
  return `${path}?${new URLSearchParams({ step: ANCHOR_PLACE[anchor].step }).toString()}#${anchor}`;
}

/** An anchor from a URL hash, with or without its `#`. Exact match only; anything else is null. */
export function parseAnchor(hash: string): SettingsAnchor | null {
  const name = hash.startsWith("#") ? hash.slice(1) : hash;
  return Object.prototype.hasOwnProperty.call(ANCHOR_PLACE, name) ? (name as SettingsAnchor) : null;
}

/**
 * Where a URL hash lands, or null when it names nothing on the page. This is how a link
 * with no `?step=` (a bookmark, an old notification) still finds its step. The place is
 * a copy, so whoever keeps it cannot change the table.
 */
export function placeOfAnchor(hash: string): SettingsPlace | null {
  const anchor = parseAnchor(hash);
  if (anchor === null) return null;
  const place = ANCHOR_PLACE[anchor];
  return { ...place, ...(place.focusIds ? { focusIds: [...place.focusIds] } : {}) };
}
