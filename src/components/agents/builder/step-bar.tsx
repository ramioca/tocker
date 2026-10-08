import { ArrowRight, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { stickyActionbarRef } from "@/hooks/root-flag";
import type { Via } from "./contract";

/** detail is 0 when a click comes from Enter or Space, which must never animate a step. */
export const viaOf = (event: React.MouseEvent): Via => (event.detail === 0 ? "keyboard" : "pointer");

/** The press every button in the bar shares: transform only, 150ms, the house ease-out. */
export const PRESS =
  "duration-150 ease-[var(--ease-out-strong)] active:[transform:scale(0.97)] motion-reduce:active:[transform:none]";

/**
 * The bar's sentence from `sm` up. The figures inside it arrive in mono; here they are
 * set in the sentence's own face, brighter, so a price reads as one word.
 */
export const SENTENCE =
  "hidden min-w-0 flex-1 text-[13px] leading-[18px] text-pretty text-muted-foreground " +
  "[&_.font-mono]:font-sans [&_.font-mono]:font-medium [&_.font-mono]:text-foreground";

/**
 * The bar under a page of steps: what the page has to say, then the way back and the way
 * forward. Sticky glass so the decision is always in reach, above the mobile tab bar on
 * phones.
 *
 * It is a frame. What it says (`message`) and the one button that commits (`primary`) are
 * the page's: creating an agent it is the cost and Create, over a saved agent it is what
 * is unsaved and Save. Back and Next are drawn here, the same size and in the same place
 * on every step. Next never refuses.
 */
export function StepBar({
  peek,
  message,
  lead,
  topLine,
  extra,
  onBack,
  next,
  primary,
  disabled = false,
}: {
  /** The agent strip shown below `lg`, where the agent card has no column of its own. */
  peek: React.ReactNode;
  /** The bar's sentence. On a phone the strip is all the text there is room for. */
  message: React.ReactNode;
  /** Shown in front of the sentence from `lg`. Decoration: it is hidden from a screen reader. */
  lead?: React.ReactNode;
  /** One line of its own above the buttons, on a phone only. */
  topLine?: string | null;
  /** Between the sentence and Back. */
  extra?: React.ReactNode;
  /** Null on the first step. */
  onBack: ((via: Via) => void) | null;
  /**
   * Where Next goes, in words ("Where it hunts"), or null on a step that has none. It is
   * the filled button where the bar has no other (`primary`), and an outline beside one.
   */
  next: { label: string; onGo: (via: Via) => void; tone: "primary" | "outline" } | null;
  /** The button that commits, after Next. */
  primary?: React.ReactNode;
  /** While a create or a save is in flight: neither Back nor Next leaves the step. */
  disabled?: boolean;
}) {
  const nextButton =
    next === null ? null : next.tone === "primary" ? (
      <Button
        disabled={disabled}
        onClick={(event) => next.onGo(viaOf(event))}
        // A fixed width where the destination is shown, so Back and the shortcut beside
        // it sit in the same place on every step.
        className={cn(
          "h-12 shrink-0 gap-2 rounded-xl px-5 font-semibold sm:h-11 xl:w-64 xl:justify-between",
          "shadow-[inset_0_1px_0_0_rgb(255_255_255/0.3)] hover:bg-[#c79bff] disabled:shadow-none",
          PRESS,
        )}
      >
        <span>
          Next
          {/* The destination only where the bar has the width for it. */}
          {next.label ? <span className="hidden xl:inline">: {next.label}</span> : null}
        </span>
        <ArrowRight aria-hidden className="hidden size-4 xl:block" />
      </Button>
    ) : (
      // Beside the button that commits, Next is the quieter of the two and, on a phone,
      // a chevron the size of Back. Named in full at every width, for where only the
      // chevron shows.
      <Button
        variant="outline"
        aria-label={`Next: ${next.label}`}
        disabled={disabled}
        onClick={(event) => next.onGo(viaOf(event))}
        className={cn("size-11 shrink-0 gap-2 rounded-xl px-0 sm:w-auto sm:px-5 xl:w-64 xl:justify-between", PRESS)}
      >
        <ChevronRight aria-hidden className="size-4 sm:hidden" />
        <span className="hidden sm:inline">
          Next
          <span className="hidden xl:inline">: {next.label}</span>
        </span>
        <ArrowRight aria-hidden className="hidden size-4 xl:block" />
      </Button>
    );

  return (
    <div
      data-sticky-actionbar
      // Holds the flag on <html> that adds this bar to the scroll padding (globals.css),
      // lifts the toasts above it (providers/toaster.tsx) and sends the approvals island to
      // the top of the page (shell/run-island.tsx), so neither lies on these buttons.
      ref={stickyActionbarRef}
      // overflow-x-clip: the chrome ring's glow canvas is wider than the button and,
      // at the right edge of a phone, pushed the whole page 28px sideways.
      // py-2 on a phone: with the text on one line the 48px button sets the height, and
      // every pixel of this bar is a pixel of form it covers.
      // 3.5rem is the height of the phone tab bar this sits on: its border, 16px of
      // padding, a 20px icon, a 4px gap and one 15px line of label.
      className={cn(
        "glass-bar sticky bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-10 mt-8 -mx-4 flex items-center gap-2 overflow-x-clip border-t border-border/60 px-4 py-2 sm:-mx-6 sm:gap-3 sm:px-6 sm:py-3 md:bottom-0",
        topLine ? "flex-wrap gap-y-1 sm:flex-nowrap" : null,
      )}
    >
      {topLine ? (
        <p className="tnum basis-full truncate text-xs leading-4 text-muted-foreground sm:hidden">{topLine}</p>
      ) : null}

      {/* Below lg the agent card is a strip here that opens it as a sheet. On a phone the
          strip is all the text the bar has room for; from sm the sentence sits beside it. */}
      <div className="min-w-0 flex-1 sm:max-w-52 sm:flex-none lg:hidden">{peek}</div>

      {lead ? (
        <div aria-hidden className="hidden shrink-0 items-center gap-3 lg:flex">
          {lead}
          <span className="h-8 w-px bg-white/[0.10]" />
        </div>
      ) : null}

      {message}

      {extra}

      {onBack ? (
        <Button
          variant="outline"
          aria-label="Back"
          disabled={disabled}
          onClick={(event) => onBack(viaOf(event))}
          className={cn("size-11 shrink-0 rounded-xl px-0 sm:w-20", PRESS)}
        >
          <ChevronLeft aria-hidden className="size-4 sm:hidden" />
          <span className="hidden sm:inline">Back</span>
        </Button>
      ) : null}

      {/* The way forward: Next, the button that commits, or both. One child of the bar
          whichever it is, so a page with only one of them has the bar the builder always
          had, down to the ids React derives from a child's place among its siblings. */}
      {nextButton && primary ? (
        <>
          {nextButton}
          {primary}
        </>
      ) : (
        (nextButton ?? primary)
      )}
    </div>
  );
}
