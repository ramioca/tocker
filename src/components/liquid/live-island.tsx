"use client";

import { useEffect, useRef, useState } from "react";
import { useInView, useReducedMotion } from "motion/react";
import { BorderBeam } from "border-beam";
import { ThinkingOrb, type OrbState } from "thinking-orbs";
import { Check } from "lucide-react";
import { AgentAvatar } from "@/components/common/agent-avatar";
import { DynamicIsland, DynamicIslandView } from "@/components/spectrumui/dynamic-island";

/**
 * The app's run island (src/components/shell/run-island.tsx), replaying one
 * sample run on a loop: the same Spectrum Dynamic Island, beam and thinking orb
 * an owner watches while their agent works. It mounts only while the hero is
 * on screen, so the orb's canvas and the beam stop the moment it scrolls away;
 * reduced motion shows the settled state, still.
 */

const AGENT = "fresh-launch-hunter";

/** Tool, words and orb state, as the real island maps them. */
const STEPS: readonly { label: string; orb: OrbState }[] = [
  { label: "Finding tokens", orb: "searching" },
  { label: "Buying data", orb: "working" },
  { label: "Scoring a token", orb: "solving" },
  { label: "Placing a trade", orb: "connecting" },
];
const STEP_MS = 1500;
const SETTLED_MS = 3200;
const IDLE_MS = 1800;

type Frame = { view: "running"; step: number } | { view: "settled" } | { view: null };

export function LiveIsland() {
  const reduced = Boolean(useReducedMotion());
  const dock = useRef<HTMLDivElement>(null);
  const onScreen = useInView(dock, { amount: 0.1 });
  const [frame, setFrame] = useState<Frame>({ view: null });

  useEffect(() => {
    if (!onScreen || reduced) return;
    const timeline: { frame: Frame; ms: number }[] = [
      { frame: { view: null }, ms: IDLE_MS },
      ...STEPS.map((_, step) => ({ frame: { view: "running", step } as Frame, ms: STEP_MS })),
      { frame: { view: "settled" }, ms: SETTLED_MS },
    ];
    let i = 0;
    let timer: ReturnType<typeof setTimeout>;
    const next = () => {
      setFrame(timeline[i].frame);
      timer = setTimeout(next, timeline[i].ms);
      i = (i + 1) % timeline.length;
    };
    next();
    return () => clearTimeout(timer);
  }, [onScreen, reduced]);

  const shown: Frame = reduced ? { view: "settled" } : frame;
  const step = shown.view === "running" ? STEPS[shown.step] : null;

  return (
    <div ref={dock} className="lp-island-dock" aria-label="Sample: an agent run, as the owner sees it" role="img">
      {onScreen || reduced ? (
        <div aria-hidden>
          <BorderBeam size="md" colorVariant="ocean" theme="dark" strength={0.7} active={shown.view === "running" && !reduced}>
            <DynamicIsland
              view={shown.view}
              className="border border-white/10 bg-black text-white"
              compact={
                <span className="flex items-center gap-2 whitespace-nowrap">
                  <span className="lp-island-dot" />
                  {AGENT} · next run in 5m
                </span>
              }
            >
              <DynamicIslandView id="running" className="w-max px-4 py-3">
                <span className="flex items-center gap-3">
                  <AgentAvatar seed={AGENT} name={AGENT} size="sm" />
                  <span className="flex flex-col leading-tight">
                    <span className="text-[13px] font-medium">{AGENT}</span>
                    <span className="text-[11px] opacity-70">{step ? `${step.label}…` : "Thinking…"}</span>
                  </span>
                  <span className="ml-2 rounded-full bg-white/10 px-2 py-0.5 font-mono text-[11px] tabular-nums">
                    {shown.view === "running" ? `${((shown.step + 1) * 1.4).toFixed(1)}s` : ""}
                  </span>
                  <ThinkingOrb state={step?.orb ?? "breathing"} size={20} theme="dark" />
                </span>
              </DynamicIslandView>
              <DynamicIslandView id="settled" className="w-max px-4 py-3">
                <span className="flex items-center gap-3">
                  <Check className="size-4 shrink-0" />
                  <span className="flex flex-col leading-tight">
                    <span className="text-[13px] font-medium">Run finished</span>
                    <span className="text-[11px] opacity-70">Bought MOTH · score 81 · paper</span>
                  </span>
                  <span className="rounded-full bg-white/10 px-2 py-0.5 font-mono text-[11px] tabular-nums">1 trade</span>
                </span>
              </DynamicIslandView>
            </DynamicIsland>
          </BorderBeam>
        </div>
      ) : null}
    </div>
  );
}
