"use client";

import { useEffect, useRef, useState } from "react";
import { useInView } from "motion/react";
import { AgentSteps } from "@/components/spectrumui/blocks/ai-assistants/agent-steps";
import { ReasoningTrace } from "@/components/spectrumui/blocks/ai-assistants/reasoning-trace";
import { StatusTracker, type TrackerStage } from "@/components/spectrumui/blocks/ai-assistants/status-tracker";
import { ToolChips } from "@/components/spectrumui/blocks/ai-assistants/tool-chips";
import type { ReasoningStep, ToolCall } from "@/components/spectrumui/blocks/ai-assistants/types";
import { AgentAvatar } from "@/components/common/agent-avatar";
import { ApprovalDemo, RUN } from "./demo";
import { usePageVisible, useSafeReducedMotion } from "./motion";

/**
 * The agent console: one sample run as its owner sees it, built from Spectrum's
 * AI Assistant blocks, the same family the app's run view uses. A status
 * tracker walks the run's stages, the reasoning trace and tool chips show what
 * it thought and what data it bought, the step list is the transcript, and the
 * approval card is where the owner says yes. Owner only: nobody else ever sees
 * a transcript or the reasoning. Every value is a sample.
 */

const AGENT = "fresh-launch-hunter";

const STAGES: TrackerStage[] = [
  { id: "discover", label: "Discover" },
  { id: "score", label: "Score" },
  { id: "gates", label: "Gates" },
  { id: "propose", label: "Propose" },
  { id: "approve", label: "You approve" },
];
const STAGE_MS = 1600;
const HOLD_MS = 3400;

const REASONING: ReasoningStep[] = [
  { id: "r1", content: "6 of 38 new launches clear the free gates. MOTH leads on holder growth, +41% in two hours." },
  { id: "r2", content: "Bought token safety for $0.01: mint revoked, freeze off, top ten hold 31%." },
  { id: "r3", content: "Bought X search for $0.006: 20 posts, sentiment +0.42 and rising." },
  { id: "r4", content: "Score 81 against a floor of 62. All ten hard gates pass." },
  { id: "r5", content: "Propose $100 on paper, stop 15%, take 40%. The owner decides." },
];

const DATA_CALLS: ToolCall[] = (RUN.find((s) => s.id === "score")?.children ?? []).map((c) => ({ ...c }));

export function AgentConsole() {
  const reduced = useSafeReducedMotion();
  const visible = usePageVisible();
  const ref = useRef<HTMLDivElement>(null);
  const onScreen = useInView(ref, { amount: 0.25 });
  // 0..STAGES.length-1 = walking the run; STAGES.length = finished, then it loops.
  const [stage, setStage] = useState(STAGES.length - 1);

  useEffect(() => {
    if (!onScreen || !visible || reduced) return;
    const finished = stage >= STAGES.length - 1;
    const t = window.setTimeout(() => setStage(finished ? 0 : stage + 1), finished ? HOLD_MS : STAGE_MS);
    return () => window.clearTimeout(t);
  }, [stage, onScreen, visible, reduced]);

  const shown = reduced ? STAGES.length - 1 : stage;
  const thinking = shown < 3;
  // Reveal the reasoning as the run gets there; the full trace once it proposes.
  const steps = REASONING.slice(0, Math.min(REASONING.length, shown + 2));

  return (
    <div ref={ref} className="lp-console">
      <div className="lp-console-head">
        <span className="lp-console-agent">
          <AgentAvatar seed={AGENT} name={AGENT} size="sm" />
          <span>
            <span className="lp-console-name">{AGENT}</span>
            <span className="lp-console-meta lp-mono">paper · asks first · every 15 min</span>
          </span>
        </span>
        <span className="lp-mono lp-console-tag">owner only · sample</span>
      </div>

      <div className="lp-console-tracker" aria-hidden>
        <StatusTracker stages={STAGES} activeIndex={shown} progress={0.5} className="max-w-none" />
      </div>

      <div className="lp-console-grid">
        <div className="lp-console-col">
          <p className="lp-console-label lp-mono">Reasoning</p>
          <div aria-hidden inert>
            <ReasoningTrace
              steps={steps}
              status={thinking ? "thinking" : "complete"}
              durationMs={5200}
              defaultOpen
              className="max-w-none"
            />
          </div>
          <p className="lp-console-label lp-mono">Transcript</p>
          {/* inert: the step toggles would be tab stops inside a picture. */}
          <div aria-hidden inert>
            <AgentSteps steps={RUN} variant="Compact" className="max-w-none" />
          </div>
        </div>

        <div className="lp-console-col">
          <p className="lp-console-label lp-mono">Data bought this run · $0.016</p>
          <div aria-hidden inert>
            <ToolChips calls={DATA_CALLS} variant="Stack" className="max-w-none" />
          </div>
          <p className="lp-console-label lp-mono">Waiting on you</p>
          <ApprovalDemo />
        </div>
      </div>
      <p className="lp-sr">
        Sample of the owner&rsquo;s run view: the agent discovers launches, buys data, scores MOTH at 81 against a
        floor of 62, passes all ten hard gates and proposes a $100 paper buy for the owner to approve.
      </p>
    </div>
  );
}
