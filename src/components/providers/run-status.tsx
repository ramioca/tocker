"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/hooks/use-session";
import type { PendingProposalsSummary, RunDetail } from "@/server/types";

export interface WatchedRun {
  runId: string;
  agentId: string;
  agentSlug: string;
  agentName: string;
  avatarSeed: string | null;
  startedAt: number;
}

interface RunStatusValue {
  watched: WatchedRun | null;
  /** Live detail from the runtime route; null while the route is unavailable. */
  detail: RunDetail | null;
  /** True from the moment a run is triggered until it reports a terminal status. */
  isRunning: boolean;
  watchRun: (run: Omit<WatchedRun, "startedAt">) => void;
  clearRun: () => void;
  /**
   * Trades this user's approve-mode agents are waiting on, polled while they are
   * anywhere in the app. A proposal has a TTL, so it cannot only be discoverable on the
   * page that produced it.
   */
  pendingProposals: PendingProposalsSummary;
  /**
   * The bell's unread count, riding on the same 15s poll. `null` until the first poll
   * lands (or when the route does not report it), so the server-rendered count shows.
   */
  unreadNotifications: number | null;
  /**
   * Re-read the proposal and unread counts now — called after a decision settles, a run
   * finishes, or notifications are marked read.
   */
  refreshProposals: () => void;
}

const RunStatusContext = createContext<RunStatusValue | null>(null);

const POLL_MS = 2_000;
const PROPOSAL_POLL_MS = 15_000;
const NO_PROPOSALS: PendingProposalsSummary = { count: 0, latest: null };
export const PROPOSALS_QUERY_KEY = ["pending-proposals"] as const;

/** `/api/me/proposals` also carries the unread notification count, so the bell needs no poll of its own. */
type ProposalsPoll = PendingProposalsSummary & { unreadNotifications?: number };

async function fetchRun(agentId: string, runId: string): Promise<RunDetail | null> {
  const response = await fetch(`/api/agents/${agentId}/runs/${runId}`, {
    headers: { accept: "application/json" },
    cache: "no-store",
  });
  // The runtime workstream owns this route. Before it lands the island still
  // shows "running" from local state rather than flashing an error at the user.
  if (!response.ok) return null;
  return (await response.json()) as RunDetail;
}

/**
 * True only where the browser has a Notification API *and* the user has already
 * granted it. Every access is guarded: this module renders on the server, Safari on
 * iOS has no constructor outside a PWA, and a locked-down browser can throw on the
 * permission read itself.
 */
function notificationsGranted(): boolean {
  if (typeof window === "undefined" || !("Notification" in window)) return false;
  try {
    return Notification.permission === "granted";
  } catch {
    return false;
  }
}

/**
 * One desktop notification for one new proposal, with the four things the operator
 * needs to decide whether to put the phone down: which agent, which side, how much,
 * which token. Clicking it focuses this tab and opens the approvals page.
 *
 * `tag` is the trade id, so a re-render or a second poll replaces the same bubble
 * rather than stacking another one on top of it.
 */
function alertNewProposal(summary: PendingProposalsSummary, open: () => void): void {
  if (!notificationsGranted()) return;
  const latest = summary.latest;
  const title = latest
    ? `${latest.agentName} wants to ${latest.side} $${Math.round(latest.requestedUsd)} of ${latest.symbol}`
    : summary.count === 1
      ? "A trade is waiting for your approval"
      : `${summary.count} trades are waiting for your approval`;
  const body = latest
    ? "Approve it or let it expire — the quote is re-taken when you approve."
    : "Open Tocker to approve or decline.";
  try {
    const notification = new Notification(title, { body, tag: latest?.tradeId ?? "tocker-proposals" });
    notification.onclick = () => {
      window.focus();
      notification.close();
      open();
    };
  } catch {
    // An unsupported constructor, a denied permission race, or a browser that refuses
    // to construct one outside a user gesture. A missed alert is not a failure state.
  }
}

