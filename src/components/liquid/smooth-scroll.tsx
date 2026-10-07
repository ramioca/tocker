"use client";

import { useEffect, useSyncExternalStore, type ReactNode } from "react";
import { MotionConfig } from "motion/react";
import { ReactLenis, useLenis, type LenisProps } from "lenis/react";
import { MOTION_OK, ScrollTrigger, gsap } from "./gsap";

/**
 * The landing's scroll and motion foundation, mounted once around the whole page.
 *
 * - `MotionConfig reducedMotion="user"`: every motion/react component on the page
 *   follows the visitor's setting (transforms dropped, opacity kept).
 * - Lenis smooth wheel scrolling on the window (the root instance, so `useLenis()`
 *   works anywhere on the page), driven by GSAP's ticker and feeding
 *   `ScrollTrigger.update` on every scroll, so pins and scrubs stay in lockstep with
 *   the eased position. Touch keeps native scrolling (`syncTouch` off).
 * - Not mounted under reduced motion (and not on the server): the page scrolls
 *   natively and ScrollTrigger reads the window as usual. It follows the setting live.
 * - In-page links (`href="#…"`) glide with Lenis and then move focus to their target,
 *   as a native jump would. The skip link is left to the browser.
 *
 * Inner scrollers and modals opt out with `data-lenis-prevent`.
 */

const LENIS_OPTIONS: LenisProps["options"] = {
  autoRaf: false,
  lerp: 0.1,
  wheelMultiplier: 1,
  smoothWheel: true,
  syncTouch: false,
};

function subscribeMotion(cb: () => void) {
  const q = window.matchMedia(MOTION_OK);
  q.addEventListener("change", cb);
  return () => q.removeEventListener("change", cb);
}

/** True once hydrated, on the client, when motion is welcome. False on the server and in the hydration pass. */
function useMotionOk(): boolean {
  return useSyncExternalStore(subscribeMotion, () => window.matchMedia(MOTION_OK).matches, () => false);
}

export function SmoothScroll({ children }: { children: ReactNode }) {
  const motionOk = useMotionOk();
  return (
    <MotionConfig reducedMotion="user">
      {motionOk ? <ReactLenis root options={LENIS_OPTIONS} /> : null}
      {motionOk ? <LenisBridge /> : null}
      {children}
    </MotionConfig>
  );
}

/** Wires the root Lenis instance to GSAP's clock and ScrollTrigger, and handles in-page links. */
function LenisBridge() {
  const lenis = useLenis();

  useEffect(() => {
    if (!lenis) return;
    const onScroll = () => ScrollTrigger.update();
    const tick = (time: number) => lenis.raf(time * 1000);
    lenis.on("scroll", onScroll);
    gsap.ticker.add(tick);
    gsap.ticker.lagSmoothing(0);
    // Triggers measured before Lenis took over still hold; re-measure once it is in charge.
    ScrollTrigger.refresh();

    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href^='#']");
      if (!(a instanceof HTMLAnchorElement)) return;
      const hash = a.getAttribute("href") ?? "";
      if (hash.length < 2 || a.classList.contains("lp-skip")) return;
      let target: HTMLElement | null = null;
      try {
        target = document.getElementById(decodeURIComponent(hash.slice(1)));
      } catch {
        return;
      }
      if (!target) return;
      e.preventDefault();
      const el = target;
      lenis.scrollTo(el, {
        duration: 1.1,
        easing: (t) => 1 - Math.pow(1 - t, 4),
        onComplete: () => {
          if (!el.hasAttribute("tabindex") && !/^(A|BUTTON|INPUT|SELECT|TEXTAREA|SUMMARY)$/.test(el.tagName)) {
            el.setAttribute("tabindex", "-1");
          }
          el.focus({ preventScroll: true });
        },
      });
      history.pushState(null, "", hash);
    };
    document.addEventListener("click", onClick);

    return () => {
      document.removeEventListener("click", onClick);
      lenis.off("scroll", onScroll);
      gsap.ticker.remove(tick);
      gsap.ticker.lagSmoothing(500, 33);
    };
  }, [lenis]);

  return null;
}
