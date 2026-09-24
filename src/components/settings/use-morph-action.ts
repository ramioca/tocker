"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { MorphButtonState } from "@/components/spectrumui/morph-button";

/** Focus ring for a MorphButton on a card: its own ring-1 disappears against the glass. */
export const MORPH_FOCUS =
  "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

/**
 * Enter in a text field submits. A MorphButton is `type="button"`, and a form with
 * several fields and no submit button gets no implicit submission from the browser,
 * so the form has to ask for it. Textareas keep Enter for new lines.
 */
export function enterSubmits(submit: () => void) {
  return (event: KeyboardEvent<HTMLFormElement>) => {
    if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
    if (!(event.target instanceof HTMLInputElement)) return;
    event.preventDefault();
    submit();
  };
}

/**
 * Drives a controlled MorphButton from one `run()` that both the button's click and
 * the form's submit (Enter in any field) call, so the two can never disagree about
 * whether a save is in flight. `action` throws to show the error state.
 */
export function useMorphAction(action: () => Promise<void>, resetDelay = 1800) {
  const [state, setState] = useState<MorphButtonState>("idle");
  const busy = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(action);

  useEffect(() => {
    latest.current = action;
  });

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const run = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    if (timer.current) clearTimeout(timer.current);
    setState("loading");
    let next: MorphButtonState = "success";
    try {
      await latest.current();
    } catch {
      next = "error";
    }
    busy.current = false;
    setState(next);
    timer.current = setTimeout(() => setState("idle"), resetDelay);
  }, [resetDelay]);

  /** Back to idle now, e.g. when the user edits the field that caused the error. */
  const reset = useCallback(() => {
    if (busy.current) return;
    if (timer.current) clearTimeout(timer.current);
    setState("idle");
  }, []);

  return { state, run, reset };
}
