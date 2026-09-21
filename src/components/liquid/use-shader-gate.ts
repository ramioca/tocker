"use client";

import { useCallback, useState, useSyncExternalStore } from "react";

/**
 * Whether a Paper Shaders canvas should mount at all.
 *
 * The two shader pieces are WebGPU-only, so where the API does not exist
 * (iOS before 26, Firefox, older Chrome) there is nothing to draw and the
 * section keeps its static art. Everywhere else — phones included — the
 * shader mounts; touch input is bridged into its mouse drivers by the shader
 * components themselves (see synthetic-pointer.ts). The gate decides once
 * after hydration, and honours `<Shader onUnavailable>` when the renderer
 * gives up on a device that advertised WebGPU but cannot provide an adapter.
 *
 *   unknown  → SSR and the hydration pass: static art shown
 *   loading  → WebGPU present, shader chunk mounting: art stays underneath
 *   on       → the renderer is ready and drawing
 *   off      → no WebGPU, reduced motion, data saver, or the renderer gave up
 */
export type ShaderState = "unknown" | "loading" | "on" | "off";

let capability: "loading" | "off" | null = null;

/** Computed once per page; the snapshot must be referentially stable. */
function getClientSnapshot(): "loading" | "off" {
  if (capability === null) {
    const nav = navigator as Navigator & { connection?: { saveData?: boolean } };
    const capable =
      "gpu" in navigator &&
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
