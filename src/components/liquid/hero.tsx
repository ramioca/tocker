"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useInView } from "motion/react";
import { EyeOff } from "lucide-react";
import { AgentAvatar } from "@/components/common/agent-avatar";
import { TokenIcon } from "@/components/common/token-icon";
import { NumberTicker } from "@/components/spectrumui/number-ticker";
import { COINS } from "./coins";
import { useSafeReducedMotion } from "./motion";
import {
  SAMPLE_AGENT,
  SAMPLE_EVERY_MIN,
  SAMPLE_FLOOR,
  SAMPLE_NEXT_RUN_AT,
  SAMPLE_PROMPT,
  SAMPLE_ROWS,
  SAMPLE_RUN_AT,
  SAMPLE_SCORED,
  SAMPLE_TRADE_USD,
  clearsFloor,
} from "./sample";
import { WaitlistButton } from "./waitlist-button";

/**
 * Hero: an eyebrow, the two-line promise, one sentence on how, one action and
 * one quiet link. Under them sits a single flat card, the sample agent's
 * latest run as its owner sees it: the strategy in plain English, three
 * tokens scored against the floor, two buys waiting for an OK.
 *
 * Motion is a load-in stagger plus one pass on first view (bars grow, scores
 * count up, verdicts fade in). Then nothing moves. Reduced motion gets the
 * final frame from CSS alone, so server and client markup never differ.
 */

const delay = (s: string) => ({ "--reveal-delay": s }) as CSSProperties;

export function Hero() {
  return (
    <section className="lp-hero" aria-labelledby="lp-hero-title">
      <div className="lp-hero-head lp-wrap">
        <p className="lp-hero-eyebrow lp-eyebrow reveal" style={delay("0s")}>
          <span className="lp-hero-dot" aria-hidden />
          Private beta · Solana and Base
        </p>
        <h1 id="lp-hero-title" className="lp-h1 reveal" style={delay("0.06s")}>
          <span className="lp-h1-line">Your agent trades</span>{" "}
          <span className="lp-h1-line">
            while you <span className="lp-mark">sleep</span>.
          </span>
        </h1>
        <p className="lp-hero-sub reveal" style={delay("0.14s")}>
          Describe a strategy in plain English. It scores every token and trades the few that clear your bar.
        </p>
        <div className="lp-hero-ctas reveal" style={delay("0.22s")}>
          <WaitlistButton />
          <a href="#how" className="lp-hero-link">
            See how it decides
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden>
              <path d="M8 2.5v11M3.5 9 8 13.5 12.5 9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </a>
        </div>
      </div>

      <HeroRun />
    </section>
  );
}

/* ------------------------------------------------------------------------- */

/** Bars, scores and verdicts start this far apart, row by row. */
const STAGGER_MS = 90;
/**
 * The card fades in with the load-in stagger. If it is already in view at
 * load, hold the bars until the fade has mostly landed, so they grow where
 * they can be seen.
 */
const SETTLE_MS = 650;

const BUYS = SAMPLE_ROWS.filter((r) => clearsFloor(r.score));
const SKIPS = SAMPLE_ROWS.filter((r) => !clearsFloor(r.score));
const MORE = SAMPLE_SCORED - SAMPLE_ROWS.length;

const COUNT = ["No", "One", "Two", "Three"] as const;
const list = (rows: readonly { coin: string; score: number }[]) => rows.map((r) => `${r.coin} at ${r.score}`).join(" and ");

const LABEL =
  `Sample run by ${SAMPLE_AGENT}: ${SAMPLE_SCORED} tokens scored against a floor of ${SAMPLE_FLOOR}. ` +
  `Buys ${list(BUYS)}, skips ${list(SKIPS)}. ${COUNT[BUYS.length] ?? BUYS.length} buys are waiting for approval.`;

/**
 * Real coins, made-up scores. A skip never names a gate: that would be a claim
 * about a real token's safety, so the only reason the card gives is the floor.
 */
