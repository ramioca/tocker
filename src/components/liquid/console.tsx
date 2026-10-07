"use client";

import { useRef } from "react";
import { CONSOLE_SUMMARY, STORY, STRATEGY_SUMMARY } from "./console-run";
import { HowHead, HowTracker, RunPane, StrategyPane, TradePane } from "./how-panes";
import { useHowStory } from "./how-story";
import { SAMPLE_AGENT } from "./sample";

/**
 * 01 How: the hero's sample run, told in three steps as its owner sees it.
 * The strategy they wrote, the run it scored (and the data it bought), and the
 * trade it asks them to approve.
 *
 * Each step is a chapter: its text, then its console pane. Stacked (phones,
 * reduced motion, short screens) they read top to bottom, every pane finished.
 * On a desktop that allows motion the chapters dissolve into one grid: the
 * texts share the left cell and the panes share the console on the right, the
 * stage is held by `position: sticky` for 300vh and how-story.tsx scrubs the
 * swaps. DOM order is the reading and tab order in both layouts.
 *
 * Owner only: the strategy and transcript here are a sample's, shown as its
 * owner sees them; nobody ever sees another user's.
 */

const PANES = [<StrategyPane key="strategy" />, <RunPane key="run" />, <TradePane key="trade" />];

export function AgentConsole() {
  const ref = useRef<HTMLDivElement>(null);
  useHowStory(ref);

  return (
    <div ref={ref} className="lp-how">
      <div className="lp-how-sticky">
        <div className="lp-how-grid" role="group" aria-label={`Sample agent ${SAMPLE_AGENT}, owner's view`}>
          <span className="lp-how-frame" aria-hidden />
          <HowHead />
          <HowTracker />
          <div className="lp-how-rail" aria-hidden>
            <span className="lp-how-rail-line">
              <span className="lp-how-rail-fill" />
            </span>
            <ol className="lp-how-rail-items lp-mono">
              {STORY.map((s, i) => (
                <li key={s.id} className="lp-how-rail-item">
                  <span className="lp-how-rail-num">0{i + 1}</span> {s.kicker}
                </li>
              ))}
            </ol>
          </div>

          {STORY.map((s, i) => (
            <div key={s.id} className="lp-how-ch" data-ch={s.id}>
              <div className="lp-how-text">
                <p className="lp-how-kicker lp-label">
                  <span className="lp-how-kicker-num">0{i + 1}</span>
                  <span aria-hidden> · </span>
                  {s.kicker}
                </p>
                <h3 className="lp-how-title">{s.title}</h3>
                <p className="lp-how-body">{s.body}</p>
                {i === 0 ? <p className="lp-sr">{STRATEGY_SUMMARY}</p> : null}
                {i === 1 ? <p className="lp-sr">{CONSOLE_SUMMARY}</p> : null}
              </div>
              {PANES[i]}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
