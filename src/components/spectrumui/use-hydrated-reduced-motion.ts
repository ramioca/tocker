"use client";

import { useSyncExternalStore } from "react";
import { useReducedMotion } from "motion/react";

const noopSubscribe = () => () => {};

/**
 * `useReducedMotion`, but false until hydration has finished.
 *
 * The server cannot know the visitor's motion preference, so a component that
 * branches on it while rendering (dropping `whileTap`, swapping an animation
 * target) produces different markup on the client's hydration pass, and React
 * logs a mismatch it never patches. Reading the preference one commit later
 * keeps both passes identical; the reduced state follows on the next render.
 */
export function useHydratedReducedMotion(): boolean | null {
  const hydrated = useSyncExternalStore(noopSubscribe, () => true, () => false);
  const reduced = useReducedMotion();
  return hydrated ? reduced : false;
}
