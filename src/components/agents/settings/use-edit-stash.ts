"use client";

import { useEffect, useRef } from "react";
import { toast } from "sonner";

/** How long the offer to restore stays up. */
const OFFER_MS = 10_000;

/** Unsaved edits to one agent, and the saved copy they were made from. */
export interface EditStash<T> {
  base: T;
  working: T;
}

/**
 * The stashes, in the page's memory and nowhere else.
 *
 * A stash holds an agent's whole config, saved and edited, and the strategy prompt in it
 * is its owner's alone. Written to the browser's storage it could outlast a sign-out made
 * from another tab, and be read by whoever opened this tab next. Held here it is gone with
 * a reload or a closed tab, which are the ways out the browser itself asks about, and it
 * lasts through the one it is for: leaving the page and coming back inside the app.
 *
 * One for each owner and agent, so a stash is only ever handed to the account that left
 * it, on the agent it was left on.
 */
const stashes = new Map<string, EditStash<unknown>>();

/** Two ids as one key. Written as a list, so neither id can run into the other. */
const keyOf = (ownerId: string, agentId: string) => JSON.stringify([ownerId, agentId]);

/**
 * Whether a page that goes away may keep its unsaved edits. A sign-out turns this off: the
 * settings page that is open then leaves with the account, a moment after the stashes
 * were removed, and must not keep a new one on its way out. The next settings page to
 * open turns it on again.
 */
let keeping = true;

/** A settings page has opened, which it only does for a signed-in owner: edits may be kept again. */
export function resumeKeeping(): void {
  keeping = true;
}

/** Keep an owner's unsaved edits to an agent, in place of any kept before. */
export function keepStash<T>(ownerId: string, agentId: string, stash: EditStash<T>): void {
  if (!keeping) return;
  stashes.set(keyOf(ownerId, agentId), { base: stash.base, working: stash.working });
}

/**
 * The stash kept for this owner and this agent, or null. It is removed as it is taken, so
 * it is offered once and anything but a press on Restore ends it.
 */
export function takeStash<T>(ownerId: string, agentId: string): EditStash<T> | null {
  const key = keyOf(ownerId, agentId);
  const stash = stashes.get(key) as EditStash<T> | undefined;
  stashes.delete(key);
  return stash ?? null;
}

export function dropStash(ownerId: string, agentId: string): void {
  stashes.delete(keyOf(ownerId, agentId));
}

/**
 * The copy to offer back, or null. A stash is worth offering only when it was made from
 * what is saved now and still differs from it: an agent changed somewhere else since has
 * a base that no longer matches, and edits that were saved after all differ in nothing.
 */
export function offerFrom<T>(stash: EditStash<T> | null, saved: T, same: (a: T, b: T) => boolean): T | null {
  if (!stash) return null;
  try {
    return same(stash.base, saved) && !same(stash.working, saved) ? stash.working : null;
  } catch {
    // The two could not be compared, so there is nothing safe to offer.
    return null;
  }
}

/**
 * Forget every stash, whoever left it. A stash holds a strategy prompt, which is its
 * owner's, so signing out must not leave one behind for whoever uses the tab next.
 */
export function clearEditStashes(): void {
  keeping = false;
  stashes.clear();
}

export interface EditStashOptions<T> {
  /** The agent's owner, who is the one editing it. A stash is never offered to anyone else. */
  ownerId: string;
  /** The saved agent. One stash is kept for each. */
  agentId: string;
  /** Its saved name, for the offer. */
  agentName: string;
  /** The working copy. It is held as it is, so it must never be changed in place. */
  working: T;
  /** What is saved now, which is what the working copy was made from. */
  base: T;
  /** True when two copies would save the same thing. */
  same: (a: T, b: T) => boolean;
  /** Goes up each time the owner changes the working copy. The offer is withdrawn the first time it does. */
  edits: number;
  /**
   * Puts an offered copy back as the working copy, unless something was changed after the
   * offer went up: `since` is `edits` as it was then. Nothing is saved by it.
   */
  onRestore: (copy: T, since: number) => void;
}

