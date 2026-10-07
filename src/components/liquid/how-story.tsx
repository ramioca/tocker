"use client";

import type { RefObject } from "react";
import { DESKTOP_MOTION, gsap, useGSAP } from "./gsap";
import { usd3 } from "./signals-data";

/**
 * The How story's scroll timeline. On a desktop that allows motion (and is tall
 * enough to hold the console), `.lp-how` is 400vh tall and its stage is
 * `position: sticky` (landing-how.css): the CSS does the pinning, so the pin's
 * spacing is in the layout from the first paint and nothing shifts when this
 * runs. This hook only scrubs: across the 300vh the stage is held, the left
 * column steps Strategy → Scored run → Trade and the console's panes swap with
 * it, the run replaying in between (bars, scores, transcript, receipt).
 *
 * Nothing here touches React state: GSAP writes styles, the step index is a
 * data attribute, and numbers are written to textContent. Everywhere else
 * (phones, reduced motion, short screens, no script) the media query does not match, the
 * section is stacked, and every pane shows its finished state.
 */

/** Must match the pinned block's media query in landing-how.css. */
export const HOW_PIN_QUERY = `(scripting: enabled) and ${DESKTOP_MOTION} and (min-height: 640px)`;

/** Timeline units (the timeline is 10 long): when each step's swap is half done. */
const SWAP_1 = 2.7;
const SWAP_2 = 7.1;
const LENGTH = 10;
/** Where to scroll a keyboard user who tabs into the approval demo: well inside the last step. */
const TRADE_PROGRESS = 0.86;

