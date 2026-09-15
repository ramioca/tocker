"use client";

/**
 * The closing CTA's shader backdrop — the hero host's little sibling. Same gates in the
 * same order (kill switch, `navigator.gpu`, live reduced-motion, a real adapter probe
 * before any import), same visibility discipline (render only while the card could be
 * seen, tear down after it has been off screen a while). It skips the hero's particle
 * planning because a FlowingGradient has no count to budget, and it renders at the
 * card's own size, which is already small.
 *
 * Under the canvas there is nothing to fall back to on purpose: the card's own
 * near-black surface IS the no-GPU design, exactly like the hero's flat ground.
 */

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "cn";

const SHADER_OFF = process.env.NEXT_PUBLIC_SHADER === "off";

const CtaShaderStage = dynamic(() => import("./cta-shader-stage").then((m) => m.CtaShaderStage), {
  ssr: false,
  loading: () => null,
});

const IDLE_TEARDOWN_MS = 15_000;

export function CtaShader({ className }: { className?: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [usable, setUsable] = useState(false);
  const [active, setActive] = useState(false);
  const [ready, setReady] = useState(false);

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
        setUsable(false);
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
      setUsable(hasAdapter);
    };

    decide();
    reduceMotion.addEventListener("change", decide);
    return () => {
      cancelled = true;
      reduceMotion.removeEventListener("change", decide);
    };
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    if (!usable || !host) return;

    let onScreen = false;
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
  }, [usable]);

  const onReady = useCallback(() => setReady(true), []);
  const onUnavailable = useCallback(() => {
    setUsable(false);
    setActive(false);
    setReady(false);
  }, []);

  return (
    <div ref={hostRef} className={cn("lp-cta-shader", className)} aria-hidden>
      {usable && active ? (
        <div className="lp-cta-shader-layer" data-ready={ready ? "true" : "false"}>
          <CtaShaderStage onReady={onReady} onUnavailable={onUnavailable} />
          {/* Inside the layer, not beside it: the scrim exists only when a canvas
              does, so the no-GPU card is its plain self with no ghost panel. */}
          <div className="lp-cta-shader-scrim" />
        </div>
      ) : null}
    </div>
  );
}
