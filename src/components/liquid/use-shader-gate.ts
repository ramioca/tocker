"use client";

import { useCallback, useState, useSyncExternalStore } from "react";
import { isWebGL2Available } from "./webgl/runner";

/**
 * Which renderer a shader section should use.
 *
 * The Paper Shaders pieces are WebGPU-only. Where WebGPU exists the shader
 * mounts (phones included; touch input is bridged into its mouse drivers by
 * the shader components themselves, see synthetic-pointer.ts). Where it does
 * not — iOS before 26, Firefox, older Chrome — the same effect is drawn by a
 * WebGL2 rendition (./webgl). Only with neither, or with reduced motion or a
 * data saver, does the section keep its static art. The gate decides once
 * after hydration and honours `<Shader onUnavailable>` when a renderer that
 * advertised itself cannot actually start.
 *
 *   unknown  → SSR and the hydration pass: static art shown
 *   loading  → WebGPU present, shader chunk mounting: art stays underneath
 *   on       → the WebGPU renderer is ready and drawing
 *   webgl    → no WebGPU; the WebGL2 rendition is mounted
 *   off      → nothing can draw, or the visitor asked for no motion
 *
 * `?forcewebgl` in the URL takes the WebGL path on a WebGPU device, for QA.
 * `reason` says why it is off (or what the renderer reported), for the
 * `?shaderdebug` overlay — see shader-debug.tsx.
 */
export type ShaderState = "unknown" | "loading" | "on" | "webgl" | "off";

type Capability = { state: "loading" | "webgl" | "off"; reason: string };
let capability: Capability | null = null;

/** Computed once per page; the snapshot must be referentially stable. */
function getClientSnapshot(): Capability {
  if (capability === null) {
    const nav = navigator as Navigator & { connection?: { saveData?: boolean } };
    const blockers: string[] = [];
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) blockers.push("reduced-motion");
    if (nav.connection?.saveData) blockers.push("save-data");
    const forceWebgl = /[?&]forcewebgl(?:[=&]|$)/.test(window.location.search);
    const hasGpu = "gpu" in navigator && !forceWebgl;
    if (blockers.length > 0) {
      capability = { state: "off", reason: blockers.join("+") };
    } else if (hasGpu) {
      capability = { state: "loading", reason: "" };
    } else if (isWebGL2Available()) {
      capability = { state: "webgl", reason: forceWebgl ? "forced" : "no-webgpu" };
    } else {
      capability = { state: "off", reason: "no-webgpu+no-webgl2" };
    }
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
    state = cap.state;
    reason = cap.reason;
  }
  return { state, reason, ready, unavailable };
}
