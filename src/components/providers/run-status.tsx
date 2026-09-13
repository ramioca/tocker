"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
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
  /** Re-read the proposal count now — called after a decision settles. */
  refreshProposals: () => void;
}

const RunStatusContext = createContext<RunStatusValue | null>(null);

const POLL_MS = 2_000;
const PROPOSAL_POLL_MS = 15_000;
const NO_PROPOSALS: PendingProposalsSummary = { count: 0, latest: null };
export const PROPOSALS_QUERY_KEY = ["pending-proposals"] as const;

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

async function fetchPendingProposals(): Promise<PendingProposalsSummary> {
  const response = await fetch("/api/me/proposals", {
    headers: { accept: "application/json" },
    credentials: "include",
    cache: "no-store",
  });
  if (!response.ok) return NO_PROPOSALS;
  return (await response.json()) as PendingProposalsSummary;
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

  // Signed-out visitors (the landing page) never poll.
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

  const value = useMemo<RunStatusValue>(
    () => ({ watched, detail, isRunning, watchRun, clearRun, pendingProposals, refreshProposals }),
    [watched, detail, isRunning, watchRun, clearRun, pendingProposals, refreshProposals],
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
