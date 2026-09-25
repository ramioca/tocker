"use client";

import { useEffect, useSyncExternalStore } from "react";
import Link from "next/link";
import { useReducedMotion } from "motion/react";
import { BorderBeam } from "border-beam";
import { ThinkingOrb, type OrbState } from "thinking-orbs";
import { Bell, Check, Gavel, TriangleAlert } from "lucide-react";
import { DynamicIsland, DynamicIslandView } from "@/components/motion/dynamic-island";
import { useRunStatus } from "@/components/providers/run-status";
import { useNow } from "@/hooks/use-now";
import { AgentAvatar } from "@/components/common/agent-avatar";
import { formatUsd } from "@/components/common/format";
import { usePushSubscription } from "@/components/wallets/use-push";

/**
 * Which thought-orb animation plays for each run tool. The orb is the island's
 * status vocabulary: what the agent is doing, without reading the text.
 */
const TOOL_ORB: Record<string, OrbState> = {
  get_portfolio: "working",
  discover_tokens: "searching",
  score_token: "solving",
  place_trade: "connecting",
  finish: "composing",
};

/**
 * The same tools in words, for the line under the agent's name. The raw ids read as
 * code ("discover_tokens…"); an unknown or newer tool falls back to "Working".
 */
const TOOL_LABEL: Record<string, string> = {
  get_portfolio: "Checking holdings",
  review_positions: "Reviewing positions",
  discover_tokens: "Finding tokens",
  score_token: "Scoring a token",
  get_token_price: "Checking a price",
  get_token_intel: "Reading token intel",
  search_data_sources: "Looking for data",
  query_data_source: "Buying data",
  place_trade: "Placing a trade",
  post_note: "Writing a note",
  finish: "Wrapping up",
};

/**
 * Where both islands sit. Phone: just above the tab bar. Desktop: bottom-centre,
 * because the approvals island is persistent and the top bar holds the nav and
 * Search — anything docked there covers them for as long as a proposal waits.
 * `data-run-island` on the dock is how the toaster knows to lift above it.
 */
const ISLAND_DOCK =
  "pointer-events-none fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-50 flex justify-center px-4 md:bottom-6";

/**
 * Every island view is capped at the viewport less the dock's gutters. The shell
 * springs to the measured width of its content, so capping the view is what keeps
 * the target on-screen; past the cap, text columns truncate instead of pushing.
 *
 * `w-max` matters as much as the cap: it makes the view's minimum size its natural
 * size (up to the cap). The truncating columns inside have no minimum of their own,
 * and without it the measuring wrapper could shrink to whatever width the shell is
 * mid-spring — and the shell would then settle on that.
 */
const VIEW_FIT = "!px-4 !py-2.5 w-max max-w-[calc(100vw-2rem)]";

/**
 * The island exists because a run is the one thing in this app that takes
 * minutes and happens off-screen. It is rare (a user triggers a handful a day),
 * so it earns real motion — and it dismisses itself once the run settles.
 */
