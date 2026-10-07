"use client";

import { NumberTicker } from "@/components/spectrumui/number-ticker";
import { cn } from "@/lib/utils";
import type { CostLine } from "../contract";
import { KICKER } from "./preview-head";

/**
 * Block D of the agent card: how often it runs, whose bill each part of a run is, and the
 * order a run works in. Dollar figures swap in place and never roll: a rolling digit shows
 * amounts nobody chose on its way to the one they did.
 */
export function RunCost({
  costs,
  runLine,
  runsPerDay,
  className,
  style,
}: {
  costs: CostLine[];
  runLine: string;
  /** The runs-a-day figure, or null when the Runs line has no number in it. */
  runsPerDay: number | null;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div className={cn("border-t border-border/50 px-4 pt-3 pb-4", className)} style={style}>
      <h3 className={KICKER}>A run</h3>
      <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-xs leading-5">
        {costs.map((line) => (
          <div key={line.id} className="contents">
            <dt className="text-muted-foreground">{line.label}</dt>
            <dd className="tnum">
              {/* The ticker only when it would say what the line says: a count that changes in
                  steps (96, 288, 24). Anything else on this line is a sentence, and stays one. */}
              {line.id === "runs" && runsPerDay !== null && line.text === `${runsPerDay} a day` ? (
                <>
                  <NumberTicker value={runsPerDay} duration={0.3} stagger={0} startOnView={false} blur={false} /> a day
                </>
              ) : (
                line.text
              )}
            </dd>
          </div>
        ))}
      </dl>
      <p className="tnum mt-3 font-mono text-[11px] leading-5 text-muted-foreground">{runLine}</p>
    </div>
  );
}