/**
 * Keeps unsaved edits through a way out of the page that cannot be asked about.
 *
 * A link and a closing tab are prompted (`useUnsavedGuard`), but the browser's Back button
 * is a history move, and a page has no way to refuse one. So the edits are kept instead:
 * when the page goes away inside the app with something unsaved, the working copy is held
 * in memory with the saved copy it was made from. On the owner's next arrival at this
 * agent's settings a toast offers them back, once. Restore puts them in the working copy
 * and saves nothing.
 *
 * The stash is removed as it is read, so anything but a press on Restore ends it. It is
 * not offered when the agent was changed since, and a page that goes away with nothing
 * unsaved (after a save, after Discard) leaves none. Nothing is written to the browser's
 * storage: a reload or a closed tab ends a stash, and so does signing out.
 *
 * The offer stands only until the owner edits something. Restore puts a whole copy back,
 * so after an edit it would take that edit away; the toast goes at the first one instead,
 * and the edits it offered go with it, as they do when it is left unpressed.
 */
export function useEditStash<T>({
  ownerId,
  agentId,
  agentName,
  working,
  base,
  same,
  edits,
  onRestore,
}: EditStashOptions<T>): void {
  // What the toast and the page's leaving read: the copies as they are when Restore is
  // pressed or the page goes away, without any of them being a reason to run again.
  const latest = useRef({ agentName, working, base, same, edits, onRestore });
  useEffect(() => {
    latest.current = { agentName, working, base, same, edits, onRestore };
  }, [agentName, working, base, same, edits, onRestore]);

  /** Whose stash, on which agent, has been read. A ref, so React's development double mount reads it once. */
  const readFor = useRef<string | null>(null);
  const mounted = useRef(false);
  /** The offer on screen, if any, and `edits` as it was when it went up. */
  const offer = useRef<{ id: string | number; since: number } | null>(null);

  useEffect(() => {
    const key = keyOf(ownerId, agentId);
    mounted.current = true;
    resumeKeeping();
    if (readFor.current !== key) {
      readFor.current = key;
      offer.current = null;
      const stash = takeStash<T>(ownerId, agentId);
      const copy = offerFrom(stash, latest.current.base, latest.current.same);
      if (stash !== null && copy !== null) {
        const since = latest.current.edits;
        const id = toast(`You left unsaved changes to ${latest.current.agentName}`, {
          duration: OFFER_MS,
          action: {
            label: "Restore",
            onClick: () => {
              const now = latest.current;
              // Only onto what they were made from. Something saved in the seconds since
              // the offer went up would otherwise be quietly put back by the next Save.
              if (readFor.current !== key || offerFrom(stash, now.base, now.same) === null) return;
              now.onRestore(copy, since);
            },
          },
        });
        offer.current = { id, since };
      }
    }
    return () => {
      mounted.current = false;
      const pending = offer.current;
      if (pending === null) return;
      // An offer nobody pressed goes with the page: its button would restore into nothing.
      // Decided a moment later, because React's development double mount runs this and
      // mounts again at once, and the offer must outlive that.
      window.setTimeout(() => {
        if (mounted.current && readFor.current === key) return;
        toast.dismiss(pending.id);
      }, 0);
    };
  }, [ownerId, agentId]);

  // The first edit takes the offer down. `onRestore` refuses a press that gets in before
  // this does.
  useEffect(() => {
    const up = offer.current;
    if (up === null || up.since === edits) return;
    offer.current = null;
    toast.dismiss(up.id);
  }, [edits]);

  useEffect(() => {
    return () => {
      // The page going away inside the app: a link, or the Back button, which is the one
      // that cannot be asked about. A reload and a closing tab take the memory with them.
      const { working: copy, base: saved, same: equal } = latest.current;
      let unsaved = false;
      try {
        unsaved = !equal(copy, saved);
      } catch {
        // Not comparable, so not worth keeping.
      }
      if (unsaved) keepStash(ownerId, agentId, { base: saved, working: copy });
      else dropStash(ownerId, agentId);
    };
  }, [ownerId, agentId]);
}
