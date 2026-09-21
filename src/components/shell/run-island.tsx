"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useReducedMotion } from "motion/react";
import { BorderBeam } from "border-beam";
import { ThinkingOrb, type OrbState } from "thinking-orbs";
import { Check, Gavel, TriangleAlert } from "lucide-react";
import { DynamicIsland, DynamicIslandView } from "@/components/motion/dynamic-island";
import { useRunStatus } from "@/components/providers/run-status";
import { useNow } from "@/hooks/use-now";
import { AgentAvatar } from "@/components/common/agent-avatar";

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
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-50 flex justify-center px-4 md:bottom-auto md:top-2">
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
          <DynamicIslandView id="running" className="!px-4 !py-2.5">
            <Link
              href={`/agents/${watched.agentSlug}/runs/${watched.runId}`}
              className="flex items-center gap-3 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <AgentAvatar seed={watched.avatarSeed} name={watched.agentName} size="sm" />
              <span className="flex flex-col leading-tight">
                <span className="text-[13px] font-medium">{watched.agentName}</span>
                {/* Per-tick churn: kept out of the polite live region so a run
                    doesn't read "1s… 2s… 3s…" over the meaningful announcements. */}
                <span className="text-[11px] opacity-70" aria-hidden>
                  {lastTool ? `${lastTool}…` : "thinking…"}
                  {stepCount > 0 ? ` · ${stepCount} steps` : null}
                </span>
              </span>
              <span
                aria-hidden
                className="tnum ml-2 rounded-full bg-white/10 px-2 py-0.5 font-mono text-[11px]"
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
              />
            </Link>
          </DynamicIslandView>

          <DynamicIslandView id="settled" className="!px-4 !py-2.5">
            <Link
              href={`/agents/${watched.agentSlug}/runs/${watched.runId}`}
              className="flex items-center gap-3 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
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
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-50 flex justify-center px-4 md:bottom-auto md:top-2">
      <div className="pointer-events-auto">
        <DynamicIsland view="proposals" className="border border-white/10">
          <DynamicIslandView id="proposals" className="!px-4 !py-2.5">
            <Link
              href={href}
              className="flex items-center gap-3 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <Gavel aria-hidden className="size-4" />
              <span className="flex flex-col leading-tight">
                <span className="text-[13px] font-medium">
                  {count === 1 ? "1 trade awaiting approval" : `${count} trades awaiting approval`}
                </span>
                {latest ? (
                  <span className="max-w-[18rem] truncate text-[11px] opacity-70">
                    {latest.agentName} wants to {latest.side} ${Math.round(latest.requestedUsd)} of {latest.symbol}
                  </span>
                ) : null}
              </span>
              <span className="tnum ml-2 rounded-full bg-white/10 px-2 py-0.5 font-mono text-[11px]">
                Review
              </span>
            </Link>
          </DynamicIslandView>
        </DynamicIsland>
      </div>
    </div>
  );
}
