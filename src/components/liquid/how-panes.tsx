"use client";

import type { CSSProperties } from "react";
import { EyeOff } from "lucide-react";
import { TokenIcon } from "@/components/common/token-icon";
import { AgentMark } from "./agent-mark";
import { COINS } from "./coins";
import {
  DATA_TOTAL_USD,
  FINAL_BEAT,
  REASONING,
  SCORE_BOARD,
  STAGES,
  STRATEGY_BUDGET_USD,
  STRATEGY_PROMPT,
  STRATEGY_ROWS,
  STRATEGY_SOURCES,
  STRATEGY_UNIVERSE,
  runAt,
} from "./console-run";
import { ApprovalDemo } from "./demo";
import { SAMPLE_AGENT, SAMPLE_AVATAR_SEED, SAMPLE_EVERY_MIN, SAMPLE_FLOOR, SAMPLE_FOUND, SAMPLE_MODE, SAMPLE_NEXT_RUN_AT, SAMPLE_RUN_AT } from "./sample";
import { usd2, usd3 } from "./signals-data";

/**
 * The How story's console parts: the shared head and tracker, and one pane per
 * step. Every pane is rendered in its finished state; on a pinned desktop the
 * scroll timeline (how-story.tsx) rewinds and replays them, and everywhere else
 * they simply sit there, done. Strategy and run are pictures (aria-hidden; the
 * console's summaries say what they show). The trade pane is the live approval demo.
 */

const FINAL = runAt(FINAL_BEAT);
const PAID_CALLS = FINAL.paid.reduce((n, p) => n + p.count, 0);
/** The two reasoning lines behind the proposals: who leads, and who clears and who doesn't. */
const WHY = REASONING.filter((r) => r.id === "r2" || r.id === "r4");
const secs = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

export function HowHead() {
  return (
    <div className="lp-how-head" aria-hidden>
      <span className="lp-cx-agent">
        <AgentMark seed={SAMPLE_AVATAR_SEED} className="lp-cx-avatar" />
        <span className="lp-cx-id">
          <span className="lp-cx-name">{SAMPLE_AGENT}</span>
          <span className="lp-cx-meta lp-mono">
            {SAMPLE_MODE}
            <span className="lp-cx-wide"> · every {SAMPLE_EVERY_MIN} min</span>
          </span>
        </span>
      </span>
      <span className="lp-cx-tag lp-mono">
        <EyeOff size={12} strokeWidth={1.75} aria-hidden />
        owner only · sample
      </span>
    </div>
  );
}