export function RunIsland() {
  const { watched, detail, isRunning, clearRun, pendingProposals } = useRunStatus();
  const reducedMotion = useReducedMotion();
  const now = useNow();
  const elapsed = watched ? Math.max(0, Math.round((now - watched.startedAt) / 1000)) : 0;

  const status = detail?.status ?? (watched ? "running" : null);
  const settled = status === "succeeded" || status === "failed" || status === "cancelled";

  // Let the settled state read for a beat, then get out of the way.
  useEffect(() => {
    if (!settled) return;
    const id = window.setTimeout(clearRun, 5_000);
    return () => window.clearTimeout(id);
  }, [settled, clearRun]);

  // A run in flight outranks a pending decision — it is the thing happening *now*, and
  // it dismisses itself after a few seconds, at which point the approvals island returns.
  if (!watched) {
    return pendingProposals.count > 0 ? <ApprovalsIsland summary={pendingProposals} /> : null;
  }

  const view = settled ? "settled" : "running";
  const stepCount = detail?.steps.length ?? 0;
  const lastTool =
    detail?.steps
      .slice()
      .reverse()
      .find((step) => step.toolName)?.toolName ?? null;

  return (
    <div data-run-island className={ISLAND_DOCK}>
      <div className="pointer-events-auto">
        {/* The beam rides the border only while the run is live — it IS the
            running indicator, and `active` freezes it the moment the run settles. */}
        <BorderBeam
          size="md"
          colorVariant="ocean"
          theme="dark"
          strength={0.7}
          active={isRunning && !reducedMotion}
        >
          <DynamicIsland view={view} className="border border-white/10">
          <DynamicIslandView id="running" className={VIEW_FIT}>
            <Link
              href={`/agents/${watched.agentSlug}/runs/${watched.runId}`}
              className="flex min-w-0 items-center gap-3 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <AgentAvatar seed={watched.avatarSeed} name={watched.agentName} size="sm" />
              <span className="flex min-w-0 flex-col leading-tight">
                <span className="truncate text-[13px] font-medium">{watched.agentName}</span>
                {/* Per-tick churn: kept out of the polite live region so a run
                    doesn't read "1s… 2s… 3s…" over the meaningful announcements. */}
                <span className="truncate text-[11px] opacity-70" aria-hidden>
                  {lastTool ? `${TOOL_LABEL[lastTool] ?? "Working"}…` : "Thinking…"}
                  {stepCount > 0 ? ` · ${stepCount} steps` : null}
                </span>
              </span>
              <span
                aria-hidden
                className="tnum ml-2 shrink-0 rounded-full bg-white/10 px-2 py-0.5 font-mono text-[11px]"
              >
                {elapsed}s
              </span>
              {/* The orb narrates the current tool without words — the island
                  is on a dark pill, so ink is pinned light. */}
              <ThinkingOrb
                state={lastTool ? (TOOL_ORB[lastTool] ?? "working") : "breathing"}
                size={20}
                theme="dark"
                aria-hidden
                className="shrink-0"
              />
            </Link>
          </DynamicIslandView>

          <DynamicIslandView id="settled" className={VIEW_FIT}>
            <Link
              href={`/agents/${watched.agentSlug}/runs/${watched.runId}`}
              className="flex min-w-0 items-center gap-3 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              {status === "failed" ? (
                <TriangleAlert aria-hidden className="size-4 shrink-0 text-negative" />
              ) : (
                <Check aria-hidden className="size-4 shrink-0" />
              )}
              <span className="flex min-w-0 flex-col leading-tight">
                <span className="whitespace-nowrap text-[13px] font-medium">
                  {status === "failed" ? "Run failed" : "Run finished"}
                </span>
                <span className="max-w-[16rem] truncate text-[11px] opacity-70">
                  {detail?.error ?? detail?.summary ?? watched.agentName}
                </span>
              </span>
              {detail?.tradeCount ? (
                <span className="tnum shrink-0 whitespace-nowrap rounded-full bg-white/10 px-2 py-0.5 font-mono text-[11px]">
                  {detail.tradeCount} {detail.tradeCount === 1 ? "trade" : "trades"}
                </span>
              ) : null}
            </Link>
          </DynamicIslandView>
          </DynamicIsland>
        </BorderBeam>
      </div>
    </div>
  );
}

type AlertPermission = NotificationPermission | "unsupported";

/** Every read guarded: no Notification on the server, none in some mobile browsers. */
function readPermission(): AlertPermission {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  try {
    return Notification.permission;
  } catch {
    return "unsupported";
  }
}

const serverPermission = (): AlertPermission => "unsupported";

const permissionListeners = new Set<() => void>();

function subscribePermission(onChange: () => void): () => void {
  permissionListeners.add(onChange);
  return () => {
    permissionListeners.delete(onChange);
  };
}

/** The browser does not fire an event we can rely on, so the asker tells us. */
function notifyPermissionChanged(): void {
  for (const listener of permissionListeners) listener();
}

// Below `sm` the pill is icon-only (a 28px round target) so the approval line keeps
// the width; the label stays in the accessible name via `sr-only`.
const ALERT_PILL =
  "ml-2 flex shrink-0 items-center gap-1 rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-medium transition-[background-color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-white/20 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60 max-sm:size-7 max-sm:justify-center max-sm:p-0";

