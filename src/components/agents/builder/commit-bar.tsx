import { useState } from "react";
import { ArrowRight, ChevronLeft } from "lucide-react";
import { LiquidMetal } from "@/components/common/liquid-metal";
import { MorphButton } from "@/components/spectrumui/morph-button";
import { MORPH_FOCUS } from "@/components/common/focus";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { stickyActionbarRef } from "@/hooks/root-flag";
import type { BuilderStepId, Via } from "./contract";
import { FOCUS } from "./look";

/** detail is 0 when a click comes from Enter or Space, which must never animate a step. */
const viaOf = (event: React.MouseEvent): Via => (event.detail === 0 ? "keyboard" : "pointer");

/** The press every button in the bar shares: transform only, 150ms, the house ease-out. */
const PRESS =
  "duration-150 ease-[var(--ease-out-strong)] active:[transform:scale(0.97)] motion-reduce:active:[transform:none]";

/**
 * The bar's sentence from `sm` up. The figures inside it arrive in mono; here they are
 * set in the sentence's own face, brighter, so a price reads as one word.
 */
const SENTENCE =
  "hidden min-w-0 flex-1 text-[13px] leading-[18px] text-pretty text-muted-foreground " +
  "[&_.font-mono]:font-sans [&_.font-mono]:font-medium [&_.font-mono]:text-foreground";

/**
 * The commit bar: what it costs, then the way forward. Sticky glass so the
 * decision is always in reach, above the mobile tab bar on phones.
 *
 * On every step but the last the way forward is Next, which never refuses. On the last it
 * is the chrome Create button. While something required is still missing on that last
 * step, from `sm` up the cost sentence gives way to a button that says what and takes the
 * user to it, with the money a funded agent will ask them to sign in front of either. A
 * phone has no room for that button; there the stepper and the agent card say what is
 * missing, and the money to be signed gets one line of its own above the buttons. From
 * `lg` the last step also names the agent in front of the sentence (`identity`).
 *
 * While the agent is being created every way out of the step is off, and the Create
 * button reads "Creating…" whichever copy of it is on screen.
 */
