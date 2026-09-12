"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AVATAR_SEEDS, emptyDraft, type BuilderDraft } from "./types";

// v2: the allowlist became a universe. A v1 draft cannot be migrated honestly
// — it has no discovery feeds and no bar — so it is simply not restored.
const STORAGE_KEY = "petri:agent-builder-draft:v2";

/**
 * The builder is seven steps long and people close tabs. The draft is restored
 * on mount and written back on every change, debounced so typing in the
 * strategy textarea does not hammer localStorage.
 */
export function useDraft() {
  const [draft, setDraft] = useState<BuilderDraft>(emptyDraft);
  const [restored, setRestored] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<BuilderDraft>;
        // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage cannot be read during SSR, so restoring a saved draft is necessarily a post-mount effect
        setDraft((current) => ({
          ...current,
          ...parsed,
          config: {
            ...current.config,
            ...parsed.config,
            // The universe is nested, so a shallow spread would drop any key a
            // saved draft predates.
            universe: { ...current.config.universe, ...parsed.config?.universe },
          },
        }));
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
  }, []);

  useEffect(() => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
      } catch {
        // Private mode / quota — the form still works, it just will not persist.
      }
    }, 400);
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [draft]);

  const update = useCallback((patch: Partial<BuilderDraft>) => {
    setDraft((current) => ({ ...current, ...patch }));
  }, []);

  const updateConfig = useCallback((patch: Partial<BuilderDraft["config"]>) => {
    setDraft((current) => ({ ...current, config: { ...current.config, ...patch } }));
  }, []);

  const clear = useCallback(() => {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
    setDraft(emptyDraft());
  }, []);

  return { draft, setDraft, update, updateConfig, clear, restored };
}
