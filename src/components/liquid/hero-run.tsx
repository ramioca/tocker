"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useInView } from "motion/react";
import { EyeOff } from "lucide-react";
import { TokenIcon } from "@/components/common/token-icon";
import { NumberTicker } from "@/components/spectrumui/number-ticker";
import { AgentMark } from "./agent-mark";
import { COINS } from "./coins";
import { useSafeReducedMotion } from "./motion";
import {
  HERO_LABEL,
  SAMPLE_AGENT,
  SAMPLE_BUYS,
  SAMPLE_EVERY_MIN,
  SAMPLE_FLOOR,
  SAMPLE_FOUND,
  SAMPLE_MODE,
  SAMPLE_NEXT_RUN_AT,
  SAMPLE_OTHER_SCORES,
  SAMPLE_PROMPT,
  SAMPLE_ROWS,
  SAMPLE_RUN_AT,
  SAMPLE_SCORED,
  SAMPLE_TRADE_USD,
  clearsFloor,
} from "./sample";

/**
 * The hero's run card: the sample agent's latest run as its owner sees it.
 * The strategy in plain English, the top three of the tokens it scored against
 * the floor, and the two buys waiting for an OK.
 *
 * Motion is one pass, the first time the rows are in view (bars grow, scores
 * count up, verdicts fade in); then nothing moves. Everything that pass needs
 * is CSS keyed on [data-in], gated on scripting and on motion being welcome:
 * without JavaScript, or under reduced motion, the card is its final frame,
 * and server and client markup never differ.
 */

/** Bars, scores and verdicts start this far apart, row by row. */
const STAGGER_MS = 90;
/**
 * The card rises in last in the hero's load-in (hero-intro.tsx: 0.6s delay, 1.3s
 * expo out). If its rows are already in view at load, hold the bars until the
 * rise has mostly landed, so they grow where they can be seen.
 */
const SETTLE_MS = 1250;

/**
 * Real coins, made-up scores. A skip never names a gate: that would be a claim
 * about a real token's safety, so the only reason the card gives is the floor.
 */
export function HeroRun() {
  // The rows are what animate: wait until most of them are on screen, not just the card's head.
  const rowsRef = useRef<HTMLDivElement>(null);
  const seen = useInView(rowsRef, { once: true, amount: 0.6 });
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
    <div className="lp-hr-stage lp-wrap lp-intro">
      <div
        className="lp-hr lp-frame"
        data-in={live ? "" : undefined}
        style={{ "--floor": SAMPLE_FLOOR } as CSSProperties}
        role="img"
        aria-label={HERO_LABEL}
      >
        <div aria-hidden>
          <div className="lp-hr-head">
            <div className="lp-hr-who">
              <AgentMark name={SAMPLE_AGENT} className="lp-hr-avatar" />
              <span className="lp-hr-agent">{SAMPLE_AGENT}</span>
              <span className="lp-hr-chip lp-mono">sample</span>
              <span className="lp-hr-meta lp-mono">
                <span className="lp-hr-wide">paper · </span>
                {SAMPLE_MODE}
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
            <span className="lp-label">
              {SAMPLE_FOUND} screened · {SAMPLE_SCORED} scored
            </span>
            <span className="lp-label">
              <span className="lp-hr-wide">Your </span>floor {SAMPLE_FLOOR}
            </span>
          </div>

          <div ref={rowsRef} className="lp-hr-rows">
            {SAMPLE_ROWS.map((r, i) => (
              <Row key={r.coin} row={r} i={i} on={live} />
            ))}
          </div>

          <p className="lp-hr-more lp-mono">
            + {SAMPLE_OTHER_SCORES.length} more <span className="lp-hr-roomy">scored </span>below your floor
          </p>

          <div className="lp-hr-foot lp-mono">
            <span>Paper · {SAMPLE_BUYS.length} buys waiting for your OK</span>
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

/** Counts up from 00 once the rows are in view, in step with its row's bar. */
function Score({ value, i, on }: { value: number; i: number; on: boolean }) {
  const [go, setGo] = useState(false);

  useEffect(() => {
    if (!on) return;
    const t = window.setTimeout(() => setGo(true), i * STAGGER_MS);
    return () => window.clearTimeout(t);
  }, [on, i]);

  return <NumberTicker value={go ? value : 0} pad={2} duration={0.7} startOnView={false} />;
}
