"use client";

import { useEffect, useId, useState } from "react";
import {
  Brain,
  CalendarClock,
  ChevronRight,
  Crosshair,
  Database,
  EyeOff,
  LogOut,
  ScrollText,
  ShieldCheck,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { REQUIRED_PLACE, type Place, type PreviewRow, type PreviewRowId } from "../contract";
import { Facts, HAIR, TYPE } from "../look";
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

/** Icon, words, chevron. A row is as tall as its words: nothing is reserved, nothing is clamped. */
const ROW =
  "group relative grid w-full grid-cols-[16px_minmax(0,1fr)_14px] items-start gap-x-2.5 rounded-lg px-2 py-2.5 text-left " +
  "transition-colors duration-150 hover:bg-white/[0.04] disabled:pointer-events-none " +
  "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";

/** Decorative: the label beside each says what the row is. */
const ROW_ICON: Record<PreviewRowId, LucideIcon> = {
  hunts: Crosshair,
  data: Database,
  limits: ShieldCheck,
  exits: LogOut,
  runs: CalendarClock,
  thinks: Brain,
  money: Wallet,
};

const ROW_ICON_CLASS = "relative mt-0.5 size-4 text-muted-foreground";

const CHEVRON =
  "relative mt-[3px] size-3.5 text-muted-foreground/60 transition-[color,translate] duration-150 ease-[var(--ease-out-strong)] " +
  "group-hover:translate-x-0.5 group-hover:text-foreground motion-reduce:group-hover:translate-x-0";

/**
 * Block C of the agent card: the strategy in the user's own words, then the seven rules
 * that are already set. Each row is the way to the step it names.
 *
 * A value breaks between its facts, never inside one, and a row grows to fit it.
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
    <div className={cn("border-t px-2 pt-4 pb-2 xl:px-3", HAIR, className)} style={style}>
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
        <ScrollText aria-hidden className={ROW_ICON_CLASS} strokeWidth={1.75} />
        <span className="relative min-w-0">
          <span className="flex items-center gap-2">
            <span className="text-[13px] leading-5 font-medium">Strategy</span>
            <span className="flex min-w-0 items-center gap-1 text-[11px] leading-4 text-muted-foreground">
              <EyeOff aria-hidden className="size-3 shrink-0" />
              <span className="truncate">Only you can see this</span>
            </span>
          </span>
          {/* Two lines of reserved height while there is a prompt: it changes on every
              keystroke, and a longer or shorter one then moves nothing below. */}
          <span
            className={cn(
              "mt-1 line-clamp-2 font-mono text-xs leading-[18px] break-words",
              prompt.trim() ? "min-h-9 text-foreground/70" : "text-muted-foreground",
            )}
          >
            {prompt.trim() ? prompt : "No instructions yet"}
          </span>
        </span>
        <ChevronRight aria-hidden className={CHEVRON} />
      </button>

      <ul aria-labelledby={headingId} className="[&>li]:border-t [&>li]:border-white/[0.05]">
        {rows.map((row) => {
          const Icon = ROW_ICON[row.id];
          return (
            <li key={row.id}>
              <button type="button" data-go disabled={disabled} onClick={() => onGo(row.place)} className={ROW}>
                <Tint on={tinted.has(row.id)} />
                <Icon aria-hidden className={ROW_ICON_CLASS} strokeWidth={1.75} />
                <span className="relative min-w-0">
                  <span className="block text-[13px] leading-5 font-medium">{row.label}</span>
                  <span
                    className={cn(
                      TYPE.caption,
                      "mt-0.5 block",
                      row.needed ? "font-medium text-foreground" : "text-muted-foreground",
                    )}
                  >
                    <Facts text={row.text} />
                  </span>
                </span>
                <ChevronRight aria-hidden className={CHEVRON} />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
