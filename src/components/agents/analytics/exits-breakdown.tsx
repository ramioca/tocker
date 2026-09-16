/**
 * Which rule closed each position, and what each rule earned.
 *
 * Bars rather than a donut: the useful comparison here is one reason against
 * another, and a donut makes that a guessing game at anything under five slices.
 * The count sizes the bar, the money sits beside it — a rule that fires often and
 * loses money is the one an operator wants to find, and that reads instantly when
 * the two numbers are adjacent.
 *
 * The exit engine may not have shipped or may never have fired, so the empty case
 * says which of the two it is rather than showing a blank panel.
 */
import { formatSignedUsd } from "@/components/common/format";
import type { AgentAnalytics, ExitReason } from "@/server/types";
import { cn } from "@/lib/utils";

const REASON_LABEL: Record<ExitReason, string> = {
  stop_loss: "Stop loss",
  take_profit: "Take profit",
  trailing_stop: "Trailing stop",
  max_hold: "Max hold",
  score_collapse: "Score collapsed",
  liquidity_collapse: "Liquidity collapsed",
};

const REASON_MEANING: Record<ExitReason, string> = {
  stop_loss: "fell past the fixed stop",
  take_profit: "hit the profit target",
  trailing_stop: "gave back too much from its peak",
  max_hold: "was held longer than allowed",
  score_collapse: "rescored into “avoid” while held",
  liquidity_collapse: "half the pool left",
};

export function ExitsBreakdown({ exits, totalClosed }: { exits: AgentAnalytics["exits"]; totalClosed: number }) {
  const max = Math.max(1, ...exits.map((exit) => exit.count));

  return (
    <section aria-labelledby="exits-heading" className="glass-panel rounded-2xl p-3 sm:p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id="exits-heading" className="text-sm font-medium tracking-tight">
          What closed the position
        </h3>
        {exits.length > 0 ? (
          <p className="tnum text-[11px] text-muted-foreground">
            {exits.reduce((n, e) => n + e.count, 0)} of {totalClosed} exits were automatic
          </p>
        ) : null}
      </div>

      {exits.length === 0 ? (
        <p className="mt-4 rounded-lg border border-dashed border-border py-8 text-center text-sm text-muted-foreground">
          No exits yet. Stops, targets and the trailing rules tag their fills with a reason — nothing
          has fired in this window.
        </p>
      ) : (
        <ul className="mt-4 space-y-2.5">
          {exits.map((exit) => (
            <li key={exit.reason} className="grid grid-cols-[9rem_1fr_5.5rem] items-center gap-2 sm:grid-cols-[11rem_1fr_6rem]">
              <span className="min-w-0">
                <span className="block truncate text-xs font-medium">{REASON_LABEL[exit.reason]}</span>
                <span className="block truncate text-[10px] text-muted-foreground">
                  {REASON_MEANING[exit.reason]}
                </span>
              </span>
              <span aria-hidden className="relative h-6 overflow-hidden rounded-md bg-muted/50">
                <span
                  className="absolute inset-y-1 left-1 rounded-sm bg-primary/50"
                  style={{ width: `calc(${(exit.count / max) * 100}% - 0.5rem)` }}
                />
                <span className="tnum absolute inset-y-0 left-2.5 flex items-center font-mono text-[11px] font-medium">
                  {exit.count}
                </span>
              </span>
              <span
                className={cn(
                  "tnum text-right font-mono text-xs",
                  exit.pnlUsd > 0 ? "text-positive" : exit.pnlUsd < 0 ? "text-negative" : "text-muted-foreground",
                )}
              >
                {formatSignedUsd(exit.pnlUsd)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
