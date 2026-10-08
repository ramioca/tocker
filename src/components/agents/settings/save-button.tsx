"use client";

import { useEffect, useState } from "react";
import { MorphButton, type MorphButtonState } from "@/components/spectrumui/morph-button";
import { MORPH_FOCUS } from "@/components/common/focus";
import { cn } from "@/lib/utils";

/** Where a save stands. */
export type SaveState = MorphButtonState;

/** How long "Saved" and "Check the form" stay up before the button is at rest again. */
export const SAVE_RESULT_MS = 1800;

/**
 * The save's state, for the page to hold: whatever it is set to, with a result going back
 * to rest by itself after `SAVE_RESULT_MS`.
 */
export function useSaveState(): readonly [SaveState, (next: SaveState) => void] {
  const [state, setState] = useState<SaveState>("idle");
  useEffect(() => {
    if (state !== "success" && state !== "error") return;
    const timer = window.setTimeout(() => setState("idle"), SAVE_RESULT_MS);
    return () => window.clearTimeout(timer);
  }, [state]);
  return [state, setState] as const;
}

/**
 * Save changes: the one filled button of the settings bar, in the same place on every step.
 *
 * The page says where the save stands and the button only draws it. A press that ends in
 * neither a save nor a refusal (a live agent's confirm answered "Keep editing") then leaves
 * the button exactly as it was, where a button that ran the save itself could only show
 * "Saved" or shake.
 *
 * It takes a press only at rest, so one made while a save is running goes nowhere. On a
 * phone the label is "Save"; its spoken name is "Save changes" at every width.
 */
export function SaveButton({
  state,
  dirty,
  onSave,
  className,
}: {
  state: SaveState;
  /** There is something to save. */
  dirty: boolean;
  onSave: () => void;
  className?: string;
}) {
  return (
    <MorphButton
      state={state}
      onClick={onSave}
      // Off while everything is saved, but only at rest: "Saved" is shown over a page that
      // is clean by then, and must not be dimmed the way a disabled button is.
      disabled={state === "idle" && !dirty}
      loadingLabel="Saving…"
      successLabel="Saved"
      // Most refusals are a field the step already marks; a server refusal explains
      // itself in a toast, so this stays true for both.
      errorLabel="Check the form"
      ariaLabel="Save changes"
      // 44px, the height of the bar's other buttons.
      className={cn("h-11 shrink-0 px-5", MORPH_FOCUS, className)}
    >
      {/* One span: the button lays its content out as a row with a gap, which would
          otherwise fall between the two words. */}
      <span>
        Save<span className="hidden sm:inline"> changes</span>
      </span>
    </MorphButton>
  );
}
