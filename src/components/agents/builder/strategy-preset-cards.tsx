import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import type { StrategyPreset } from "./types";

/**
 * The strategy presets as cards: what each one is, and a line of facts about the agent
 * it would make. The blurb is on the card, not behind a hover, because a tooltip never
 * shows on touch and what a preset does is the thing to know before tapping it.
 */
export function StrategyPresetCards({
  presets,
  pressedId,
  factsLine,
  feeNote,
  onApply,
}: {
  presets: StrategyPreset[];
  /** The preset whose prompt is the draft's, or null when the prompt is the owner's own. */
  pressedId: string | null;
  /** The agent this preset would leave behind, in one line. */
  factsLine: (preset: StrategyPreset) => string;
  /** What the flat fee takes from this preset's ticket; empty when there is nothing to say. */
  feeNote: (preset: StrategyPreset) => string;
  onApply: (preset: StrategyPreset) => void;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {presets.map((preset) => {
        const active = pressedId === preset.id;
        const base = `strategy-preset-${preset.id}`;
        return (
          <button
            key={preset.id}
            type="button"
            aria-pressed={active}
            // Named by its title alone, so a screen reader says "Momentum, pressed" and
            // then the blurb and the facts, not one run-on sentence.
            aria-labelledby={`${base}-label`}
            aria-describedby={`${base}-blurb ${base}-facts`}
            onClick={() => onApply(preset)}
            className={cn(
              "flex min-h-11 flex-col gap-1.5 rounded-xl border p-3 text-left",
              "transition-[border-color,background-color,scale] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.97]",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              active
                ? "border-primary/50 bg-primary/8"
                : "border-border/70 bg-card/30 hover:border-border hover:bg-card/60",
            )}
          >
            <span className="flex items-center gap-1.5">
              <span id={`${base}-label`} className="text-sm font-medium">
                {preset.label}
              </span>
              {active ? <Check aria-hidden className="size-3.5 text-primary" /> : null}
            </span>
            <span id={`${base}-blurb`} className="text-xs leading-relaxed text-muted-foreground">
              {preset.blurb}
              {feeNote(preset)}
              <span className="sr-only"> Replaces the strategy prompt; you can undo it.</span>
            </span>
            {/* Pushed to the foot, so the facts of two cards in a row sit on one line
                whatever the length of their blurbs. */}
            <span
              id={`${base}-facts`}
              className="tnum mt-auto pt-0.5 font-mono text-[11px] leading-4 text-muted-foreground"
            >
              {factsLine(preset)}
            </span>
          </button>
        );
      })}
    </div>
  );
}
