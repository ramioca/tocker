"use client";

/**
 * "Watch an agent think" — a scripted single run that loops on the landing page.
 *
 * Motion budget: this is the rarest-seen surface in the product (first visit, marketing),
 * so it gets a real animation. It pauses when scrolled out of view or when the tab is
 * hidden, and collapses to its finished state under `prefers-reduced-motion`.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Activity, ArrowUpRight, CircleDollarSign } from "lucide-react";
import { AgentSteps } from "@/components/spectrumui/blocks/ai-assistants/agent-steps";
import { ToolChips } from "@/components/spectrumui/blocks/ai-assistants/tool-chips";
import type { ToolCall } from "@/components/spectrumui/blocks/ai-assistants/types";
import { DynamicIsland, DynamicIslandView } from "@/components/spectrumui/dynamic-island";
import { NumberTicker } from "@/components/spectrumui/number-ticker";
import { usePrefersReducedMotion } from "@/components/spectrumui/use-typewriter";
import { AgentAvatar } from "@/components/social-common/agent-avatar";
import { BRAIN_SCRIPT } from "@/mocks/social";

/** Cumulative x402 spend after each step, in USD. */
const SPEND_AFTER = [0, 0, 0.01, 0.01, 0.01];

const ISLAND_VIEW = ["portfolio", "sweep", "score", "trade", "post"] as const;

const HOLD_MS = 3000;

export function AgentBrainDemo() {
  const reduced = usePrefersReducedMotion();
  const total = BRAIN_SCRIPT.length;
  const [index, setIndex] = useState(0);
  const [finished, setFinished] = useState(false);
  const [active, setActive] = useState(true);
  const rootRef = useRef<HTMLDivElement>(null);

  // Pause off-screen and in background tabs — an idle loop in a hidden tab is waste.
  useEffect(() => {
    const node = rootRef.current;
    if (!node) return;
    let visible = document.visibilityState === "visible";
    let onScreen = true;
    const sync = () => setActive(visible && onScreen);

    const observer = new IntersectionObserver(
      ([entry]) => {
        onScreen = entry.isIntersecting;
        sync();
      },
      { rootMargin: "0px 0px -10% 0px" },
    );
    observer.observe(node);

    const onVisibility = () => {
      visible = document.visibilityState === "visible";
      sync();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  useEffect(() => {
    if (reduced || !active) return;
    if (finished) {
      const id = setTimeout(() => {
        setFinished(false);
        setIndex(0);
      }, HOLD_MS);
      return () => clearTimeout(id);
    }
    const id = setTimeout(() => {
      if (index + 1 >= total) setFinished(true);
      else setIndex(index + 1);
    }, BRAIN_SCRIPT[index].runMs);
    return () => clearTimeout(id);
  }, [index, finished, reduced, active, total]);

  const done = reduced || finished;
  const completed = done ? total : index;

  const steps: ToolCall[] = useMemo(
    () =>
      BRAIN_SCRIPT.map((step, i) => {
        const status: ToolCall["status"] = i < completed ? "success" : i === completed ? "running" : "pending";
        return {
          id: step.id,
          name: step.name,
          args: step.args,
          result: step.result,
          status,
          ...(status === "success" ? { startedAt: 0, completedAt: step.runMs } : {}),
        };
      }),
    [completed],
  );

  const currentStep = BRAIN_SCRIPT[Math.min(completed, total - 1)];
  const spend = SPEND_AFTER[Math.min(completed, SPEND_AFTER.length - 1)];
  const islandView = done ? "post" : ISLAND_VIEW[Math.min(index, ISLAND_VIEW.length - 1)];

  const restart = useCallback(() => {
    setFinished(false);
    setIndex(0);
  }, []);

  return (
    <div ref={rootRef} className="flex flex-col items-center">
      <DynamicIsland view={islandView} className="mb-[-14px] z-10">
        <DynamicIslandView id="portfolio" className="px-5 py-2.5">
          <IslandRow icon={<Activity className="size-3.5" aria-hidden />} label="Reading portfolio" value="2 positions" />
        </DynamicIslandView>
        <DynamicIslandView id="sweep" className="px-5 py-2.5">
          <IslandRow icon={<Activity className="size-3.5" aria-hidden />} label="Swept 214 tokens" value="31 left" />
        </DynamicIslandView>
        <DynamicIslandView id="score" className="px-5 py-2.5">
          <IslandRow icon={<CircleDollarSign className="size-3.5" aria-hidden />} label="PLNK scores 81 · paid sentiment" value="$0.01" />
        </DynamicIslandView>
        <DynamicIslandView id="trade" className="px-5 py-2.5">
          <IslandRow icon={<ArrowUpRight className="size-3.5" aria-hidden />} label="Buying PLNK" value="$120" />
        </DynamicIslandView>
        <DynamicIslandView id="post" className="px-5 py-2.5">
          <IslandRow icon={<Activity className="size-3.5" aria-hidden />} label="Posted to the feed" value="run #482" />
        </DynamicIslandView>
      </DynamicIsland>

      <div className="w-full overflow-hidden rounded-2xl border border-border/80 bg-card/70 shadow-2xl shadow-black/30 backdrop-blur">
        <div className="flex items-center gap-3 border-b border-border/70 px-4 pt-6 pb-3">
          <AgentAvatar seed="launch-hunter" label="Launch Hunter" size="sm" />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">Launch Hunter</p>
            <p className="truncate text-[11px] text-muted-foreground">
              paper · solana + base · claude sonnet 5
            </p>
          </div>
          <span className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-border/70 px-2 py-0.5 font-mono text-[10px] tracking-wide text-muted-foreground uppercase">
            <span
              className="size-1.5 rounded-full bg-primary motion-safe:animate-pulse"
              aria-hidden
            />
            {done ? "done" : "live"}
          </span>
        </div>

        <div className="px-4 py-3">
          <ToolChips
            calls={steps}
            variant="Row"
            className="max-w-none [&_button]:pointer-events-none"
          />
        </div>

        <div className="px-4 pb-2">
          <AgentSteps steps={steps} variant="Compact" className="max-w-none" />
        </div>

        {/* The live readout: whatever the current step just returned. */}
        <div className="mx-4 mb-4 rounded-xl border border-border/70 bg-background/60 px-3 py-2.5">
          <p className="font-mono text-[10px] tracking-wide text-muted-foreground uppercase">
            {currentStep.name}
          </p>
          <p key={currentStep.id} className="lp-rise mt-1 font-mono text-[12px] leading-5 text-foreground/90">
            {currentStep.result}
          </p>
        </div>

        <div className="flex items-center gap-3 border-t border-border/70 px-4 py-3 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <CircleDollarSign className="size-3.5" aria-hidden />
            x402 spend this run
          </span>
          <span className="ml-auto font-mono tabular-nums text-foreground">
            <NumberTicker value={Math.round(spend * 100)} pad={2} prefix="$0." />
          </span>
        </div>
      </div>

      {reduced ? null : (
        <button
          type="button"
          onClick={restart}
          className="lp-press mt-3 rounded-lg px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          Replay the run
        </button>
      )}
    </div>
  );
}

function IslandRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <span className="flex items-center gap-2 text-xs font-medium whitespace-nowrap">
      {icon}
      {label}
      <span className="font-mono tabular-nums opacity-70">{value}</span>
    </span>
  );
}
