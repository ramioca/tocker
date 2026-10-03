"use client";

import { useSyncExternalStore } from "react";
import { useHydratedReducedMotion } from "@/components/spectrumui/use-hydrated-reduced-motion";

/**
 * `useReducedMotion`, but false until hydration has finished. The server cannot
 * know the visitor's motion preference, so reading it during the hydration pass
 * renders different markup on the client and React reports a mismatch. Waiting
 * one commit keeps both passes identical; the still state follows a frame later.
 *
 * The landing's name for Spectrum's `useHydratedReducedMotion` (one implementation,
 * so the page and the vendored components agree on the same frame), as a boolean.
 */
export function useSafeReducedMotion(): boolean {
  return Boolean(useHydratedReducedMotion());
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
