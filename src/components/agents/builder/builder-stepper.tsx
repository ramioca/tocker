import { Check } from "lucide-react";
import { TextStates } from "@/components/spectrumui/text-states";
import type { BuilderStepId, StepStatus, Via } from "./contract";
import { cn } from "@/lib/utils";

export interface StepView {
  id: BuilderStepId;
  label: string;
  status: StepStatus;
  /** The status as a word: "Needed", "Ready", "Defaults", "Edited", "Fix". */
  statusLabel: string;
  /** "error" only after a failed Create; before that a missing thing is simply needed. */
  tone: "neutral" | "error";
}

/** A step that is waiting on the user, as opposed to one that is fine as it stands. */
const waiting = (status: StepStatus) => status === "needed" || status === "fix";

/**
 * The four steps, each a button: any of them can be visited at any time. A list of
 * buttons and not a tablist, so Tab reaches every one.
 *
 * From `sm` up each step is a dot, its name and its status word, joined by a hairline
 * that fills up to the current step. On a phone there is no room for four labels: the
 * steps are four segments, each still a 44px button, and one line of text says where
 * you are.
 */
export function BuilderStepper({
  steps,
  current,
  onGo,
  disabled = false,
}: {
  steps: StepView[];
  current: BuilderStepId;
  onGo: (id: BuilderStepId, via: Via) => void;
  /** While the agent is being created: the steps stay where they are. */
  disabled?: boolean;
}) {
  const index = Math.max(0, steps.findIndex((step) => step.id === current));
  const active = steps[index];
  const last = Math.max(1, steps.length - 1);

  return (
    <nav aria-label="Steps">
      <ol className="relative grid grid-cols-4 gap-1.5 sm:gap-0">
        {/* The hairline runs from the first dot's centre to the last one's. One bar,
            scaled from the left: no width animates and no variable drives a child. */}
        <li aria-hidden className="pointer-events-none absolute top-[22px] left-3 hidden h-px w-3/4 bg-border sm:block">
          <span
            className="block h-full origin-left bg-foreground/70 transition-transform duration-[240ms] ease-[var(--ease-in-out-strong)] motion-reduce:transition-none"
            style={{ transform: `scaleX(${index / last})` }}
          />
        </li>
        {steps.map((step, i) => {
          const isCurrent = step.id === current;
          const error = step.tone === "error";
          // A tick once a step is ready, or once it has been passed with nothing left to
          // do on it; a step ahead keeps its number.
          const ticked = !isCurrent && !waiting(step.status) && (step.status === "ready" || i < index);
          return (
            <li key={step.id} className="min-w-0">
              <button
                type="button"
                aria-current={isCurrent ? "step" : undefined}
                disabled={disabled}
                // detail is 0 when a click comes from Enter or Space: a keyboard move swaps
                // the step at once, a pointer move plays the short entrance.
                onClick={(event) => onGo(step.id, event.detail === 0 ? "keyboard" : "pointer")}
                className="group relative flex min-h-11 w-full flex-col justify-center rounded-lg text-left transition-colors duration-150 disabled:pointer-events-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none sm:justify-start sm:py-2.5 sm:pr-3"
              >
                {/* One name for every width; what is drawn below is decoration on top of it. */}
                <span className="sr-only">
                  {step.label}: {step.statusLabel}
                </span>

                {/* Phones: a segment, filled up to the current step. */}
                <span
                  aria-hidden
                  className={cn(
                    "block h-1 w-full rounded-full transition-colors duration-150 sm:hidden",
                    error ? "bg-destructive" : isCurrent ? "bg-foreground" : i < index ? "bg-foreground/60" : "bg-border",
                  )}
                />

                {/* sm and up: dot, name, status word. */}
                <span aria-hidden className="hidden sm:block">
                  <span
                    className={cn(
                      "tnum flex size-6 items-center justify-center rounded-full border bg-background font-mono text-[11px] transition-colors duration-150",
                      isCurrent
                        ? "border-foreground bg-foreground text-background"
                        : error
                          ? "border-destructive/70 text-destructive"
                          : ticked
                            ? "border-foreground/50 text-foreground"
                            : "border-border text-muted-foreground group-hover:border-foreground/40 group-hover:text-foreground",
                    )}
                  >
                    {ticked ? <Check className="size-3" strokeWidth={2.5} /> : i + 1}
                  </span>
                  <span
                    className={cn(
                      "mt-2 block truncate text-sm font-medium transition-colors duration-150",
                      isCurrent ? "text-foreground" : "text-muted-foreground group-hover:text-foreground",
                    )}
                  >
                    {step.label}
                  </span>
                  <span
                    className={cn(
                      "block h-4 text-xs leading-4 transition-colors duration-150",
                      error ? "text-destructive" : step.status === "ready" ? "text-positive" : "text-muted-foreground",
                    )}
                  >
                    <TextStates text={step.statusLabel} duration={150} translateY={4} blur={2} />
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      {/* Phones: where you are, in words. The buttons above and the line below already
          say it to a screen reader. */}
      {active ? (
        <p aria-hidden className="tnum mt-1 text-xs text-muted-foreground sm:hidden">
          Step {index + 1} of {steps.length} · {active.label} ·{" "}
          <span className={cn(active.tone === "error" && "text-destructive")}>{active.statusLabel}</span>
        </p>
      ) : null}

      {/* Announced when the step changes, however it changed. */}
      <p aria-live="polite" className="sr-only">
        {active ? `Step ${index + 1} of ${steps.length}: ${active.label}` : ""}
      </p>
    </nav>
  );
}
