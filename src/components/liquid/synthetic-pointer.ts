"use client";

import { useEffect, type RefObject } from "react";

/**
 * Paper Shaders' `mouse` / `mouse-position` drivers only ever hear the mouse.
 * These helpers feed them synthetic pointer events so the pieces also move on
 * a phone: a finger dragging over the canvas, and an idle drift when nobody
 * is touching it.
 */

/** Dispatch one synthetic mouse/pointer position to a canvas (and the window). */
export function dispatchPointer(canvas: HTMLCanvasElement, clientX: number, clientY: number) {
  for (const type of ["pointermove", "mousemove"] as const) {
    const ev = new PointerEvent(type, {
      clientX,
      clientY,
      bubbles: true,
      pointerId: 1,
      pointerType: "mouse",
    });
    canvas.dispatchEvent(ev);
    window.dispatchEvent(ev);
  }
}

export const isCoarsePointer = () =>
  typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;

/**
 * Touch bridge: while a finger moves over the page, forward its position to
 * the canvas inside `wrapRef` as mouse input. Calls `onTouch` with the time so
 * an idle animation can yield to the user. No-op on fine pointers.
 */
export function useTouchPointerBridge(
  wrapRef: RefObject<HTMLElement | null>,
  onTouch?: (at: number) => void,
) {
  useEffect(() => {
    if (!isCoarsePointer()) return;
    const onMove = (e: TouchEvent) => {
      const canvas = wrapRef.current?.querySelector("canvas");
      const t = e.touches[0];
      if (!canvas || !t) return;
      onTouch?.(performance.now());
      dispatchPointer(canvas, t.clientX, t.clientY);
    };
    window.addEventListener("touchmove", onMove, { passive: true });
    window.addEventListener("touchstart", onMove, { passive: true });
    return () => {
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchstart", onMove);
    };
  }, [wrapRef, onTouch]);
}
