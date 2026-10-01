"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

/**
 * The hero's product shot: a sample agent's console, drawn in DOM rather than
 * shipped as a screenshot so it stays sharp and costs nothing to paint. The
 * feed takes a new decision every few seconds while the panel is on screen and
 * the tab is visible; reduced motion leaves it still. Everything in it is
 * illustrative and says so: no real agent, wallet or token is shown.
 */

type Decision = {
  token: string;
  chain: "SOL" | "BASE";
  action: "buy" | "sell" | "skip";
  score: number;
  /** Size for a buy, realised P&L for a sell, the failed gate for a skip. */
  detail: string;
  tone?: "up" | "down";
};

const POOL: readonly Decision[] = [
  { token: "MOTH", chain: "SOL", action: "buy", score: 81, detail: "$100.00" },
  { token: "GLYPH", chain: "BASE", action: "skip", score: 74, detail: "mint authority live" },
  { token: "KITE", chain: "SOL", action: "sell", score: 58, detail: "+$38.20", tone: "up" },
  { token: "RUNE", chain: "BASE", action: "buy", score: 77, detail: "$100.00" },
  { token: "PIXL", chain: "SOL", action: "skip", score: 49, detail: "below score floor" },
  { token: "OKRA", chain: "SOL", action: "sell", score: 41, detail: "−$15.00", tone: "down" },
  { token: "VANTA", chain: "BASE", action: "buy", score: 69, detail: "$100.00" },
  { token: "FERN", chain: "SOL", action: "skip", score: 83, detail: "top-10 hold 71%" },
  { token: "MOTH", chain: "SOL", action: "sell", score: 66, detail: "+$40.00", tone: "up" },
  { token: "HALO", chain: "BASE", action: "skip", score: 71, detail: "honeypot check" },
];

const VISIBLE = 6;
const STEP_MS = 2600;

type Row = Decision & { id: number; time: string };

const clock = (s: number) => {
  const h = Math.floor(s / 3600) % 24;
  const m = Math.floor(s / 60) % 60;
  const sec = s % 60;
  return [h, m, sec].map((n) => String(n).padStart(2, "0")).join(":");
};
const START = 14 * 3600 + 2 * 60 + 11;

function rowAt(i: number): Row {
  const d = POOL[i % POOL.length];
  // Deterministic spacing so the server and client render the same first frame.
  return { ...d, id: i, time: clock(START + i * 47 + ((i * 13) % 29)) };
}

const INITIAL: Row[] = Array.from({ length: VISIBLE }, (_, k) => rowAt(VISIBLE - 1 - k));

export function AgentPreview() {
  const reduced = useReducedMotion();
  const root = useRef<HTMLDivElement>(null);
  const [rows, setRows] = useState(INITIAL);

  useEffect(() => {
    if (reduced) return;
    const el = root.current;
    if (!el) return;
    let next = VISIBLE;
    let timer: ReturnType<typeof setInterval> | undefined;
    let onScreen = false;

    const sync = () => {
      const run = onScreen && document.visibilityState === "visible";
      if (run && !timer) {
        timer = setInterval(() => {
          const row = rowAt(next++);
          setRows((r) => [row, ...r.slice(0, VISIBLE - 1)]);
        }, STEP_MS);
      } else if (!run && timer) {
        clearInterval(timer);
        timer = undefined;
      }
    };
    const io = new IntersectionObserver(([e]) => {
      onScreen = e.isIntersecting;
      sync();
    });
    io.observe(el);
    document.addEventListener("visibilitychange", sync);
    return () => {
      io.disconnect();
      document.removeEventListener("visibilitychange", sync);
      if (timer) clearInterval(timer);
    };
  }, [reduced]);

  return (
    <div ref={root} className="pv" aria-label="Sample agent console (illustrative)" role="img">
      <div className="pv-bar" aria-hidden>
        <span className="pv-dots">
          <i />
          <i />
          <i />
        </span>
        <span className="pv-title">fresh-launch-hunter</span>
        <span className="pv-status">
          <span className="pv-status-dot" />
          running
        </span>
      </div>

      <div className="pv-body" aria-hidden>
        <aside className="pv-side">
          <div className="pv-stat pv-stat-lead">
            <span className="pv-k">Equity · paper</span>
            <span className="pv-v pv-v-lg">$12,480.22</span>
            <span className="pv-delta">+18.4% · 30d</span>
          </div>
          <Spark />
          <div className="pv-grid">
            <div className="pv-stat">
              <span className="pv-k">Win rate</span>
              <span className="pv-v">61%</span>
            </div>
            <div className="pv-stat">
              <span className="pv-k">Trades today</span>
              <span className="pv-v">7 / 10</span>
            </div>
            <div className="pv-stat">
              <span className="pv-k">Data spent</span>
              <span className="pv-v">$0.84</span>
            </div>
            <div className="pv-stat">
              <span className="pv-k">Stop · take</span>
              <span className="pv-v">15 / 40%</span>
            </div>
          </div>
        </aside>

        <div className="pv-feed">
          <div className="pv-feed-head">
            <span>Time</span>
            <span>Token</span>
            <span>Decision</span>
            <span className="pv-col-score">Score</span>
            <span className="pv-col-detail">Detail</span>
          </div>
          <div className="pv-rows">
            <AnimatePresence initial={false} mode="popLayout">
              {rows.map((r) => (
                <motion.div
                  key={r.id}
                  layout="position"
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ type: "spring", duration: 0.5, bounce: 0 }}
                  className="pv-row"
                  data-action={r.action}
                >
                  <span className="pv-time">{r.time}</span>
                  <span className="pv-token">
                    {r.token}
                    <span className="pv-chain">{r.chain}</span>
                  </span>
                  <span className="pv-action">{r.action}</span>
                  <span className="pv-col-score pv-score">
                    <span className="pv-meter">
                      <span style={{ transform: `scaleX(${r.score / 100})` }} />
                    </span>
                    {r.score}
                  </span>
                  <span className="pv-col-detail pv-detail" data-tone={r.tone}>
                    {r.detail}
                  </span>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </div>
      </div>
      <p className="pv-note">Illustrative agent · not live data</p>
    </div>
  );
}

function Spark() {
  // A fixed, hand-shaped equity curve; the panel is a picture, not a chart.
  const d =
    "M0 46 L14 44 L28 45 L42 39 L56 41 L70 33 L84 35 L98 28 L112 31 L126 22 L140 25 L154 17 L168 20 L182 12 L196 14 L210 6 L224 9 L240 3";
  return (
    <svg className="pv-spark" viewBox="0 0 240 52" preserveAspectRatio="none" aria-hidden>
      <defs>
        <linearGradient id="pv-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#a78bfa" stopOpacity="0.28" />
          <stop offset="1" stopColor="#a78bfa" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${d} L240 52 L0 52 Z`} fill="url(#pv-fill)" />
      <path d={d} fill="none" stroke="#a78bfa" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
