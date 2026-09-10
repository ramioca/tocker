"use client";

import type { ReactNode } from "react";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";

export function Field({
  label,
  hint,
  error,
  htmlFor,
  children,
  className,
}: {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  htmlFor?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={htmlFor} className="block text-sm font-medium">
        {label}
      </label>
      {children}
      {error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

export function StepHeading({ title, blurb }: { title: string; blurb: string }) {
  return (
    <div>
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{blurb}</p>
    </div>
  );
}

/**
 * A slider that explains itself. The number alone means nothing to somebody
 * who has never run a trading bot — the sentence underneath is the real label.
 */
export function RiskSlider({
  id,
  label,
  value,
  min,
  max,
  step = 1,
  format,
  meaning,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  format: (value: number) => string;
  meaning: string;
  onChange: (value: number) => void;
}) {
  return (
    <div className="rounded-xl border border-border/70 bg-card/30 p-3">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
        <output htmlFor={id} className="tnum font-mono text-sm">
          {format(value)}
        </output>
      </div>
      <Slider
        id={id}
        className="mt-3"
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={(next) => {
          const first = Array.isArray(next) ? next[0] : next;
          if (typeof first === "number") onChange(first);
        }}
      />
      <p className="mt-2.5 text-xs leading-relaxed text-muted-foreground">{meaning}</p>
    </div>
  );
}

export function Toggle({
  id,
  label,
  description,
  checked,
  onChange,
  disabled,
}: {
  id: string;
  label: string;
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-start justify-between gap-4 rounded-xl border border-border/70 bg-card/30 p-3",
        disabled && "opacity-60",
      )}
    >
      <div className="min-w-0">
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
        {description ? (
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{description}</p>
        ) : null}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative mt-0.5 h-5 w-9 shrink-0 rounded-full border border-transparent",
          "transition-colors duration-200 ease-[cubic-bezier(0.23,1,0.32,1)]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          "disabled:pointer-events-none",
          checked ? "bg-primary" : "bg-muted",
        )}
      >
        <span
          aria-hidden
          className={cn(
            "absolute top-0.5 left-0.5 size-4 rounded-full bg-background shadow",
            "transition-transform duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none",
          )}
          style={{ transform: checked ? "translateX(16px)" : "translateX(0)" }}
        />
      </button>
    </div>
  );
}
