"use client";

import { useSafeReducedMotion } from "./motion";
import { useEffect, useRef, useState } from "react";
import {
  AnimatePresence,
  motion,
  useInView,
} from "motion/react";
import { AgentSteps } from "@/components/spectrumui/blocks/ai-assistants/agent-steps";
import {
  ApprovalCard,
  type ApprovalDecision,
} from "@/components/spectrumui/blocks/ai-assistants/approval-card";
import { AnimatedSwitch } from "@/components/spectrumui/animated-switch";
import { BorderBeam } from "@/components/spectrumui/border-beam";
import { PriceChart } from "@/components/spectrumui/charts/price-chart";
import type { PricePoint } from "@/components/spectrumui/charts/chart-kit";
import type { ToolCall } from "@/components/spectrumui/blocks/ai-assistants/types";
import { NumberTicker } from "@/components/spectrumui/number-ticker";
import { TextStates } from "@/components/spectrumui/text-states";
import "./landing-how.css";

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
  gatesPassed: number;
};

/** The sample strategy's score floor (`universe.minScore`). */
const FLOOR = 62;

const CANDIDATES: readonly Candidate[] = [
  {
    token: "MOTH",
    chain: "Solana",
    score: 81,
    verdict: "buy",
    amount: "$100.00",
    gates: "Passed 10 of 10 gates",
    gatesOk: true,
    gatesPassed: 10,
  },
  {
    token: "GLYPH",
    chain: "Solana",
    score: 74,
    verdict: "skip",
    amount: "$0.00",
    gates: "Failed: mint authority is live",
    gatesOk: false,
    gatesPassed: 9,
  },
  {
    token: "RUNE",
    chain: "Solana",
    score: 77,
    verdict: "buy",
    amount: "$100.00",
    gates: "Passed 10 of 10 gates",
    gatesOk: true,
    gatesPassed: 10,
  },
  {
    token: "PIXL",
    chain: "Solana",
    score: 49,
    verdict: "skip",
    amount: "$0.00",
    gates: "Below your score floor of 62",
    gatesOk: false,
    gatesPassed: 10,
  },
];

