"use client";

import { useCallback, useMemo, useReducer, useState } from "react";
import type { BuilderDraft } from "@/components/agents/builder/types";
import type { AgentConfig } from "@/db/schema";
import type { AgentDetail, LlmKeyRow } from "@/server/types";
import {
  draftOf,
  editReducer,
  savePayload,
  savedFrom,
  startEdit,
  withPaperBalance,
  type SavedAgent,
} from "./edit-model";

/** As much of the saved agent as its working copy is made from. */
type EditedAgent = Pick<
  AgentDetail,
  "name" | "tagline" | "avatarSeed" | "isPublic" | "llmKeyId" | "paperStartingUsd" | "status"
>;

export interface AgentEdit {
  /** What the steps show and a save sends. */
  working: BuilderDraft;
  /**
   * The agent as the server holds it, to compare the working copy with. Between a save
   * and the page catching up with it, that is what was sent, not what the page was last
   * handed, so nothing reads as unsaved under a "Saved" toast.
   */
  saved: SavedAgent;
  /** The same as a working copy: what Discard goes back to, and what unsaved edits are kept against. */
  savedDraft: BuilderDraft;
  /** The errors of the last refused save, less whatever has been edited since. */
  refused: Record<string, string> | null;
  /** Goes up each time the working copy is replaced whole, so the agent card does not tint every row. */
  quietKey: number;
  /** The account's keys, with any added on this page. */
  keys: LlmKeyRow[];
  update: (patch: Partial<BuilderDraft>) => void;
  updateConfig: (patch: Partial<BuilderDraft["config"]>) => void;
  addKey: (key: LlmKeyRow) => void;
  /** A save was refused before it was sent: `errors` is what `validateEdit` found. */
  refuse: (errors: Record<string, string>) => void;
  /** This page's save went through. `sent` is the working copy the payload was built from. */
  markSaved: (sent: BuilderDraft) => void;
  /** Back to what is saved. Returns the copy that was discarded, for an Undo. */
  discard: () => BuilderDraft;
  /**
   * Goes up each time the owner changes the working copy. An offer to put a copy back
   * notes it, and is withdrawn once it has moved.
   */
  edits: number;
  /**
   * Put a copy back as the working copy, unless the owner has changed something since it
   * was offered: `since` is `edits` as it was then. Nothing is saved by it.
   */
  restore: (copy: BuilderDraft, since: number) => void;
}

/**
 * The working copy of an agent's settings page: the saved agent as a draft, edited by the
 * steps and sent by Save.
 *
 * The page is rendered again under it all the time. Pausing the agent, the Fund sheet, a
 * wallet budget, Back to paper, a withdrawal and coming back to the tab each refresh the
 * page, and every refresh hands it the saved agent anew. None of those may touch an edit
 * in progress, so the saved agent is never copied into the working copy as it arrives. It
 * is only compared with: which steps read "Changed" always answers against what the
 * server holds now.
 *
 * The working copy is replaced whole three times only: when this page's own save comes
 * back (taking the server's value for everything not typed since), on Discard, and when
 * a copy is put back (an Undo, or edits kept from an earlier visit). Those rules are
 * `editReducer`, tested without a browser; this holds its state and tells it when the
 * page was handed the agent again.
 *
 * The list of keys grows when one is added on the page and is never reset.
 *
 * `paperBalanceOpen` is the server's answer on whether the paper starting balance can
 * still be changed. Once it cannot, the working copy handed out carries the saved balance
 * whatever was typed while it could (`withPaperBalance`).
 */
export function useAgentEdit(
  agent: EditedAgent,
  config: AgentConfig,
  initialKeys: LlmKeyRow[],
  paperBalanceOpen = false,
): AgentEdit {
  // One object for each time the page is handed the agent, so that is what a change of it means.
  const told = useMemo(() => draftOf(agent, config), [agent, config]);
  const [state, dispatch] = useReducer(editReducer, told, startEdit);
  // During render, not in an effect: a save's answer then replaces the working copy in the
  // same paint as the page shows the saved agent, and no frame shows one without the other.
  if (told !== state.saved) dispatch({ type: "propsChanged", saved: told });

  const [keys, setKeys] = useState(initialKeys);

  const { pending } = state;
  const saved = useMemo<SavedAgent>(() => {
    const asTold: SavedAgent = {
      name: agent.name,
      tagline: agent.tagline,
      avatarSeed: agent.avatarSeed,
      isPublic: agent.isPublic,
      llmKeyId: agent.llmKeyId,
      paperStartingUsd: agent.paperStartingUsd,
      config,
    };
    if (pending === null) return asTold;
    // A save's answer is still on its way, and the page's copy is from before it. The
    // picture is the one thing a save may leave out: it is then whatever it was.
    return {
      ...savedFrom(pending.sent),
      avatarSeed: savePayload(pending.sent, asTold).avatarSeed ?? asTold.avatarSeed,
    };
  }, [agent, config, pending]);

  const update = useCallback((patch: Partial<BuilderDraft>) => dispatch({ type: "edit", patch }), []);
  const updateConfig = useCallback(
    (patch: Partial<BuilderDraft["config"]>) => dispatch({ type: "edit", config: patch }),
    [],
  );
  const addKey = useCallback((key: LlmKeyRow) => setKeys((current) => [key, ...current]), []);
  const refuse = useCallback((errors: Record<string, string>) => dispatch({ type: "refused", errors }), []);
  const markSaved = useCallback((sent: BuilderDraft) => dispatch({ type: "saved", sent }), []);
  const restore = useCallback(
    (copy: BuilderDraft, since: number) => dispatch({ type: "restore", draft: copy, since }),
    [],
  );
  // The copy every reader is given: the one being edited, less a balance edit that can no
  // longer be saved.
  const working = useMemo(
    () => withPaperBalance(state.working, saved.paperStartingUsd, paperBalanceOpen),
    [state.working, saved.paperStartingUsd, paperBalanceOpen],
  );
  const discard = () => {
    const discarded = working;
    dispatch({ type: "discard" });
    return discarded;
  };

  return {
    working,
    saved,
    savedDraft: pending ? pending.sent : state.saved,
    refused: state.refused,
    quietKey: state.quietKey,
    edits: state.edits,
    keys,
    update,
    updateConfig,
    addKey,
    refuse,
    markSaved,
    discard,
    restore,
  };
}
