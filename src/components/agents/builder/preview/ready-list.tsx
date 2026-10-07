"use client";

import { useId } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Place, ReadyItem } from "../contract";
import { KICKER } from "./preview-head";

/**
 * Block B of the agent card: the three things only the user can decide, and which of
 * them are done. A missing one reads in a neutral colour, never red: nothing has been
 * refused yet, and red is kept for after a failed Create.
 */
export function ReadyList({
  items,
  onGo,
  disabled = false,
  className,
  style,
}: {
  items: ReadyItem[];
  onGo: (place: Place) => void;
  disabled?: boolean;
  className?: string;
  style?: React.CSSProperties;
}) {
  const headingId = useId();
  const readyCount = items.filter((item) => item.ready).length;

  return (
    <div className={cn("border-t border-border/50 px-4 pt-3 pb-2", className)} style={style}>
      <h3 id={headingId} className={cn(KICKER, "tnum")}>
        Yours to decide · {readyCount} of {items.length} ready
      </h3>
      <ul aria-labelledby={headingId} className="mt-1">
        {items.map((item) => (
          <li key={item.id} className="flex min-h-11 items-center gap-2.5">
            <span
              aria-hidden
              className={cn(
                "relative grid size-4 shrink-0 place-items-center rounded-full border transition-colors duration-150",
                item.ready ? "border-primary/60 bg-primary/15" : "border-border",
              )}
            >
              {/* Always in the tree, so becoming ready is a transition and can be interrupted
                  if the thing goes missing again a keystroke later. */}
              <Check
                className={cn(
                  "size-2.5 text-primary transition-[opacity,scale] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:scale-100",
                  item.ready ? "scale-100 opacity-100" : "scale-90 opacity-0",
                )}
              />
            </span>
            <span className="shrink-0 text-sm">{item.label}</span>
            <span className="sr-only">{item.ready ? ": ready, " : ": not ready, "}</span>
            {/* Plain text: the name is typed here a key at a time, and a value that fades
                between states is blank for as long as the keys keep coming. */}
            <span
              className={cn(
                "min-w-0 flex-1 truncate text-right text-xs",
                item.ready ? "text-muted-foreground" : "text-foreground/80",
              )}
            >
              {item.value}
            </span>
            {item.ready ? null : (
              <button
                type="button"
                data-go
                disabled={disabled}
                onClick={() => onGo(item.place)}
                aria-label={`Fix: ${item.label}`}
                className="group -mr-1.5 flex min-h-11 shrink-0 items-center px-1.5 disabled:pointer-events-none focus-visible:outline-none"
              >
                <span className="rounded-md border border-border px-2 py-1 text-xs transition-[background-color,scale] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] group-hover:bg-muted group-focus-visible:ring-2 group-focus-visible:ring-ring group-active:scale-[0.97]">
                  Fix
                </span>
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
