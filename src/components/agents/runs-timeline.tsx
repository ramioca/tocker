"use client";

import { useState } from "react";
import Link from "next/link";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { ChevronDown, ExternalLink, History } from "lucide-react";
import { RunStatusBadge } from "@/components/common/status-badge";
import { RelativeTime } from "@/components/common/relative-time";
import { EmptyState, ErrorState } from "@/components/common/empty-state";
import { formatDuration, formatUsd } from "@/components/common/format";
import { RunSteps } from "./run-steps";
import { fetchAgentRuns, fetchRunDetail } from "./agent-actions";
import { cn } from "@/lib/utils";
import type { Page, RunSummary } from "@/server/types";

function RunRow({
  agentSlug,
  agentId,
  run,
}: {
  agentSlug: string;
  agentId: string;
  run: RunSummary;
}) {
  const [open, setOpen] = useState(false);

  // Steps are only fetched when a row is opened — a timeline of forty runs
  // should not pull forty transcripts.
  const detail = useQuery({
    queryKey: ["run-detail", agentId, run.id],
    queryFn: () => fetchRunDetail(run.id),
    enabled: open,
    retry: false,
  });

  const elapsed =
    run.startedAt && run.finishedAt
      ? new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime()
      : null;

  return (
    <li>
      <div className="flex items-center gap-3 px-3 py-2.5">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-3 rounded-lg text-left transition-transform duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.995] focus-ring"
        >
          <ChevronDown
            aria-hidden
            className={cn(
              "size-3.5 shrink-0 text-muted-foreground transition-transform duration-200 ease-[cubic-bezier(0.23,1,0.32,1)]",
              open && "rotate-180",
            )}
          />
          <RunStatusBadge status={run.status} />
          {/*
            `run.error` is already redacted for non-owners in the query (`visibleError`),
            so whatever arrives here is safe to print. Tone it as a failure though: a red
            status pill next to a line in the ordinary body colour reads like a summary
            that happens to sit beside a badge.
          */}
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-sm",
              run.error ? "text-destructive/90" : "text-foreground/85",
            )}
          >
            {run.error ?? run.summary ?? (run.status === "running" ? "Working…" : "No summary")}
          </span>
          <span className="hidden shrink-0 items-center gap-3 font-mono text-[11px] text-muted-foreground sm:flex">
            <span className="tnum">{run.stepCount} steps</span>
            <span className="tnum">{run.tradeCount} trades</span>
            <span className="tnum">{formatUsd(run.dataSpendUsd)}</span>
            {elapsed !== null ? <span className="tnum">{formatDuration(elapsed)}</span> : null}
          </span>
          <RelativeTime iso={run.createdAt} className="shrink-0 text-[11px]" />
        </button>

        <Link
          href={`/agents/${agentSlug}/runs/${run.id}`}
          aria-label="Open full run"
          className="grid size-7 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground focus-ring"
        >
          <ExternalLink aria-hidden className="size-3.5" />
        </Link>
      </div>

      {/* grid-template-rows collapse keeps the transition on a compositable
          property path and avoids measuring the content. */}
      <div
        className="grid transition-[grid-template-rows] duration-[240ms] ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none"
        style={{ gridTemplateRows: open ? "1fr" : "0fr" }}
      >
        <div className="overflow-hidden">
          <div className="px-3 pb-4 pl-10">
            {detail.isPending && open ? (
              <p className="text-xs text-muted-foreground">Loading steps…</p>
            ) : detail.data && !detail.data.transcriptVisible ? (
              /*
                Somebody else's run. The transcript is owner-only — which sources were
                queried, with what arguments and in what order *is* the strategy — and
                the query returns an empty `steps` array for a non-owner.

                Say that, rather than letting `RunSteps` fall through to its "this run
                ended before the model produced a step" empty state: the row directly
                above this one says the run took three steps, so that copy reads as a
                contradiction and makes the product look broken instead of discreet.
              */
              <p className="max-w-prose text-xs leading-relaxed text-muted-foreground">
                The transcript is private.{" "}
                {detail.data.stepCount > 0
                  ? `This run took ${detail.data.stepCount} step${detail.data.stepCount === 1 ? "" : "s"}; what it asked, and of which data sources, is part of the strategy and stays with its owner.`
                  : "What a run asks, and of which data sources, is part of the strategy and stays with its owner."}
              </p>
            ) : detail.data ? (
              <RunSteps steps={detail.data.steps} status={detail.data.status} durationMs={elapsed} />
            ) : open ? (
              <p className="text-xs text-muted-foreground">
                No step transcript was stored for this run.
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </li>
  );
}

export function RunsTimeline({
  agentId,
  agentSlug,
  initialPage,
}: {
  agentId: string;
  agentSlug: string;
  initialPage?: Page<RunSummary>;
}) {
  const query = useInfiniteQuery({
    queryKey: ["agent-runs", agentId],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => fetchAgentRuns(agentId, pageParam),
    getNextPageParam: (last: Page<RunSummary>) => last.nextCursor,
    initialData: initialPage
      ? { pages: [initialPage], pageParams: [null as string | null] }
      : undefined,
  });

  const runs = query.data?.pages.flatMap((page) => page.items) ?? [];

  if (query.isPending) {
    return (
      <div className="space-y-2" role="status" aria-label="Loading runs">
        {Array.from({ length: 4 }, (_, i) => (
          <span
            key={i}
            className="block h-11 rounded-lg bg-muted/60 motion-safe:animate-pulse"
            aria-hidden
          />
        ))}
      </div>
    );
  }

  if (query.isError) {
    return (
      <ErrorState
        title="Run history did not load"
        description={(query.error as Error).message}
        action={
          <button
            type="button"
            onClick={() => void query.refetch()}
            className="rounded-lg border border-border px-3 py-1.5 text-xs transition-colors duration-150 hover:bg-muted"
          >
            Try again
          </button>
        }
      />
    );
  }

  if (runs.length === 0) {
    return (
      <EmptyState
        icon={<History />}
        title="No runs yet"
        description="Trigger a run from the header, or give the agent a schedule and it will start on its own."
      />
    );
  }

  return (
    <div className="space-y-3">
      <ul className="glass-card divide-y divide-[var(--glass-hairline)] overflow-hidden rounded-xl">
        {runs.map((run) => (
          <RunRow key={run.id} run={run} agentId={agentId} agentSlug={agentSlug} />
        ))}
      </ul>

      {query.hasNextPage ? (
        <button
          type="button"
          onClick={() => void query.fetchNextPage()}
          disabled={query.isFetchingNextPage}
          className="w-full rounded-lg border border-border py-2 text-xs text-muted-foreground transition-colors duration-150 hover:bg-muted/60 hover:text-foreground disabled:opacity-50 focus-ring"
        >
          {query.isFetchingNextPage ? "Loading…" : "Load older runs"}
        </button>
      ) : null}
    </div>
  );
}
