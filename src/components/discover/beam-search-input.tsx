"use client";

/**
 * Search field whose bottom edge lights up with a traveling beam while focused.
 *
 * Spectrum's `beam-search` depends on the `border-beam` package, which is not installed
 * in this workspace (see the merge notes) — this is the same idea, hand-rolled on `motion`.
 * Constant motion, so the beam is `linear`; it only runs while the field has focus, and
 * reduced motion gets a static underline instead.
 */
import { useId, useState } from "react";
import { Search, X } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";

export function BeamSearchInput({
  value,
  onValueChange,
  placeholder = "Search",
  label,
  className,
}: {
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  label: string;
  className?: string;
}) {
  const id = useId();
  const [focused, setFocused] = useState(false);
  const reduce = useReducedMotion();

  return (
    <div className={className}>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <div className="relative overflow-hidden rounded-xl border border-border/80 bg-card/60 transition-colors duration-150 focus-within:border-ring">
        <Search
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <input
          id={id}
          type="search"
          value={value}
          placeholder={placeholder}
          onChange={(event) => onValueChange(event.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          className="h-10 w-full bg-transparent pr-9 pl-9 text-sm outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden"
        />
        {value ? (
          <button
            type="button"
            onClick={() => onValueChange("")}
            aria-label="Clear search"
            className="absolute top-1/2 right-2 grid size-6 -translate-y-1/2 place-items-center rounded-md text-muted-foreground transition-[color,transform] duration-150 hover:text-foreground active:scale-95 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <X className="size-3.5" aria-hidden />
          </button>
        ) : null}

        <span aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-px overflow-hidden">
          {focused ? (
            reduce ? (
              <span className="block h-px w-full bg-primary/70" />
            ) : (
              <motion.span
                className="block h-px w-1/3"
                style={{
                  background:
                    "linear-gradient(90deg, transparent, var(--primary), transparent)",
                }}
                initial={{ transform: "translateX(-100%)" }}
                animate={{ transform: "translateX(300%)" }}
                transition={{ repeat: Infinity, ease: "linear", duration: 1.6 }}
              />
            )
          ) : null}
        </span>
      </div>
    </div>
  );
}
