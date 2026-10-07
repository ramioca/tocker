"use client";

import { useEffect, useId, useState } from "react";
import { ChevronRight, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { REQUIRED_PLACE, type Place, type PreviewRow } from "../contract";
import { KICKER } from "./preview-head";
import { rowsToTint } from "./tint";

/** How long the tint stays up before it fades, in ms. The fade itself is the CSS below. */
const TINT_HOLD_MS = 750;

const NONE: ReadonlySet<string> = new Set();

/** The tint layer under a row that one choice just changed. Colour only, so it stays under reduced motion. */
function Tint({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden
      // In fast and out slow: the same element carries both durations, so a second
      // preset tapped mid-fade turns it back on from where it is. No keyframes.
      className={cn(
        "pointer-events-none absolute inset-0 rounded-lg bg-primary/8 transition-opacity ease-[cubic-bezier(0.23,1,0.32,1)]",
        on ? "opacity-100 duration-150" : "opacity-0 duration-700",
      )}
    />
  );
}

const ROW =
  "relative block w-full rounded-lg px-2 py-1.5 text-left transition-colors duration-150 hover:bg-muted/40 disabled:pointer-events-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";

/**
 * Block C of the agent card: the strategy in the user's own words, then the seven rules
 * that are already set. Each row is the way to the step it names.
 *
 * Values swap in place and never animate: a slider can change one many times a second.
 * The one exception is a choice that rewrites several rows at once (a strategy preset, a
 * posture): those rows are tinted for a moment, so it is clear what the choice touched.
 * A draft swapped whole (`quietKey` changed) is not such a choice, and tints nothing.
 */
export function PreviewRows({
  prompt,
  rows,
  onGo,
  quietKey,
  disabled = false,
  className,
  style,
}: {
  prompt: string;
  rows: PreviewRow[];
  onGo: (place: Place) => void;
  /** Changes in the same render as the rows when the whole draft was swapped. */
  quietKey?: unknown;
  disabled?: boolean;
  className?: string;
  style?: React.CSSProperties;
}) {
  const headingId = useId();

  // What was on screen last time, to see what one update changed. Compared while
  // rendering, so the tint goes up in the same paint as the new words.
  const shown = [prompt, ...rows.map((row) => row.text)];
  const [seen, setSeen] = useState(shown);
  const [tinted, setTinted] = useState(NONE);
  const [quiet, setQuiet] = useState(quietKey);
  const wholesale = quiet !== quietKey;
  if (wholesale) setQuiet(quietKey);
  if (shown.some((text, index) => text !== seen[index])) {
    setSeen(shown);
    const touched = rowsToTint(["strategy", ...rows.map((row) => row.id)], seen, shown, wholesale);
    if (touched.length > 0) setTinted(new Set(touched));
  }
  useEffect(() => {
    if (tinted.size === 0) return;
    const timer = window.setTimeout(() => setTinted(NONE), TINT_HOLD_MS);
    return () => window.clearTimeout(timer);
  }, [tinted]);

  return (
    <div className={cn("border-t border-border/50 px-2 pt-3 pb-2", className)} style={style}>
      <h3 id={headingId} className={cn(KICKER, "px-2")}>
        Already set
      </h3>

      {/* Named by what it does. Without a name of its own a screen reader would read the
          whole prompt, which the clamp below only hides from the eye. */}
      <button
        type="button"
        data-go
        disabled={disabled}
        aria-label="Strategy. Go to the strategy field."
        onClick={() => onGo(REQUIRED_PLACE.strategy)}
        className={cn(ROW, "mt-1")}
      >
        <Tint on={tinted.has("strategy")} />
        <span className="relative flex items-center gap-2">
          <span className="text-xs font-medium">Strategy</span>
          <span className="flex min-w-0 items-center gap-1 text-[11px] text-muted-foreground">
            <EyeOff aria-hidden className="size-3 shrink-0" />
            <span className="truncate">Only you can see this</span>
          </span>
        </span>
        {/* Three lines of reserved height, so a longer or shorter prompt moves nothing below. */}
        <span
          className={cn(
            "relative mt-1 line-clamp-3 min-h-[3.75rem] font-mono text-xs leading-5 break-words",
            prompt.trim() ? "text-foreground/80" : "text-muted-foreground",
          )}
        >
          {prompt.trim() ? prompt : "No instructions yet"}
        </span>
      </button>

      <ul aria-labelledby={headingId}>
        {rows.map((row) => (
          <li key={row.id}>
            <button type="button" data-go disabled={disabled} onClick={() => onGo(row.place)} className={ROW}>
              <Tint on={tinted.has(row.id)} />
              <span className="relative flex items-center justify-between gap-2">
                <span className="text-xs font-medium">{row.label}</span>
                <ChevronRight aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
              </span>
              {/* Two lines of reserved height: a value that grows or shrinks never moves the rows below. */}
              <span
                className={cn(
                  "tnum relative line-clamp-2 min-h-10 text-xs leading-5",
                  row.needed ? "text-foreground/80" : "text-muted-foreground",
                )}
              >
                {row.text}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
