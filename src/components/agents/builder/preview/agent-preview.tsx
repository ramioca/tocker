"use client";

import type { CostLine, Place, PreviewRow, ReadyItem } from "../contract";
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
  reveal = false,
  quietKey,
  disabled = false,
}: AgentPreviewProps) {
  // `.animate-rise` is off under reduced motion in globals.css, delay and all.
  const rise = (index: number) =>
    reveal ? { className: "animate-rise", style: { animationDelay: `${index * STAGGER_MS}ms` } } : {};

  return (
    <aside aria-label="Your agent" className="overflow-hidden rounded-2xl border border-border/70 bg-card/30">
      <PreviewHead draft={draft} onGo={onGo} disabled={disabled} {...rise(0)} />
      <ReadyList items={ready} onGo={onGo} disabled={disabled} {...rise(1)} />
      <PreviewRows
        prompt={draft.config.strategyPrompt}
        rows={rows}
        onGo={onGo}
        quietKey={quietKey}
        disabled={disabled}
        {...rise(2)}
      />
      <RunCost costs={costs} runLine={runLine} runsPerDay={runsPerDay} {...rise(3)} />
    </aside>
  );
}
