"use client";

import { useState, useTransition } from "react";
import { Check, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  DEFAULT_SIZING,
  SIZING_EXPLANATIONS,
  SIZING_LABELS,
  sizeOrder,
  type PositionSizingConfig,
  type PositionSizingMode,
} from "@/lib/trading/sizing";
import { formatUsd } from "@/components/common/format";

/**
 * Picking a sizing mode — and, crucially, seeing what it does to the next ticket before
 * committing to it.
 *
 * The preview is the whole point. "Percent of equity, 10%" is an abstraction; "$412
 * right now, capped at your $500 max" is a decision. So this renders the live ceiling
 * from the same {@link sizeOrder} the risk guard calls — not a re-implementation of it,
 * the same function — which is what stops the form and the guard from ever disagreeing.
 *
 * Presentational: it owns its draft state and either saves it itself (`onSave`, with its
 * own button) or reports every change to a form that saves it (`onChange`, no button —
 * the agent settings form, so sizing and the caps above it share one Save).
 * `src/components/agents/manual-trade.tsx` uses the read-only half ({@link SizingSummary})
 * to explain the ceiling next to the amount field.
 */

const MODES: PositionSizingMode[] = ["fixed_usd", "percent_equity", "volatility_scaled"];

/** The bounds `positionSizingSchema` enforces on the server, so a Save can never trip them. */
const PERCENT_BOUNDS = {
  percentOfEquity: { min: 0.1, max: 100 },
  referenceRangePct: { min: 1, max: 500 },
} as const;

/**
 * A percentage typed freely and clamped when it is left — the same pattern as the risk
 * sliders' exact-value box. Reporting every keystroke let "" and "500" reach the form,
 * whose Save then failed on a schema path ("risk.sizing.percentOfEquity: Too big")
 * the field itself never mentioned.
 */
function PercentInput({
  id,
  value,
  min,
  max,
  describedBy,
  onCommit,
}: {
  id: string;
  value: number;
  min: number;
  max: number;
  describedBy?: string;
  onCommit: (value: number) => void;
}) {
  const [text, setText] = useState<string | null>(null);

  const commit = () => {
    if (text === null) return;
    const parsed = Number(text);
    // Emptied or unreadable: keep the value it had rather than inventing one.
    if (text.trim() !== "" && Number.isFinite(parsed)) {
      const clamped = Math.min(max, Math.max(min, Math.round(parsed * 100) / 100));
      if (clamped !== value) onCommit(clamped);
    }
    setText(null);
  };

  return (
    <div className="relative">
      <Input
        id={id}
        type="text"
        inputMode="decimal"
        aria-describedby={describedBy}
        className="tnum pr-7 font-mono"
        value={text ?? String(value)}
        onChange={(event) => setText(event.target.value.replace(/[^0-9.]/g, ""))}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            event.currentTarget.blur();
          } else if (event.key === "Escape") {
            setText(null);
          }
        }}
      />
      <span className="pointer-events-none absolute inset-y-0 right-3 grid place-items-center text-xs text-muted-foreground">
        %
      </span>
    </div>
  );
}

