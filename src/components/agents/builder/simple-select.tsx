"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

export interface SelectOption {
  value: string;
  label: string;
  hint?: string;
}

/**
 * Base UI's Select is controlled with `items` so the trigger can render a label
 * rather than the raw value. This wrapper keeps that wiring in one place.
 */
export function SimpleSelect({
  id,
  value,
  options,
  onChange,
  placeholder = "Select…",
  className,
  disabled,
  invalid,
  describedBy,
}: {
  id?: string;
  value: string | null;
  options: SelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  /** Marks the trigger invalid (the trigger styles `aria-invalid`) and ties it to its error. */
  invalid?: boolean;
  describedBy?: string;
}) {
  return (
    <Select
      items={options.map((option) => ({ value: option.value, label: option.label }))}
      value={value}
      onValueChange={(next: string | null) => {
        if (typeof next === "string") onChange(next);
      }}
      disabled={disabled}
    >
      <SelectTrigger
        id={id}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        className={cn("w-full", className)}
      >
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            <span className="flex min-w-0 flex-col">
              <span className="truncate">{option.label}</span>
              {option.hint ? (
                <span className="truncate text-[11px] text-muted-foreground">{option.hint}</span>
              ) : null}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
