"use client";

import { useEffect, useState } from "react";
import { useSafeReducedMotion } from "./motion";

type Canvas = typeof import("./hero-shader-canvas").default;

/**
 * A slow aurora in the mark's colours behind the hero (Shaders, MIT, WebGPU).
 *
 * Kept off the critical path and out of the way:
 * - the library loads only after the page is idle, so it never delays the headline;
 * - it mounts only where WebGPU exists and motion is welcome; everyone else keeps
 *   the painted poster under it (hero.tsx, `.lp-hero-poster`), which the canvas
 *   crossfades over once it has drawn its first frame;
 * - the renderer stops drawing while the hero is off screen (the library's own
 *   IntersectionObserver), and the canvas is rendered at a low cap and faded in;
 * - telemetry is off.
 */
export function HeroShader() {
  const reduced = useSafeReducedMotion();
  const [lib, setLib] = useState<{ Canvas: Canvas } | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (reduced || !("gpu" in navigator)) return;
    let cancelled = false;
    const load = () => {
      import("./hero-shader-canvas")
        .then((m) => !cancelled && setLib({ Canvas: m.default }))
        .catch(() => !cancelled && setFailed(true));
    };
    const idle = window.requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 600));
    const cancelIdle = window.cancelIdleCallback ?? window.clearTimeout;
    const id = idle(load, { timeout: 2500 } as IdleRequestOptions);
    return () => {
      cancelled = true;
      cancelIdle(id as number);
    };
  }, [reduced]);

  if (!lib || failed || reduced) return null;
  const { Canvas } = lib;

  return (
    <div className="lp-hero-shader" data-ready={ready ? "" : undefined} aria-hidden>
      <Canvas onReady={() => setReady(true)} onUnavailable={() => setFailed(true)} />
    </div>
  );
}
