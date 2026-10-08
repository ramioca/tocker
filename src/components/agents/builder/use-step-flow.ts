"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { StepPlace, Via } from "./contract";

/** 1 when `to` is the same step as `from` or a later one, -1 when it is an earlier one. */
export function directionOf<Id extends string>(steps: readonly Id[], from: Id, to: Id): 1 | -1 {
  return steps.indexOf(to) < steps.indexOf(from) ? -1 : 1;
}

/** The steps on either side of one, null at the ends. */
export function neighboursOf<Id extends string>(
  steps: readonly Id[],
  step: Id,
): { back: Id | null; next: Id | null } {
  const index = steps.indexOf(step);
  if (index === -1) return { back: null, next: null };
  return { back: steps[index - 1] ?? null, next: steps[index + 1] ?? null };
}

/** What one move comes to. */
export interface StepMove<Id extends string> {
  /** Where focus goes once its step is showing. */
  place: StepPlace<Id>;
  /**
   * The step change, or null when that step is already showing: then only focus moves and
   * the address is left as it is.
   */
  change: { direction: 1 | -1; animate: boolean; history: "push" | "replace" } | null;
}

/**
 * Decide a move, without making it. Null when there is none to make: the flow is locked,
 * or the place is on a step this page does not have.
 *
 * A move the user made is pushed, so the browser's Back button walks the steps; a move
 * the page made for them (`auto`) replaces the entry. Only a pointer move animates.
 */
export function planMove<Id extends string>(input: {
  steps: readonly Id[];
  /** The step that is showing. */
  current: Id;
  place: StepPlace<string>;
  via: Via;
  locked: boolean;
}): StepMove<Id> | null {
  const { steps, current, place, via } = input;
  if (input.locked) return null;
  const to = steps.find((id) => id === place.step);
  if (to === undefined) return null;
  return {
    place: { ...place, step: to },
    change:
      to === current
        ? null
        : {
            direction: directionOf(steps, current, to),
            animate: via === "pointer",
            history: via === "auto" ? "replace" : "push",
          },
  };
}

export interface StepFlowOptions<Id extends string> {
  /** The page's steps, in order. */
  steps: readonly Id[];
  /** The step an address names, or null when it names none. */
  read: (params: Pick<URLSearchParams, "get">) => Id | null;
  /** The address of a step. */
  hrefOf: (step: Id) => string;
  /** While this answers true no move is made: a create or a save is in flight. */
  locked?: () => boolean;
  /**
   * A place to go once, on arrival, which only the browser can know: the `#anchor` of a
   * link to one spot on the page. Asked after mount and before the first paint.
   */
  initialPlace?: () => StepPlace<string> | null;
  /** A restored draft resumes on `step()`, once, unless the address named a step itself. */
  resume?: { restored: boolean; step: () => Id };
  /**
   * Told of every move the flow makes with `goTo`, in the same update as the step change,
   * so whatever a place names beside its step (`sub`) is showing by the time focus lands.
   */
  onMove?: (place: StepPlace<Id>) => void;
}

export interface StepFlow<Id extends string> {
  step: Id;
  /** 1 when the last move went forward through the steps, -1 when it went back. */
  direction: 1 | -1;
  /** Whether the panel that just appeared should play its entrance: pointer moves only. */
  animate: boolean;
  /**
   * Go to a place: show its step, then put focus on its control. `missing` is called when
   * none of the place's controls is on the page. A place on a step this page does not
   * have is ignored.
   */
  goTo: (place: StepPlace<string>, via: Via, missing?: () => void) => void;
  /** `goTo` for a click that does not say how it was made (a row of the agent card). */
  goFromCard: (place: StepPlace<string>) => void;
  /** The steps on either side of the one showing, null at the ends. */
  back: Id | null;
  next: Id | null;
  /** The form column: the top of a step, where a plain step change scrolls to. */
  columnRef: React.RefObject<HTMLDivElement | null>;
  /** For the page's root element: records whether the user last used a pointer or a key. */
  inputProps: { onPointerDownCapture: () => void; onKeyDownCapture: () => void };
}

interface Nav<Id extends string> {
  step: Id;
  direction: 1 | -1;
  animate: boolean;
}

/**
 * A move the page has been asked to make, kept until the render that makes it has
 * committed: only then is the step showing, so only then can a control on it take focus.
 */
interface PendingMove<Id extends string> {
  place: StepPlace<Id>;
  /** Called when none of the place's controls is on the page. */
  missing?: () => void;
  /** The count of moves this one was, so no earlier render's effect takes it. */
  turn: number;
}

/**
 * Which step a page of steps is on, and how it gets from one to the next. Creating an
 * agent and editing one are the same eight steps, so both pages run on this.
 *
 * State is the source of truth, so a step change commits in the same render as the click
 * and focus never waits on the router. The address mirrors it (`?step=limits`): a move the
 * user made is pushed, so the browser's Back button walks the steps; a move the page made
 * for them (a restored draft, a failed Create, Start over) replaces the entry. The first
 * value is read from the address during the first render, so the server paints the right
 * step and a deep link does not flash step 1.
 *
 * The rules are the pure functions above, tested in node (`use-step-flow.test.ts`). What
 * is left here is the state, the address and where focus goes.
 */
