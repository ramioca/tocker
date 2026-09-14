"use client";

import { useState } from "react";
import type { AgentAnalytics, LeaderboardWindow } from "@/server/types";
import { EmptyState } from "@/components/common/empty-state";
import { BarChart3 } from "lucide-react";
import { AnalyticsStats } from "./analytics-stats";
import { CalibrationChart } from "./calibration-chart";
import { ExitsBreakdown } from "./exits-breakdown";
import { SplitTables } from "./split-tables";
import { TradeHighlights } from "./trade-highlight";
import { cn } from "@/lib/utils";

const WINDOWS: Array<{ value: LeaderboardWindow; label: string }> = [
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "all", label: "All time" },
];

/**
 * The Performance tab.
 *
 * All three windows arrive pre-computed, so switching one is a state change and
 * never a request — a window switch is a hot path and has no motion budget.
 *
 * Public for everyone, like the rest of an agent's record. Nothing rendered here
 * is derived from the strategy prompt, the universe rules or the transcript: these
 * are outcomes, and outcomes are the part Tocker publishes.
 */
export function PerformancePanel({
  windows,
}: {
  windows: Record<LeaderboardWindow, AgentAnalytics>;
}) {
  const [window, setWindow] = useState<LeaderboardWindow>("30d");
  const analytics = windows[window];
  const closedExits = analytics.byChain.reduce((n, row) => n + row.trades, 0);
  const nothingYet = closedExits === 0 && analytics.unrealizedPnlUsd === 0 && analytics.realizedPnlUsd === 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div
          role="group"
          aria-label="Analytics window"
          className="flex gap-1 rounded-lg border border-border/70 bg-card/30 p-1"
        >
          {WINDOWS.map((option) => {
            const active = window === option.value;
            return (
              <button
                key={option.value}
                type="button"
                aria-pressed={active}
                onClick={() => setWindow(option.value)}
                className={cn(
                  "rounded-md px-2.5 py-1 text-xs font-medium transition-colors duration-150",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  active
                    ? "bg-primary/12 text-primary"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                {option.label}
              </button>
            );
          })}
        </div>
        <p className="text-[11px] text-muted-foreground">
          Closed trades are matched FIFO, so each exit carries the score of the entry it closed.
        </p>
      </div>

      {nothingYet ? (
        <EmptyState
          icon={<BarChart3 />}
          title="Nothing to measure yet"
          description="Performance fills in from the first closed position. Until then the equity chart on Overview is the whole story."
        />
      ) : (
        <>
          <AnalyticsStats analytics={analytics} />
          <CalibrationChart bands={analytics.calibration} />
          <TradeHighlights best={analytics.bestTrade} worst={analytics.worstTrade} />
          <ExitsBreakdown exits={analytics.exits} totalClosed={closedExits} />
          <SplitTables analytics={analytics} />
        </>
      )}
    </div>
  );
}
