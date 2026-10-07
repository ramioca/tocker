"use client";

import { NumberTicker } from "@/components/spectrumui/number-ticker";
import { cn } from "@/lib/utils";
import type { CostLine } from "../contract";
import { Facts, HAIR, TYPE } from "../look";
import { KICKER } from "./preview-head";

/**
 * Block D of the agent card: how often it runs, whose bill each part of a run is, and the
 * order a run works in. Dollar figures swap in place and never roll: a rolling digit shows
 * amounts nobody chose on its way to the one they did. It sits on a darker ground than
 * the rest of the card, as its footer.
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
    <div className={cn("border-t bg-black/20 px-4 pt-4 pb-4 xl:px-5", HAIR, className)} style={style}>
      <h3 className={KICKER}>A run</h3>
      {/* A fixed label column, so every value shares one left edge. */}
      <dl className={cn(TYPE.caption, "mt-3 grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-3 gap-y-2")}>
        {costs.map((line) => (
          <div key={line.id} className="contents">
            <dt className="text-muted-foreground">{line.label}</dt>
            <dd className="text-foreground">
              {/* The ticker only when it would say what the line says: a count that changes in
                  steps (96, 288, 24). Anything else on this line is a sentence, and stays one. */}
              {line.id === "runs" && runsPerDay !== null && line.text === `${runsPerDay} a day` ? (
                // Centred, not baseline-aligned: the ticker's digits are overflow-hidden
                // inline-blocks, whose baseline is their bottom edge.
                <span className="inline-flex h-[18px] items-center">
                  <NumberTicker value={runsPerDay} duration={0.3} stagger={0} startOnView={false} blur={false} />
                  <span className="whitespace-pre"> a day</span>
                </span>
              ) : (
                <Facts text={line.text} />
              )}
            </dd>
          </div>
        ))}
      </dl>

      {/* The order a run works in. Read as the one sentence; drawn as its steps, the last
          of which (who decides) is the violet one. */}
      <p className="sr-only">{runLine}</p>
      <ol aria-hidden className="tnum mt-4 flex flex-wrap items-center gap-y-1.5 text-[11px] leading-4">
        {runLine.split(" → ").map((node, index, all) => (
          <li key={index} className="flex items-center">
            {index > 0 ? <span className="mx-1 h-px w-2 bg-white/[0.18]" /> : null}
            <span
              className={cn(
                "rounded-full border px-2 py-0.5",
                index === all.length - 1
                  ? "border-primary/40 bg-primary/12 text-[#c4b5fd]"
                  : cn(HAIR, "bg-white/[0.03] text-foreground/80"),
              )}
            >
              {node}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
