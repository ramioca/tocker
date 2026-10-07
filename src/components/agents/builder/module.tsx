"use client";

import { useState, type CSSProperties, type ReactNode } from "react";
import { CircleAlert } from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import { FOCUS, TYPE } from "./look";
import { display, preview, settle, type ValueSpec } from "./typed-value";
import { ladderStops, nearestStopIndex } from "./types";

/**
 * One module: a name, a value that can be typed, a slider, and a sentence that says
 * what the number does. Every slider in the builder and in Settings is this card, so
 * they read as one family and share one set of rules for typed entry.
 *
 * Class names are whole literals so Tailwind sees them.
 */

/** The frame of the builder's choice cards without the hover, so modules sit in the same family. */
export const MODULE =
  "relative rounded-xl border border-white/[0.09] bg-card/40 p-4 " +
  "transition-[border-color] duration-150 ease-[var(--ease-out-strong)] focus-within:border-white/[0.18]";
/** A module that does nothing right now: said by the dashed frame and a pill, not by dimming. */
export const MODULE_INACTIVE = "border-dashed bg-transparent";

/**
 * The value at rest is a faint filled box: touch has no hover, and the number must read
 * as editable. 16px under `md`, because iOS zooms into anything smaller; 44px tall on touch.
 */
export const VALUE_FIELD =
  "tnum h-8 max-w-full min-w-0 rounded-lg border border-white/[0.09] bg-white/[0.04] px-2 text-right " +
  "font-mono text-base leading-5 text-foreground md:text-[15px] pointer-coarse:h-11 " +
  "transition-[border-color,background-color] duration-150 ease-[var(--ease-out-strong)] " +
  "hover:border-white/[0.18] hover:bg-white/[0.06] " +
  "focus:border-primary/70 focus:bg-background focus:outline-none focus-visible:ring-2 focus-visible:ring-ring " +
  "aria-invalid:border-destructive/70 " +
  "disabled:cursor-not-allowed disabled:border-transparent disabled:bg-transparent disabled:text-muted-foreground";

/** A body that opens and closes by its grid row, so it can be interrupted mid-way. */
export const COLLAPSE =
  "grid grid-rows-[0fr] transition-[grid-template-rows] duration-200 ease-[var(--ease-out-strong)] " +
  "data-[open=true]:grid-rows-[1fr] motion-reduce:transition-none";

export const PREVIEW = "mt-2 font-mono text-[11px] leading-4 tnum text-muted-foreground empty:hidden";
export const NOTE = "mt-2 flex items-center gap-1.5 text-xs leading-[18px] tnum";

/** A finger needs 44px; the control keeps its drawn size and grows an invisible band on touch. */
const TOUCH_BAND =
  "relative pointer-coarse:after:absolute pointer-coarse:after:-inset-x-2 pointer-coarse:after:-inset-y-3";

/**
 * What a commit said. `value` is the stored value the note is about: the note is shown
 * only while the module still holds it, so a preset or a drag retires it without an effect.
 */
export type FieldNote = {
  kind: "set" | "refused";
  text: string;
  /** Visible, not only spoken. A refusal always is. */
  show: boolean;
  value: number | null;
};

/**
 * The value of a module, and the way to set an exact one. It is a text box at all
 * times, so it is in the tab order and labelled; at rest it shows the formatted value.
 *
 * Nothing is written while typing: a draft that passed through $1 on the way to $150
 * would flick every summary on the page. Enter, Tab or a tap elsewhere commits, and a
 * value that cannot be read or is out of range is refused and the old one kept. It is
 * never clamped: on a money form nothing is stored that was not typed.
 */
