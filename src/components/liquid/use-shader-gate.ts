"use client";

import { useCallback, useState, useSyncExternalStore } from "react";

/**
 * Whether a Paper Shaders canvas should mount at all.
 *
 * The two shader pieces are WebGPU-only and every visual driver in them is
 * mouse-based, so on a phone (no fine pointer, and on iOS before 26 no WebGPU
 * either) the canvas paints nothing and the section reads as a black void.
 * The gate decides once after hydration — the server renders the static
 * fallback, which is also what stays when the renderer reports itself
 * unavailable or the visitor prefers reduced motion.
 *
 *   unknown  → SSR and the hydration pass: static fallback shown
 *   loading  → capable device, shader chunk mounting: fallback stays underneath
 *   on       → the renderer is ready and drawing
 *   off      → not capable, or the renderer gave up: fallback for good
 */
export type ShaderState = "unknown" | "loading" | "on" | "off";

let capability: "loading" | "off" | null = null;

/** Computed once per page; the snapshot must be referentially stable. */
function getClientSnapshot(): "loading" | "off" {
  if (capability === null) {
    const nav = navigator as Navigator & { connection?: { saveData?: boolean } };
    const capable =
      "gpu" in navigator &&
      !window.matchMedia("(pointer: coarse)").matches &&
      !window.matchMedia("(prefers-reduced-motion: reduce)").matches &&
      !nav.connection?.saveData;
    capability = capable ? "loading" : "off";
  }
  return capability;
}
const getServerSnapshot = (): "unknown" => "unknown";
const subscribeNever = () => () => {};

export function useShaderGate() {
  // Server and hydration render "unknown"; the first client render after
  // hydration switches to the real capability without a state update in an
  // effect (and without a hydration mismatch).
  const base = useSyncExternalStore(subscribeNever, getClientSnapshot, getServerSnapshot);
  const [outcome, setOutcome] = useState<"on" | "off" | null>(null);

  const ready = useCallback(() => setOutcome((o) => (o === "off" ? o : "on")), []);
  const unavailable = useCallback(() => setOutcome("off"), []);

  const state: ShaderState = base === "off" ? "off" : (outcome ?? base);
  return { state, ready, unavailable };
}
