"use client";

import { useEffect, useRef, useState } from "react";
import { useInView } from "motion/react";
import { usePageVisible, useSafeReducedMotion } from "./motion";
import { BorderBeam } from "@/components/spectrumui/border-beam";
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
  // The server cannot know the motion preference: hold it until hydration so
  // the first client render matches the server's HTML.
  const reduced = useSafeReducedMotion();
  const visible = usePageVisible();
  const dock = useRef<HTMLDivElement>(null);
  const onScreen = useInView(dock, { amount: 0.1 });
  const [frame, setFrame] = useState<Frame>({ view: null });

  useEffect(() => {
    if (!onScreen || !visible || reduced) return;
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
  }, [onScreen, visible, reduced]);

  const shown: Frame = reduced ? { view: "settled" } : frame;
  const step = shown.view === "running" ? STEPS[shown.step] : null;

  return (
    <div ref={dock} className="lp-island-dock" aria-label="Sample: an agent run, as the owner sees it" role="img">
      {onScreen || reduced ? (
        <div aria-hidden>
          {/* Spectrum's beam (one rotating conic layer), not the npm border-beam package,
              whose blur/hue filters and 30fps custom-property loop were the page's
              largest steady main-thread cost. Mounted only while a run is live. */}
          <div className="relative inline-flex rounded-[32px]">
            {shown.view === "running" && !reduced ? (
              <BorderBeam duration={5} borderWidth={1} colorFrom="rgba(63, 210, 255, 0)" colorTo="rgba(63, 210, 255, 0.9)" isHovered className="z-10" />
            ) : null}
            <DynamicIsland
              view={shown.view}
              className="border border-white/10 bg-black text-white"
              compact={
                <span className="flex items-center gap-2 whitespace-nowrap">
                  <span className="lp-island-dot" />
                  {AGENT} · next run in 15m
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
                    <span className="text-[11px] opacity-70">Wants to buy MOTH · score 81 · paper</span>
                  </span>
                  <span className="rounded-full bg-white/10 px-2 py-0.5 font-mono text-[11px] tabular-nums">1 to approve</span>
                </span>
              </DynamicIslandView>
            </DynamicIsland>
          </div>
        </div>
      ) : null}
    </div>
  );
}