export function useStepFlow<Id extends string>(opts: StepFlowOptions<Id>): StepFlow<Id> {
  const { steps, read, hrefOf, resume } = opts;
  const searchParams = useSearchParams();
  const [nav, setNav] = useState<Nav<Id>>(() => ({
    step: read(searchParams) ?? steps[0],
    direction: 1,
    animate: false,
  }));
  const step = nav.step;
  // The step as of the last move. It is a render ahead of `step` between a move and the
  // render that shows it, and every move starts from it, so one made by a callback that
  // was created renders ago (after an await, from a toast) still starts in the right place.
  const latest = useRef(step);

  const pendingPlace = useRef<PendingMove<Id> | null>(null);
  /** The step the effect below last saw, to tell a step change it was not told about. */
  const shownStep = useRef<Id | null>(null);
  const columnRef = useRef<HTMLDivElement>(null);
  // Counted so a move to a place on the step that is already showing still reaches the
  // effect.
  const [moves, setMoves] = useState(0);
  const asked = useRef(0);
  // How the user last touched the page. The agent card reports a click on a row without
  // saying how it was made, and a keyboard move must not animate the step.
  const lastInput = useRef<Via>("pointer");

  /** Show the step a move ends on and write it to the address. */
  const show = (move: StepMove<Id>) => {
    if (!move.change) return;
    const to = move.place.step;
    latest.current = to;
    setNav({ step: to, direction: move.change.direction, animate: move.change.animate });
    // Both calls are picked up by the Next router, which keeps `useSearchParams` in step
    // (docs: linking-and-navigating, "Native History API").
    const href = hrefOf(to);
    if (move.change.history === "replace") window.history.replaceState(null, "", href);
    else window.history.pushState(null, "", href);
  };

  /** Go to a place: show its step, then put focus on its control. */
  const goTo = (place: StepPlace<string>, via: Via, missing?: () => void) => {
    // Nobody leaves the step while its agent is being created or saved.
    const move = planMove({ steps, current: latest.current, place, via, locked: opts.locked?.() ?? false });
    if (!move) return;
    asked.current += 1;
    pendingPlace.current = { place: move.place, missing, turn: asked.current };
    setMoves(asked.current);
    opts.onMove?.(move.place);
    show(move);
  };
  const goFromCard = (place: StepPlace<string>) => goTo(place, lastInput.current);

  // A spot the address itself asks for, which the server never sees. Taken before the
  // first paint, so a link that names no step does not show the first one on the way.
  useLayoutEffect(() => {
    const place = opts.initialPlace?.() ?? null;
    if (place) goTo(place, "auto");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on arrival
  }, []);

  // The browser's Back and Forward buttons: the address changed and nothing here did it.
  // Never animated. The router can report an address a beat late (two quick presses of
  // Next), so a value that is no longer the real address is ignored, not obeyed.
  const urlStep = read(searchParams) ?? steps[0];
  useEffect(() => {
    if ((read(new URLSearchParams(window.location.search)) ?? steps[0]) !== urlStep) return;
    latest.current = urlStep;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the address is the input here; it changes outside React
    setNav((current) =>
      current.step === urlStep
        ? current
        : { step: urlStep, direction: directionOf(steps, current.step, urlStep), animate: false },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the address is the only input; `read` and `steps` are the page's own and do not change
  }, [urlStep]);

  // A restored draft resumes where something is still missing, once, and only when the
  // address did not ask for a place itself. `resume.step` is read on the render that
  // reports the restore, which is the first one that holds the restored draft.
  const restored = resume?.restored ?? false;
  const resumed = useRef(false);
  useEffect(() => {
    if (!restored || resumed.current || !resume) return;
    resumed.current = true;
    const params = new URLSearchParams(window.location.search);
    if (read(params) !== null) return;
    const move = planMove({ steps, current: latest.current, place: { step: resume.step() }, via: "auto", locked: false });
    // A restore is read from localStorage after mount, so its step can only follow it. No
    // place is kept for the move: the step changes and focus goes to its heading.
    if (move) show(move);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per restore; `resume.step` changes on every edit
  }, [restored]);

  // After the commit that un-hides the panel, so focus can never land on a hidden control
  // and the focused control already carries its error when a screen reader announces it.
  useEffect(() => {
    const arriving = shownStep.current === null;
    const stepChanged = shownStep.current !== step;
    shownStep.current = step;
    // A move is taken by the render it asked for. One made before the first paint (the
    // address's own spot) is still waiting for that render when this first runs.
    const due = pendingPlace.current !== null && pendingPlace.current.turn <= moves;
    let move: Omit<PendingMove<Id>, "turn"> | null = due ? pendingPlace.current : null;
    if (due) pendingPlace.current = null;
    if (arriving) {
      // The first paint, a deep link included: the page is where it should be, and focus
      // stays where the browser put it.
      move = null;
    } else if (!move && stepChanged) {
      // The browser's Back or Forward button, or a restored draft resuming: the step
      // changed without a place, so focus goes to its heading.
      move = { place: { step } };
    }
    if (!move || move.place.step !== step) return;

    const target = move.place.focusIds?.map((id) => document.getElementById(id)).find((el) => el !== null);
    if (target) {
      const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      target.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "center" });
      target.focus({ preventScroll: true });
      return;
    }
    move.missing?.();
    // A plain step change: the top of the form, at once, with focus on the step's heading.
    columnRef.current?.scrollIntoView({ behavior: "auto", block: "start" });
    document.getElementById(`step-${step}-title`)?.focus({ preventScroll: true });
  }, [step, moves]);

  return {
    step,
    direction: nav.direction,
    animate: nav.animate,
    goTo,
    goFromCard,
    ...neighboursOf(steps, step),
    columnRef,
    inputProps: {
      onPointerDownCapture: () => {
        lastInput.current = "pointer";
      },
      onKeyDownCapture: () => {
        lastInput.current = "keyboard";
      },
    },
  };
}