export function ValueField({
  id,
  label,
  spec,
  value,
  disabled,
  invalid,
  describedBy,
  className,
  style,
  onCommit,
  onNote,
  onPreview,
}: {
  id: string;
  /** The accessible name, without the ", exact value" suffix. */
  label: string;
  spec: ValueSpec;
  /** The stored value; null is "Any" on a field that has such a state. */
  value: number | null;
  disabled?: boolean;
  invalid?: boolean;
  describedBy?: string;
  className?: string;
  style?: CSSProperties;
  onCommit: (value: number | null) => void;
  onNote?: (note: FieldNote | null) => void;
  /** The "Reads as …" line while typing, or null. */
  onPreview?: (line: string | null) => void;
}) {
  // null at rest; the text being edited while focused.
  const [text, setText] = useState<string | null>(null);
  const shown = display(spec, value);
  const current = text ?? shown;

  const refuse = (message: string) => onNote?.({ kind: "refused", text: message, show: true, value });

  const commit = () => {
    if (text === null) return;
    const result = settle(spec, text, value);
    setText(null);
    onPreview?.(null);
    if (result.status === "refused") refuse(result.message);
    else if (result.status === "set") {
      onCommit(result.value);
      onNote?.({ kind: "set", text: result.say, show: result.show, value: result.value });
    }
  };

  return (
    <input
      id={`${id}-value`}
      type="text"
      inputMode={spec.inputMode}
      autoComplete="off"
      autoCorrect="off"
      autoCapitalize="none"
      spellCheck={false}
      enterKeyHint="done"
      data-1p-ignore
      data-lpignore="true"
      aria-label={`${label}, exact value`}
      aria-invalid={invalid || undefined}
      aria-describedby={describedBy}
      disabled={disabled}
      value={current}
      onFocus={(event) => {
        // The text stays what was shown ("$100.00", "5 minutes") and is selected, so the
        // first key replaces it and a single digit can still be edited.
        setText(shown);
        onNote?.(null);
        const input = event.target;
        requestAnimationFrame(() => input.select());
      }}
      onChange={(event) => {
        const next = event.target.value;
        setText(next);
        onNote?.(null);
        onPreview?.(preview(spec, next, value));
      }}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          // The box must never submit or trigger anything around it.
          event.preventDefault();
          if (text === null) return;
          const result = settle(spec, text, value);
          // Refused: focus and the typed text stay, so it can be corrected in place.
          if (result.status === "refused") refuse(result.message);
          // Otherwise leaving the box is the commit, which also closes a phone keyboard.
          else event.currentTarget.blur();
        } else if (event.key === "Escape") {
          // Only swallowed when there was text to discard, so Escape still closes
          // whatever sheet the module sits in.
          if (text !== null && text !== shown) event.stopPropagation();
          setText(shown);
          onNote?.(null);
          onPreview?.(null);
          const input = event.currentTarget;
          requestAnimationFrame(() => input.select());
        }
      }}
      // Mono, so the box is as wide as its text and the card never reflows by more than that.
      style={{ width: `calc(${Math.max(5, current.length)}ch + 1.125rem)`, ...style }}
      className={cn(VALUE_FIELD, className)}
    />
  );
}

/** The switch on its own: a rule's existence, or a plain yes or no. */
export function Switch({
  id,
  label,
  checked,
  onChange,
  disabled,
  className,
}: {
  id: string;
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "h-5 w-9 shrink-0 rounded-full border border-transparent",
        TOUCH_BAND,
        "transition-colors duration-200 ease-[cubic-bezier(0.23,1,0.32,1)]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        "disabled:pointer-events-none",
        checked ? "bg-primary" : "bg-muted",
        className,
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
  );
}

/** A small button in a module's header ("Any age"), with a finger-sized hit area on touch. */
export function ModuleAction({
  pressed,
  onClick,
  children,
}: {
  pressed: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={pressed}
      onClick={onClick}
      className={cn(
        "shrink-0 rounded-md border px-1.5 py-0.5 text-[10px] font-medium",
        TOUCH_BAND,
        "transition-colors duration-150",
        FOCUS,
        pressed
          ? "border-primary/50 bg-primary/10 text-primary"
          : "border-border text-muted-foreground hover:bg-muted",
      )}
    >
      {children}
    </button>
  );
}

/** The track: its own range and step, or a ladder of stops worth having. */
export type ModuleSlider = { min: number; max: number; step?: number } | { ladder: readonly number[] };