/** The run's four stages: a hairline that fills, and a dot per stage. Finished by default. */
export function HowTracker() {
  return (
    <div className="lp-how-trk" aria-hidden>
      <div className="lp-how-trk-line">
        <span className="lp-how-trk-fill" />
      </div>
      <ol className="lp-how-trk-stages">
        {STAGES.map((s, i) => (
          <li key={s.id} className="lp-how-trk-stage" data-last={i === STAGES.length - 1 ? "" : undefined}>
            <span className="lp-how-trk-dot">
              <span className="lp-how-trk-on" />
            </span>
            <span className="lp-how-trk-label lp-label">{s.label}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function StrategyPane() {
  return (
    <div className="lp-how-pane" data-pane="strategy" aria-hidden>
      <p className="lp-cx-label lp-label">
        <span>Strategy</span>
        <span>only you see this</span>
      </p>
      <blockquote className="lp-how-prompt">
        <span className="lp-how-prompt-text">{STRATEGY_PROMPT}</span>
      </blockquote>
      <dl className="lp-how-rows">
        {STRATEGY_ROWS.map(([k, v]) => (
          <div key={k} className="lp-how-row">
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      <dl className="lp-how-rows lp-how-universe">
        <div className="lp-how-row">
          <dt>Universe</dt>
          <dd>{STRATEGY_UNIVERSE}</dd>
        </div>
        <div className="lp-how-row">
          <dt>Blocklist</dt>
          <dd className="lp-how-muted">empty · it only subtracts</dd>
        </div>
      </dl>
      <div className="lp-how-sources">
        <p className="lp-cx-label lp-label">
          <span>Data it may buy</span>
          <span>up to {usd2(STRATEGY_BUDGET_USD)} a run</span>
        </p>
        <ul className="lp-how-chips lp-mono">
          {STRATEGY_SOURCES.map((id) => (
            <li key={id}>{id}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function RunPane() {
  return (
    <div className="lp-how-pane" data-pane="run" aria-hidden>
      <div className="lp-how-board-wrap">
        <p className="lp-cx-label lp-label">
          <span>
            Run {SAMPLE_RUN_AT} · {SAMPLE_FOUND} screened
          </span>
          <span>{SCORE_BOARD.length} scored</span>
        </p>
        <ol className="lp-how-board" style={{ "--floor": `${SAMPLE_FLOOR}%` } as CSSProperties}>
          {SCORE_BOARD.map((r) => (
            <li key={r.id} className="lp-how-score" data-score={r.score} data-clears={r.clears ? "" : undefined}>
              <span className="lp-how-coin">
                {r.coin ? (
                  <TokenIcon token={COINS[r.coin]} size="sm" className="lp-how-coin-icon" />
                ) : (
                  <span className="lp-how-coin-blank" />
                )}
                <span className="lp-how-coin-name">{r.label}</span>
                <span className="lp-how-coin-chain lp-mono">{r.chain}</span>
              </span>
              <span className="lp-how-track">
                <span className="lp-how-bar" style={{ "--s": r.score / 100 } as CSSProperties} />
              </span>
              <span className="lp-how-num lp-mono">{r.score}</span>
            </li>
          ))}
        </ol>
        <p className="lp-how-floor lp-mono" style={{ "--floor": `${SAMPLE_FLOOR}%` } as CSSProperties}>
          <span>floor {SAMPLE_FLOOR}</span>
        </p>
      </div>

      <div className="lp-how-log-wrap">
        <p className="lp-cx-label lp-label">
          <span>Transcript</span>
          <span>{FINAL.steps.length} steps</span>
        </p>
        <ol className="lp-how-log lp-mono">
          {FINAL.steps.map((s) => (
            <li key={s.id} className="lp-how-step">
              <svg className="lp-how-check" width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
                <circle cx="8" cy="8" r="7.25" stroke="currentColor" strokeOpacity="0.35" strokeWidth="1" />
                <path d="m5 8.3 2 2 4-4.6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span className="lp-how-step-name">{s.name}</span>
              <span className="lp-how-step-result">{s.result}</span>
              <span className="lp-how-step-dur">{s.startedAt && s.completedAt ? secs(s.completedAt - s.startedAt) : ""}</span>
            </li>
          ))}
        </ol>
      </div>

      <p className="lp-how-receipt">
        <span className="lp-cx-label lp-label">Data bought this run</span>
        <span className="lp-how-receipt-note lp-mono">{PAID_CALLS} paid calls</span>
        <span className="lp-how-total lp-mono" data-total={DATA_TOTAL_USD}>
          {usd3(DATA_TOTAL_USD)}
        </span>
      </p>
    </div>
  );
}

export function TradePane() {
  return (
    <div className="lp-how-pane" data-pane="trade">
      <div className="lp-how-why" aria-hidden>
        <p className="lp-cx-label lp-label">
          <span>Why these two</span>
          <span>reasoning</span>
        </p>
        <ol className="lp-how-why-lines">
          {WHY.map((r) => (
            <li key={r.id}>{r.content}</li>
          ))}
        </ol>
      </div>
      <ApprovalDemo />
      <p className="lp-how-next" aria-hidden>
        <span className="lp-cx-next-title">Next run {SAMPLE_NEXT_RUN_AT}</span>
        <span className="lp-cx-next-note">Exits are checked every 5 min in code, between runs too.</span>
      </p>
    </div>
  );
}
