"use client";

import { useRef, type ReactNode } from "react";
import { gsap, MOTION_OK, useGSAP } from "./gsap";

/** How far the button may follow the cursor, in pixels, on either axis. */
const PULL_MAX = 8;
/** The share of the cursor's offset from centre the button follows. */
const PULL = 0.22;

/**
 * The page's one magnetic control: the final call to action leans toward the cursor
 * (at most 8px) while the pointer is over its zone, and settles back when it leaves.
 * Transform only, driven by gsap.quickTo; fine pointers with motion allowed. The zone
 * is the wrapper, padded a little past the button so the pull starts just before it.
 */
export function Magnetic({ className, children }: { className?: string; children: ReactNode }) {
  const zone = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const el = inner.current;
      const area = zone.current;
      if (!el || !area) return;
      const mm = gsap.matchMedia();
      mm.add(`${MOTION_OK} and (hover: hover) and (pointer: fine)`, () => {
        const toX = gsap.quickTo(el, "x", { duration: 0.5, ease: "power3.out" });
        const toY = gsap.quickTo(el, "y", { duration: 0.5, ease: "power3.out" });
        const clamp = gsap.utils.clamp(-PULL_MAX, PULL_MAX);
        const move = (e: PointerEvent) => {
          const box = area.getBoundingClientRect();
          toX(clamp((e.clientX - (box.left + box.width / 2)) * PULL));
          toY(clamp((e.clientY - (box.top + box.height / 2)) * PULL));
        };
        const leave = () => {
          toX(0);
          toY(0);
        };
        area.addEventListener("pointermove", move, { passive: true });
        area.addEventListener("pointerleave", leave);
        return () => {
          area.removeEventListener("pointermove", move);
          area.removeEventListener("pointerleave", leave);
          gsap.set(el, { clearProps: "transform" });
        };
      });
      return () => mm.revert();
    },
    { scope: zone },
  );

  return (
    <div ref={zone} className={className ? `lp-magnet ${className}` : "lp-magnet"}>
      <div ref={inner} className="lp-magnet-inner">
        {children}
      </div>
    </div>
  );
}
