"use client";

import { useRef, type ReactNode } from "react";
import { gsap, MOTION_OK, SplitText, useGSAP } from "./gsap";

/**
 * A section's h2, rising into place line by line the first time it scrolls into view:
 * each line slides up out of its own mask (SplitText, `mask: "lines"`), 60ms apart.
 *
 * The heading is server-rendered whole and stays readable without script. Only with
 * motion allowed does it split; reduced motion keeps the plain heading. The split
 * re-runs on resize and font load (`autoSplit`), and the reveal plays once.
 */
export function SplitTitle({ id, className, children }: { id: string; className?: string; children: ReactNode }) {
  const ref = useRef<HTMLHeadingElement>(null);

  useGSAP(
    () => {
      const el = ref.current;
      if (!el) return;
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        let played = false;
        const split = SplitText.create(el, {
          type: "lines",
          mask: "lines",
          linesClass: "lp-split-line",
          autoSplit: true,
          aria: "auto",
          onSplit(self) {
            // After the reveal has played, a re-split (resize, fonts) lands still.
            if (played) return;
            return gsap.from(self.lines, {
              yPercent: 100,
              duration: 0.9,
              ease: "expo.out",
              stagger: 0.06,
              scrollTrigger: {
                trigger: el,
                start: "top 88%",
                once: true,
                onEnter: () => {
                  played = true;
                },
              },
            });
          },
        });
        return () => split.revert();
      });
      return () => mm.revert();
    },
    { scope: ref },
  );

  return (
    <h2 ref={ref} id={id} className={className}>
      {children}
    </h2>
  );
}
