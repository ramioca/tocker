"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Module, Switch } from "./module";
import type { ValueSpec } from "./typed-value";

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
        <p
          id={htmlFor ? `${htmlFor}-error` : undefined}
          role="alert"
          className="text-xs text-destructive"
        >
          {error}
        </p>
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
 *
 * `min`, `max`, `step` and `ladder` are the track; `spec` is what may be typed into
 * the value, and how it is printed.
 */
export function RiskSlider({
  id,
  label,
  value,
  min,
  max,
  step = 1,
  spec,
  ladder,
  meaning,
  onChange,
  className,
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  spec: ValueSpec;
  /** Rungs for the thumb when the range is log-ish; typing still takes any value in range. */
  ladder?: readonly number[];
  meaning: ReactNode;
  onChange: (value: number) => void;
  className?: string;
}) {
  return (
    <Module
      id={id}
      label={label}
      spec={spec}
      value={value}
      slider={ladder ? { ladder } : { min, max, step }}
      meaning={meaning}
      className={className}
      // None of these fields has an "Any" state, so there is never a null to pass on.
      onChange={(next) => {
        if (next !== null) onChange(next);
      }}
    />
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
      <Switch
        id={id}
        label={label}
        checked={checked}
        onChange={onChange}
        disabled={disabled}
        className="mt-0.5"
      />
    </div>
  );
}
