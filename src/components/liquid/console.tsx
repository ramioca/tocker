"use client";

import { useEffect, useId, useRef, useState, type MouseEvent } from "react";
import { useInView } from "motion/react";
import { EyeOff } from "lucide-react";
import { AgentSteps } from "@/components/spectrumui/blocks/ai-assistants/agent-steps";
import { ReasoningTrace } from "@/components/spectrumui/blocks/ai-assistants/reasoning-trace";
import { StatusTracker } from "@/components/spectrumui/blocks/ai-assistants/status-tracker";
import { ToolChips } from "@/components/spectrumui/blocks/ai-assistants/tool-chips";
import { AgentAvatar } from "@/components/common/agent-avatar";
import { BEAT_MS, DATA_TOTAL_USD, FINAL_BEAT, REASONING, STAGES, THOUGHT_MS, runAt, usd3 } from "./console-run";
import { ApprovalDemo } from "./demo";
import { usePageVisible, useSafeReducedMotion } from "./motion";
import { DEFAULT_DATA_BUDGET_USD } from "./signals-data";
import {
  SAMPLE_AGENT,
  SAMPLE_EVERY_MIN,
  SAMPLE_FLOOR,
  SAMPLE_NEXT_RUN_AT,
  SAMPLE_ROWS,
  SAMPLE_RUN_AT,
  SAMPLE_SCORED,
  SAMPLE_TRADE_USD,
  clearsFloor,
} from "./sample";

/**
 * The agent console: the hero's sample run, opened up as its owner sees it,
 * built from Spectrum's AI Assistant blocks (the family the app's run view
 * uses). A status tracker for the stages, the reasoning trace, the transcript
 * in the run loop's own tool names, a receipt for the data it bought, and the
 * first of its two proposals waiting on you. Owner only: nobody else ever sees
 * a run's reasoning or transcript.
 *
 * Motion: each time the console comes into view the run replays once, in
 * under five seconds, then holds the finished run, perfectly still. Off
 * screen, in a background tab, under reduced motion, or once you touch a
 * control, it shows the finished run and nothing ticks. The server renders
 * the finished run too.
 */

const BUYS = SAMPLE_ROWS.filter((r) => clearsFloor(r.score));
const SKIPS = SAMPLE_ROWS.filter((r) => !clearsFloor(r.score));

const SUMMARY =
  `Sample, owner only: the ${SAMPLE_RUN_AT} run of ${SAMPLE_AGENT}, as its owner sees it. ` +
  `It scored ${SAMPLE_SCORED} tokens on Solana and Base against a floor of ${SAMPLE_FLOOR} and bought ` +
  `${usd3(DATA_TOTAL_USD)} of data: an X search on TIBBIR and a token safety report on SUPER INU. ` +
  `It proposed ${BUYS.length} paper buys of $${SAMPLE_TRADE_USD}: ${BUYS.map((r) => `${r.coin} at ${r.score}`).join(" and ")}. ` +
  `${SKIPS.map((r) => `${r.coin} stopped at ${r.score}`).join(", ")}, below the floor. ` +
  `Both wait for the owner's approval, starting with the request below. The next run is at ${SAMPLE_NEXT_RUN_AT}.`;