/** Runs `step` every `ms` while `ref` is on screen and the tab is visible. */
function useOnScreenInterval(
  ref: React.RefObject<HTMLElement | null>,
  ms: number,
  step: () => void,
  off: boolean,
) {
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
  const reduced = useSafeReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref);
  const [i, setI] = useState(0);
  useOnScreenInterval(
    ref,
    3400,
    () => setI((n) => (n + 1) % CANDIDATES.length),
    reduced,
  );
  const c = CANDIDATES[i];
  const clears = c.score >= FLOOR;

  return (
    <div
      ref={ref}
      className="lp-demo lp-how-demo"
      data-live={inView ? "true" : "false"}
      role="img"
      aria-label="Sample: a strategy prompt and the decision the agent reaches on one launch"
    >
      <div className="lp-demo-left" aria-hidden>
        <p className="lp-k">Your strategy</p>
        <p className="lp-demo-prompt">
          Buy fresh Solana launches with real holder growth and no mint
          authority. Take profit at 40%, cut at 15%.
        </p>
        <div className="lp-demo-meta">
          <span className="lp-k">Agent</span>
          <span className="lp-mono lp-demo-key">fresh-launch-hunter</span>
        </div>
        <div className="lp-demo-meta">
          <span className="lp-k">Agent wallet</span>
          <span className="lp-mono lp-how-wallet">So1a····7x9k</span>
        </div>
        <div className="lp-demo-meta">
          <span className="lp-k">Mode</span>
          <span className="lp-pill">paper</span>
          <span className="lp-pill">asks before entries</span>
        </div>
      </div>

      <div className="lp-demo-right" aria-hidden>
        <div className="lp-demo-head">
          <span className="lp-k">The decision</span>
          <span className="lp-demo-live">scoring launches</span>
          <span className="lp-mono lp-how-sample">sample</span>
        </div>

        {/* Spectrum's text-states and number-ticker swap each field in place. */}
        <div className="lp-demo-body">
          <div className="lp-demo-token">
            <span className="lp-demo-glyph lp-how-glyph">
              <TextStates text={c.token[0]} />
            </span>
            <span className="lp-demo-name">
              <TextStates text={c.token} />
            </span>
            <span className="lp-mono lp-demo-chain">
              <TextStates text={c.chain} />
            </span>
          </div>
          <div className="lp-demo-cols">
            <div>
              <p className="lp-k">Score</p>
              <p className="lp-demo-big">
                <NumberTicker
                  value={c.score}
                  pad={2}
                  duration={0.7}
                  startOnView={false}
                />
                <span className="lp-demo-of">/100</span>
              </p>
            </div>
            <span className="lp-demo-arrow">→</span>
            <div>
              <p className="lp-k">
                <TextStates text={c.verdict === "buy" ? "Buy" : "Skip"} />
              </p>
              <p
                className={`lp-demo-big ${c.verdict === "buy" ? "lp-how-buy" : "lp-muted-ink"}`}
              >
                <TextStates text={c.amount} duration={180} translateY={8} />
              </p>
            </div>
          </div>

          {/* Score against the strategy's floor, and the ten hard gates. */}
          <div className="lp-how-meters">
            <div className="lp-how-meter">
              <div className="lp-how-meter-head">
                <span className="lp-k">Score vs floor</span>
                <span className="lp-mono lp-how-meter-val">
                  {c.score} {clears ? "≥" : "<"} {FLOOR}
                </span>
              </div>
              <div className="lp-how-track">
                <span
                  className="lp-how-fill"
                  data-ok={clears ? "true" : "false"}
                  style={{ transform: `scaleX(${c.score / 100})` }}
                />
                <span className="lp-how-floor" style={{ left: `${FLOOR}%` }} />
              </div>
            </div>
            <div className="lp-how-meter">
              <div className="lp-how-meter-head">
                <span className="lp-k">Hard gates</span>
                <span className="lp-mono lp-how-meter-val">
                  {c.gatesPassed} / 10
                </span>
              </div>
              <div className="lp-how-gates">
                {Array.from({ length: 10 }, (_, g) => (
                  <span
                    key={g}
                    data-on={g < c.gatesPassed ? "true" : "false"}
                  />
                ))}
              </div>
            </div>
          </div>

          <div
            className={`lp-demo-bar lp-how-bar ${c.gatesOk ? "" : "lp-demo-bar-no"}`}
          >
            <TextStates text={c.gates} />
            <span className="lp-mono">stop 15% · take 40%</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// One sample run, in the run loop's own tool names (src/lib/agent). Owners see
// their real runs like this; nobody else ever sees a transcript.
const RUN: ToolCall[] = [
  {
    id: "discover",
    name: "discover_tokens",
    args: { chain: "solana", limit: 20 },
    result: "38 candidates · 6 clear the free gates",
    status: "success",
    startedAt: 0,
    completedAt: 1400,
  },
  {
    // score_token buys its own paid signals for a token that clears the free gates.
    id: "score",
    name: "score_token",
    args: { token: "MOTH" },
    result: "81 / 100 · floor 62 · 10 of 10 hard gates · $0.016 data",
    parallel: true,
    status: "success",
    startedAt: 1400,
    completedAt: 4100,
    children: [
      {
        id: "safety",
        name: "deepnets-token-safety",
        args: { token: "MOTH", paid: "$0.01" },
        result: "risk low · mint revoked · top ten 31%",
        status: "success",
        startedAt: 1400,
        completedAt: 3300,
      },
      {
        id: "x",
        name: "x-search",
        args: { query: "$MOTH", paid: "$0.006" },
        result: "20 posts · sentiment +0.42",
        status: "success",
        startedAt: 1400,
        completedAt: 2600,
      },
    ],
  },
  {
    id: "trade",
    name: "place_trade",
    args: { chain: "solana", side: "buy", amountUsd: 100 },
    result: "sent for your approval · paper · stop 15% · take 40%",
    status: "success",
    startedAt: 4100,
    completedAt: 4900,
  },
  {
    id: "finish",
    name: "finish",
    args: { summary: "Proposed MOTH (81): holder growth, clean mint, sentiment turning." },
    result: "1 proposal out · next run in 15m",
    status: "success",
    startedAt: 4900,
    completedAt: 5200,
  },
];

export function RunSteps() {
  return (
    <div
      className="lp-card lp-run"
      role="img"
      aria-label="Sample: one of your agent's runs, as only you see it, from discovering launches to proposing a paper trade"
    >
      <div className="lp-card-head" aria-hidden>
        <span className="lp-card-title">
          <span className="lp-dot" />
          Your run, step by step
        </span>
        <span className="lp-mono lp-card-meta">owner only · every 15 min · sample</span>
      </div>
      {/* inert: Recharts and the step toggles would otherwise be tab stops inside a picture. */}
      <div className="lp-run-body" aria-hidden inert>
        <AgentSteps steps={RUN} className="max-w-none" />
      </div>
      <div className="lp-how-foot lp-mono" aria-hidden>
        <span>4 tools</span>
        <span>5.2s</span>
        <span>$0.016 data</span>
        <span className="lp-how-foot-hi">1 proposal</span>
      </div>
    </div>
  );
}

type Call = {
  id: number;
  token: string;
  action: "buy" | "sell" | "skip";
  detail: string;
  ago: string;
};
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
const callAt = (n: number): Call => ({
  ...CALLS[n % CALLS.length],
  id: n,
  ago: "",
});

export function RecentCalls() {
  const reduced = useSafeReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const [rows, setRows] = useState<Call[]>(() =>
    Array.from({ length: VISIBLE }, (_, k) => callAt(VISIBLE - 1 - k)),
  );
  const next = useRef(VISIBLE);
  useOnScreenInterval(
    ref,
    2800,
    () => {
      // Bump the ref outside the updater: StrictMode runs updaters twice.
      const n = next.current++;
      setRows((r) => [callAt(n), ...r.slice(0, VISIBLE - 1)]);
    },
    reduced,
  );

  return (
    <div
      ref={ref}
      className="lp-card lp-calls"
      role="img"
      aria-label="Sample: the agent's latest decisions"
    >
      <div className="lp-card-head" aria-hidden>
        <span className="lp-card-title">
          <span className="lp-dot" />
          Recent calls
        </span>
        <span className="lp-mono lp-card-meta">sample agent</span>
      </div>
      <div className="lp-calls-rows" aria-hidden>
        {/* No layout projection: measuring every row on each tick cost more than the slide was worth. */}
        <AnimatePresence initial={false}>
          {rows.map((r, k) => (
            <motion.div
              key={r.id}
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
              <span
                className="lp-mono lp-call-detail"
                data-tone={
                  r.detail.startsWith("+")
                    ? "up"
                    : r.detail.startsWith("−")
                      ? "down"
                      : undefined
                }
              >
                {r.detail}
              </span>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
      <p className="lp-how-foot" aria-hidden>
        Every fill posts to the public feed. The strategy behind it stays
        private.
      </p>
    </div>
  );
}

// A fictional MOTH series: 48 five-minute closes, deterministic (no Math.random),
// edging up into the agent's entry at bar 16 and through it after, so the
// chart's own 4h move (+30%) reads alongside "+22.8% since entry".
const ENTRY_AT = 16;
const ENTRY = 0.0123;
const LAST = 0.0151;
const BARS = 48;
const MOTH: PricePoint[] = Array.from({ length: BARS }, (_, k) => {
  const pre = 0.0116 + (ENTRY - 0.0116) * Math.pow(k / ENTRY_AT, 1.35);
  const span = BARS - 1 - ENTRY_AT;
  const post =
    ENTRY +
    (LAST - ENTRY) * Math.pow((k - ENTRY_AT) / span, 1.15) -
    0.0007 * Math.sin(((k - ENTRY_AT) / span) * Math.PI);
  const wiggle = 0.00021 * Math.sin(k * 1.7) + 0.00013 * Math.sin(k * 3.1 + 1);
  const raw =
    k === ENTRY_AT
      ? ENTRY
      : k === BARS - 1
        ? LAST
        : (k < ENTRY_AT ? pre : post) + wiggle;
  const minutes = 9 * 60 + k * 5;
  const time = `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
  return { time, price: Math.round(raw * 1e6) / 1e6 };
});
// Spectrum's price chart has no level markers, so the entry rides its compare
// line: flat at the fill price, starting at the bar the agent bought.
const ENTRY_LINE: PricePoint[] = MOTH.slice(ENTRY_AT).map((p) => ({
  time: p.time,
  price: ENTRY,
}));
const SINCE_ENTRY = ((LAST - ENTRY) / ENTRY) * 100;

export function PriceCard() {
  const ref = useRef<HTMLDivElement>(null);
  // Mount the chart when it scrolls in, so its one-shot reveal plays where it is seen.
  const seen = useInView(ref, { once: true, margin: "0px 0px -15% 0px" });

  return (
    <div
      ref={ref}
      className="lp-card lp-how-price"
      role="img"
      aria-label="Sample: price of the fictional token MOTH, with the agent's paper entry at $0.0123"
    >
      <div className="lp-card-head" aria-hidden>
        <span className="lp-card-title">
          <span className="lp-dot" />
          After you approved
        </span>
        <span className="lp-mono lp-card-meta">MOTH · 5m · sample</span>
      </div>
      <div className="lp-how-price-body" aria-hidden inert>
        <div className="lp-how-chart">
          {seen ? (
            <PriceChart
              data={MOTH}
              symbol="MOTH"
              name="Solana · 4h · sample"
              compare={{ label: "entry", data: ENTRY_LINE }}
              glowing
              className="h-full"
            />
          ) : null}
        </div>
        <dl className="lp-how-levels">
          <div>
            <dt>Entry</dt>
            <dd className="lp-how-entry">$0.0123</dd>
          </div>
          <div>
            <dt>Stop · −15%</dt>
            <dd>$0.0105</dd>
          </div>
          <div>
            <dt>Take · +40%</dt>
            <dd>$0.0172</dd>
          </div>
          <div>
            <dt>Since entry</dt>
            <dd className="lp-up">+{SINCE_ENTRY.toFixed(1)}%</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}

const APPROVAL_RESULT: Record<
  ApprovalDecision | "auto",
  { title: string; note: string }
> = {
  approved: {
    title: "Paper buy filled · MOTH $100.00 at $0.0123",
    note: "Posted to the public feed. The strategy stays private.",
  },
  rejected: {
    title: "Skipped · no position opened",
    note: "The agent logs why and moves to the next launch.",
  },
  auto: {
    title: "Approvals off · bought MOTH on its own",
    note: "Hard gates and your budget still apply to every entry.",
  },
};

export function ApprovalDemo() {
  const reduced = useSafeReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref);
  const [decision, setDecision] = useState<ApprovalDecision | null>(null);
  const [ask, setAsk] = useState(true);
  // The focused button unmounts when the card swaps; move focus into whatever
  // replaces it so keyboard users keep their place.
  const stageRef = useRef<HTMLDivElement>(null);
  const moveFocus = useRef(false);
  const decide = (d: ApprovalDecision | null) => {
    moveFocus.current = true;
    setDecision(d);
  };
  const outcome = !ask ? "auto" : decision;
  const pending = outcome === null;
  const result = outcome ? APPROVAL_RESULT[outcome] : null;

  useEffect(() => {
    if (!moveFocus.current) return;
    moveFocus.current = false;
    // Wait for AnimatePresence to mount the replacement before focusing it.
    const t = window.setTimeout(() => {
      stageRef.current?.querySelector<HTMLElement>(outcome ? ".lp-how-replay, .lp-how-result" : "button")?.focus();
    }, 450);
    return () => window.clearTimeout(t);
  }, [outcome]);
  const swap = reduced
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } }
    : {
        initial: { opacity: 0, y: 8, scale: 0.98 },
        animate: { opacity: 1, y: 0, scale: 1 },
        exit: { opacity: 0, y: -6, scale: 0.98 },
      };

  return (
    <div ref={ref} className="lp-card lp-how-approve">
      <div className="lp-card-head">
        <span className="lp-card-title">
          <span className="lp-dot" />
          Asks before every entry
        </span>
        <span className="lp-mono lp-card-meta">paper · sample</span>
      </div>
      <div className="lp-how-approve-body">
        <p className="lp-how-approve-lede">
          A new agent trades paper money and asks before it opens a position.
          Approve, skip, or let it run on its own once you trust it.
        </p>

        {/* One persistent live region: a region mounted already full is often not read. */}
        <p className="lp-sr" role="status">
          {result ? result.title : ""}
        </p>
        <div
          ref={stageRef}
          className="lp-how-approve-stage"
          data-pending={pending ? "true" : "false"}
        >
          {/* Spectrum's border beam circles the request only while it waits on you, and only on screen. */}
          {pending && inView && !reduced ? (
            <BorderBeam
              duration={6}
              borderWidth={1}
              colorFrom="rgba(63, 210, 255, 0)"
              colorTo="rgba(139, 108, 255, 0.9)"
              isHovered
            />
          ) : null}
          <AnimatePresence mode="popLayout" initial={false}>
            {result ? (
              <motion.div
                key={outcome}
                {...swap}
                transition={{ type: "spring", duration: 0.4, bounce: 0 }}
                className="lp-how-result"
                data-outcome={outcome}
                tabIndex={-1}
              >
                <span className="lp-how-result-icon" aria-hidden>
                  {outcome === "rejected" ? "×" : "✓"}
                </span>
                <p className="lp-how-result-title">{result.title}</p>
                <p className="lp-how-result-note">{result.note}</p>
                {ask ? (
                  <button
                    type="button"
                    className="lp-how-replay"
                    onClick={() => decide(null)}
                  >
                    Show the request again
                  </button>
                ) : null}
              </motion.div>
            ) : (
              <motion.div
                key="ask"
                {...swap}
                transition={{ type: "spring", duration: 0.4, bounce: 0 }}
              >
                {/* Controlled with decision={null}: the outcome copy above is ours, not the card's. */}
                <ApprovalCard
                  className="lp-how-approval max-w-none"
                  title="fresh-launch-hunter wants to buy MOTH"
                  description="$100.00 at $0.0123 · score 81 / 100 · 10 of 10 hard gates passed. Stop 15%, take 40%."
                  meta="paper · Solana · place_trade · sample"
                  approveLabel="Approve buy"
                  rejectLabel="Skip"
                  decision={null}
                  onDecide={decide}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="lp-how-approve-foot">
          <span>
            <span className="lp-how-foot-title">Ask before entries</span>
            <span className="lp-k">
              {ask ? "On while it learns" : "Off: it enters on its own"}
            </span>
          </span>
          <AnimatedSwitch
            size="sm"
            label="Ask before entries"
            checked={ask}
            onCheckedChange={(on) => {
              setAsk(on);
              if (on) setDecision(null);
            }}
          />
        </div>
      </div>
    </div>
  );
}
