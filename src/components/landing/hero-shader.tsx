"use client";

/**
 * The hero backdrop.
 *
 * Two layers, always in this order:
 *
 *  1. A CSS fallback — dark ground, a violet ink-flow bloom, a particle-grid texture and
 *     grain. It paints on first render, on every device, and it never goes away. It is the
 *     design, not a placeholder.
 *  2. The WebGPU shader, composited over it with `mix-blend-mode: screen` and faded in
 *     when the renderer reports its first frame. Screen blending is deliberate: the
 *     composition's ground is #161617, so anywhere the shader is dark the fallback shows
 *     through unchanged and the ink only ever *adds* light. There is no frame in which the
 *     hero is a black rectangle.
 *
 * The shader is skipped entirely — and its ~35MB chunk never requested — when:
 *   - `NEXT_PUBLIC_SHADER=off`,
 *   - the browser has no `navigator.gpu` (the engine is WebGPU-only: no WebGL2 path),
 *   - the visitor asks for reduced motion (checked live, so toggling it mid-session stops it),
 *   - or the GPU turns out to be unusable anyway (`onUnavailable`).
 *
 * While it is running it is throttled: the stage unmounts after the hero has been off
 * screen or the tab in the background for a while, and on phones / low-core machines it
 * gets fewer particles and a smaller backing store.
 */

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { cn } from "cn";

/** One flag removes the shader from the product — the licence makes that a requirement. */
const SHADER_OFF = process.env.NEXT_PUBLIC_SHADER === "off";

/** Loaded only when it is rendered, which only happens after the checks below pass. */
const HeroShaderStage = dynamic(
  () => import("./hero-shader-stage").then((m) => m.HeroShaderStage),
  { ssr: false, loading: () => null },
);

type Plan = {
  /** Particles in the field. 40k is the design value; phones cannot hold that frame rate. */
  count: number;
  /**
   * Backing-store divisor. The engine caps DPR itself (2 on desktop, 1.5 on phones) and
   * exposes no knob under that, so the extra cap is applied in layout: lay the stage out
   * at 1/scale of the hero and scale it back up. The resize observer reads `contentBoxSize`,
   * which is pre-transform, so this is a real reduction in pixels rendered.
   */
  scale: number;
};

/** How long the hero must be unwatched before the GPU work is torn down. */
const IDLE_TEARDOWN_MS = 15_000;

function planForDevice(): Plan {
  const cores = navigator.hardwareConcurrency || 4;
  const narrow = window.innerWidth < 768;
  const dpr = window.devicePixelRatio || 1;
  return {
    count: narrow ? 10_000 : cores <= 6 ? 20_000 : 40_000,
    scale: narrow || cores <= 4 ? 1.5 : dpr > 2 ? 1.25 : 1,
  };
}

/** Run `fn` when the browser is idle, so the chunk fetch never competes with first paint. */
function whenIdle(fn: () => void): () => void {
  if (typeof window.requestIdleCallback === "function") {
    const id = window.requestIdleCallback(fn, { timeout: 2_500 });
    return () => window.cancelIdleCallback(id);
  }
  const id = window.setTimeout(fn, 800);
  return () => window.clearTimeout(id);
}

export function HeroShader({ className }: { className?: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [active, setActive] = useState(false);
  const [ready, setReady] = useState(false);

  // 1. Decide whether this visitor gets a shader at all. Both tests happen BEFORE the
  //    import, so a browser that cannot run it downloads nothing: first `navigator.gpu`,
  //    then an actual adapter request — the API exists in plenty of places that cannot
  //    grant an adapter (headless, VMs, blocklisted drivers), and those would otherwise
  //    pull 35MB to render nothing. Requesting an adapter is cheap, creates no device,
  //    and browsers memoize it.
  useEffect(() => {
    if (SHADER_OFF || !("gpu" in navigator)) return;

    const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
    if (!gpu) return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let cancelled = false;
    let hasAdapter: boolean | null = null;

    const decide = () => {
      if (cancelled) return;
      if (reduceMotion.matches) {
        setPlan(null);
        return;
      }
      if (hasAdapter === null) {
        void gpu
          .requestAdapter()
          .then((adapter) => {
            hasAdapter = adapter != null;
          })
          .catch(() => {
            hasAdapter = false;
          })
          .finally(decide);
        return;
      }
      setPlan(hasAdapter ? planForDevice() : null);
    };

    const cancelIdle = whenIdle(decide);
    reduceMotion.addEventListener("change", decide);
    return () => {
      cancelled = true;
      cancelIdle();
      reduceMotion.removeEventListener("change", decide);
    };
  }, []);

  // 2. Only render while someone could actually be looking at it. The engine pauses its
  //    own animation loop off screen; this goes further and releases the device, but only
  //    after a delay, so scrolling past and back does not thrash the GPU.
  useEffect(() => {
    const host = hostRef.current;
    if (!plan || !host) return;

    let onScreen = true;
    let tabVisible = document.visibilityState === "visible";
    let teardown: number | undefined;

    const sync = () => {
      if (onScreen && tabVisible) {
        if (teardown !== undefined) {
          window.clearTimeout(teardown);
          teardown = undefined;
        }
        setActive(true);
      } else if (teardown === undefined) {
        teardown = window.setTimeout(() => {
          teardown = undefined;
          setActive(false);
          setReady(false);
        }, IDLE_TEARDOWN_MS);
      }
    };

    const observer = new IntersectionObserver(
      ([entry]) => {
        onScreen = entry.isIntersecting;
        sync();
      },
      { rootMargin: "200px" },
    );
    observer.observe(host);

    const onVisibility = () => {
      tabVisible = document.visibilityState === "visible";
      sync();
    };
    document.addEventListener("visibilitychange", onVisibility);
    sync();

    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      if (teardown !== undefined) window.clearTimeout(teardown);
    };
  }, [plan]);

  const onReady = useCallback(() => setReady(true), []);
  const onUnavailable = useCallback(() => {
    // A GPU that cannot run this will not start running it later. Stop, keep the fallback.
    setPlan(null);
    setActive(false);
    setReady(false);
  }, []);

  return (
    <div ref={hostRef} className={cn("lp-shader-host", className)} aria-hidden>
      <div className="lp-shader-fallback" />
      {plan && active ? (
        <div className="lp-shader-layer" data-ready={ready ? "true" : "false"}>
          <div
            className="lp-shader-scale"
            style={{ "--lp-shader-scale": plan.scale } as CSSProperties}
          >
            <HeroShaderStage count={plan.count} onReady={onReady} onUnavailable={onUnavailable} />
          </div>
        </div>
      ) : null}
      <div className="lp-shader-scrim" />
    </div>
  );
}
