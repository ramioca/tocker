"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import type { RunDetail } from "@/server/types";

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
}

const RunStatusContext = createContext<RunStatusValue | null>(null);

const POLL_MS = 2_000;

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

  const value = useMemo<RunStatusValue>(
    () => ({ watched, detail, isRunning, watchRun, clearRun }),
    [watched, detail, isRunning, watchRun, clearRun],
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
