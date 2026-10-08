import { useState } from "react";
import { LiquidMetal } from "@/components/common/liquid-metal";
import { MorphButton } from "@/components/spectrumui/morph-button";
import { MORPH_FOCUS } from "@/components/common/focus";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { BuilderStepId, Via } from "./contract";
import { FOCUS } from "./look";
import { PRESS, SENTENCE, StepBar, viaOf } from "./step-bar";

/**
 * The commit bar: what it costs, then the way forward. The frame, Back and Next are the
 * bar every page of steps has (`./step-bar`); this is what creating an agent puts in it.
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
  const last = step === "create";

  return (
    <StepBar
      peek={peek}
      // A phone's last step drops the strip's cost line to give the Create button its width, so
      // the money about to be signed takes a line of its own above the buttons.
      topLine={last ? signingShort : null}
      lead={last ? identity : undefined}
      message={
        last && stillNeeded ? (
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
        )
      }
      // A returning user's shortcut. Not on a phone: the bar has no room, and the stepper
      // is one tap from the last step anyway.
      extra={
        onSkipToEnd && !last ? (
          <Button
            variant="ghost"
            disabled={creating}
            onClick={(event) => onSkipToEnd(viaOf(event))}
            className={cn("hidden h-11 shrink-0 px-3 text-[13px] text-muted-foreground md:inline-flex", PRESS)}
          >
            Skip to the end
          </Button>
        ) : null
      }
      onBack={onBack}
      next={last ? null : { label: nextLabel ?? "", onGo: onNext, tone: "primary" }}
      primary={last ? <CreateButton submit={submit} creating={creating} /> : undefined}
      disabled={creating}
    />
  );
}

/** The chrome Create button of the last step. */
function CreateButton({ submit, creating }: { submit: () => Promise<void>; creating: boolean }) {
  // The chrome ring runs only under the pointer or keyboard focus, as in the top bar:
  // the commit bar is on screen the whole time someone writes a strategy, and a ring
  // that redraws every frame for all of it is a phone's battery for no reason.
  const [metalHovered, setMetalHovered] = useState(false);
  const [metalFocused, setMetalFocused] = useState(false);

  return (
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
  );
}
