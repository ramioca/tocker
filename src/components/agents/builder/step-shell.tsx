import { cn } from "@/lib/utils";
import { BuilderStepper, type StepView } from "./builder-stepper";
import type { PartId } from "./parts";
import type { StepFlow } from "./use-step-flow";

/**
 * The page every step is shown on: the rail, the step that is open, the agent card beside
 * it from `lg`, and the bar underneath. Creating an agent and editing a saved one are both
 * this page, so it is drawn here, once.
 *
 * Layout and nothing else. It holds no draft and decides nothing: which step is open is
 * `flow`, and everything it shows arrives as a prop from the page that hosts it.
 */
export function StepShell<Id extends PartId>({
  flow,
  steps,
  top,
  intro,
  panels,
  card,
  bar,
  announcement = "",
  disabled = false,
  topSpan = "form",
  panelMinHeight,
}: {
  flow: StepFlow<Id>;
  /** The rail. */
  steps: StepView<Id>[];
  /** What the page opens with, above the rail: its name, or the agent being edited. */
  top: React.ReactNode;
  /** One sentence under `top`, in the form column. */
  intro?: React.ReactNode;
  /** The step panels. Every one stays mounted; the panels hide themselves. */
  panels: React.ReactNode;
  /** The agent card of the column that `lg` and wider screens have. */
  card: React.ReactNode;
  /** The bar underneath. */
  bar: React.ReactNode;
  /** Spoken when it changes, and never shown: the one line that says the ready count. */
  announcement?: string;
  /** While a create or a save is in flight: the rail takes no press. */
  disabled?: boolean;
  /** Where `top` sits: at the head of the form column, or across the form and the card. */
  topSpan?: "form" | "full";
  /**
   * The least height of the open step, as one whole class (`min-h-[calc(100dvh-17rem)]`),
   * so a short step never makes the page shorter than the viewport and the bar below does
   * not jump between steps. It is the page's to say: it depends on how tall `top` is.
   */
  panelMinHeight: string;
}) {
  const { step, animate, goTo, columnRef, inputProps } = flow;
  const columns = (
    <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-8 xl:grid-cols-[minmax(0,1fr)_400px] xl:gap-12">
      {/* The form. 672px is the width every control in it was built for. */}
      <div ref={columnRef} className="mx-auto w-full max-w-2xl min-w-0 scroll-mt-20 lg:mx-0">
        {topSpan === "form" ? top : null}
        {intro}

        <div className="mt-1 sm:mt-6">
          <BuilderStepper
            steps={steps}
            current={step}
            onGo={(id, via) => goTo({ step: id }, via)}
            disabled={disabled}
            animate={animate}
          />
        </div>

        <div className={cn("mt-2", panelMinHeight)}>{panels}</div>
      </div>

      {/* The agent card, in its own column from lg, so nothing the form does moves it.
          The height stops it sliding under the bar below. The padding leaves room for the
          card's shadow, and the mask fades the cut instead of slicing a row in half. */}
      <div className="hidden lg:block">
        <div className="scrollbar-thin lg:sticky lg:top-20 lg:-mx-4 lg:max-h-[calc(100dvh-11rem)] lg:overflow-y-auto lg:scroll-pb-8 lg:px-4 lg:pb-8 lg:[mask-image:linear-gradient(to_bottom,black_calc(100%-24px),transparent)]">
          {card}
        </div>
      </div>
    </div>
  );

  return (
    <div className="mx-auto w-full max-w-[1120px] px-4 pt-3 pb-6 sm:px-6 sm:pt-6" {...inputProps}>
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
      {/* `top` joins the columns only when it spans them. In the form column it adds no
          child here, so the ids React derives from a component's place among its siblings
          (a slider's, a card heading's) are the ones the builder had before it shared
          this page. */}
      {topSpan === "full" ? (
        <>
          {top}
          {columns}
        </>
      ) : (
        columns
      )}
      {bar}
    </div>
  );
}
