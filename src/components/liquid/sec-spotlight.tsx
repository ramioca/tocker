"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * A grid whose cards' borders light up under the cursor. One pointermove listener on
 * the grid, throttled to one write per animation frame, sets `--x`/`--y` on each
 * `.lpg-cell` (the pointer in that card's own coordinates) and `data-hot` on the grid;
 * the light itself is a masked radial gradient in CSS. No React state changes per
 * frame. Fine pointers only: on touch nothing is attached and the borders stay plain.
 */
export function SpotlightGrid({ className, label, children }: { className?: string; label?: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = ref.current;
    if (!root || !window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    const cells = () => Array.from(root.querySelectorAll<HTMLElement>(".lpg-cell"));
    let frame = 0;
    let px = 0;
    let py = 0;

    const paint = () => {
      frame = 0;
      for (const cell of cells()) {
        const box = cell.getBoundingClientRect();
        cell.style.setProperty("--x", `${(px - box.left).toFixed(1)}px`);
        cell.style.setProperty("--y", `${(py - box.top).toFixed(1)}px`);
      }
    };
    const move = (e: PointerEvent) => {
      if (e.pointerType !== "mouse" && e.pointerType !== "pen") return;
      px = e.clientX;
      py = e.clientY;
      root.dataset.hot = "true";
      if (!frame) frame = requestAnimationFrame(paint);
    };
    const leave = () => {
      delete root.dataset.hot;
    };

    root.addEventListener("pointermove", move, { passive: true });
    root.addEventListener("pointerleave", leave);
    return () => {
      root.removeEventListener("pointermove", move);
      root.removeEventListener("pointerleave", leave);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div ref={ref} className={className} role={label ? "group" : undefined} aria-label={label}>
      {children}
    </div>
  );
}
