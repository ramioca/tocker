"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { BUILDER_STEPS, type BuilderStepId, type Place, type Via } from "./contract";
import { neighbours, requestedStep, resumeStep, stepHref, stepOf } from "./flow";

interface Nav {
  step: BuilderStepId;
  /** 1 when the last move went forward through the steps, -1 when it went back. */
  direction: 1 | -1;
  /** Whether the panel that just appeared should play its entrance: pointer moves only. */
  animate: boolean;
}

function directionOf(from: BuilderStepId, to: BuilderStepId): 1 | -1 {
  return BUILDER_STEPS.indexOf(to) < BUILDER_STEPS.indexOf(from) ? -1 : 1;
}

/**
 * Which step the builder is on.
 *
 * State is the source of truth, so a step change commits in the same render as the click
 * and focus never waits on the router. The address mirrors it (`?step=limits`): a move the
 * user made is pushed, so the browser's Back button walks the steps; a move the page made
 * for them (a restored draft, a failed Create, Start over) replaces the entry. The first
 * value is read from the address during the first render, so the server paints the right
 * step and a deep link does not flash step 1. An old link (`?step=rules&open=risk`) is
 * understood on the way in and never written on the way out.
 */
export function useBuilderStep({ restored, errors }: { restored: boolean; errors: Record<string, string> }) {
  const searchParams = useSearchParams();
  const [nav, setNav] = useState<Nav>(() => ({ step: stepOf(searchParams), direction: 1, animate: false }));
  const step = nav.step;

  const go = useCallback(
    (place: Place, via: Via) => {
      if (place.step === step) return;
      setNav({ step: place.step, direction: directionOf(step, place.step), animate: via === "pointer" });
      // Both calls are picked up by the Next router, which keeps `useSearchParams` in step
      // (docs: linking-and-navigating, "Native History API").
      const href = stepHref(place.step);
      if (via === "auto") window.history.replaceState(null, "", href);
      else window.history.pushState(null, "", href);
    },
    [step],
  );

  const back = useCallback(
    (via: Via) => {
      const to = neighbours(step).back;
      if (to) go({ step: to }, via);
    },
    [go, step],
  );

  const next = useCallback(
    (via: Via) => {
      const to = neighbours(step).next;
      if (to) go({ step: to }, via);
    },
    [go, step],
  );

  // The browser's Back and Forward buttons: the address changed and nothing here did it.
  // Never animated. The router can report an address a beat late (two quick presses of
  // Next), so a value that is no longer the real address is ignored, not obeyed.
  const urlStep = stepOf(searchParams);
  useEffect(() => {
    if (stepOf(new URLSearchParams(window.location.search)) !== urlStep) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the address is the input here; it changes outside React
    setNav((current) =>
      current.step === urlStep
        ? current
        : { step: urlStep, direction: directionOf(current.step, urlStep), animate: false },
    );
  }, [urlStep]);

  // A restored draft resumes where something is still missing, once, and only when the
  // address did not ask for a place itself. `errors` is read on the render that reports
  // the restore, which is the first one that holds the restored draft.
  const resumed = useRef(false);
  useEffect(() => {
    if (!restored || resumed.current) return;
    resumed.current = true;
    const params = new URLSearchParams(window.location.search);
    if (requestedStep(params) !== null) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- a restore is read from localStorage after mount, so its step can only follow it
    go({ step: resumeStep(errors) }, "auto");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per restore; `errors` and `go` change on every edit
  }, [restored]);

  return { step, go, back, next, direction: nav.direction, animate: nav.animate };
}
