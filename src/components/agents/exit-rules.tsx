"use client";

import { useState, type ReactNode } from "react";
import { Module } from "@/components/agents/builder/module";
import { SPECS } from "@/components/agents/builder/module-specs";
import { sayHold, type ValueSpec } from "@/components/agents/builder/typed-value";
import type { AgentConfig } from "@/db/schema";

type Risk = AgentConfig["risk"];

/**
 * The exit-rule half of an agent's risk config, as one self-contained field group.
 *
 * Every rule here is enforced by the exit engine (`src/lib/trading/exits.ts`), applied by
 * the guardian before each tick and every five minutes in between — so the copy says
 * what will *happen*, not what the agent should consider. The rules are nullable by
 * design: off is a real answer, and the toggle is the honest way to express it.
 *
 * Mounted by the agent builder and the settings form (both owned by other workstreams):
 *
 *   <ExitRulesFields value={config.risk} onChange={(risk) => setConfig({ ...config, risk })} />
 *
 * It only ever rewrites the six exit fields; everything else in `risk` passes through
 * untouched.
 */
export function ExitRulesFields({
  value,
  onChange,
  className,
}: {
  value: Risk;
  onChange: (next: Risk) => void;
  className?: string;
}) {
  const set = <K extends keyof Risk>(key: K, next: Risk[K]): void => onChange({ ...value, [key]: next });

  return (
    <div className={className}>
      {/* One card per rule. Top-aligned, so a rule that is off does not stretch to match
          an open neighbour. */}
      <div className="grid items-start gap-3 sm:grid-cols-2">
        <OptionalRule
          id="exit-stop-loss"
          label="Stop loss"
          description="Sell when the mark falls this far below the average entry. The floor under every position."
          value={value.stopLossPct}
          defaultValue={15}
          onChange={(next) => set("stopLossPct", next)}
          spec={SPECS.stopLossPct}
          slider={{ min: 1, max: 90, step: 1 }}
          meaning={(v) => `A position ${v}% below entry is sold on the next pass, at most five minutes later.`}
        />

        <OptionalRule
          id="exit-take-profit"
          label="Take profit"
          description="Sell when the mark rises this far above entry."
          value={value.takeProfitPct}
          defaultValue={40}
          onChange={(next) => set("takeProfitPct", next)}
          spec={SPECS.takeProfitPct}
          slider={{ min: 5, max: 500, step: 5 }}
          meaning={(v) => `Gains are banked at +${v}% instead of waiting for the next thought.`}
        />

        <OptionalRule
          id="exit-trailing-stop"
          label="Trailing stop"
          description="Sell when the mark falls this far from the highest price seen since entry. Only armed once the position is in profit, so it locks in gains and never pre-empts the stop loss."
          value={value.trailingStopPct}
          defaultValue={25}
          onChange={(next) => set("trailingStopPct", next)}
          spec={SPECS.trailingStopPct}
          slider={{ min: 5, max: 90, step: 1 }}
          meaning={(v) =>
            `A winner that gives back ${v}% of its peak is closed. Set it loose: a ${v}% retrace is ordinary for a launch that is working.`
          }
        />

        <OptionalRule
          id="exit-max-hold"
          label="Max hold"
          description="Sell a position that has been open longer than this, whatever it is doing."
          value={value.maxHoldHours}
          defaultValue={24}
          onChange={(next) => set("maxHoldHours", next)}
          spec={SPECS.maxHoldHours}
          slider={{ min: 1, max: 168, step: 1 }}
          meaning={(v) => `Anything still open after ${sayHold(v)} is closed. Capital stops being tied up in a thesis that had its window.`}
        />

        <OptionalRule
          id="exit-score-floor"
          label="Score floor"
          description="Rescore every holding each pass and sell any token that drops below this."
          value={value.exitScoreBelow}
          defaultValue={40}
          onChange={(next) => set("exitScoreBelow", next)}
          spec={SPECS.exitScoreBelow}
          slider={{ min: 5, max: 90, step: 1 }}
          meaning={(v) =>
            `A holding that rescores under ${v}/100 — or picks up a hard-gate failure — is sold. Scoring is free, so this costs nothing to leave on.`
          }
        />

        <OptionalRule
          id="exit-liquidity"
          label="Liquidity collapse"
          description="Sell when the pooled liquidity behind a holding falls this far below what it was when you bought."
          value={value.exitOnLiquidityDropPct}
          defaultValue={50}
          onChange={(next) => set("exitOnLiquidityDropPct", next)}
          spec={SPECS.exitOnLiquidityDropPct}
          slider={{ min: 10, max: 90, step: 5 }}
          meaning={(v) => `Half the point of an exit is being able to take it: ${v}% of the pool gone means the door is closing.`}
        />
      </div>

      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
        These run in code, not in the model: the exit engine applies them before every run and
        every five minutes in between, and publishes the reason with the trade. Turning them all
        off is allowed — then nothing sells a position but the agent itself.
      </p>
    </div>
  );
}

/**
 * A rule that can be off, as one card. The switch is the rule's existence; the value
 * and the slider are its threshold. Turning it off preserves nothing — `null` is what
 * the config means by "off" — and turning it back on restores the default rather than
 * the last value, because a half-remembered threshold is worse than a stated one.
 */
function OptionalRule({
  id,
  label,
  description,
  value,
  defaultValue,
  onChange,
  spec,
  slider,
  meaning,
}: {
  id: string;
  label: string;
  description: string;
  value: number | null;
  defaultValue: number;
  onChange: (next: number | null) => void;
  /** What may be typed into the threshold, and how it is printed. */
  spec: ValueSpec;
  /** The track. */
  slider: { min: number; max: number; step: number };
  meaning: (value: number) => ReactNode;
}) {
  // While the card closes, its body goes on saying the threshold the rule just had,
  // not the default; nothing is stored from this.
  const [last, setLast] = useState(value ?? defaultValue);
  if (value !== null && value !== last) setLast(value);
  return (
    <Module
      id={id}
      label={label}
      description={description}
      spec={spec}
      value={value}
      toggle={{ defaultValue }}
      sliderRest={last}
      slider={slider}
      meaning={meaning(value ?? last)}
      onChange={onChange}
    />
  );
}
