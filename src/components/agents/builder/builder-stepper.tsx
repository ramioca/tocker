import { Check, CircleAlert } from "lucide-react";
import type { BuilderStepId, StepStatus, Via } from "./contract";
import { EASE, FOCUS, FOCUS_OFFSET, PartIcon, SILK, TYPE } from "./look";
import { PART_STROKE, type PartId } from "./parts";
import { cn } from "@/lib/utils";

/**
 * One step of the rail. The id is a part, never any string: the rail draws the part's
 * icon, so a step with no icon cannot be given to it.
 */
export interface StepView<Id extends PartId = BuilderStepId> {
  id: Id;
  /** One word, for under the segment: "Hunts". */
  label: string;
  /** The step's name where there is room for it: "Where it hunts". */
  name: string;
  status: StepStatus;
  /**
   * The status as a word, which is the page's to choose: "Needed", "Ready", "Defaults",
   * "Edited", "Fix" while creating; "Saved", "Changed", "Fix" over a saved agent.
   */
  statusLabel: string;
  /** "error" only after a failed Create or a refused save; before that a missing thing is simply needed. */
  tone: "neutral" | "error";
}

/** A step that is waiting on the user, as opposed to one that is fine as it stands. */
const waiting = (status: StepStatus) => status === "needed" || status === "fix";

/**
 * A step's status as a badge on the corner of its icon, a shape for each so no state is
 * told by colour alone: a tick disc (ready), a dashed ring (needed), a dot (edited), an
 * alert (fix). A step still on its defaults has none: nothing happened there.
 *
 * The wrapper is always in the tree, so a badge appearing is a transition that can be
 * interrupted. The dot and the disc are fills, which forced colours would paint over, so
 * each names a system colour there.
 */
function StateBadge({ status, error }: { status: StepStatus; error: boolean }) {
  const kind = error ? "fix" : status;
  return (
    <span
      data-state={kind}
      className={cn(
        "absolute -right-2 -bottom-1 grid size-3 place-items-center rounded-full bg-background ring-1 ring-background",
        "transition-[opacity,scale] duration-150",
        EASE,
        "motion-reduce:scale-100",
        kind === "defaults" ? "scale-75 opacity-0" : "scale-100 opacity-100",
      )}
    >
      {kind === "ready" ? (
        <span className="grid size-3 place-items-center rounded-full bg-primary text-primary-foreground forced-colors:bg-[Highlight] forced-colors:text-[HighlightText]">
          <Check className="size-2" strokeWidth={4} />
        </span>
      ) : kind === "needed" ? (
        <span className="size-3 rounded-full border-[1.5px] border-dashed border-foreground/60" />
      ) : kind === "edited" ? (
        <span className="size-1.5 rounded-full bg-foreground/80 forced-colors:bg-[CanvasText]" />
      ) : kind === "fix" ? (
        <CircleAlert className="size-3 text-destructive" strokeWidth={2.5} />
      ) : null}
    </span>
  );
}

/**
 * The eight steps, each a button: any of them can be visited at any time. A list of
 * buttons and not a tablist, so Tab reaches every one.
 *
 * The steps are a rail: eight segments, filled up to the current step, each with its
 * slice of one gradient, so the first is always blue and the last always pink. From `sm`
 * up the step's icon, with its status on a badge, sits under each segment over a one-word
 * label. The icon is the one the agent card draws for the same part. The status word is
 * printed once, in the line under the rail, which carries the current step's icon too.
 *
 * On a phone there is no room for eight labels: the rail and that one line share a single
 * 44px row. The buttons touch, with the gap drawn inside each one, so every pixel of the
 * row is a target, as wide as an eighth of the screen allows (43px on a 375px phone). The
 * line lies over the bottom of the row and lets taps through.
 */
export function BuilderStepper<Id extends PartId>({
  steps,
  current,
  onGo,
  disabled = false,
  animate = false,
}: {
  steps: StepView<Id>[];
  current: Id;
  onGo: (id: Id, via: Via) => void;
  /** While the agent is being created or saved: the steps stay where they are. */
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
                data-step={step.id}
                data-status={error ? "fix" : step.status}
                className={cn(
                  "group flex h-11 w-full flex-col justify-start rounded-md px-[3px] pt-2 text-left sm:h-14 sm:px-0 sm:pt-1",
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

                {/* sm and up: the part's icon with its status on a badge, then the name. The
                    label has the whole cell, so no name is cut short at any width. */}
                <span
                  aria-hidden
                  className={cn(
                    "mt-2.5 hidden origin-left flex-col items-start gap-1.5 transition-[color,scale] duration-150",
                    EASE,
                    "group-active:scale-[0.97] motion-reduce:group-active:scale-100 sm:flex",
                    isCurrent
                      ? "text-foreground"
                      : error
                        ? "text-destructive"
                        : "text-muted-foreground group-hover:text-foreground",
                  )}
                >
                  <span className="relative block size-4">
                    <PartIcon part={step.id} strokeWidth={isCurrent ? 2 : PART_STROKE} />
                    <StateBadge status={step.status} error={error} />
                  </span>
                  <span
                    className={cn("block w-full truncate text-xs leading-4", isCurrent ? "font-semibold" : "font-medium")}
                  >
                    {step.label}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      {/* Where you are and how the step stands, in words, directly above the step's title.
          The buttons above and the line below already say it to a screen reader. It leads
          with the step's icon, which on a phone is the only place the icon shows. */}
      {active ? (
        <p
          aria-hidden
          className={cn(
            TYPE.kicker,
            "pointer-events-none absolute inset-x-0 bottom-0 flex items-center gap-1.5 sm:static sm:mt-4",
          )}
        >
          <PartIcon part={active.id} className="size-3.5" strokeWidth={2} />
          <span className="truncate">
            Step {index + 1} of {steps.length} ·{" "}
            <span
              className={cn(
                active.tone === "error" ? "text-destructive" : waiting(active.status) ? "text-foreground" : null,
              )}
            >
              {active.statusLabel}
            </span>
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
