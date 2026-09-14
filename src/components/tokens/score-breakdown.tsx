"use client";

import { useId, useState } from "react";
import type { ScoreComponents } from "@/server/types";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { SCORE_COMPONENTS, scoreColor, verdictTint } from "./verdict";

/**
 * Where the composite came from. The weight is on the label because "safety 82"
 * means nothing until you know safety is 30% of the number.
 *
 * Hovering or focusing a row explains what that sub-score reads; clicking pins
 * the explanation, because a tooltip is useless on a phone.
 */
export function ScoreBreakdown({
  components,
  className,
  dense = false,
}: {
  components: ScoreComponents;
  className?: string;
  dense?: boolean;
}) {
  const [pinned, setPinned] = useState<string | null>(null);
  const listId = useId();

  return (
    <TooltipProvider delay={120}>
      <div className={cn("w-full", className)}>
        <ul className={cn(dense ? "space-y-1" : "space-y-1.5")}>
          {SCORE_COMPONENTS.map((component) => {
            const raw = components[component.key];
            const missing = raw === null || raw === undefined;
            const value = missing ? 0 : Math.max(0, Math.min(100, raw));
            const color = missing ? "var(--muted-foreground)" : scoreColor(value);
            const isPinned = pinned === component.key;

            return (
              <li key={component.key}>
                <Tooltip>
                  <TooltipTrigger
                    type="button"
                    aria-expanded={isPinned}
                    aria-controls={`${listId}-${component.key}`}
                    onClick={() => setPinned(isPinned ? null : component.key)}
                    className={cn(
                      "flex w-full items-center gap-2.5 rounded-md px-1 py-1 text-left",
                      "transition-colors duration-150 hover:bg-muted/50",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    )}
                  >
                      <span className="flex w-[5.5rem] shrink-0 items-baseline gap-1.5 sm:w-24">
                        <span className="truncate text-xs font-medium">{component.label}</span>
                        {component.weight === null ? null : (
                          <span className="tnum font-mono text-[10px] text-muted-foreground">
                            {component.weight}
                          </span>
                        )}
                      </span>

                      <span
                        aria-hidden
                        className="relative h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted"
                      >
                        <span
                          className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none"
                          style={{
                            width: `${value}%`,
                            backgroundColor: missing ? verdictTint(color, 30) : color,
                          }}
                        />
                      </span>

                      <span
                        className="tnum w-9 shrink-0 text-right font-mono text-xs"
                        style={{ color: missing ? "var(--muted-foreground)" : color }}
                      >
                        {missing ? "—" : Math.round(value)}
                      </span>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-[16rem] leading-relaxed">
                    {missing
                      ? (component.missingNote ?? "Not bought for this token — it costs money, so it is optional.")
                      : component.reads}
                  </TooltipContent>
                </Tooltip>

                {isPinned ? (
                  <p
                    id={`${listId}-${component.key}`}
                    className="mt-0.5 mb-1 px-1 text-[11px] leading-relaxed text-muted-foreground"
                  >
                    {missing
                      ? (component.missingNote ?? "Not bought for this token — it costs money, so it is optional.")
                      : component.reads}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      </div>
    </TooltipProvider>
  );
}
