/**
 * Notification preferences: which kinds a user has muted.
 *
 * Stored on `users.notification_prefs` as `{ [kind]: false }` for each muted kind; a
 * kind that is absent (or true) is delivered. Muting is a read-side filter — rows are
 * still written, so turning a kind back on shows what arrived in the meantime.
 *
 * Some kinds are never muteable: a proposal waits on the user's decision, and a failed
 * exit or an unsettled trade means money is not where the user thinks it is.
 */

export type NotificationPrefs = Record<string, boolean>;

/** Always delivered, whatever the stored prefs say. */
export const ALWAYS_DELIVERED: readonly string[] = ["proposal", "exit_failed", "trade_unsettled"];

export interface NotificationPrefGroup {
  id: string;
  label: string;
  description: string;
  /** The notification kinds this one switch controls. */
  kinds: readonly string[];
}

/** The switches Settings shows, each over the real kinds the app writes. */
export const NOTIFICATION_PREF_GROUPS: readonly NotificationPrefGroup[] = [
  {
    id: "fills",
    label: "Your agents' trades",
    description: "Each fill with its receipt, and every exit a stop or target closed.",
    kinds: ["fill", "exit"],
  },
  {
    id: "digest",
    label: "Daily digest",
    description: "One summary per agent per day: trades, PnL and what the exit rules did.",
    kinds: ["digest"],
  },
  {
    id: "run_failed",
    label: "Failed runs",
    description: "When a run errors — a rejected key, a failed trade, a dead data source.",
    kinds: ["run_failed"],
  },
  {
    id: "following",
    label: "Agents you follow",
    description: "When an agent you follow places a trade.",
    kinds: ["trade"],
  },
  {
    id: "social",
    label: "Follows and likes",
    description: "When someone follows you or one of your agents, or likes a post.",
    kinds: ["follow", "like"],
  },
  {
    id: "comments",
    label: "Comments",
    description: "When someone comments on one of your agents' posts.",
    kinds: ["comment"],
  },
];

const MUTEABLE = new Set(NOTIFICATION_PREF_GROUPS.flatMap((group) => group.kinds));

/**
 * Keep only muteable kinds with a boolean value. The action runs this on whatever the
 * client sent, and the reader on whatever is stored, so neither trusts the other.
 */
export function sanitizePrefs(input: unknown): NotificationPrefs {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const out: NotificationPrefs = {};
  for (const [kind, value] of Object.entries(input as Record<string, unknown>)) {
    if (MUTEABLE.has(kind) && typeof value === "boolean") out[kind] = value;
  }
  return out;
}

/** The kinds to leave out of the list and the unread count. Never an always-delivered one. */
export function mutedKinds(prefs: unknown): string[] {
  const clean = sanitizePrefs(prefs);
  return Object.entries(clean)
    .filter(([kind, on]) => !on && !ALWAYS_DELIVERED.includes(kind))
    .map(([kind]) => kind);
}

/** A group's switch is on unless any of its kinds is muted. */
export function groupEnabled(prefs: NotificationPrefs, group: NotificationPrefGroup): boolean {
  return group.kinds.every((kind) => prefs[kind] !== false);
}

/** Set every kind in a group at once. */
export function withGroup(prefs: NotificationPrefs, group: NotificationPrefGroup, on: boolean): NotificationPrefs {
  const next = { ...prefs };
  for (const kind of group.kinds) next[kind] = on;
  return next;
}
