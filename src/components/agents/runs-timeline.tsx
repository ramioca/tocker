"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, History } from "lucide-react";
import { RunStatusBadge } from "@/components/common/status-badge";
import { RelativeTime } from "@/components/common/relative-time";
import { EmptyState, ErrorState } from "@/components/common/empty-state";
import { formatDuration, formatUsd } from "@/components/common/format";
import { RunSteps } from "./run-steps";
import { fetchAgentRuns, fetchRunDetail } from "./agent-actions";
import { LoadMoreFailed } from "./load-more-failed";
import { readRunThinking, runThinkingShown } from "./thinking";
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
  const toggleId = useId();

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
  const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;
  // Orders the guard or the venue turned down: why "0 trades" was not "nothing to buy".
  const refused = run.refusedCount ?? 0;
  // Owner only, and only for a run that paid for its own thinking: the query sends
  // nothing for a key run or to a visitor, and such a row renders as it always has.
  const thinking = readRunThinking(run);
  // The words for it. The amount on a run row is what the ledger counted as charged,
  // which is more than what is proven paid, so it is not called paid; and a run that
  // stopped on a step that got no answer is not told that step was paid for, because the
  // chain may since have shown it never was (`runThinkingShown`).
  const shown = thinking ? runThinkingShown(thinking) : null;

  return (
    <li>
      <div className="flex items-center gap-3 px-3 py-2.5">
        <button
          id={toggleId}
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
          {/*
            On a phone the SUCCEEDED pill on every row costs the summary its width and
            says nothing — success is the normal case. Only a dot is left for it there;
            anything else keeps its full badge.
          */}
          {run.status === "succeeded" ? (
            <>
              <RunStatusBadge status={run.status} className="max-sm:hidden" />
              <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-positive/70 sm:hidden" />
              <span className="sr-only sm:hidden">{run.status}</span>
            </>
          ) : (
            <RunStatusBadge status={run.status} />
          )}
          {/*
            `run.error` is already redacted for non-owners in the query (`visibleError`),
            so whatever arrives here is safe to print. Tone it as a failure though: a red
            status pill next to a line in the ordinary body colour reads like a summary
            that happens to sit beside a badge.
          */}
          <span className="min-w-0 flex-1">
            <span
              className={cn(
                "block text-sm max-sm:line-clamp-2 sm:truncate",
                run.error ? "text-destructive/90" : "text-foreground/85",
              )}
            >
              {/* `shown.sentence` stands in for the stored error of one kind of stop only,
                  and only where there is an error to stand in for (the owner's view). */}
              {run.error && shown?.sentence
                ? shown.sentence
                : (run.error ?? run.summary ?? (run.status === "running" ? "Working…" : "No summary"))}
            </span>
            <span className="tnum mt-0.5 block font-mono text-[11px] text-muted-foreground sm:hidden">
              {plural(run.tradeCount, "trade")}
              {refused > 0 ? ` · ${refused} refused` : null} ·{" "}
              <span title="x402 data spend">{formatUsd(run.dataSpendUsd)} data</span>
            </span>
            {/* Its own line under the summary, at every width: the figure columns on the
                right are fixed, and a fifth would move every key run's numbers too. The
                reason is `describeInferenceStop`'s title, the words the banner and the
                notification use, for every stop but the one whose sentence claims a
                payment (`runThinkingShown`); its full sentence is the run's own summary or
                error. */}
            {shown ? (
              <span className="tnum mt-0.5 block text-[11px] text-muted-foreground sm:truncate">
                <span className="font-mono" title={shown.amountNote}>
                  {shown.amount}
                </span>{" "}
                thinking
                {shown.stop ? (
                  <>
                    {" · "}
                    <span
                      title={shown.stop.detail}
                      className={shown.stop.kind === "limit" ? "text-amber-700 dark:text-amber-400" : "text-destructive/90"}
                    >
                      {shown.stop.title}
                    </span>
                  </>
                ) : null}
              </span>
            ) : null}
          </span>
          {/* Fixed columns, right-aligned, so the figures scan down the list; an
              auto-width group started each row's numbers at a different x. */}
          <span className="hidden shrink-0 font-mono text-[11px] text-muted-foreground sm:grid sm:grid-cols-[4.25rem_4.5rem_4.5rem_3.5rem] sm:justify-items-end sm:gap-x-3">
            <span className="tnum">{plural(run.stepCount, "step")}</span>
            {/* Refusals (owner-only; null for anyone else) stack under the count, so the
                column keeps its width and the figures still line up down the list. */}
            {refused > 0 ? (
              <span className="tnum flex flex-col items-end gap-0.5 leading-none">
                <span>{plural(run.tradeCount, "trade")}</span>
                <span className="text-amber-700 dark:text-amber-400">{refused} refused</span>
              </span>
            ) : (
              <span className="tnum">{plural(run.tradeCount, "trade")}</span>
            )}
            <span className="tnum" title="x402 data spend">
              {formatUsd(run.dataSpendUsd)} data
            </span>
            {elapsed !== null ? <span className="tnum">{formatDuration(elapsed)}</span> : <span />}
          </span>
          <RelativeTime iso={run.createdAt} className="w-14 shrink-0 text-right text-[11px]" />
        </button>

        {/* Described by the toggle beside it, so twenty of these are not twenty
            identical "Open full run"s to a screen reader. The `after:` inset widens the
            hit area to 44px without making the chevron louder than the row. */}
        <Link
          href={`/agents/${agentSlug}/runs/${run.id}`}
          aria-label="Open full run"
          aria-describedby={toggleId}
          className="relative grid size-7 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors duration-150 after:absolute after:-inset-2 after:content-[''] hover:bg-muted hover:text-foreground focus-ring"
        >
          {/* A page in this tab, not a new one: the external-link glyph belongs to GeckoTerminal. */}
          <ChevronRight aria-hidden className="size-3.5" />
        </Link>
      </div>

      {/* grid-template-rows collapse keeps the transition on a compositable
          property path and avoids measuring the content. `inert` while closed: a
          zero-height row must not keep its transcript controls in the Tab order. */}
      <div
        inert={!open}
        className="grid transition-[grid-template-rows] duration-[240ms] ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none"
        style={{ gridTemplateRows: open ? "1fr" : "0fr" }}
      >
        <div className="overflow-hidden">
          <div className="px-3 pb-4 pl-10">
            {open && (detail.isPending || (detail.isError && detail.isFetching)) ? (
              <p className="text-xs text-muted-foreground">Loading steps…</p>
            ) : detail.isError ? (
              // The request failed; that is not the same as a run with nothing stored.
              <p className="text-xs text-muted-foreground">
                Couldn&rsquo;t load this run&rsquo;s steps.{" "}
                <button
                  type="button"
                  onClick={() => void detail.refetch()}
                  className="rounded underline underline-offset-2 transition-colors duration-150 hover:text-foreground focus-ring"
                >
                  Retry
                </button>
              </p>
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
            ) : open && detail.data === null ? (
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

  // Only when there is nothing to show. `isError` is also true when just an older page
  // failed, and the pages already loaded are still in `query.data` — those must stay.
  if (query.isError && !query.data) {
    return (
      <ErrorState
        title="Run history did not load"
        description="Try again in a moment."
        action={
          <button
            type="button"
            onClick={() => void query.refetch()}
            className="focus-ring rounded-lg border border-border px-3 py-1.5 text-xs transition-[background-color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-muted active:scale-[0.97]"
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

      {query.isFetchNextPageError && !query.isFetchingNextPage ? (
        <LoadMoreFailed what="runs" onRetry={() => void query.fetchNextPage()} />
      ) : query.hasNextPage ? (
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