/**
 * The one place the alert permission is asked for, and only while there is actually
 * something waiting: a permission prompt makes sense next to "1 trade awaiting
 * approval" and nowhere else. It disappears for good once alerts are on — and never
 * renders at all if the browser cannot do notifications, or if the user already said
 * no (the browser will not re-ask, so offering again would be a dead button).
 *
 * **What "alerts" means depends on the browser, and the difference matters.** Where
 * there is a service worker, a push service and a VAPID key, this subscribes to Web
 * Push: the notification arrives with every tab closed and the phone in a pocket,
 * which is the only version of this feature that keeps a five-minute TTL honest, and
 * it carries Approve and Reject on the notification itself. Where any of that is
 * missing the old behaviour is still here — a plain `Notification` that fires from an
 * open tab — because a degraded alert beats none.
 */
function EnableAlertsButton() {
  const push = usePushSubscription();

  // `Notification.permission` is browser state, not React state, so it is read through
  // useSyncExternalStore: the server snapshot is "unsupported" (there is no
  // Notification object there), which renders nothing and cannot mismatch on hydration.
  // Only the fallback path uses it; the push hook tracks its own.
  const tabPermission = useSyncExternalStore(subscribePermission, readPermission, serverPermission);

  if (push.supported) {
    // Already reachable, or the browser was told no and will not ask again.
    if (push.subscribed || push.permission === "denied") return null;
    return (
      <button type="button" disabled={push.busy} onClick={() => void push.enable()} className={ALERT_PILL}>
        <Bell aria-hidden className="size-3" />
        <span className="sr-only sm:not-sr-only">{push.busy ? "Enabling…" : "Enable alerts"}</span>
      </button>
    );
  }

  if (tabPermission !== "default") return null;

  return (
    <button
      type="button"
      onClick={() => {
        try {
          // Both arms notify: the answer is whatever the browser now reports.
          void Notification.requestPermission().then(notifyPermissionChanged, notifyPermissionChanged);
        } catch {
          notifyPermissionChanged();
        }
      }}
      className={ALERT_PILL}
    >
      <Bell aria-hidden className="size-3" />
      <span className="sr-only sm:not-sr-only">Enable alerts</span>
    </button>
  );
}

/**
 * "1 trade awaiting approval", anywhere in the app.
 *
 * A proposal expires, so it cannot only exist on the page that produced it. This is the
 * one persistent island in the product — it stays until the queue is empty, because
 * unlike a run it does not resolve itself.
 */
function ApprovalsIsland({
  summary,
}: {
  summary: ReturnType<typeof useRunStatus>["pendingProposals"];
}) {
  const { count, latest } = summary;
  const href = latest ? `/agents/${latest.agentSlug}?proposal=${latest.tradeId}` : "/notifications";

  return (
    <div data-run-island className={ISLAND_DOCK}>
      <div className="pointer-events-auto">
        <DynamicIsland view="proposals" className="border border-white/10">
          <DynamicIslandView id="proposals" className={VIEW_FIT}>
            <Link
              href={href}
              className="flex min-w-0 flex-1 items-center gap-3 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <Gavel aria-hidden className="size-4 shrink-0" />
              <span className="flex min-w-0 flex-col leading-tight">
                <span className="truncate text-[13px] font-medium">
                  {count === 1 ? "1 trade awaiting approval" : `${count} trades awaiting approval`}
                </span>
                {latest ? (
                  <span className="tnum max-w-[18rem] truncate text-[11px] opacity-70">
                    {latest.agentName} wants to {latest.side} {formatUsd(latest.requestedUsd)} of {latest.symbol}
                  </span>
                ) : null}
              </span>
              <span className="tnum ml-2 shrink-0 rounded-full bg-white/10 px-2 py-0.5 font-mono text-[11px]">
                Review
              </span>
            </Link>
            <EnableAlertsButton />
          </DynamicIslandView>
        </DynamicIsland>
      </div>
    </div>
  );
}