export function Module({
  id,
  label,
  spec,
  value,
  onChange,
  meaning,
  slider,
  description,
  toggle,
  sliderRest,
  action,
  badge,
  footer,
  inactive,
  sliderOff,
  tint,
  valueColor,
  size = "md",
  className,
}: {
  id: string;
  label: string;
  /** What may be typed, and the one formatter for the field, the slider and its ends. */
  spec: ValueSpec;
  /** null is "Any" on a field with such a state, and "off" on a module with a toggle. */
  value: number | null;
  onChange: (value: number | null) => void;
  /** What the number does, in a sentence. */
  meaning: ReactNode;
  slider: ModuleSlider;
  description?: ReactNode;
  /** A rule that can be off: the switch stores null, and this value when turned on. */
  toggle?: { defaultValue: number };
  /** Where the thumb rests while the value is null. Never shown in the field. */
  sliderRest?: number;
  action?: ReactNode;
  badge?: ReactNode;
  footer?: ReactNode;
  /** The module has no effect right now: the value stays readable, nothing can be changed. */
  inactive?: boolean;
  sliderOff?: boolean;
  tint?: CSSProperties;
  valueColor?: string;
  size?: "md" | "hero";
  className?: string;
}) {
  const [note, setNote] = useState<FieldNote | null>(null);
  const [reads, setReads] = useState<string | null>(null);

  const armed = toggle ? value !== null : true;
  const ladder = "ladder" in slider ? slider.ladder : null;
  const linear = "ladder" in slider ? { min: 0, max: 0, step: 1 } : slider;
  // The slider always needs a number: the stored one, or where the thumb rests without one.
  const at = value ?? sliderRest ?? toggle?.defaultValue ?? (ladder ? (ladder[0] ?? 0) : linear.min);

  // A value that is not a rung (typed, a preset, a restored draft, an older config) stays
  // a stop of its own, so the thumb sits where the number is and can come back to it;
  // snapping it to a neighbour would rewrite the setting on first touch. Remembered, not
  // derived, or the stops would reshuffle under the thumb mid-drag.
  const [extra, setExtra] = useState(at);
  if (ladder && !ladder.includes(at) && at !== extra) setExtra(at);
  const stops = ladder ? ladderStops(ladder, extra) : null;

  const low = stops ? stops[0] : linear.min;
  const high = stops ? stops[stops.length - 1] : linear.max;

  // A note belongs to the value it was said about; once the value moves on, it is gone
  // for good, so a preset that later returns to the same number does not bring it back.
  if (note !== null && note.value !== value) setNote(null);
  const live = note !== null && note.value === value ? note : null;
  const refused = live?.kind === "refused";

  const body = (
    <>
      {/* No transition on the slider itself: a dragged control must track the finger
          exactly, and 150ms of easing reads as lag. */}
      <Slider
        aria-labelledby={`${id}-label`}
        // On a ladder the slider's value is a rung index; announce the amount, not "6".
        getAriaValueText={(_, v) =>
          value === null ? display(spec, null) : spec.format(stops ? (stops[v] ?? at) : v)
        }
        className="mt-3"
        value={[stops ? nearestStopIndex(stops, at) : at]}
        min={stops ? 0 : low}
        max={stops ? stops.length - 1 : high}
        step={stops ? 1 : (linear.step ?? 1)}
        disabled={inactive || sliderOff}
        onValueChange={(next) => {
          const first = Array.isArray(next) ? next[0] : next;
          if (typeof first === "number") {
            setNote(null);
            onChange(stops ? stops[first] : first);
          }
        }}
      />
      {/* What the slider can reach; the field says what can be typed. */}
      <div
        aria-hidden
        className="tnum mt-1.5 flex justify-between font-mono text-[11px] leading-4 text-muted-foreground"
      >
        <span>{spec.format(low)}</span>
        <span>{spec.format(high)}</span>
      </div>
      {footer}
      {/* Not live: a screen reader is not read a sentence per keystroke. */}
      <p id={`${id}-preview`} className={PREVIEW}>
        {reads}
      </p>
      {/* Always mounted so screen readers are already listening when a note lands. */}
      <p
        id={`${id}-note`}
        aria-live="polite"
        className={cn(
          NOTE,
          live?.show ? (refused ? "text-destructive" : "text-muted-foreground") : "sr-only",
        )}
      >
        {refused ? <CircleAlert aria-hidden className="size-3.5 shrink-0" /> : null}
        {live ? <span>{live.text}</span> : null}
      </p>
      <p id={`${id}-meaning`} className={cn(TYPE.small, "mt-2.5 text-muted-foreground")}>
        {meaning}
      </p>
    </>
  );

  return (
    <div className={cn(MODULE, inactive && MODULE_INACTIVE, className)} style={tint}>
      <div className="flex min-h-8 items-center justify-between gap-3 pointer-coarse:min-h-11">
        {/* Names both controls: the typed value (htmlFor) and the slider (aria-labelledby).
            While a rule is off there is no value box, so it names the switch. */}
        <label
          id={`${id}-label`}
          htmlFor={armed ? `${id}-value` : `${id}-toggle`}
          className={cn(TYPE.heading, "min-w-0")}
        >
          {label}
        </label>
        {/* Capped so a long entry cannot push the label off; the action wraps under the value. */}
        <span className="flex max-w-[72%] min-w-0 flex-wrap items-center justify-end gap-2">
          {badge}
          {armed ? (
            <ValueField
              id={id}
              label={toggle ? `${label} threshold` : label}
              spec={spec}
              value={value}
              disabled={inactive}
              invalid={refused}
              describedBy={`${id}-note ${id}-meaning`}
              className={size === "hero" ? "h-10 text-2xl leading-8 font-semibold md:text-2xl" : undefined}
              style={valueColor && !inactive ? { color: valueColor } : undefined}
              onCommit={onChange}
              onNote={setNote}
              onPreview={setReads}
            />
          ) : (
            <span className={cn(TYPE.caption, "font-mono text-muted-foreground")}>Off</span>
          )}
          {action}
          {toggle ? (
            <Switch
              id={`${id}-toggle`}
              label={label}
              checked={armed}
              onChange={(next) => {
                setNote(null);
                onChange(next ? toggle.defaultValue : null);
              }}
            />
          ) : null}
        </span>
      </div>

      {description ? <p className={cn(TYPE.small, "mt-1 text-muted-foreground")}>{description}</p> : null}

      {toggle ? (
        // The only movement in a module: the rule's body opening and closing.
        <div className={COLLAPSE} data-open={armed} inert={!armed}>
          {/* The side padding leaves room for the thumb's focus ring inside the clip. */}
          <div className="-mx-1.5 min-h-0 overflow-hidden px-1.5">{body}</div>
        </div>
      ) : (
        body
      )}
    </div>
  );
}
