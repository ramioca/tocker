"use client";

/**
 * How trades leave the agent: on their own, or past you first.
 *
 * This is the one setting that changes what the agent *is*, so it is written as two
 * choices with consequences rather than a switch with a label. The TTL only appears once
 * approval is on — an expiry with nothing to expire is noise.
 */
import { Check, Gavel, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AgentConfig } from "@/db/schema";

export type ExecutionConfig = AgentConfig["execution"];

export const DEFAULT_EXECUTION: ExecutionConfig = { mode: "auto", proposalTtlMinutes: 60 };

/**
 * TTL presets. Deliberately declared here rather than imported from
 * `@/lib/trading/proposals`: that module reaches the database, and this one ships to the
 * browser.
 */
export const PROPOSAL_TTL_PRESETS = [
  { minutes: 15, label: "15 min", hint: "Fast markets. Miss it and the agent re-proposes next tick." },
  { minutes: 60, label: "1 hour", hint: "The default. Long enough to see a phone notification." },
  { minutes: 240, label: "4 hours", hint: "You check in a few times a day." },
  { minutes: 1_440, label: "24 hours", hint: "Slow theses only — a day-old quote is a different market." },
] as const;

const MODES: Array<{
  mode: ExecutionConfig["mode"];
  label: string;
  icon: typeof Zap;
  blurb: string;
}> = [
  {
    mode: "auto",
    label: "Trade on its own",
    icon: Zap,
    blurb:
      "Every order that clears the risk guard routes immediately. This is what makes the record its own — nobody had to be awake.",
  },
  {
    mode: "approve",
    label: "Ask me first",
    icon: Gavel,
    blurb:
      "The agent scores, sizes and explains the trade, then waits for you to approve it. Buys and sells both. Approving re-scores and re-quotes before anything routes, so you never fill on a stale number.",
  },
];

export function ExecutionControls({
  idPrefix = "execution",
  execution,
  onChange,
}: {
  execution: ExecutionConfig | undefined;
  onChange: (next: ExecutionConfig) => void;
  idPrefix?: string;
}) {
  const value = execution ?? DEFAULT_EXECUTION;
  const approving = value.mode === "approve";

  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2">
        {MODES.map((option) => {
          const active = value.mode === option.mode;
          const Icon = option.icon;
          return (
            <button
              key={option.mode}
              id={`${idPrefix}-${option.mode}`}
              type="button"
              aria-pressed={active}
              onClick={() => onChange({ ...value, mode: option.mode })}
              className={cn(
                "flex flex-col gap-1.5 rounded-xl border p-3 text-left",
                "transition-[border-color,background-color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.99]",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                active
                  ? "border-primary/50 bg-primary/8"
                  : "border-border/70 bg-card/30 hover:border-border hover:bg-card/60",
              )}
            >
              <span className="flex items-center gap-2">
                <Icon aria-hidden className="size-3.5 text-muted-foreground" />
                <span className="text-sm font-medium">{option.label}</span>
                {active ? <Check aria-hidden className="ml-auto size-3.5 text-primary" /> : null}
              </span>
              <span className="text-xs leading-relaxed text-muted-foreground">{option.blurb}</span>
            </button>
          );
        })}
      </div>

      {approving ? (
        <div className="rounded-xl border border-border/70 bg-card/30 p-3">
          <p className="text-sm font-medium">A proposal expires after</p>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            Past this the proposal dies on its own and the agent is free to propose the token again
            next tick. A quote you approve hours later is a quote for a different market.
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-4">
            {PROPOSAL_TTL_PRESETS.map((preset) => {
              const active = value.proposalTtlMinutes === preset.minutes;
              return (
                <button
                  key={preset.minutes}
                  type="button"
                  aria-pressed={active}
                  title={preset.hint}
                  onClick={() => onChange({ ...value, proposalTtlMinutes: preset.minutes })}
                  className={cn(
                    "tnum rounded-lg border px-2.5 py-2 font-mono text-xs",
                    "transition-[border-color,background-color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.97]",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    active ? "border-primary/50 bg-primary/8" : "border-border/70 hover:border-border hover:bg-muted/40",
                  )}
                >
                  {preset.label}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
