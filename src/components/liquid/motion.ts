"use client";

import { useSyncExternalStore } from "react";
import { useReducedMotion } from "motion/react";

const noop = () => () => {};

/**
 * `useReducedMotion`, but false until hydration has finished. The server cannot
 * know the visitor's motion preference, so reading it during the hydration pass
 * renders different markup on the client and React reports a mismatch. Waiting
 * one commit keeps both passes identical; the still state follows a frame later.
 */
export function useSafeReducedMotion(): boolean {
  const hydrated = useSyncExternalStore(noop, () => true, () => false);
  const reduced = useReducedMotion();
  return hydrated && Boolean(reduced);
}

function subscribeVisibility(cb: () => void) {
  document.addEventListener("visibilitychange", cb);
  return () => document.removeEventListener("visibilitychange", cb);
}

/** True while the tab is visible; periodic demos stop in a background tab. */
export function usePageVisible(): boolean {
  return useSyncExternalStore(
    subscribeVisibility,
    () => document.visibilityState === "visible",
    () => true,
  );
}