export function useHowStory(root: RefObject<HTMLElement | null>) {
  useGSAP(
    () => {
      const el = root.current;
      if (!el) return;
      const mm = gsap.matchMedia();

      mm.add(HOW_PIN_QUERY, () => {
        const q = gsap.utils.selector(el);
        const texts = q(".lp-how-text");
        const panes = q(".lp-how-pane");
        const rail = q(".lp-how-rail-item");
        if (texts.length < 3 || panes.length < 3) return;

        const setStep = (progress: number) => {
          const t = progress * LENGTH;
          const step = String(t >= SWAP_2 ? 2 : t >= SWAP_1 ? 1 : 0);
          if (el.dataset.step !== step) el.dataset.step = step;
        };

        const tl = gsap.timeline({
          defaults: { ease: "none" },
          scrollTrigger: {
            trigger: el,
            start: "top top",
            end: "bottom bottom",
            scrub: 0.6,
            invalidateOnRefresh: true,
            onUpdate: (self) => setStep(self.progress),
            onRefresh: (self) => setStep(self.progress),
          },
        });

        const out = { opacity: 0, y: -28, filter: "blur(6px)", duration: 0.7, ease: "power1.in" };
        const from = { opacity: 0, y: 28, filter: "blur(6px)" };
        const into = { opacity: 1, y: 0, filter: "blur(0px)", duration: 1, ease: "power2.out" };
        const paneOut = { opacity: 0, y: -14, scale: 0.985, duration: 0.7, ease: "power1.in" };
        const paneFrom = { opacity: 0, y: 22, scale: 0.985 };
        const paneIn = { opacity: 1, y: 0, scale: 1, duration: 1, ease: "power2.out" };

        const swap = (at: number, i: number) => {
          // The outgoing step is nearly gone before the next one shows, so the two never read as one.
          tl.to(texts[i], out, at - 0.7)
            .fromTo(texts[i + 1], from, { ...into, immediateRender: false }, at - 0.15)
            .to(panes[i], paneOut, at - 0.7)
            .fromTo(panes[i + 1], paneFrom, { ...paneIn, immediateRender: false }, at - 0.15)
            .to(rail[i], { opacity: 0.4, duration: 0.4 }, at - 0.2)
            .to(rail[i + 1], { opacity: 1, duration: 0.4 }, at - 0.2);
        };
        // The later texts and panes start hidden (the CSS has them so before this runs too).
        gsap.set([texts[1], texts[2]], from);
        gsap.set([panes[1], panes[2]], paneFrom);
        swap(SWAP_1, 0);
        swap(SWAP_2, 1);

        // The run, replayed between the two swaps: the tracker fills to Propose,
        // then to You approve on the last swap.
        const fill = q(".lp-how-trk-fill");
        const dots = q(".lp-how-trk-on");
        tl.fromTo(fill, { scaleX: 0 }, { scaleX: 2 / 3, duration: 3 }, 3)
          .to(fill, { scaleX: 1, duration: 0.8 }, SWAP_2 - 0.2);
        dots.forEach((dot, i) => {
          const at = i < dots.length - 1 ? 3 + i * 1.4 : SWAP_2 + 0.5;
          tl.fromTo(dot, { opacity: 0, scale: 0.4 }, { opacity: 1, scale: 1, duration: 0.4, ease: "back.out(2)" }, at);
        });

        // Scores: bars grow and numbers count up, best first. Counters write only while
        // this branch is live: reverting replays them to zero, and `restore` puts the
        // finished numbers back.
        let live = true;
        const write = (node: HTMLElement, text: string) => {
          if (live) node.textContent = text;
        };
        const restore: (() => void)[] = [];
        q(".lp-how-score").forEach((row, i) => {
          const bar = row.querySelector<HTMLElement>(".lp-how-bar");
          const num = row.querySelector<HTMLElement>(".lp-how-num");
          if (!bar || !num) return;
          const final = Number(row.dataset.score) || 0;
          const at = 3.2 + i * 0.32;
          tl.fromTo(bar, { scaleX: 0 }, { scaleX: final / 100, duration: 1.1, ease: "power2.out" }, at);
          const proxy = { v: 0 };
          tl.fromTo(
            proxy,
            { v: 0 },
            { v: final, duration: 1.1, ease: "power2.out", onUpdate: () => write(num, String(Math.round(proxy.v))) },
            at,
          );
          tl.fromTo(row, { opacity: 0.35 }, { opacity: 1, duration: 0.5 }, at);
          restore.push(() => void (num.textContent = String(final)));
        });

        // Transcript rows light up in order.
        // (One tween each: a staggered fromTo renders only its first target's start up front.)
        q(".lp-how-step").forEach((row, i) => {
          tl.fromTo(row, { opacity: 0.18 }, { opacity: 1, duration: 0.45 }, 3.1 + i * 0.42);
        });

        // The receipt adds up as the calls land.
        const total = q(".lp-how-total")[0];
        if (total) {
          const sum = Number(total.dataset.total) || 0;
          const proxy = { v: 0 };
          tl.fromTo(
            proxy,
            { v: 0 },
            { v: sum, duration: 2.8, onUpdate: () => write(total, usd3(proxy.v)) },
            3.2,
          );
          restore.push(() => void (total.textContent = usd3(sum)));
        }

        // The rail's progress hairline runs the whole way.
        tl.fromTo(q(".lp-how-rail-fill"), { scaleX: 0 }, { scaleX: 1, duration: LENGTH }, 0);
        tl.to({}, { duration: 0 }, LENGTH);

        // Tabbing into the approval demo while another step shows: scroll to the
        // trade step, so the focused control is the one on screen.
        const onFocus = (e: FocusEvent) => {
          const target = e.target as Element | null;
          if (!target?.closest('[data-pane="trade"]') || el.dataset.step === "2") return;
          const st = tl.scrollTrigger;
          if (!st) return;
          window.scrollTo({ top: st.start + (st.end - st.start) * TRADE_PROGRESS, behavior: "instant" });
        };
        el.addEventListener("focusin", onFocus);

        return () => {
          el.removeEventListener("focusin", onFocus);
          delete el.dataset.step;
          live = false;
          restore.forEach((r) => r());
        };
      });

      return () => mm.revert();
    },
    { scope: root },
  );
}
