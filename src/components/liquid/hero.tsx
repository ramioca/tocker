"use client";

import { useRef, type CSSProperties } from "react";
import Image from "next/image";
import { useInView } from "motion/react";
import { BorderBeam } from "@/components/spectrumui/border-beam";
import { NumberTicker } from "@/components/spectrumui/number-ticker";
import { useTypewriter } from "@/components/spectrumui/use-typewriter";
import { LiveIsland } from "./live-island";
import knot from "../../../public/brand/tocker/master/tocker-mark-3d-transparent.png";
import { useWaitlist } from "./waitlist";

/**
 * Hero: the promise on the left, the product's one input on the right. The
 * card types example strategies the way a visitor would write one, so the
 * first thing they see is how the product is used, not a picture of it.
 */
const PROMPTS = [
  "Buy fresh Solana launches with real holder growth and no mint authority. Take profit at 40%, cut at 15%.",
  "Momentum on Base: enter when volume and X mentions both accelerate. Skip anything with a top ten above 50%.",
  "Follow the sentiment. Small size, $100 a trade, never more than ten trades a day.",
] as const;

const delay = (s: string) => ({ "--reveal-delay": s }) as CSSProperties;

export function Hero() {
  const { open } = useWaitlist();

  return (
    <section className="lp-hero lp-wrap">
      <div className="lp-hero-copy">
        <div className="reveal" style={delay("0s")}>
          <LiveIsland />
        </div>
        <h1 className="lp-h1 reveal" style={delay("0.05s")}>
          Your agent trades while you <span className="lp-mark">sleep</span>.
        </h1>
        <p className="lp-hero-sub reveal" style={delay("0.12s")}>
          Describe a strategy in plain English. It scores every launch and trades it, 24/7.
        </p>
        <a href="#how" className="lp-link reveal" style={delay("0.18s")}>
          See how it decides
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
            <path d="M3.5 8.5l5-5M4.5 3.5h4v4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </a>

        <dl className="lp-hero-stats reveal" style={delay("0.26s")}>
          <div>
            <dt className="lp-sr">Hard gates</dt>
            <dd className="lp-stat-num">
              <NumberTicker value={10} duration={1.1} />
            </dd>
            <dd className="lp-stat-cap">hard gates no score can override</dd>
          </div>
          <div>
            <dt className="lp-sr">Exit clock</dt>
            <dd className="lp-stat-num">
              <NumberTicker value={5} duration={1.1} />
              <span className="lp-stat-unit">min</span>
            </dd>
            <dd className="lp-stat-cap">exit clock, model awake or not</dd>
          </div>
        </dl>
      </div>

      <div className="lp-hero-art">
        {/* The dimensional Ticker Knot: the kit's hero art for launch pages. */}
        <Image src={knot} alt="" priority sizes="(min-width: 1024px) 300px, 220px" className="lp-knot reveal" style={delay("0.1s")} />
        <div className="lp-build reveal" style={delay("0.2s")}>
          <BorderBeam duration={9} borderWidth={1} colorFrom="rgba(167, 139, 250, 0)" colorTo="rgba(167, 139, 250, 0.9)" isHovered />
          <p className="lp-build-tab">Build an agent</p>
          <p className="lp-build-label" id="lp-build-label">
            Your strategy, in plain English
          </p>
          <Typewriter />
          <button type="button" className="lp-btn-accent" onClick={open}>
            Join the waitlist
          </button>
          <p className="lp-build-fine">Starts on paper. Asks before every entry.</p>
        </div>
      </div>
    </section>
  );
}

function Typewriter() {
  const ref = useRef<HTMLDivElement>(null);
  // Types only while the card is on screen; reduced motion shows the first prompt whole.
  const onScreen = useInView(ref, { amount: 0.4 });
  const { text } = useTypewriter([...PROMPTS], {
    typeMs: 34,
    deleteMs: 12,
    holdMs: 3200,
    gapMs: 380,
    startDelayMs: 900,
    enabled: onScreen,
  });

  return (
    <div ref={ref} className="lp-build-input" aria-labelledby="lp-build-label" role="textbox" aria-readonly>
      {text}
      <span className="lp-caret" aria-hidden />
    </div>
  );
}
