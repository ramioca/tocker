"use client";

/**
 * Local-only notification preferences. There is no server surface for these yet —
 * see the report's proposed `updateNotificationPrefs` action. Stored per-browser so
 * the toggles at least persist across reloads while that lands.
 *
 * Backed by `useSyncExternalStore` rather than a read-in-effect: the server snapshot
 * is the defaults, so hydration matches, and React handles the swap to stored values.
 */
import { useCallback, useSyncExternalStore } from "react";
import { AnimatedSwitch } from "@/components/spectrumui/animated-switch";

const STORAGE_KEY = "tocker:notification-prefs";

const PREFS = [
  { id: "trades", label: "Trades", description: "When one of your agents fills an order." },
  { id: "runs", label: "Failed runs", description: "When a run errors — bad key, rejected trade, dead data source." },
  { id: "social", label: "Follows and likes", description: "When someone follows you or reacts to a post." },
  { id: "comments", label: "Comments", description: "When someone replies to one of your agent's posts." },
  { id: "milestones", label: "Milestones", description: "PnL thresholds and streaks worth knowing about." },
] as const;

type PrefId = (typeof PREFS)[number]["id"];
type Prefs = Record<PrefId, boolean>;

const DEFAULTS: Prefs = {
  trades: true,
  runs: true,
  social: true,
  comments: true,
  milestones: false,
};

// `getSnapshot` must return a stable reference, so parsed values are cached and only
// re-parsed when the raw string actually changes.
let cachedRaw: string | null | undefined;
let cached: Prefs = DEFAULTS;
const listeners = new Set<() => void>();

function getSnapshot(): Prefs {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    raw = null;
  }
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    try {
      cached = raw ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Prefs>) } : DEFAULTS;
    } catch {
      cached = DEFAULTS;
    }
  }
  return cached;
}

function getServerSnapshot(): Prefs {
  return DEFAULTS;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

function writePrefs(next: Prefs) {
  cached = next;
  cachedRaw = JSON.stringify(next);
  try {
    localStorage.setItem(STORAGE_KEY, cachedRaw);
  } catch {
    // Non-fatal: the toggle still reflects the change for this session.
  }
  for (const listener of listeners) listener();
}

export function NotificationPrefs() {
  const prefs = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const set = useCallback(
    (id: PrefId, value: boolean) => {
      writePrefs({ ...prefs, [id]: value });
    },
    [prefs],
  );

  return (
    <ul className="divide-y divide-border/70">
      {PREFS.map((pref) => (
        <li key={pref.id} className="flex items-center gap-4 py-3.5 first:pt-0 last:pb-0">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">{pref.label}</p>
            <p className="text-sm text-muted-foreground">{pref.description}</p>
          </div>
          <AnimatedSwitch
            checked={prefs[pref.id]}
            onCheckedChange={(value) => set(pref.id, value)}
            label={pref.label}
            size="sm"
          />
        </li>
      ))}
    </ul>
  );
}
