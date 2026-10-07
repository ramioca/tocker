"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * Marks its block for a one-time entrance drawn in CSS. On hydration, a block still
 * below the fold (with motion allowed) gets `data-armed`, which CSS reads as "hold the
 * start state"; the first time it is 35% on screen it gets `data-seen`, and CSS plays
 * the entrance (a sparkline drawing in by stroke-dashoffset, a meter filling). Without
 * script, under reduced motion, or already on screen, it is never armed and the
 * finished state is what paints.
 */
export function InView({ className, children }: { className?: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || !window.matchMedia("(prefers-reduced-motion: no-preference)").matches) return;
    const box = el.getBoundingClientRect();
    if (box.top < window.innerHeight && box.bottom > 0) return;
    el.dataset.armed = "true";
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        io.disconnect();
        el.dataset.seen = "true";
      },
      { threshold: 0.35 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