async function fetchPendingProposals(): Promise<ProposalsPoll> {
  const response = await fetch("/api/me/proposals", {
    headers: { accept: "application/json" },
    credentials: "include",
    cache: "no-store",
  });
  if (!response.ok) return NO_PROPOSALS;
  return (await response.json()) as ProposalsPoll;
}

/**
 * One run at a time is watched — the one the user just started. The Dynamic
 * Island reads this; nothing else needs to know a run is in flight.
 */
export function RunStatusProvider({ children }: { children: ReactNode }) {
  const [watched, setWatched] = useState<WatchedRun | null>(null);

  const { data } = useQuery({
    queryKey: ["run-status", watched?.agentId, watched?.runId],
    queryFn: () => fetchRun(watched!.agentId, watched!.runId),
    enabled: watched !== null,
    refetchInterval: (query) => {
      const run = query.state.data;
      if (!run) return POLL_MS;
      return run.status === "running" || run.status === "queued" ? POLL_MS : false;
    },
    retry: false,
    staleTime: 0,
  });

  const detail = data ?? null;
  const isRunning =
    watched !== null && (detail === null || detail.status === "running" || detail.status === "queued");

  const watchRun = useCallback((run: Omit<WatchedRun, "startedAt">) => {
    setWatched({ ...run, startedAt: Date.now() });
  }, []);

  const clearRun = useCallback(() => setWatched(null), []);

  // Signed-out visitors never poll.
  const { session } = useSession();
  const queryClient = useQueryClient();
  const proposalsQuery = useQuery({
    queryKey: PROPOSALS_QUERY_KEY,
    queryFn: fetchPendingProposals,
    enabled: session !== null,
    refetchInterval: PROPOSAL_POLL_MS,
    refetchOnWindowFocus: true,
    retry: false,
    staleTime: 0,
  });

  const refreshProposals = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: PROPOSALS_QUERY_KEY });
  }, [queryClient]);

  const pendingProposals = proposalsQuery.data ?? NO_PROPOSALS;
  const unreadNotifications =
    typeof proposalsQuery.data?.unreadNotifications === "number" ? proposalsQuery.data.unreadNotifications : null;

  // A run that just settled is what writes fill and exit notifications (and, in approve
  // mode, proposals): re-read both counts then rather than up to 15s later.
  const settledRunId = watched !== null && detail !== null && !isRunning ? watched.runId : null;
  useEffect(() => {
    if (settledRunId) refreshProposals();
  }, [settledRunId, refreshProposals]);

  // A proposal is worth interrupting someone for: it expires, and the whole point of
  // approval mode on a five-minute tick is that the answer comes in minutes. Only a
  // *rise* in the count fires — the first poll of a session never does, so opening the
  // app with three already pending is silent.
  const router = useRouter();
  const lastCountRef = useRef<number | null>(null);
  // Nothing is compared until the first real payload: the placeholder is a count of
  // zero, and treating it as a baseline would alert for proposals that were already
  // waiting when the tab opened.
  const proposalsLoaded = proposalsQuery.data !== undefined;
  useEffect(() => {
    if (!proposalsLoaded) return;
    const count = pendingProposals.count;
    const previous = lastCountRef.current;
    lastCountRef.current = count;
    if (previous === null || count <= previous) return;
    alertNewProposal(pendingProposals, () => router.push("/notifications"));
  }, [proposalsLoaded, pendingProposals, router]);

  const value = useMemo<RunStatusValue>(
    () => ({
      watched,
      detail,
      isRunning,
      watchRun,
      clearRun,
      pendingProposals,
      unreadNotifications,
      refreshProposals,
    }),
    [watched, detail, isRunning, watchRun, clearRun, pendingProposals, unreadNotifications, refreshProposals],
  );

  return <RunStatusContext.Provider value={value}>{children}</RunStatusContext.Provider>;
}

export function useRunStatus(): RunStatusValue {
  const context = useContext(RunStatusContext);
  if (!context) {
    throw new Error("useRunStatus must be used inside <RunStatusProvider>");
  }
  return context;
}
