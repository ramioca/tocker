"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

/**
 * "How it decides": one sample strategy, the decision it reaches on a launch,
 * and the shape of a day around it (the scored field and the latest calls).
 * Every figure is illustrative and the panels say so; no real agent, wallet or
 * token appears.
 */

type Candidate = {
  token: string;
  chain: string;
  score: number;
  verdict: "buy" | "skip";
  amount: string;
  gates: string;
  gatesOk: boolean;
};

const CANDIDATES: readonly Candidate[] = [
  { token: "MOTH", chain: "Solana", score: 81, verdict: "buy", amount: "$100.00", gates: "Passed 10 of 10 gates", gatesOk: true },
  { token: "GLYPH", chain: "Base", score: 74, verdict: "skip", amount: "$0.00", gates: "Failed: mint authority is live", gatesOk: false },
  { token: "RUNE", chain: "Base", score: 77, verdict: "buy", amount: "$100.00", gates: "Passed 10 of 10 gates", gatesOk: true },
  { token: "PIXL", chain: "Solana", score: 49, verdict: "skip", amount: "$0.00", gates: "Below your score floor of 62", gatesOk: false },
];

/** Runs `step` every `ms` while `ref` is on screen and the tab is visible. */
function useOnScreenInterval(ref: React.RefObject<HTMLElement | null>, ms: number, step: () => void, off: boolean) {
  const saved = useRef(step);
  useEffect(() => {
    saved.current = step;
  });
  useEffect(() => {
    const el = ref.current;
    if (off || !el) return;
    let timer: ReturnType<typeof setInterval> | undefined;
    let onScreen = false;
    const sync = () => {
      const run = onScreen && document.visibilityState === "visible";
      if (run && !timer) timer = setInterval(() => saved.current(), ms);
      else if (!run && timer) {
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
  }, [ref, ms, off]);
}

export function DecisionDemo() {
  const reduced = Boolean(useReducedMotion());
  const ref = useRef<HTMLDivElement>(null);
  const [i, setI] = useState(0);
  useOnScreenInterval(ref, 3400, () => setI((n) => (n + 1) % CANDIDATES.length), reduced);
  const c = CANDIDATES[i];

  return (
    <div ref={ref} className="lp-demo" role="img" aria-label="Sample: a strategy prompt and the decision the agent reaches on one launch">
      <div className="lp-demo-left" aria-hidden>
        <p className="lp-k">Your strategy</p>
        <p className="lp-demo-prompt">
          Buy fresh Solana launches with real holder growth and no mint authority. Take profit at 40%, cut at 15%.
        </p>
        <div className="lp-demo-meta">
          <span className="lp-k">Agent wallet</span>
          <span className="lp-mono lp-demo-key">So1a····7x9k</span>
        </div>
        <div className="lp-demo-meta">
          <span className="lp-k">Mode</span>
          <span className="lp-pill">paper</span>
        </div>
      </div>

      <div className="lp-demo-right" aria-hidden>
        <div className="lp-demo-head">
          <span className="lp-k">The decision</span>
          <span className="lp-demo-live">scoring launches</span>
        </div>

        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 6, filter: "blur(2px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            exit={{ opacity: 0, y: -4, filter: "blur(2px)" }}
            transition={{ duration: 0.28, ease: [0.23, 1, 0.32, 1] }}
            className="lp-demo-body"
          >
            <div className="lp-demo-token">
              <span className="lp-demo-glyph">{c.token[0]}</span>
              <span className="lp-demo-name">{c.token}</span>
              <span className="lp-mono lp-demo-chain">{c.chain}</span>
            </div>
            <div className="lp-demo-cols">
              <div>
                <p className="lp-k">Score</p>
                <p className="lp-demo-big">
                  {c.score}
                  <span className="lp-demo-of">/100</span>
                </p>
              </div>
              <span className="lp-demo-arrow">→</span>
              <div>
                <p className="lp-k">{c.verdict === "buy" ? "Buy" : "Skip"}</p>
                <p className={`lp-demo-big ${c.verdict === "buy" ? "lp-accent-ink" : "lp-muted-ink"}`}>{c.amount}</p>
              </div>
            </div>
            <div className={`lp-demo-bar ${c.gatesOk ? "" : "lp-demo-bar-no"}`}>
              <span>{c.gates}</span>
              <span className="lp-mono">stop 15% · take 40%</span>
            </div>
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

const FIELD = [
  { band: "90 +", count: 14, note: "" },
  { band: "80 – 89", count: 52, note: "" },
  { band: "70 – 79", count: 131, note: "" },
  { band: "62 – 69", count: 208, note: "floor" },
  { band: "below 62", count: 879, note: "skipped" },
] as const;
const FIELD_MAX = Math.max(...FIELD.map((f) => f.count));
const FIELD_TOTAL = FIELD.reduce((a, f) => a + f.count, 0);

export function FieldBook() {
  return (
    <div className="lp-card lp-book" role="img" aria-label="Sample: today's launches by score band">
      <div className="lp-card-head" aria-hidden>
        <span className="lp-card-title">
          <span className="lp-dot" />
          Today&rsquo;s field
        </span>
        <span className="lp-mono lp-card-meta">{FIELD_TOTAL.toLocaleString("en-US")} launches scored</span>
      </div>
      <div className="lp-book-cols lp-mono" aria-hidden>
        <span>score</span>
        <span>launches</span>
      </div>
      <div aria-hidden>
        {FIELD.map((f) => (
          <div key={f.band} className="lp-book-row lp-mono" data-note={f.note || undefined}>
            <span className="lp-book-depth" style={{ transform: `scaleX(${f.count / FIELD_MAX})` }} />
            <span className="lp-book-band">
              {f.band}
              {f.note ? <em>{f.note}</em> : null}
            </span>
            <span>{f.count.toLocaleString("en-US")}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

type Call = { id: number; token: string; action: "buy" | "sell" | "skip"; detail: string; ago: string };
const CALLS: readonly Omit<Call, "id" | "ago">[] = [
  { token: "MOTH", action: "buy", detail: "$100.00" },
  { token: "KITE", action: "sell", detail: "+$38.20" },
  { token: "GLYPH", action: "skip", detail: "gate" },
  { token: "RUNE", action: "buy", detail: "$100.00" },
  { token: "OKRA", action: "sell", detail: "−$15.00" },
  { token: "FERN", action: "skip", detail: "gate" },
  { token: "VANTA", action: "buy", detail: "$100.00" },
  { token: "PIXL", action: "skip", detail: "floor" },
];
const AGES = ["now", "4m ago", "9m ago", "17m ago", "26m ago"];
const VISIBLE = 5;
const callAt = (n: number): Call => ({ ...CALLS[n % CALLS.length], id: n, ago: "" });

export function RecentCalls() {
  const reduced = Boolean(useReducedMotion());
  const ref = useRef<HTMLDivElement>(null);
  const [rows, setRows] = useState<Call[]>(() => Array.from({ length: VISIBLE }, (_, k) => callAt(VISIBLE - 1 - k)));
  const next = useRef(VISIBLE);
  useOnScreenInterval(ref, 2800, () => setRows((r) => [callAt(next.current++), ...r.slice(0, VISIBLE - 1)]), reduced);

  return (
    <div ref={ref} className="lp-card lp-calls" role="img" aria-label="Sample: the agent's latest decisions">
      <div className="lp-card-head" aria-hidden>
        <span className="lp-card-title">
          <span className="lp-dot" />
          Recent calls
        </span>
        <span className="lp-mono lp-card-meta">sample agent</span>
      </div>
      <div className="lp-calls-rows" aria-hidden>
        <AnimatePresence initial={false} mode="popLayout">
          {rows.map((r, k) => (
            <motion.div
              key={r.id}
              layout="position"
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ type: "spring", duration: 0.5, bounce: 0 }}
              className="lp-call"
            >
              <span>
                <span className="lp-call-token lp-mono">
                  {r.token}
                  <span className="lp-call-action" data-action={r.action}>
                    {r.action}
                  </span>
                </span>
                <span className="lp-call-ago">{AGES[k]}</span>
              </span>
              <span className="lp-mono lp-call-detail" data-tone={r.detail.startsWith("+") ? "up" : r.detail.startsWith("−") ? "down" : undefined}>
                {r.detail}
              </span>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}
