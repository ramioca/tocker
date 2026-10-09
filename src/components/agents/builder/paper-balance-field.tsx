"use client";

import { useState } from "react";
import { CircleAlert } from "lucide-react";
import { formatUsd } from "@/components/common/format";
import { cn } from "@/lib/utils";
import { Field } from "./field";
import { NOTE, PREVIEW, ValueField, type FieldNote } from "./module";
import { SPECS } from "./module-specs";
import { paperLabel } from "./paper-balance";
import { PAPER_BALANCES } from "./types";

/**
 * The paper starting balance: three amounts to press and a box to type any other into.
 * The Schedule step draws it while an agent is being made, and again over a saved agent
 * whose paper book is still untouched.
 *
 * The box is the same typed entry every module has (`ValueField`), with the same rules:
 * nothing is written while typing, and an amount that cannot be read or is out of range
 * is refused and the old one kept, never moved to the nearest limit. It always shows the
 * balance, so a pressed button and the box agree, and an amount typed that is one of the
 * three lights its button.
 *
 * `locked` is why the balance cannot be changed, for a saved agent that has traded. Then
 * there is no control: the amount in full, and that sentence.
 */
export function PaperBalanceField({
  label,
  hint,
  value,
  onChange,
  locked,
}: {
  label: string;
  hint: string;
  value: number;
  onChange: (usd: number) => void;
  locked?: string;
}) {
  const [note, setNote] = useState<FieldNote | null>(null);
  const [reads, setReads] = useState<string | null>(null);
  // A note belongs to the amount it was said about, as in `Module`: once the balance moves
  // on (a button, a Discard) it is gone for good.
  if (note !== null && note.value !== value) setNote(null);
  const live = note !== null && note.value === value ? note : null;
  const refused = live?.kind === "refused";
  // An amount that is none of the three is the box's own: it is lit the way a pressed
  // button is, so exactly one of the four always reads as the choice.
  const typed = !(PAPER_BALANCES as readonly number[]).includes(value);

  if (locked) {
    return (
      <Field label={label} hint={locked}>
        <p className="tnum font-mono text-sm">{formatUsd(value)}</p>
      </Field>
    );
  }

  return (
    <Field label={label} htmlFor="paper-balance-value" hint={hint}>
      <div>
        <div role="group" aria-label={label} className="flex flex-wrap items-center gap-2">
          {PAPER_BALANCES.map((amount) => {
            const active = value === amount;
            return (
              <button
                key={amount}
                type="button"
                aria-pressed={active}
                onClick={() => {
                  setNote(null);
                  onChange(amount);
                }}
                className={cn(
                  "tnum rounded-xl border px-3 py-2 font-mono text-sm",
                  "transition-[border-color,background-color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.97]",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  active
                    ? "border-primary/50 bg-primary/8"
                    : "border-border/70 hover:border-border hover:bg-muted/40",
                )}
              >
                {paperLabel(amount)}
              </button>
            );
          })}
          {/* A fixed width, so the row is the same whatever is typed: under the buttons
              and as wide as the step on a phone, beside them from `sm`. The box itself is
              as tall as a button, and the frame of one, so the four read as one row. */}
          <span className="w-full sm:w-44">
            <ValueField
              id="paper-balance"
              label={label}
              spec={SPECS.paperStart}
              value={value}
              invalid={refused}
              describedBy="paper-balance-note"
              className={cn("h-[38px] rounded-xl px-3 text-left md:text-sm", typed && "border-primary/50 bg-primary/8")}
              style={{ width: "100%" }}
              // The balance has no "Any": there is never a null to pass on.
              onCommit={(next) => {
                if (next !== null) onChange(next);
              }}
              onNote={setNote}
              onPreview={setReads}
            />
          </span>
        </div>
        {/* Not live: a screen reader is not read a sentence per keystroke. */}
        <p id="paper-balance-preview" className={PREVIEW}>
          {reads}
        </p>
        {/* Always mounted so screen readers are already listening when a note lands. */}
        <p
          id="paper-balance-note"
          aria-live="polite"
          className={cn(NOTE, live?.show ? (refused ? "text-destructive" : "text-muted-foreground") : "sr-only")}
        >
          {refused ? <CircleAlert aria-hidden className="size-3.5 shrink-0" /> : null}
          {live ? <span>{live.text}</span> : null}
        </p>
      </div>
    </Field>
  );
}