export function CommitBar({
  step,
  nextLabel,
  onBack,
  onNext,
  onSkipToEnd,
  stillNeeded,
  onStillNeeded,
  submit,
  creating,
  sentence,
  signing,
  signingShort,
  peek,
  identity,
}: {
  step: BuilderStepId;
  /** Where Next goes, in words ("Where it hunts"). Null on the last step, which has Create instead. */
  nextLabel: string | null;
  /** Null on the first step. */
  onBack: ((via: Via) => void) | null;
  onNext: (via: Via) => void;
  /** Null until the strategy and the way to think are both ready, and on the last step. */
  onSkipToEnd: ((via: Via) => void) | null;
  /** "a key and a name", or null when nothing required is missing. */
  stillNeeded: string | null;
  onStillNeeded: () => void;
  submit: () => Promise<void>;
  /** A create is in flight. Held by the builder, so it outlives this button. */
  creating: boolean;
  /** The cost sentence, `sm` and up. */
  sentence: React.ReactNode;
  /** Only the fund-mode signing sentence, or nothing. */
  signing: React.ReactNode;
  /** What a funded agent will ask the user to sign, in one line; null on paper. */
  signingShort: string | null;
  /** The agent strip shown below `lg`, where the agent card has no column of its own. */
  peek: React.ReactNode;
  /** The agent about to be created, shown on the last step from `lg`. Decoration: the card says the same. */
  identity?: React.ReactNode;
}) {
  // The chrome ring runs only under the pointer or keyboard focus, as in the top bar:
  // the commit bar is on screen the whole time someone writes a strategy, and a ring
  // that redraws every frame for all of it is a phone's battery for no reason.
  const [metalHovered, setMetalHovered] = useState(false);
  const [metalFocused, setMetalFocused] = useState(false);

  const last = step === "create";
  // A phone's last step drops the strip's text to give the Create button its width, so
  // the money about to be signed takes a line of its own above the buttons.
  const signingLine = last ? signingShort : null;

  return (
    <div
      data-sticky-actionbar
      // Holds the flag on <html> that adds this bar to the scroll padding (globals.css) and
      // lifts the toasts above it on a phone.
      ref={stickyActionbarRef}
      // overflow-x-clip: the chrome ring's glow canvas is wider than the button and,
      // at the right edge of a phone, pushed the whole page 28px sideways.
      // py-2 on a phone: with the text on one line the 48px button sets the height, and
      // every pixel of this bar is a pixel of form it covers.
      // 3.5rem is the height of the phone tab bar this sits on: its border, 16px of
      // padding, a 20px icon, a 4px gap and one 15px line of label.
      className={cn(
        "glass-bar sticky bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-10 mt-8 -mx-4 flex items-center gap-2 overflow-x-clip border-t border-border/60 px-4 py-2 sm:-mx-6 sm:gap-3 sm:px-6 sm:py-3 md:bottom-0",
        signingLine ? "flex-wrap gap-y-1 sm:flex-nowrap" : null,
      )}
    >
      {signingLine ? (
        <p className="tnum basis-full truncate text-xs leading-4 text-muted-foreground sm:hidden">{signingLine}</p>
      ) : null}

      {/* Below lg the agent card is a strip here that opens it as a sheet. On a phone the
          strip is all the text the bar has room for; from sm the sentence sits beside it. */}
      <div className="min-w-0 flex-1 sm:max-w-52 sm:flex-none lg:hidden">{peek}</div>

      {last && identity ? (
        <div aria-hidden className="hidden shrink-0 items-center gap-3 lg:flex">
          {identity}
          <span className="h-8 w-px bg-white/[0.10]" />
        </div>
      ) : null}

      {last && stillNeeded ? (
        <p className={cn(SENTENCE, "flex-wrap items-center gap-x-2 sm:flex")}>
          {signing}
          <button
            type="button"
            disabled={creating}
            onClick={onStillNeeded}
            className={cn(
              "inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-primary/40 bg-primary/12 px-3.5 text-left text-[13px] font-medium text-primary transition-[color,background-color,border-color,transform] hover:bg-primary/20",
              FOCUS,
              PRESS,
            )}
          >
            Still needed: {stillNeeded}
          </button>
        </p>
      ) : (
        <p className={cn(SENTENCE, "sm:block")}>
          {/* Never clamped: about 64 characters a line, on as many lines as it takes. */}
          <span className="block max-w-[64ch]">{sentence}</span>
        </p>
      )}

      {/* A returning user's shortcut. Not on a phone: the bar has no room, and the stepper
          is one tap from the last step anyway. */}
      {onSkipToEnd && !last ? (
        <Button
          variant="ghost"
          disabled={creating}
          onClick={(event) => onSkipToEnd(viaOf(event))}
          className={cn("hidden h-11 shrink-0 px-3 text-[13px] text-muted-foreground sm:inline-flex", PRESS)}
        >
          Skip to the end
        </Button>
      ) : null}

      {onBack ? (
        <Button
          variant="outline"
          aria-label="Back"
          disabled={creating}
          onClick={(event) => onBack(viaOf(event))}
          className={cn("size-11 shrink-0 rounded-xl px-0 sm:w-20", PRESS)}
        >
          <ChevronLeft aria-hidden className="size-4 sm:hidden" />
          <span className="hidden sm:inline">Back</span>
        </Button>
      ) : null}

      {last ? (
        <div
          className="shrink-0"
          onPointerEnter={() => setMetalHovered(true)}
          onPointerLeave={() => setMetalHovered(false)}
          // Keyboard focus only: a click also focuses the button, and the ring would then
          // keep running for as long as nothing else took the focus.
          onFocus={(event) => setMetalFocused(event.target.matches(":focus-visible"))}
          onBlur={() => setMetalFocused(false)}
        >
          {/* Paused keeps the last frame on screen: at rest the ring is still chrome, just still. */}
          <LiquidMetal
            preset="chromatic"
            theme="dark"
            strength={0.85}
            paused={!(metalHovered || metalFocused)}
            className="shrink-0"
          >
            {/* metal-fx strips the button's fill, which would leave its dark:text-neutral-900
                on the dark chrome at about 1.2:1, so inside the ring the label takes the
                foreground colour. Only inside the ring (`.metal-fx-content` is its wrapper
                around the child): before hydration, and wherever WebGL2 is missing, there is
                no ring and the button keeps its own fills, and a forced foreground label was
                near-white on the white pill, idle and while creating. There it now wears the
                button's own colours in every state. The `dark:` copy is there to outrank the
                button's `dark:text-neutral-900` by specificity, not by order. */}
            <MorphButton
              size="lg"
              onAction={submit}
              // Loading for as long as the builder says so, not only for the life of this
              // button: it unmounts when the step changes, and a fresh one must not offer
              // a second create while the first is still running.
              state={creating ? "loading" : undefined}
              loadingLabel="Creating…"
              successLabel="Created"
              errorLabel="Check the form"
              className={cn(
                "[.metal-fx-content>&]:text-foreground dark:[.metal-fx-content>&]:text-foreground",
                MORPH_FOCUS,
              )}
            >
              Create agent
            </MorphButton>
          </LiquidMetal>
        </div>
      ) : (
        <Button
          disabled={creating}
          onClick={(event) => onNext(viaOf(event))}
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
            {nextLabel ? <span className="hidden xl:inline">: {nextLabel}</span> : null}
          </span>
          <ArrowRight aria-hidden className="hidden size-4 xl:block" />
        </Button>
      )}
    </div>
  );
}
