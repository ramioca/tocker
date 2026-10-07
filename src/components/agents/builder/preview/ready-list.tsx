"use client";

import { useId } from "react";
import { cn } from "@/lib/utils";
import type { BuilderStepId, Place, ReadyItem } from "../contract";
import { HAIR, Mark, PartIcon, ReadyPips, TYPE } from "../look";
import { REQUIRED_PART } from "../parts";
import { KICKER } from "./preview-head";
import { CurrentBar } from "./preview-rows";

/**
 * Block B of the agent card: the three things only the user can decide, and which of
 * them are done, by shape as well as colour: a filled disc, or a dashed ring. A missing
 * one is never red: nothing has been refused yet, and red is kept for after a failed Create.
 *
 * Each starts with its part's icon and ends with its mark, the order the choice cards
 * use. The one decided on the step that is open is marked as the rows below are.
 */
export function ReadyList({
  items,
  onGo,
  currentStep,
  disabled = false,
  className,
  style,
}: {
  items: ReadyItem[];
  onGo: (place: Place) => void;
  /** The step that is open: the thing decided there is marked. */
  currentStep?: BuilderStepId;
  disabled?: boolean;
  className?: string;
  style?: React.CSSProperties;
}) {
  const headingId = useId();
  const readyCount = items.filter((item) => item.ready).length;

  return (
    <div className={cn("border-t px-4 pt-4 pb-2 xl:px-5", HAIR, className)} style={style}>
      <div className="flex items-center justify-between gap-3">
        <h3 id={headingId} className={KICKER}>
          Yours to decide · {readyCount} of {items.length} ready
        </h3>
        <ReadyPips ready={items.map((item) => item.ready)} />
      </div>
      <ul aria-labelledby={headingId} className="mt-1">
        {items.map((item) => {
          const current = item.place.step === currentStep;
          return (
            <li key={item.id} className="relative flex min-h-12 items-center gap-2.5 py-1.5">
              {/* Out in the card's padding, so it lines up with the bars of the rows below. */}
              <CurrentBar on={current} className="-left-2" />
              <PartIcon
                part={REQUIRED_PART[item.id]}
                className={cn("transition-colors duration-150", current ? "text-foreground" : "text-muted-foreground")}
              />
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] leading-5 font-medium">{item.label}</span>
                <span className="sr-only">{item.ready ? ": ready, " : ": not ready, "}</span>
                {/* Plain text: the name is typed here a key at a time, and a value that fades
                    between states is blank for as long as the keys keep coming. Under its
                    label and up to two lines, so a model id is read whole. */}
                <span
                  className={cn(
                    TYPE.caption,
                    "line-clamp-2 break-words",
                    item.ready ? "text-muted-foreground" : "font-medium text-foreground",
                  )}
                >
                  {item.value}
                </span>
              </span>
              {item.ready ? null : (
                <button
                  type="button"
                  data-go
                  disabled={disabled}
                  onClick={() => onGo(item.place)}
                  aria-label={`Fix: ${item.label}`}
                  className="group flex min-h-11 shrink-0 items-center pl-1.5 disabled:pointer-events-none focus-visible:outline-none"
                >
                  <span className="rounded-full border border-primary/40 bg-primary/12 px-2.5 py-1 text-xs font-medium text-primary transition-[background-color,scale] duration-150 ease-[var(--ease-out-strong)] group-hover:bg-primary/20 group-focus-visible:ring-2 group-focus-visible:ring-ring group-active:scale-[0.97] motion-reduce:group-active:scale-100">
                    Fix
                  </span>
                </button>
              )}
              {/* Its tick is always in the tree, so becoming ready is a transition and can be
                  interrupted if the thing goes missing again a keystroke later. */}
              <Mark on={item.ready} off="dashed" />
            </li>
          );
        })}
      </ul>
    </div>
  );
}
