"use client";

import { useEffect, useState } from "react";
import { useHydratedReducedMotion } from "@/components/spectrumui/use-hydrated-reduced-motion";
import { readSilkEnv, shouldLoadSilk } from "./login-silk-gate";

type Canvas = typeof import("@/components/liquid/hero-shader-canvas").default;

/**
 * The landing's silk behind the sign-in card: the same canvas module, so the colours
 * and the tuning are defined once and a visitor arriving from the landing already has
 * the chunk.
 *
 * It never stands between the visitor and the form:
 * - nothing renders until the library has loaded, and it loads only after the page is
 *   idle, so the card and the painted poster under it are on screen first;
 * - it loads only where `shouldLoadSilk` says so (login-silk-gate.ts); everyone else
 *   keeps the poster, which is the same composition, still;
 * - a plain `import()` in an effect, so a device the gate turns away never fetches it;
 * - the canvas fades in over the poster once it has drawn its first frame (auth.css).
 */
export function LoginSilk() {
  const reduced = Boolean(useHydratedReducedMotion());
  const [lib, setLib] = useState<{ Canvas: Canvas; interactive: boolean } | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!shouldLoadSilk(readSilkEnv(reduced))) return;
    let cancelled = false;
    const load = () => {
      import("@/components/liquid/hero-shader-canvas")
        .then((m) => {
          if (cancelled) return;
          // With a mouse the silk gives under the cursor; on touch it only flows.
          const interactive = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
          setLib({ Canvas: m.default, interactive });
        })
        .catch(() => {
          if (!cancelled) setFailed(true);
        });
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
  const { Canvas, interactive } = lib;

  return (
    <div className="auth-bg-silk" data-ready={ready ? "" : undefined} aria-hidden>
      <Canvas interactive={interactive} onReady={() => setReady(true)} onUnavailable={() => setFailed(true)} />
    </div>
  );
}
