"use client";

import { useSafeReducedMotion } from "./motion";
import { useEffect, useRef, useState } from "react";
import { useInView } from "motion/react";
import { Sparkline } from "@/components/spectrumui/charts/sparkline-chart";

/**
 * A market tape under the nav: fictional tokens, made-up prices, a 24h change
 * and a Spectrum sparkline each. Labelled as a sample; nothing in it is live.
 *
 * The row is rendered twice and the track slides by exactly one copy, a pure
 * CSS transform loop. It pauses on hover, off screen and in a hidden tab;
 * reduced motion gets the first copy, still. Six tokens, so twelve sparklines.
 */

type Tape = { sym: string; chain: "SOL" | "BASE"; price: number; change: number; seed: number };

const TAPE: readonly Tape[] = [
  { sym: "MOTH", chain: "SOL", price: 0.0151, change: 22.8, seed: 11 },
  { sym: "RUNE", chain: "BASE", price: 0.0871, change: 6.2, seed: 23 },
  { sym: "GLYPH", chain: "BASE", price: 0.000394, change: -9.7, seed: 37 },
  { sym: "KITE", chain: "SOL", price: 1.284, change: 3.1, seed: 5 },
  { sym: "VANTA", chain: "BASE", price: 0.0216, change: 27.9, seed: 41 },
  { sym: "OKRA", chain: "SOL", price: 0.00712, change: -4.3, seed: 59 },
];

/**
 * 24 deterministic points rescaled into 1–10 (the sparkline's y axis starts at
 * zero, so raw prices would draw flat), tilted so the line's colour, which
 * Spectrum picks from first vs last point, agrees with the 24h change.
 */
function series(seed: number, change: number) {
  let x = seed;
  const walk: number[] = [];
  let v = 0;
  for (let i = 0; i < 24; i += 1) {
    x = (x * 16807) % 2147483647;
    v += (x / 2147483647 - 0.5) * 1.4 + change / 60;
    walk.push(v);
  }
  const delta = walk[23] - walk[0];
  const target = (change >= 0 ? 1 : -1) * Math.max(Math.abs(delta), 1.5);
  const ramp = (target - delta) / 23;
  const tilted = walk.map((w, i) => w + ramp * i);
  const lo = Math.min(...tilted);
  const hi = Math.max(...tilted);
  return tilted.map((w, i) => ({ i, value: 1 + (9 * (w - lo)) / (hi - lo || 1) }));
}

const ROWS = TAPE.map((t) => ({ ...t, data: series(t.seed, t.change) }));

function formatPrice(p: number) {
  if (p >= 1) return `$${p.toFixed(3)}`;
  const digits = Math.max(2, -Math.floor(Math.log10(p)) + 2);
  return `$${p.toFixed(digits)}`;
}

export function MarketTicker() {
  const ref = useRef<HTMLDivElement>(null);
  const onScreen = useInView(ref, { amount: 0 });
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    const sync = () => setHidden(document.visibilityState === "hidden");
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, []);

  // A moving strip must be stoppable by anyone, not only mouse users (WCAG 2.2.2).
  const [paused, setPaused] = useState(false);
  const reduced = useSafeReducedMotion();
  const running = onScreen && !hidden && !paused;

  return (
    <div ref={ref} className="lp-tape" role="region" aria-label="Sample market tape, illustrative prices">
      <button
        type="button"
        className="lp-tape-tag lp-mono"
        aria-pressed={paused}
        aria-label={paused ? "Play the sample market tape" : "Pause the sample market tape"}
        onClick={() => setPaused((p) => !p)}
      >
        <span aria-hidden className="lp-tape-tag-icon">
          {paused ? "▶" : "❚❚"}
        </span>
        sample
      </button>
      {/* inert: each Recharts sparkline is otherwise a focusable, unnamed tab stop. */}
      <div className="lp-tape-viewport" aria-hidden inert>
        <div className="lp-tape-track" data-running={running ? "" : undefined}>
          <TapeRow />
          {/* The copy only exists to make the loop seamless; a still tape doesn't need it. */}
          {reduced ? null : <TapeRow copy />}
        </div>
      </div>
    </div>
  );
}

function TapeRow({ copy = false }: { copy?: boolean }) {
  return (
    <ul className="lp-tape-row" data-copy={copy ? "" : undefined}>
      {ROWS.map((t) => {
        const up = t.change >= 0;
        return (
          <li key={t.sym} className="lp-tape-item">
            <span className="lp-tape-sym">{t.sym}</span>
            <span className="lp-tape-chain lp-mono">{t.chain}</span>
            <span className="lp-tape-price lp-mono">{formatPrice(t.price)}</span>
            <span className={`lp-tape-chg lp-mono ${up ? "lp-up" : "lp-down"}`}>
              {up ? "+" : "−"}
              {Math.abs(t.change).toFixed(1)}%
            </span>
            <Sparkline data={t.data} framed={false} className="lp-tape-spark" />
          </li>
        );
      })}
    </ul>
  );
}
