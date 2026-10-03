"use client";

import { useSyncExternalStore } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";
let query: MediaQueryList | null = null;
const reducedQuery = () => (query ??= window.matchMedia(QUERY));

function subscribe(onChange: () => void) {
  const q = reducedQuery();
  q.addEventListener("change", onChange);
  return () => q.removeEventListener("change", onChange);
}

/**
 * The visitor's reduced-motion preference, but false until hydration has finished.
 *
 * The server cannot know the preference, so a component that branches on it while
 * rendering (dropping `whileTap`, swapping an animation target) would produce different
 * markup on the client's hydration pass, and React logs a mismatch it never patches.
 * The server snapshot is false, so hydration renders the same markup; React then reads
 * the real preference and re-renders only if it differs, which is only for visitors who
 * ask for reduced motion (an always-true "hydrated" flag re-rendered every consumer,
 * synchronously, right after hydration). It follows the setting live, too.
 */
export function useHydratedReducedMotion(): boolean | null {
  return useSyncExternalStore(subscribe, () => reducedQuery().matches, () => false);
}
