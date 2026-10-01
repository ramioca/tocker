"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import Image from "next/image";
import { useInView, useReducedMotion } from "motion/react";
import { BorderBeam } from "@/components/spectrumui/border-beam";
import { NumberTicker } from "@/components/spectrumui/number-ticker";
import { TextStates } from "@/components/spectrumui/text-states";
import { useTypewriter } from "@/components/spectrumui/use-typewriter";
import knot from "../../../public/brand/tocker/master/tocker-mark-3d-transparent.png";
import { LiveIsland } from "./live-island";
import { LANDING_SOURCES } from "./signals-data";
import { useWaitlist } from "./waitlist";

/**
 * Hero, centred: the live run island docked at the top like a notch, a
 * two-line promise, two calls to action, then a stage. The dimensional Ticker
 * Knot (the kit's hero art) stands in the middle of it, between the two halves
 * of the product: the strategy someone types, and the decision their agent
 * reaches. A hairline strip of facts closes the section.
 *
 * Everything that moves pauses off screen; reduced motion gets still frames.
 */

const PROMPTS = [
  "Buy fresh Solana launches with real holder growth and no mint authority. Take profit at 40%, cut at 15%.",
  "Momentum on Base: enter when volume and X mentions both accelerate. Skip a top ten above 50%.",
  "Follow the sentiment. $100 a trade, never more than ten trades a day.",
] as const;

const DECISIONS = [
  { token: "MOTH", chain: "Solana", score: 81, verdict: "Buy $100.00", gate: "10 of 10 gates passed", ok: true },
  { token: "GLYPH", chain: "Base", score: 74, verdict: "Skip", gate: "Mint authority is live", ok: false },
  { token: "RUNE", chain: "Base", score: 77, verdict: "Buy $100.00", gate: "10 of 10 gates passed", ok: true },
] as const;

const delay = (s: string) => ({ "--reveal-delay": s }) as CSSProperties;

export function Hero() {
  const { open } = useWaitlist();

  return (
    <section className="lp-hero">
      <div className="lp-hero-head lp-wrap">
        <div className="reveal" style={delay("0s")}>
          <LiveIsland />
        </div>
        <h1 className="lp-h1 reveal" style={delay("0.06s")}>
          <span className="lp-h1-line">Your agent trades</span>{" "}
          <span className="lp-h1-line">
            while you <span className="lp-mark">sleep</span>.
          </span>
        </h1>
        <p className="lp-hero-sub reveal" style={delay("0.14s")}>
          Describe a strategy in plain English. Tocker scores every launch on Solana and Base and trades it, 24/7,
          on its own wallet.
        </p>
        <div className="lp-hero-ctas reveal" style={delay("0.22s")}>
          <button type="button" className="lp-btn-accent lp-btn-hero" onClick={open}>
            Join the waitlist
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden className="lp-btn-arrow">
              <path d="M2 8h11M8.5 3.5 13 8l-4.5 4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <a href="#how" className="lp-btn-ghost lp-btn-hero">
            See how it decides
          </a>
        </div>
      </div>

      <div className="lp-stage lp-wrap" aria-hidden>
        <div className="lp-stage-glow" />
        <Image
          src={knot}
          alt=""
          priority
          sizes="(min-width: 1024px) 360px, 240px"
          className="lp-stage-knot reveal"
          style={delay("0.3s")}
        />
        <StrategyCard />
        <DecisionCard />
      </div>

      <dl className="lp-facts lp-wrap reveal" style={delay("0.5s")}>
        <Fact value={10} label="hard gates no score overrides" />
        <Fact value={5} unit="min" label="exit clock, model awake or not" />
        <Fact value={LANDING_SOURCES.length} label="paid data sources, by the call" />
        <Fact value={2} label="chains: Solana and Base" />
      </dl>
    </section>
  );
}

function Fact({ value, unit, label }: { value: number; unit?: string; label: string }) {
  return (
    <div className="lp-fact">
      <dt className="lp-sr">{label}</dt>
      <dd className="lp-fact-num">
        <NumberTicker value={value} duration={1.1} />
        {unit ? <span className="lp-fact-unit">{unit}</span> : null}
      </dd>
      <dd className="lp-fact-cap" aria-hidden>
        {label}
      </dd>
    </div>
  );
}

function StrategyCard() {
  const ref = useRef<HTMLDivElement>(null);
  const onScreen = useInView(ref, { amount: 0.3 });
  const { text } = useTypewriter([...PROMPTS], {
    typeMs: 32,
    deleteMs: 10,
    holdMs: 3600,
    gapMs: 360,
    startDelayMs: 900,
    enabled: onScreen,
  });

  return (
    <div ref={ref} className="lp-float lp-float-left reveal" style={delay("0.38s")}>
      <div className="lp-float-head">
        <span>Strategy</span>
        <span className="lp-pill">paper</span>
      </div>
      <p className="lp-float-prompt">
        {text}
        <span className="lp-caret" />
      </p>
      <div className="lp-float-chips">
        <span className="lp-pill">Solana · Base</span>
        <span className="lp-pill">$100 / trade</span>
        <span className="lp-pill">stop 15%</span>
      </div>
    </div>
  );
}

function DecisionCard() {
  const reduced = Boolean(useReducedMotion());
  const ref = useRef<HTMLDivElement>(null);
  const onScreen = useInView(ref, { amount: 0.3 });
  const [i, setI] = useState(0);

  useEffect(() => {
    if (!onScreen || reduced) return;
    const t = setInterval(() => setI((n) => (n + 1) % DECISIONS.length), 3600);
    return () => clearInterval(t);
  }, [onScreen, reduced]);

  const d = DECISIONS[i];
  return (
    <div ref={ref} className="lp-float lp-float-right reveal" style={delay("0.46s")}>
      <BorderBeam duration={10} borderWidth={1} colorFrom="rgba(167, 139, 250, 0)" colorTo="rgba(167, 139, 250, 0.85)" isHovered />
      <div className="lp-float-head">
        <span>Decision</span>
        <span className="lp-float-live">live</span>
      </div>
      <div className="lp-float-token">
        <span className="lp-float-glyph">
          <TextStates text={d.token[0]} />
        </span>
        <TextStates text={d.token} className="lp-float-name" />
        <span className="lp-mono lp-float-chain">
          <TextStates text={d.chain} />
        </span>
      </div>
      <div className="lp-float-row">
        <span className="lp-float-score">
          <NumberTicker value={d.score} pad={2} duration={0.7} startOnView={false} />
          <span className="lp-float-of">/100</span>
        </span>
        <span className={d.ok ? "lp-float-verdict" : "lp-float-verdict lp-float-verdict-no"}>
          <TextStates text={d.verdict} />
        </span>
      </div>
      <p className={d.ok ? "lp-float-gate" : "lp-float-gate lp-float-gate-no"}>
        <TextStates text={d.gate} />
      </p>
    </div>
  );
}