export function AgentConsole() {
  const ref = useRef<HTMLDivElement>(null);
  const transcriptId = useId();
  const near = useInView(ref);
  // Its top has climbed past 60% of the viewport: whatever its height, the run is in front of you.
  const seen = useInView(ref, { margin: "0px 0px -40% 0px" });
  const visible = usePageVisible();
  const reduced = useSafeReducedMotion();
  const [touched, setTouched] = useState(false);
  const live = near && visible && !reduced && !touched;

  const [beat, setBeat] = useState(FINAL_BEAT);
  const [playing, setPlaying] = useState(false);
  // A replay is owed on the next entry into view.
  const due = useRef(true);

  useEffect(() => {
    if (!live) {
      due.current = true;
      return;
    }
    // First pixel of a new entry: rewind while most of the console is still below the fold.
    if (due.current) {
      const t = window.setTimeout(() => {
        due.current = false;
        setPlaying(false);
        setBeat(0);
      }, 0);
      return () => window.clearTimeout(t);
    }
    // Start once it is in front of you; then beat by beat to the end, and hold.
    if (!playing) {
      if (!seen) return;
      const t = window.setTimeout(() => setPlaying(true), 0);
      return () => window.clearTimeout(t);
    }
    if (beat >= FINAL_BEAT) return;
    const t = window.setTimeout(() => setBeat((b) => b + 1), BEAT_MS);
    return () => window.clearTimeout(t);
  }, [live, seen, playing, beat]);

  const frame = runAt(live ? beat : FINAL_BEAT);
  // Only the replay moves: the clock, the shimmer and the pulses stop with it.
  const moving = live && playing && !frame.finished;

  // Using any control ends the replay: the run shows finished and stays put.
  const onClickCapture = (e: MouseEvent) => {
    if (!touched && (e.target as Element).closest("button, [role='switch']")) setTouched(true);
  };

  return (
    <div
      ref={ref}
      className="lp-cx lp-frame"
      role="group"
      aria-label={`Sample run by ${SAMPLE_AGENT}, owner's view`}
      data-live={moving ? "" : undefined}
      onClickCapture={onClickCapture}
    >
      <p className="lp-sr">{SUMMARY}</p>

      <div className="lp-cx-head" aria-hidden>
        <span className="lp-cx-agent">
          <AgentAvatar seed={SAMPLE_AGENT} name={SAMPLE_AGENT} size="sm" className="lp-cx-avatar" />
          <span className="lp-cx-id">
            <span className="lp-cx-name">{SAMPLE_AGENT}</span>
            <span className="lp-cx-meta lp-mono">
              paper · asks first<span className="lp-cx-wide"> · every {SAMPLE_EVERY_MIN} min</span>
            </span>
          </span>
        </span>
        <span className="lp-cx-tag lp-mono">
          <EyeOff size={12} strokeWidth={1.75} aria-hidden />
          owner only · sample
        </span>
      </div>

      <div className="lp-cx-trk" aria-hidden>
        <div className="lp-cx-trk-full">
          <StatusTracker stages={STAGES} activeIndex={frame.stage} progress={1} className="max-w-none" />
        </div>
        <div className="lp-cx-trk-min">
          <StatusTracker stages={STAGES} activeIndex={frame.stage} progress={1} variant="Minimal" className="max-w-none" />
        </div>
      </div>

      {/* The story (why it chose, then what it asks of you), then the machinery (transcript, data):
          side by side on wide screens, stacked in the same order on narrow ones. */}
      <div className="lp-cx-grid">
        <div className="lp-cx-col">
          <div className="lp-cx-block" aria-hidden>
            <p className="lp-cx-label lp-label">
              <span>Reasoning</span>
              <span>run {SAMPLE_RUN_AT}</span>
            </p>
            {/* Every line is always laid out; the replay reveals them in place, so nothing below moves. */}
            <div className="lp-cx-reason" data-lines={frame.lines} inert>
              <ReasoningTrace
                steps={REASONING}
                status={moving ? "thinking" : "complete"}
                durationMs={THOUGHT_MS}
                defaultOpen
                className="max-w-none"
              />
            </div>
          </div>

          <ApprovalDemo />
        </div>

        <div className="lp-cx-col">
          <div className="lp-cx-block" role="group" aria-labelledby={transcriptId}>
            <p className="lp-cx-label lp-label">
              <span id={transcriptId}>Transcript</span>
              <span aria-hidden>open a step</span>
            </p>
            <div className="lp-cx-steps">
              <AgentSteps steps={frame.steps} className="max-w-none" />
            </div>
          </div>

          <div className="lp-cx-block" aria-hidden>
            <p className="lp-cx-label lp-label">
              <span>Data bought this run</span>
              <span className="lp-cx-total" data-on={frame.paid.every((p) => p.bought) ? "" : undefined}>
                {usd3(DATA_TOTAL_USD)}
              </span>
            </p>
            <div className="lp-cx-receipt" inert>
              <ToolChips calls={frame.paid.map((p) => p.call)} variant="Stack" className="max-w-none" />
              <ul className="lp-cx-prices lp-mono">
                {frame.paid.map((p) => (
                  <li key={p.call.id} data-on={p.bought ? "" : undefined}>
                    <span className="lp-cx-for">{p.token}</span>
                    {usd3(p.priceUsd)}
                  </li>
                ))}
              </ul>
            </div>
            <p className="lp-cx-fine lp-mono">
              Paid per call in USDC over x402 · ${DEFAULT_DATA_BUDGET_USD.toFixed(2)} run budget
            </p>
          </div>

          <div className="lp-cx-block lp-cx-next" aria-hidden>
            <span className="lp-cx-next-title">Next run {SAMPLE_NEXT_RUN_AT}</span>
            <span className="lp-cx-next-note">Exits are checked every 5 min in code, between runs too.</span>
          </div>
        </div>
      </div>
    </div>
  );
}
