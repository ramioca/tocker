import { Check, Circle, CircleAlert, Pencil } from "lucide-react";
import type { BuilderStepId, StepStatus, Via } from "./contract";
import { EASE, FOCUS, FOCUS_OFFSET, SILK, TYPE } from "./look";
import { cn } from "@/lib/utils";

export interface StepView {
  id: BuilderStepId;
  /** One word, for under the segment: "Hunts". */
  label: string;
  /** The step's name where there is room for it: "Where it hunts". */
  name: string;
  status: StepStatus;
  /** The status as a word: "Needed", "Ready", "Defaults", "Edited", "Fix". */
  statusLabel: string;
  /** "error" only after a failed Create; before that a missing thing is simply needed. */
  tone: "neutral" | "error";
}

/** A step that is waiting on the user, as opposed to one that is fine as it stands. */
const waiting = (status: StepStatus) => status === "needed" || status === "fix";

/**
 * A step's status as a shape, so no state is told by colour alone. A step still on its
 * defaults has none: nothing happened there.
 */
function StatusGlyph({ status, error, current }: { status: StepStatus; error: boolean; current: boolean }) {
  const shape = "size-3 shrink-0";
  if (error || status === "fix") return <CircleAlert className={cn(shape, "text-destructive")} strokeWidth={2.5} />;
  if (status === "ready") return <Check className={cn(shape, "text-primary")} strokeWidth={2.5} />;
  if (status === "edited") return <Pencil className={cn(shape, "text-muted-foreground")} strokeWidth={2.5} />;
  if (status === "needed") {
    return (
      <Circle className={cn(shape, current ? "text-foreground" : "text-muted-foreground")} strokeWidth={2.5} />
    );
  }
  return null;
}

/**
 * The eight steps, each a button: any of them can be visited at any time. A list of
 * buttons and not a tablist, so Tab reaches every one.
 *
 * The steps are a rail: eight segments, filled up to the current step, each with its
 * slice of one gradient, so the first is always blue and the last always pink. From `sm`
 * up a one-word label and a status glyph sit under each segment. The status word is
 * printed once, in the line under the rail.
 *
 * On a phone there is no room for eight labels: the rail and that one line share a single
 * 44px row. The buttons touch, with the gap drawn inside each one, so every pixel of the
 * row is a target, as wide as an eighth of the screen allows (43px on a 375px phone). The
 * line lies over the bottom of the row and lets taps through.
 */
export function BuilderStepper({
  steps,
  current,
  onGo,
  disabled = false,
  animate = false,
}: {
  steps: StepView[];
  current: BuilderStepId;
  onGo: (id: BuilderStepId, via: Via) => void;
  /** While the agent is being created: the steps stay where they are. */
  disabled?: boolean;
  /** True when the step was changed with a pointer: only then does a segment fill in motion. */
  animate?: boolean;
}) {
  const index = Math.max(0, steps.findIndex((step) => step.id === current));
  const active = steps[index];
  const last = Math.max(1, steps.length - 1);

  return (
    <nav aria-label="Steps" className="relative">
      <ol className="grid grid-cols-8 sm:gap-1">
        {steps.map((step, i) => {
          const isCurrent = step.id === current;
          const filled = i <= index;
          const error = step.tone === "error";
          return (
            <li key={step.id} className="min-w-0">
              <button
                type="button"
                aria-current={isCurrent ? "step" : undefined}
                disabled={disabled}
                // detail is 0 when a click comes from Enter or Space: a keyboard move swaps
                // the step at once, a pointer move plays the short entrance.
                onClick={(event) => onGo(step.id, event.detail === 0 ? "keyboard" : "pointer")}
                className={cn(
                  "group flex h-11 w-full flex-col justify-start rounded-md px-[3px] pt-2 text-left sm:h-10 sm:px-0 sm:pt-1 sm:pointer-coarse:h-11",
                  "disabled:pointer-events-none",
                  FOCUS,
                  FOCUS_OFFSET,
                )}
              >
                {/* One name for every width; what is drawn below is decoration on top of it. */}
                <span className="sr-only">
                  {step.name}: {step.statusLabel}
                </span>

                {/* The segment. Its fill is scaled from the left, so no width animates, and
                    the gradient is eight segments wide so each one shows its own slice. */}
                <span
                  aria-hidden
                  className="relative block h-1 w-full overflow-hidden rounded-full bg-foreground/10 transition-colors duration-150 group-hover:bg-foreground/20 sm:h-0.5"
                >
                  <span
                    data-animate={animate}
                    className={cn(
                      "absolute inset-0 origin-left bg-[length:800%_100%] transition-transform duration-200",
                      EASE,
                      "motion-reduce:transition-none data-[animate=false]:transition-none",
                      error ? "bg-destructive" : SILK,
                      filled || error ? "scale-x-100" : "scale-x-0",
                    )}
                    style={error ? undefined : { backgroundPosition: `${(i / last) * 100}% 0` }}
                  />
                </span>
                {/* Phones have no label under the segment, so a step that needs fixing is
                    marked with the same glyph the label carries from sm, not by red alone. */}
                {error ? (
                  <CircleAlert aria-hidden className="mx-auto mt-1 size-3 text-destructive sm:hidden" strokeWidth={2.5} />
                ) : null}

                {/* sm and up: status glyph and name. */}
                <span
                  aria-hidden
                  className={cn(
                    "mt-2 hidden items-center gap-1 text-xs leading-4 transition-colors duration-150 sm:flex",
                    isCurrent
                      ? "font-semibold text-foreground"
                      : error
                        ? "font-medium text-destructive"
                        : "font-medium text-muted-foreground group-hover:text-foreground",
                  )}
                >
                  <StatusGlyph status={step.status} error={error} current={isCurrent} />
                  <span className="truncate">{step.label}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      {/* Where you are and how the step stands, in words, directly above the step's title.
          The buttons above and the line below already say it to a screen reader. */}
      {active ? (
        <p
          aria-hidden
          className={cn(TYPE.kicker, "pointer-events-none absolute inset-x-0 bottom-0 truncate sm:static sm:mt-6")}
        >
          Step {index + 1} of {steps.length} ·{" "}
          <span
            className={cn(
              active.tone === "error" ? "text-destructive" : waiting(active.status) ? "text-foreground" : null,
            )}
          >
            {active.statusLabel}
          </span>
        </p>
      ) : null}

      {/* Announced when the step changes, however it changed. */}
      <p aria-live="polite" className="sr-only">
        {active ? `Step ${index + 1} of ${steps.length}: ${active.name}` : ""}
      </p>
    </nav>
  );
}
