"use client";

import { cn } from "@/lib/utils";
import type { BuilderStepId, CostLine, Place, PreviewRow, ReadyItem } from "../contract";
import { SILK_EDGE } from "../look";
import type { BuilderDraft } from "../types";
import { PreviewHead } from "./preview-head";
import { PreviewRows } from "./preview-rows";
import { ReadyList } from "./ready-list";
import { RunCost } from "./run-cost";

export interface AgentPreviewProps {
  draft: BuilderDraft;
  /** The three "Yours to decide" rows, from `readyItems`. */
  ready: ReadyItem[];
  /** The seven "Already set" rows, from `previewRows`. */
  rows: PreviewRow[];
  /** The lines of "A run", from `costLines`. */
  costs: CostLine[];
  runLine: string;
  /**
   * The runs-a-day figure for the ticker. Null when there is no number to show (a manual
   * schedule, or a funded agent held for the checklist): the Runs line of `costs` then
   * stands as text.
   */
  runsPerDay: number | null;
  onGo: (place: Place) => void;
  /** The step that is open: the card marks the rows edited there. */
  currentStep?: BuilderStepId;
  /** Column copy only: play the one-pass entrance. */
  reveal?: boolean;
  /**
   * Changes when the whole draft was swapped rather than edited (a saved draft restored,
   * Start over, its Undo). The rows then change without their tint.
   */
  quietKey?: unknown;
  /** While the agent is being created: nothing on the card goes anywhere. */
  disabled?: boolean;
}

/** The gap between one block of the entrance and the next, in ms. */
const STAGGER_MS = 40;

/**
 * The agent being made, as a card: who it is, what is still the user's to decide, what
 * is already set, and what a run costs. It reads the draft and never writes it, and
 * everything on it is the draft's own: no sample tokens, no scores, no made-up curve.
 *
 * Up to three copies are on the page at once (the column, the phone sheet, the read-back
 * on the last step), so nothing in it has a fixed id and it announces nothing itself: the
 * builder owns the one line that speaks the ready count.
 *
 * It is derived state. A value changes in place, with no animation, however fast the
 * draft changes; the entrance plays once, on the column copy, and is never replayed.
 */
export function AgentPreview({
  draft,
  ready,
  rows,
  costs,
  runLine,
  runsPerDay,
  onGo,
  currentStep,
  reveal = false,
  quietKey,
  disabled = false,
}: AgentPreviewProps) {
  // `.animate-rise` is off under reduced motion in globals.css, delay and all.
  const rise = (index: number) =>
    reveal ? { className: "animate-rise", style: { animationDelay: `${index * STAGGER_MS}ms` } } : {};

  return (
    <aside
      aria-label="Your agent"
      data-all-ready={ready.every((item) => item.ready)}
      className={cn(
        "group/card relative overflow-hidden rounded-2xl border border-white/[0.09] bg-card/50",
        "shadow-[inset_0_1px_0_0_rgb(255_255_255/0.06),0_24px_48px_-32px_rgb(0_0_0/0.8)]",
      )}
    >
      {/* The lit top edge. It brightens once all three things are ready: a transition
          from a state, so it never plays on mount. Marked so the phone sheet can drop it. */}
      <span
        aria-hidden
        data-card-edge
        className={cn(
          SILK_EDGE,
          "pointer-events-none absolute inset-x-6 top-0 h-px opacity-50 transition-opacity duration-200",
          "group-data-[all-ready=true]/card:opacity-100 forced-colors:hidden",
        )}
      />
      <PreviewHead draft={draft} onGo={onGo} disabled={disabled} {...rise(0)} />
      <ReadyList items={ready} onGo={onGo} currentStep={currentStep} disabled={disabled} {...rise(1)} />
      <PreviewRows
        prompt={draft.config.strategyPrompt}
        rows={rows}
        onGo={onGo}
        currentStep={currentStep}
        quietKey={quietKey}
        disabled={disabled}
        {...rise(2)}
      />
      <RunCost costs={costs} runLine={runLine} runsPerDay={runsPerDay} {...rise(3)} />
    </aside>
  );
}
