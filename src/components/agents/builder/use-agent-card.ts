"use client";

import { useDeferredValue, useMemo, useState } from "react";
import type { AgentConfig } from "@/db/schema";
import type { DataSourceInfo, LlmKeyRow } from "@/server/types";
import type { ReadyItem, SummaryEdit } from "./contract";
import type { AgentPreviewProps } from "./preview/agent-preview";
import type { CardPlace } from "./preview/preview-head";
import { SUMMARY_LABELS } from "./step-registry";
import { costFacts, costLines, previewRows, readyItems, runLine } from "./summaries";
import type { BuilderDraft } from "./types";
import { universeSummary } from "./universe-copy";
import { validateDraft } from "./validate";

/** Everything an `AgentPreview` takes but `reveal`, which only the column copy sets. */
export interface AgentCardProps extends Omit<AgentPreviewProps, "reveal"> {
  ready: ReadyItem[];
}

/**
 * The agent card's contents, worked out from the draft: the props every copy of the card
 * on the page takes, and the ready count the page quotes beside it. One place for both
 * pages, so the card over a saved agent is the card the builder shows.
 *
 * Readiness is always `validateDraft` on the draft, whichever page asks: a saved agent
 * that could not be created as it stands (no key that works) reads as not ready on its
 * card, although a save of anything else would still go through.
 */
export function useAgentCard({
  draft,
  keys,
  sources,
  payPerUseAllowed,
  feeBps,
  quietKey,
  currentStep,
  onGo,
  disabled,
  edit,
}: {
  draft: BuilderDraft;
  keys: LlmKeyRow[];
  sources: DataSourceInfo[];
  payPerUseAllowed: boolean;
  feeBps: number;
  /**
   * Changes when the whole draft was swapped rather than edited (a saved draft restored,
   * Start over, a save, a discard). The rows then change without their tint.
   */
  quietKey: unknown;
  /** The step that is open: the card marks the rows edited there. */
  currentStep: string;
  onGo: (place: CardPlace) => void;
  /** While a create or a save is in flight: nothing on the card goes anywhere. */
  disabled: boolean;
  /** Set only over a saved agent: the card then states what is true of it now, not a plan. */
  edit?: SummaryEdit;
}): {
  previewProps: AgentCardProps;
  /** The three "Yours to decide" rows of the draft as it is this instant. */
  ready: ReadyItem[];
  readyCount: number;
  /** The draft the card is showing, which trails the real one while the user types. */
  cardDraft: BuilderDraft;
  /** The one line that speaks the ready count; empty until the count first moves. */
  announcement: string;
} {
  const errors = useMemo(
    () => validateDraft(draft, keys, { payPerUseAllowed }),
    [draft, keys, payPerUseAllowed],
  );
  const ready = readyItems(draft, errors, keys, { payPerUseAllowed });
  const readyCount = ready.filter((item) => item.ready).length;
  // The one line that speaks the ready count, whichever copies of the agent card are on
  // screen. Spoken only when the count moves, and empty until it first does.
  const [counted, setCounted] = useState(readyCount);
  const [announcement, setAnnouncement] = useState("");
  if (counted !== readyCount) {
    setCounted(readyCount);
    setAnnouncement(`${readyCount} of ${ready.length} ready`);
  }

  // The agent card reads a deferred copy of the draft, so typing in an 8,000-character
  // prompt never waits on it. Derived, never stored: no effect and no second draft.
  const cardDraft = useDeferredValue(draft);
  // Deferred with it, so the card learns that the draft was swapped whole (restored,
  // started over, undone) in the same render as its rows change.
  const cardQuietKey = useDeferredValue(quietKey);
  // What the summaries are told about a saved agent, by value: the page makes a new
  // object of it on every render, and the card must not be worked out again for that.
  const editMode = edit?.mode;
  const editStatus = edit?.status;
  const editBalance = edit?.balanceText;
  const card = useMemo(() => {
    const saved: SummaryEdit | undefined =
      editMode !== undefined && editStatus !== undefined && editBalance !== undefined
        ? { mode: editMode, status: editStatus, balanceText: editBalance }
        : undefined;
    const cardErrors = validateDraft(cardDraft, keys, { payPerUseAllowed });
    const cardFacts = costFacts(cardDraft, sources, { payPerUseAllowed, feeBps });
    return {
      ready: readyItems(cardDraft, cardErrors, keys, { payPerUseAllowed }),
      rows: previewRows(cardDraft, cardFacts, cardErrors, {
        hunts: universeSummary(cardDraft.config.universe as AgentConfig["universe"], cardDraft.config.chains),
        labels: SUMMARY_LABELS,
        payPerUseAllowed,
        edit: saved,
      }),
      costs: costLines(cardDraft, cardFacts, saved),
      runLine: runLine(cardDraft.config),
      // No figure on a manual schedule, or while a funded agent waits for the checklist:
      // the Runs line then stands as text.
      runsPerDay:
        cardFacts.intervalMinutes === 0 || cardFacts.heldForLive
          ? null
          : (cardFacts.thinking?.runsPerDay ?? cardFacts.runsPerDay),
    };
  }, [cardDraft, keys, sources, payPerUseAllowed, feeBps, editMode, editStatus, editBalance]);

  return {
    previewProps: {
      draft: cardDraft,
      ready: card.ready,
      rows: card.rows,
      costs: card.costs,
      runLine: card.runLine,
      runsPerDay: card.runsPerDay,
      onGo,
      currentStep,
      quietKey: cardQuietKey,
      disabled,
    },
    ready,
    readyCount,
    cardDraft,
    announcement,
  };
}