function HeroRun() {
  const ref = useRef<HTMLDivElement>(null);
  const seen = useInView(ref, { once: true, amount: 0.35 });
  const reduced = useSafeReducedMotion();
  const mountedAt = useRef(0);
  const [on, setOn] = useState(false);

  useEffect(() => {
    mountedAt.current = performance.now();
  }, []);

  useEffect(() => {
    if (!seen) return;
    const wait = Math.max(0, SETTLE_MS - (performance.now() - mountedAt.current));
    const t = window.setTimeout(() => setOn(true), wait);
    return () => window.clearTimeout(t);
  }, [seen]);

  const live = on || reduced;

  return (
    <div className="lp-hr-stage lp-wrap reveal" style={delay("0.32s")}>
      <div
        ref={ref}
        className="lp-hr lp-frame"
        data-in={live ? "" : undefined}
        style={{ "--floor": SAMPLE_FLOOR } as CSSProperties}
        role="img"
        aria-label={LABEL}
      >
        <div aria-hidden>
          <div className="lp-hr-head">
            <div className="lp-hr-who">
              <AgentAvatar seed={SAMPLE_AGENT} name={SAMPLE_AGENT} size="sm" className="lp-hr-avatar" />
              <span className="lp-hr-agent">{SAMPLE_AGENT}</span>
              <span className="lp-hr-chip lp-mono">sample</span>
              <span className="lp-hr-meta lp-mono">
                <span className="lp-hr-wide">paper · </span>asks first
                <span className="lp-hr-xwide"> · every {SAMPLE_EVERY_MIN} min</span>
              </span>
            </div>
            <span className="lp-hr-meta lp-hr-wide lp-mono">run {SAMPLE_RUN_AT}</span>
          </div>

          <div className="lp-hr-strategy">
            <div className="lp-hr-strategy-top">
              <span className="lp-label">Strategy</span>
              <span className="lp-hr-private lp-mono">
                <EyeOff size={13} strokeWidth={1.75} aria-hidden />
                Only you can see this
              </span>
            </div>
            <p className="lp-hr-prompt">{SAMPLE_PROMPT}</p>
          </div>

          <div className="lp-hr-listhead">
            <span className="lp-label">{SAMPLE_SCORED} tokens scored</span>
            <span className="lp-label">Your floor {SAMPLE_FLOOR}</span>
          </div>

          <div className="lp-hr-rows">
            {SAMPLE_ROWS.map((r, i) => (
              <Row key={r.coin} row={r} i={i} on={live} />
            ))}
          </div>

          <p className="lp-hr-more lp-mono">+ {MORE} more below your floor</p>

          <div className="lp-hr-foot lp-mono">
            <span>Paper · {BUYS.length} buys waiting for your OK</span>
            <span className="lp-hr-wide">next run {SAMPLE_NEXT_RUN_AT}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ row, i, on }: { row: (typeof SAMPLE_ROWS)[number]; i: number; on: boolean }) {
  const pass = clearsFloor(row.score);
  return (
    <div className="lp-hr-row" data-pass={pass ? "" : undefined} style={{ "--i": i, "--s": row.score } as CSSProperties}>
      <TokenIcon token={COINS[row.coin]} size="md" className="lp-hr-logo" />
      <span className="lp-hr-name">
        <b>{row.coin}</b>
        <span className="lp-mono">{row.chain}</span>
      </span>
      <span className="lp-hr-bar">
        <i className="lp-hr-fill" />
      </span>
      <span className="lp-hr-score lp-mono">
        <span className="lp-hr-num-tick">
          <Score value={row.score} i={i} on={on} />
        </span>
        <span className="lp-hr-num-still">{row.score}</span>
      </span>
      <span className="lp-hr-verdict">
        <i className="lp-hr-vdot" />
        {pass ? `Buy $${SAMPLE_TRADE_USD}` : "Skip"}
      </span>
    </div>
  );
}

/** Counts up from 00 once the card is in view, in step with its row's bar. */
function Score({ value, i, on }: { value: number; i: number; on: boolean }) {
  const [go, setGo] = useState(false);

  useEffect(() => {
    if (!on) return;
    const t = window.setTimeout(() => setGo(true), i * STAGGER_MS);
    return () => window.clearTimeout(t);
  }, [on, i]);

  return <NumberTicker value={go ? value : 0} pad={2} duration={0.7} startOnView={false} />;
}
