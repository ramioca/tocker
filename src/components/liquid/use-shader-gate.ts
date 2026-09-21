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
 *
 * `reason` says why it is off (or what the renderer reported), for the
 * `?shaderdebug` overlay — see shader-debug.tsx.
 */
export type ShaderState = "unknown" | "loading" | "on" | "off";

type Capability = { state: "loading" | "off"; reason: string };
let capability: Capability | null = null;

/** Computed once per page; the snapshot must be referentially stable. */
function getClientSnapshot(): Capability {
  if (capability === null) {
    const nav = navigator as Navigator & { connection?: { saveData?: boolean } };
    const reasons: string[] = [];
    if (!("gpu" in navigator)) reasons.push("no-webgpu");
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) reasons.push("reduced-motion");
    if (nav.connection?.saveData) reasons.push("save-data");
    capability =
      reasons.length === 0 ? { state: "loading", reason: "" } : { state: "off", reason: reasons.join("+") };
  }
  return capability;
}
const SERVER: Capability = { state: "loading", reason: "" };
const getServerSnapshot = (): Capability => SERVER;
const subscribeNever = () => () => {};

export function useShaderGate() {
  // Server and hydration render as "unknown" (see below); the first client
  // render after hydration switches to the real capability without a state
  // update in an effect (and without a hydration mismatch).
  const cap = useSyncExternalStore(subscribeNever, getClientSnapshot, getServerSnapshot);
  const hydrated = useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  );
  const [outcome, setOutcome] = useState<{ state: "on" | "off"; reason: string } | null>(null);

  const ready = useCallback(
    () => setOutcome((o) => (o?.state === "off" ? o : { state: "on", reason: "" })),
    [],
  );
  const unavailable = useCallback(
    (reason?: unknown) => setOutcome({ state: "off", reason: typeof reason === "string" ? reason : "unavailable" }),
    [],
  );

  let state: ShaderState;
  let reason: string;
  if (!hydrated) {
    state = "unknown";
    reason = "";
  } else if (cap.state === "off") {
    state = "off";
    reason = cap.reason;
  } else if (outcome) {
    state = outcome.state;
    reason = outcome.reason;
  } else {
    state = "loading";
    reason = "";
  }
  return { state, reason, ready, unavailable };
}