export function SizingControls({
  value,
  maxTradeUsd,
  equityUsd,
  onSave,
  onChange,
  className,
}: {
  /** The starting point; the draft is local after that so a half-typed number is not clamped. */
  value: PositionSizingConfig | null | undefined;
  /** The hard ceiling. Shown, never editable here — it belongs to the risk form. */
  maxTradeUsd: number;
  equityUsd: number | null;
  /** Persist. Returns an error message, or null on success. */
  onSave?: (next: PositionSizingConfig) => Promise<string | null>;
  /** Part of a larger form: every change is reported, and the form's own Save persists it. */
  onChange?: (next: PositionSizingConfig) => void;
  className?: string;
}) {
  const [draft, setDraft] = useState<PositionSizingConfig>(value ?? DEFAULT_SIZING);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  const save = () => {
    if (!onSave) return;
    setError(null);
    setSaved(false);
    startTransition(async () => {
      // A throw is a save that never landed; say so rather than leave the spinner's
      // silence to read as success.
      const message = await onSave(draft).catch(() => "Could not reach Tocker. Not saved.");
      if (message) setError(message);
      else setSaved(true);
    });
  };

  const set = <K extends keyof PositionSizingConfig>(key: K, next: PositionSizingConfig[K]) => {
    setSaved(false);
    const updated = { ...draft, [key]: next };
    setDraft(updated);
    onChange?.(updated);
  };

  return (
    <div className={cn("min-w-0 space-y-4", className)}>
      <fieldset className="space-y-2">
        <legend className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
          Position sizing
        </legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {MODES.map((mode) => {
            const selected = draft.mode === mode;
            return (
              <button
                key={mode}
                type="button"
                onClick={() => set("mode", mode)}
                aria-pressed={selected}
                className={cn(
                  "rounded-xl border px-3 py-2.5 text-left",
                  "transition-[background-color,border-color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)]",
                  "active:scale-[0.99] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                  selected
                    ? "border-primary/60 bg-primary/10"
                    : "border-border/70 bg-card/40 hover:border-border hover:bg-muted/40",
                )}
              >
                <span className="block text-sm font-medium">{SIZING_LABELS[mode]}</span>
              </button>
            );
          })}
        </div>
        <p className="text-xs leading-5 text-muted-foreground">{SIZING_EXPLANATIONS[draft.mode]}</p>
      </fieldset>

      {draft.mode === "fixed_usd" ? null : (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="sizing-pct" className="text-xs">
              Share of equity
            </Label>
            <PercentInput
              id="sizing-pct"
              value={draft.percentOfEquity}
              {...PERCENT_BOUNDS.percentOfEquity}
              describedBy="sizing-pct-range"
              onCommit={(next) => set("percentOfEquity", next)}
            />
            <p id="sizing-pct-range" className="tnum text-[11px] leading-5 text-muted-foreground">
              {PERCENT_BOUNDS.percentOfEquity.min}–{PERCENT_BOUNDS.percentOfEquity.max}% of equity
            </p>
          </div>

          {draft.mode === "volatility_scaled" ? (
            <div className="space-y-1.5">
              <Label htmlFor="sizing-range" className="text-xs">
                Reference range
              </Label>
              <PercentInput
                id="sizing-range"
                value={draft.referenceRangePct}
                {...PERCENT_BOUNDS.referenceRangePct}
                describedBy="sizing-range-hint"
                onCommit={(next) => set("referenceRangePct", next)}
              />
              <p id="sizing-range-hint" className="text-[11px] leading-5 text-muted-foreground">
                <span className="tnum">
                  {PERCENT_BOUNDS.referenceRangePct.min}–{PERCENT_BOUNDS.referenceRangePct.max}%.
                </span>{" "}
                A token that has ranged this much recently still gets a full clip. One ranging twice as wide gets half.
                It never sizes <em>up</em>.
              </p>
            </div>
          ) : null}
        </div>
      )}

      <SizingSummary sizing={draft} maxTradeUsd={maxTradeUsd} equityUsd={equityUsd} />

      {onSave && !onChange ? (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={save}
            disabled={pending}
            className={cn(
              "inline-flex items-center gap-2 rounded-lg bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground",
              "transition-transform duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.98]",
              "disabled:opacity-60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
            )}
          >
            {pending ? <Loader2 aria-hidden className="size-3.5 animate-spin" /> : null}
            {pending ? "Saving" : "Save sizing"}
          </button>
          {saved && !pending ? (
            <span className="inline-flex items-center gap-1.5 text-xs text-positive">
              <Check aria-hidden className="size-3.5" /> Saved
            </span>
          ) : null}
          {error ? <span className="text-xs text-destructive">{error}</span> : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * The read-only half: what the next ticket may be, and how that number was reached.
 * Safe to render anywhere an amount is being chosen.
 */
export function SizingSummary({
  sizing,
  maxTradeUsd,
  equityUsd,
  rangePct = null,
  className,
}: {
  sizing: PositionSizingConfig | null | undefined;
  maxTradeUsd: number;
  equityUsd: number | null;
  /** Recent range for the token being sized, when one is known. */
  rangePct?: number | null;
  className?: string;
}) {
  const result = sizeOrder({ sizing: sizing ?? DEFAULT_SIZING, maxTradeUsd, equityUsd, rangePct });
  return (
    <div className={cn("rounded-xl border border-border/70 bg-card/40 px-3 py-2.5", className)}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[11px] tracking-wide text-muted-foreground uppercase">Max ticket now</span>
        <span className="tnum font-mono text-sm font-medium">{formatUsd(result.amountUsd)}</span>
      </div>
      <p className="mt-1 text-[11px] leading-5 text-muted-foreground">{result.explanation}</p>
      {result.belowMinimum ? (
        <p className="mt-1 text-[11px] leading-5 text-negative">
          That is below your ${sizing?.minTradeUsd ?? DEFAULT_SIZING.minTradeUsd} minimum ticket. Nothing blocks it: a
          ticket this size is placed like any other.
        </p>
      ) : null}
    </div>
  );
}
