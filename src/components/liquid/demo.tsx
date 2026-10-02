"use client";

import { useEffect, useRef, useState } from "react";
import {
  AnimatePresence,
  motion,
  useInView,
} from "motion/react";
import {
  ApprovalCard,
  type ApprovalDecision,
} from "@/components/spectrumui/blocks/ai-assistants/approval-card";
import { AnimatedSwitch } from "@/components/spectrumui/animated-switch";
import { BorderBeam } from "@/components/spectrumui/border-beam";
import type { ToolCall } from "@/components/spectrumui/blocks/ai-assistants/types";
import { NumberTicker } from "@/components/spectrumui/number-ticker";
import { TextStates } from "@/components/spectrumui/text-states";
import { useSafeReducedMotion } from "./motion";
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
export const RUN: ToolCall[] = [
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
