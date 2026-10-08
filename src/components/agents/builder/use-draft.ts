"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AVATAR_SEEDS, emptyDraft, restoreDraft, withDefaultKey, type BuilderDraft } from "./types";
import type { LlmKeyRow } from "@/server/types";

// v2: the allowlist became a universe. A v1 draft cannot be migrated honestly
// — it has no discovery feeds and no bar — so it is simply not restored.
const STORAGE_PREFIX = "tocker:agent-builder-draft:v2";

/**
 * The draft holds a strategy prompt, which is the operator's IP. It is keyed by user so
 * a second account on the same browser never gets the first one's strategy pre-filled,
 * and every key under the prefix is wiped on sign-out (`clearAllDrafts`).
 */
function storageKey(userId: string): string {
  return `${STORAGE_PREFIX}:${userId}`;
}

/** Remove every saved builder draft on this browser, including the old unscoped one. */
export function clearAllDrafts(): void {
  try {
    const doomed: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (key?.startsWith(STORAGE_PREFIX)) doomed.push(key);
    }
    for (const key of doomed) window.localStorage.removeItem(key);
  } catch {
    // Storage unavailable: nothing was persisted either.
  }
}

/**
 * The builder is seven steps long and people close tabs. The draft is restored
 * on mount and written back on every change the user makes, debounced so typing
 * in the strategy textarea does not hammer localStorage.
 *
 * `keys` are the account's LLM keys. A fresh, restored or cleared draft starts on one of
 * them (`withDefaultKey`), so the key someone saved a minute ago in onboarding is already
 * chosen. That is state set here, not an edit: it never marks the draft as touched, so
 * an untouched form is still not saved.
 *
 * `payPerUseAllowed` is the server's answer for this viewer. A draft saved in pay-per-use
 * mode is restored as one only while it is true (`withDefaultKey`).
 */
export function useDraft(userId: string, keys: readonly LlmKeyRow[] = [], payPerUseAllowed = false) {
  const draftKey = storageKey(userId);
  // The keys come with the server render, so the first paint already shows the choice
  // and matches on hydration.
  const [draft, setDraft] = useState<BuilderDraft>(() => withDefaultKey(emptyDraft(), keys, { payPerUseAllowed }));
  const [restored, setRestored] = useState(false);
  const timer = useRef<number | null>(null);
  // The restore below runs once and `clear` is called from handlers; both want the keys
  // as they are at that moment (one may have been added in the form), without the list
  // being a reason to run the restore again.
  const keysRef = useRef(keys);
  useEffect(() => {
    keysRef.current = keys;
  }, [keys]);
  // The same for the server's answer about pay-per-use: read at the moment of a restore
  // or a clear, never a reason to restore again.
  const allowedRef = useRef(payPerUseAllowed);
  useEffect(() => {
    allowedRef.current = payPerUseAllowed;
  }, [payPerUseAllowed]);
  /**
   * Only an edit makes a draft. Without this, the mount itself (and the random avatar
   * it picks) was saved, so the next visit offered to "Start over" a form nobody had
   * touched.
   */
  const touched = useRef(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(draftKey);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<BuilderDraft>;
        // localStorage cannot be read during SSR, so restoring a saved draft is
        // necessarily a post-mount effect.
        setDraft((current) =>
          // A saved draft can name a key that has since been removed, or none at all.
          // Laid over the starting draft key by key (`restoreDraft`), so a setting the
          // saved draft predates comes back as its default and not as a hole.
          withDefaultKey(restoreDraft(current, parsed), keysRef.current, { payPerUseAllowed: allowedRef.current }),
        );
        setRestored(true);
      } else {
        // Vary the starting avatar, but only after hydration — a random value in
        // the initial state would not match what the server rendered.
        setDraft((current) => ({
          ...current,
          avatarSeed: AVATAR_SEEDS[Math.floor(Math.random() * AVATAR_SEEDS.length)],
        }));
      }
    } catch {
      // A corrupt draft is not worth a broken page.
    }
  }, [draftKey]);

  useEffect(() => {
    if (timer.current) window.clearTimeout(timer.current);
    if (!touched.current) return;
    timer.current = window.setTimeout(() => {
      try {
        window.localStorage.setItem(draftKey, JSON.stringify(draft));
      } catch {
        // Private mode / quota — the form still works, it just will not persist.
      }
    }, 400);
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [draft, draftKey]);

  const update = useCallback((patch: Partial<BuilderDraft>) => {
    touched.current = true;
    setDraft((current) => ({ ...current, ...patch }));
  }, []);

  const updateConfig = useCallback((patch: Partial<BuilderDraft["config"]>) => {
    touched.current = true;
    setDraft((current) => ({ ...current, config: { ...current.config, ...patch } }));
  }, []);

  const clear = useCallback(() => {
    touched.current = false;
    if (timer.current) window.clearTimeout(timer.current);
    try {
      window.localStorage.removeItem(draftKey);
    } catch {
      // ignore
    }
    setDraft(withDefaultKey(emptyDraft(), keysRef.current, { payPerUseAllowed: allowedRef.current }));
    // Nothing is restored any more, so "Start over" has nothing left to undo.
    setRestored(false);
  }, [draftKey]);

  /**
   * Put back a draft that "Start over" just cleared — its Undo. Written straight to
   * storage rather than waiting for the debounce, so a reload right after the Undo
   * still finds it.
   */
  const restore = useCallback(
    (previous: BuilderDraft) => {
      touched.current = true;
      setDraft(previous);
      try {
        window.localStorage.setItem(draftKey, JSON.stringify(previous));
      } catch {
        // Private mode / quota — the form still has it, it just will not persist.
      }
      setRestored(true);
    },
    [draftKey],
  );

  return { draft, setDraft, update, updateConfig, clear, restore, restored };
}
