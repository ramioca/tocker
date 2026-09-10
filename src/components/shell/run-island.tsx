"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Check, TriangleAlert } from "lucide-react";
import { DynamicIsland, DynamicIslandView } from "@/components/motion/dynamic-island";
import { useRunStatus } from "@/components/providers/run-status";
import { useNow } from "@/hooks/use-now";
import { AgentAvatar } from "@/components/common/agent-avatar";
import { cn } from "@/lib/utils";

/**
 * The island exists because a run is the one thing in this app that takes
 * minutes and happens off-screen. It is rare (a user triggers a handful a day),
 * so it earns real motion — and it dismisses itself once the run settles.
 */
export function RunIsland() {
  const { watched, detail, isRunning, clearRun } = useRunStatus();
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

  if (!watched) return null;

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
        <DynamicIsland view={view} className="border border-white/10">
          <DynamicIslandView id="running" className="!px-4 !py-2.5">
            <Link
              href={`/agents/${watched.agentSlug}/runs/${watched.runId}`}
              className="flex items-center gap-3 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <AgentAvatar seed={watched.avatarSeed} name={watched.agentName} size="sm" />
              <span className="flex flex-col leading-tight">
                <span className="text-[13px] font-medium">{watched.agentName}</span>
                <span className="text-[11px] opacity-70">
                  {lastTool ? `${lastTool}…` : "thinking…"}
                  {stepCount > 0 ? ` · ${stepCount} steps` : null}
                </span>
              </span>
              <span className="tnum ml-2 rounded-full bg-background/15 px-2 py-0.5 font-mono text-[11px]">
                {elapsed}s
              </span>
              <span
                aria-hidden
                className={cn(
                  "size-2 rounded-full bg-background",
                  isRunning && "motion-safe:animate-pulse",
                )}
              />
            </Link>
          </DynamicIslandView>

          <DynamicIslandView id="settled" className="!px-4 !py-2.5">
            <Link
              href={`/agents/${watched.agentSlug}/runs/${watched.runId}`}
              className="flex items-center gap-3 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              {status === "failed" ? (
                <TriangleAlert aria-hidden className="size-4 text-negative" />
              ) : (
                <Check aria-hidden className="size-4" />
              )}
              <span className="flex flex-col leading-tight">
                <span className="text-[13px] font-medium">
                  {status === "failed" ? "Run failed" : "Run finished"}
                </span>
                <span className="max-w-[16rem] truncate text-[11px] opacity-70">
                  {detail?.error ?? detail?.summary ?? watched.agentName}
                </span>
              </span>
              {detail?.tradeCount ? (
                <span className="tnum rounded-full bg-background/15 px-2 py-0.5 font-mono text-[11px]">
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
