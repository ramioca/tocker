"use client";

import { useEffect, useState } from "react";
import { useSafeReducedMotion } from "./motion";

type Canvas = typeof import("./close-shader-canvas").default;

/** Same rule as the hero: data saver, little memory or few cores keep the painted glow. */
function lowEnd(): boolean {
  const nav = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
  if (nav.connection?.saveData) return true;
  if (nav.deviceMemory !== undefined && nav.deviceMemory < 4) return true;
  return nav.hardwareConcurrency !== undefined && nav.hardwareConcurrency < 4;
}

/**
 * A slow liquid silk behind the closing call to action (Shaders, WebGPU). It loads only
 * once the section comes near the viewport and the browser is idle, only where WebGPU
 * exists and motion is welcome, and fades in over the painted glow (`.lp-close-glow`),
 * which is all everyone else sees. The library pauses it off screen.
 */
export function CloseShader() {
  const reduced = useSafeReducedMotion();
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const [lib, setLib] = useState<{ Canvas: Canvas } | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!host || reduced || !("gpu" in navigator) || lowEnd()) return;
    let cancelled = false;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        io.disconnect();
        import("./close-shader-canvas")
          .then((m) => !cancelled && setLib({ Canvas: m.default }))
          .catch(() => !cancelled && setFailed(true));
      },
      { rootMargin: "600px 0px" },
    );
    io.observe(host);
    return () => {
      cancelled = true;
      io.disconnect();
    };
  }, [host, reduced]);

  const Canvas = lib && !failed && !reduced ? lib.Canvas : null;
  return (
    <div ref={setHost} className="lp-close-shader" data-ready={ready && Canvas ? "" : undefined} aria-hidden>
      {Canvas ? <Canvas
          interactive={window.matchMedia("(hover: hover) and (pointer: fine)").matches}
          onReady={() => setReady(true)}
          onUnavailable={() => setFailed(true)}
        /> : null}
    </div>
  );
}
