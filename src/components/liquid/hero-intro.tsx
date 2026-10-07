"use client";

import { useRef, type CSSProperties, type ReactNode } from "react";
import { DESKTOP_MOTION, MOTION_OK, SplitText, gsap, useGSAP } from "./gsap";

/**
 * The hero's choreography, around the server-rendered hero (hero.tsx passes its markup
 * in as children, so the text is in the HTML and readable without JavaScript).
 *
 * On load, once: the eyebrow, then the headline and the sentence rising line by line
 * out of masks (SplitText), then the actions, then the run card rising out of depth.
 * On scroll (wide screens): the card leans back to flat as it comes up, and the head
 * drifts a little slower than the page.
 *
 * Until this runs, landing-hero.css holds the `.lp-intro` parts at opacity 0, but only
 * where scripting is on and motion is welcome, and only for INTRO_FAILSAFE_MS: past that
 * a CSS fallback fades them in, and a late hydration just marks the hero done instead of
 * dropping visible text to replay it. Reduced motion: no split, no tween, final frame.
 */

/**
 * How long the hero waits for this script before CSS shows it anyway (the section
 * passes it to landing-hero.css as --intro-failsafe). The dev server hydrates far
 * slower than a production build, so there it waits longer, or the intro would
 * never be seen in review.
 */
const INTRO_FAILSAFE_MS = process.env.NODE_ENV === "development" ? 8000 : 2400;

export function HeroIntro({ children, labelledBy }: { children: ReactNode; labelledBy: string }) {
  const ref = useRef<HTMLElement>(null);

  useGSAP(
    () => {
      const root = ref.current;
      if (!root) return;
      const mm = gsap.matchMedia();

      mm.add(MOTION_OK, () => {
        const late = performance.now() > INTRO_FAILSAFE_MS;
        const q = gsap.utils.selector(root);
        if (late) {
          root.setAttribute("data-intro", "");
          return;
        }

        const ease = "expo.out";
        // A beat after hydration, so the first frames are not lost to the long tasks around it.
        const d = 0.12;
        // Standalone tweens, not one timeline: autoSplit re-splits on resize and font
        // load, and a tween returned from onSplit keeps its progress across the re-split.
        const lines = (el: Element | null, delay: number, duration = 0.9) =>
          el
            ? SplitText.create(el, {
                type: "lines",
                mask: "lines",
                linesClass: "lp-split-line",
                autoSplit: true,
                aria: "auto",
                onSplit: (self) =>
                  gsap.fromTo(self.lines, { yPercent: 105 }, { yPercent: 0, duration, delay, ease, stagger: 0.06 }),
              })
            : null;

        gsap.fromTo(q(".lp-hero-eyebrow"), { autoAlpha: 0, y: 10 }, { autoAlpha: 1, y: 0, duration: 0.8, delay: d, ease });
        const h1 = lines(root.querySelector(".lp-h1"), d + 0.06);
        const sub = lines(root.querySelector(".lp-hero-sub"), d + 0.3, 1);
        gsap.fromTo(q(".lp-hero-ctas"), { autoAlpha: 0, y: 14 }, { autoAlpha: 1, y: 0, duration: 0.9, delay: d + 0.48, ease });
        gsap.fromTo(
          q(".lp-hr-stage"),
          { autoAlpha: 0, y: 72 },
          { autoAlpha: 1, y: 0, duration: 1.3, delay: d + 0.6, ease, clearProps: "transform,opacity,visibility" },
        );
        root.setAttribute("data-intro", "");

        return () => {
          h1?.revert();
          sub?.revert();
        };
      });

      // Scroll depth, wide screens only: the card starts leaned back and comes flat by
      // the time it has risen into the middle of the screen; the head drifts slower.
      mm.add(DESKTOP_MOTION, () => {
        const card = root.querySelector(".lp-hr");
        const head = root.querySelector(".lp-hero-head");
        if (!card || !head) return;
        gsap.fromTo(
          card,
          { rotateX: 14, scale: 0.94, transformOrigin: "50% 0%" },
          {
            rotateX: 0,
            scale: 1,
            ease: "none",
            scrollTrigger: { trigger: root, start: "top top", end: "+=520", scrub: 0.6 },
          },
        );
        gsap.to(head, {
          y: 90,
          autoAlpha: 0.25,
          ease: "none",
          scrollTrigger: { trigger: root, start: "top top", end: "bottom top", scrub: 0.6 },
        });
      });

      return () => mm.revert();
    },
    { scope: ref },
  );

  return (
    <section
      ref={ref}
      className="lp-hero"
      aria-labelledby={labelledBy}
      style={{ "--intro-failsafe": `${INTRO_FAILSAFE_MS}ms` } as CSSProperties}
    >
      {children}
    </section>
  );
}
