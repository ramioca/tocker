"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Check, Gavel, TriangleAlert } from "lucide-react";
import { DynamicIsland, DynamicIslandView } from "@/components/motion/dynamic-island";
import { useRunStatus } from "@/components/providers/run-status";
import { useNow } from "@/hooks/use-now";
import { AgentAvatar } from "@/components/common/agent-avatar";
import { cn } from "@/lib/utils";

/**
 * The heaviest material in the app, and the only one that floats free of a page.
 *
 * `DynamicIsland` paints its own opaque shell, so the tokens are handed to it as
 * utilities rather than as `.glass-heavy` — same recipe, same weight. It is a
 * blurred surface, so it counts against the per-viewport budget: it is on screen
 * for at most a minute or two, and nothing else blurs while it is.
 */
const ISLAND_MATERIAL = cn(
  "border border-[var(--glass-hairline)]",
  "bg-[var(--glass-overlay)] text-foreground",
  "backdrop-blur-[var(--glass-blur-heavy)] backdrop-saturate-[1.7]",
  "shadow-[var(--glass-overlay-shadow)]",
);

/**
 * The island exists because a run is the one thing in this app that takes
 * minutes and happens off-screen. It is rare (a user triggers a handful a day),
 * so it earns real motion — and it dismisses itself once the run settles.
 */
export function RunIsland() {
  const { watched, detail, isRunning, clearRun, pendingProposals } = useRunStatus();
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
    <div className="pointer-events-none fixed inset-x-0 top-2 z-50 flex justify-center px-4">
      <div className="pointer-events-auto">
        <DynamicIsland view={view} className={ISLAND_MATERIAL}>
          <DynamicIslandView id="running" className="!px-4 !py-2.5">
            <Link
              href={`/agents/${watched.agentSlug}/runs/${watched.runId}`}
              className="focus-ring flex items-center gap-3 rounded-lg"
            >
              <AgentAvatar seed={watched.avatarSeed} name={watched.agentName} size="sm" />
              <span className="flex flex-col leading-tight">
                <span className="text-[13px] font-medium">{watched.agentName}</span>
                <span className="text-[11px] text-muted-foreground">
                  {lastTool ? `${lastTool}…` : "thinking…"}
                  {stepCount > 0 ? ` · ${stepCount} steps` : null}
                </span>
              </span>
              <span className="tnum glass-inset ml-2 rounded-full px-2 py-0.5 font-mono text-[11px]">
                {elapsed}s
              </span>
              <span
                aria-hidden
                className={cn(
                  "size-2 rounded-full bg-primary",
                  isRunning && "motion-safe:animate-pulse",
                )}
              />
            </Link>
          </DynamicIslandView>

          <DynamicIslandView id="settled" className="!px-4 !py-2.5">
            <Link
              href={`/agents/${watched.agentSlug}/runs/${watched.runId}`}
              className="focus-ring flex items-center gap-3 rounded-lg"
            >
              {status === "failed" ? (
                <TriangleAlert aria-hidden className="size-4 text-negative" />
              ) : (
                <Check aria-hidden className="size-4 text-positive" />
              )}
              <span className="flex flex-col leading-tight">
                <span className="text-[13px] font-medium">
                  {status === "failed" ? "Run failed" : "Run finished"}
                </span>
                <span className="max-w-[16rem] truncate text-[11px] text-muted-foreground">
                  {detail?.error ?? detail?.summary ?? watched.agentName}
                </span>
              </span>
              {detail?.tradeCount ? (
                <span className="tnum glass-inset rounded-full px-2 py-0.5 font-mono text-[11px]">
                  {detail.tradeCount} {detail.tradeCount === 1 ? "trade" : "trades"}
                </span>
              ) : null}
            </Link>
          </DynamicIslandView>
        </DynamicIsland>
      </div>
    </div>
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
    <div className="pointer-events-none fixed inset-x-0 top-2 z-50 flex justify-center px-4">
      <div className="pointer-events-auto">
        <DynamicIsland view="proposals" className={ISLAND_MATERIAL}>
          <DynamicIslandView id="proposals" className="!px-4 !py-2.5">
            <Link
              href={href}
              className="focus-ring flex items-center gap-3 rounded-lg"
            >
              <Gavel aria-hidden className="size-4 text-primary" />
              <span className="flex flex-col leading-tight">
                <span className="text-[13px] font-medium">
                  {count === 1 ? "1 trade awaiting approval" : `${count} trades awaiting approval`}
                </span>
                {latest ? (
                  <span className="max-w-[18rem] truncate text-[11px] text-muted-foreground">
                    {latest.agentName} wants to {latest.side} ${Math.round(latest.requestedUsd)} of {latest.symbol}
                  </span>
                ) : null}
              </span>
              <span className="tnum glass-inset ml-2 rounded-full px-2 py-0.5 font-mono text-[11px] text-primary">
                Review
              </span>
            </Link>
          </DynamicIslandView>
        </DynamicIsland>
      </div>
    </div>
  );
}
