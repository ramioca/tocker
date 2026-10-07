/**
 * Reading what somebody typed into a module's value box, and printing a stored value
 * back so that it reads as the same number. Pure: no React, no client code.
 *
 * Two rules hold for everything here. A reader never guesses: text it cannot read
 * exactly is `null`, and `settle` refuses a value outside the field's range instead of
 * moving it to the nearest limit, so nothing is stored that was not typed. And every
 * string a field shows can be typed back into it and gives the same number, which is
 * what lets the box keep its own text when it takes focus.
 */
import { formatCompactUsd, formatHolders, formatHours, formatMinutes } from "@/components/tokens/format";

export type SpanUnit = "minute" | "hour" | "day" | "week" | "month" | "year";

export interface ValueSpec {
  /** The module's name as the messages say it: "Max per trade". */
  label: string;
  /** Range and smallest kept difference, in the stored unit. For a `span` spec all three are MINUTES. */
  min: number;
  max: number;
  precision: number;
  /** Typed text to a number in the stored unit, before rounding. Not called for a `span` spec. */
  read: (text: string) => number | null;
  /** Stored value to what the field shows: "$7.37", "36 hours", and "Any" for a zero that means any. */
  format: (value: number) => string;
  /** A duration: the unit it is stored in, and the unit a bare number takes when the display names none. */
  span?: { stored: "minutes" | "hours"; bare: SpanUnit };
  /** What "any" / "none" stores, when the field has such a state (0 or null). */
  any?: 0 | null;
  /** For the "Could not read that. Try …" message: "10k or $12,345". */
  example: string;
  /** A value in range that must still be refused; returns the sentence, without "Kept …". */
  refuse?: (value: number) => string | null;
  inputMode: "decimal" | "numeric" | "text";
}

export type Settled =
  | { status: "unchanged" }
  /** `value` is in the stored unit, on the precision grid, inside [min, max] (or `spec.any`). `show`: the note is visible, not only spoken. */
  | { status: "set"; value: number | null; say: string; show: boolean }
  | { status: "refused"; message: string };

// ------------------------------------------------------------------ lexing

const ANY = /^(any|any age|none|no limit|no minimum|no ceiling|off|unlimited|∞)$/;

/** Trimmed, lower-cased, typographic minus signs made plain, runs of spaces made one. */
const clean = (text: string): string =>
  text
    .trim()
    .toLowerCase()
    .replace(/[−–]/g, "-")
    .replace(/\s+/g, " ");

/** Multiplying by 1,000 or by 60 leaves float dust ("2.3k" is 2299.9999…); six places clears it. */
const fix = (value: number): number => Number(value.toFixed(6));

/**
 * "12345.5", ".5", "12,345.5" and "7,37" to a number. Commas are read two ways and no
 * others: as well-formed thousands groups, or as a decimal comma when it is the only
 * separator and one or two digits follow it. A phone's decimal pad offers only a comma
 * in much of the world, so refusing "7,37" would make cents untypeable there.
 */
function plain(text: string): number | null {
  if (/^\d+,\d{1,2}$/.test(text)) return Number(text.replace(",", "."));
  if (text === "" || !/^(\d{1,3}(,\d{3})+|\d+)?(\.\d+)?$/.test(text)) return null;
  const parsed = Number(text.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

const SCALE: Record<string, number> = { k: 1_000, m: 1_000_000 };

/** A number with an optional "k" or "m" after it. */
function scaled(digits: string, suffix: string | undefined): number | null {
  const parsed = plain(digits);
  if (parsed === null) return null;
  return fix(parsed * (suffix ? SCALE[suffix] : 1));
}

// ----------------------------------------------------------------- readers

/** The words that remove a limit. An empty box is never one of them. */
export function isAnyWord(text: string): boolean {
  return ANY.test(clean(text));
}

/** Dollars: "$1,250.50", "10k", "1.5m". Money has no sign. */
export function readUsd(text: string): number | null {
  const match = /^\$? ?([\d.,]+) ?(k|m)?$/.exec(clean(text));
  return match ? scaled(match[1], match[2]) : null;
}

/** A count: "37", "1,234", "10k". */
export function readCount(text: string): number | null {
  const match = /^([\d.,]+) ?(k|m)?$/.exec(clean(text));
  return match ? scaled(match[1], match[2]) : null;
}

/**
 * A percentage, as a 0-100 number. `sign` says which mark the field is shown with:
 * "none" takes a plus and refuses a minus, "drop" reads "-20" and "20" as 20 and
 * refuses a plus, "gain" takes a plus and refuses a minus.
 */
export function readPercent(text: string, sign: "none" | "drop" | "gain" = "none"): number | null {
  const match = /^([+-])? ?([\d.,]+) ?%?( off peak)?$/.exec(clean(text));
  if (!match) return null;
  if (match[1] === "-" && sign !== "drop") return null;
  if (match[1] === "+" && sign === "drop") return null;
  return plain(match[2]);
}

/** Basis points. Slippage is stored in bps but people think in percent: "1.5%" is 150, "150" is 150. */
export function readBps(text: string): number | null {
  const match = /^([\d.,]+) ?(%|bps?)?$/.exec(clean(text));
  if (!match) return null;
  const parsed = plain(match[1]);
  if (parsed === null) return null;
  return match[2] === "%" ? fix(parsed * 100) : parsed;
}

/** A 0-100 score: "70" or "70/100". */
export function readScore(text: string): number | null {
  const match = /^([\d.,]+)( ?\/ ?100)?$/.exec(clean(text));
  return match ? plain(match[1]) : null;
}

/** A number and nothing else. */
export function readNumber(text: string): number | null {
  return plain(clean(text));
}

const UNIT_MINUTES: Record<string, number> = {};
for (const [names, minutes] of [
  ["m min mins minute minutes", 1],
  ["h hr hrs hour hours", 60],
  ["d day days", 1_440],
  ["w wk wks week weeks", 10_080],
  ["mo mos month months", 43_200],
  ["y yr yrs year years", 525_600],
] as const) {
  for (const name of names.split(" ")) UNIT_MINUTES[name] = minutes;
}

const BARE: Record<SpanUnit, number> = {
  minute: 1,
  hour: 60,
  day: 1_440,
  week: 10_080,
  month: 43_200,
  year: 525_600,
};

/**
 * A length of time, in minutes. A bare number takes the unit `bare`. Up to three
 * "number unit" parts add up ("1h 30m"), and they must run from the larger unit to the
 * smaller with no unit twice, so "1h 1h" and "30m 1h" are not read. A month is 30 days
 * and a year 365, as the formatters print them.
 */
export function readSpan(text: string, bare: SpanUnit): number | null {
  const cleaned = clean(text);
  if (cleaned === "") return null;
  const alone = plain(cleaned);
  if (alone !== null) return fix(alone * BARE[bare]);

  const part = /^([\d.,]+?) ?([a-z]+) ?/;
  let total = 0;
  let rest = cleaned;
  let parts = 0;
  let last = Infinity;
  while (rest !== "") {
    const match = part.exec(rest);
    if (!match) return null;
    const count = plain(match[1]);
    const per = UNIT_MINUTES[match[2]];
    if (count === null || per === undefined || per >= last) return null;
    last = per;
    total += count * per;
    rest = rest.slice(match[0].length);
    parts += 1;
    if (parts > 3) return null;
  }
  return fix(total);
}

/**
 * The unit a bare number takes: the one the readout is showing. The box says "1 day",
 * somebody replaces the 1 with a 3, and they mean three days. Every unit the reader
 * knows is recognised, Max hold's "h" and "d" included.
 */
export function shownUnit(display: string, fallback: SpanUnit): SpanUnit {
  const word = /[a-z]+$/.exec(display.trim().toLowerCase());
  const per = word ? UNIT_MINUTES[word[0]] : undefined;
  return (Object.keys(BARE) as SpanUnit[]).find((unit) => BARE[unit] === per) ?? fallback;
}

// -------------------------------------------------------- honest formatters
//
// One rule: the short form the app already prints when reading it back gives the same
// number, otherwise a longer form that does. "$12K" for a $12,345 gate would describe a
// pool the gate refuses, and "2 days" for a 36-hour ceiling is twelve hours out.

const GROUPED = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
const GROUPED_WHOLE = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const group = (value: number, digits: 0 | 2 = 2): string => (digits === 0 ? GROUPED_WHOLE : GROUPED).format(value);

/** Zero, then whole days, then hours when one decimal says it exactly, then minutes. */
function longSpan(minutes: number): string {
  const unit = (count: number, word: string) => `${group(count)} ${word}${count === 1 ? "" : "s"}`;
  if (minutes === 0) return "0 minutes";
  if (minutes % 1_440 === 0) return unit(minutes / 1_440, "day");
  if (minutes >= 60 && minutes % 6 === 0) return unit(minutes / 60, "hour");
  return unit(minutes, "minute");
}

/** "$15K" where that is the number, "$12,345" where it is not. */
export function sayUsd(usd: number): string {
  const short = formatCompactUsd(usd);
  return readUsd(short) === usd ? short : `$${group(usd)}`;
}

/** "10K" where that is the number, "12,345" where it is not. */
export function sayCount(count: number): string {
  const short = formatHolders(count);
  return readCount(short) === count ? short : group(count, 0);
}

/** A span stored in minutes. Zero is the caller's word ("Any", "From birth"). */
export function sayMinutes(minutes: number): string {
  const short = formatMinutes(minutes);
  return readSpan(short, "minute") === minutes ? short : longSpan(minutes);
}

/**
 * A span stored in hours, to the minute. Under an hour it is said in minutes ("15
 * minutes", never "0.25 hours"). The short form is kept only for whole and half hours
 * that read back, so this and `sayMinutes` say the same length of time the same way.
 */
export function sayHours(hours: number): string {
  const minutes = Math.round(hours * 60);
  const short = hours < 1 ? formatMinutes(Math.max(1, minutes)) : formatHours(hours);
  const tidy = Number.isInteger(hours < 1 ? minutes : hours * 2);
  return tidy && readSpan(short, "hour") === minutes ? short : longSpan(minutes);
}

function hoursLabel(hours: number): string {
  if (hours < 48) return `${hours}h`;
  return `${(hours / 24).toFixed(hours % 24 === 0 ? 0 : 1)}d`;
}

/** Max hold: "24h", "2.5d", and plain hours ("50h") where the days form would round. */
export function sayHold(hours: number): string {
  const short = hoursLabel(hours);
  return readSpan(short, "hour") === fix(hours * 60) ? short : `${hours}h`;
}

// ------------------------------------------------------------------ settle

/** To the nearest multiple of `precision`, without float dust: 7.375 at 0.01 is 7.38. */
export function roundTo(value: number, precision: number): number {
  const decimals = Math.min(6, Math.max(0, Math.ceil(-Math.log10(precision)) + 2));
  return Number((Math.round(Number((value / precision).toFixed(6))) * precision).toFixed(decimals));
}

/** What the field shows at rest: `spec.format(current)`, or "Any" for null. */
export function display(spec: ValueSpec, current: number | null): string {
  return current === null ? "Any" : spec.format(current);
}

/**
 * The commit. Pure. `current` is the stored value (null = "Any"). Never clamps.
 *
 * A duration is read, rounded and range-checked in minutes and converted to its stored
 * unit last, so "20 min" in an hours field is twenty minutes and is not reported as
 * rounded.
 */
export function settle(spec: ValueSpec, text: string, current: number | null): Settled {
  const typed = text.trim();
  const shown = display(spec, current);
  // An emptied box never means zero and never means "Any".
  if (typed === "" || typed === shown) return { status: "unchanged" };

  if (isAnyWord(typed)) {
    if (spec.any === undefined) {
      return { status: "refused", message: `${spec.label} needs a number, like ${spec.example}. Kept ${shown}.` };
    }
    if (spec.any === current) return { status: "unchanged" };
    return { status: "set", value: spec.any, say: "Set to Any.", show: false };
  }

  const span = spec.span;
  const raw = span ? readSpan(typed, shownUnit(shown, span.bare)) : spec.read(typed);
  if (raw === null) {
    return { status: "refused", message: `Could not read that. Try ${spec.example}. Kept ${shown}.` };
  }

  // From here `rounded` is in minutes for a duration, in the stored unit otherwise.
  const rounded = roundTo(raw, spec.precision);
  const stored = (amount: number): number =>
    span?.stored === "hours" ? Number((amount / 60).toFixed(4)) : amount;

  const custom = spec.refuse?.(rounded);
  if (custom) return { status: "refused", message: `${custom} Kept ${shown}.` };

  if (!(rounded >= spec.min && rounded <= spec.max)) {
    // A zero that means "any" is printed as the number here: "goes from Any to …" says nothing.
    const low = spec.min === 0 && spec.any === 0 ? "0" : spec.format(stored(spec.min));
    return {
      status: "refused",
      message: `${spec.label} goes from ${low} to ${spec.format(stored(spec.max))}. Kept ${shown}.`,
    };
  }

  const value = stored(rounded);
  if (value === current) return { status: "unchanged" };

  const wasRounded = Math.abs(rounded - raw) > 1e-9;
  // The two places where the reader chose something the text did not spell out: which
  // way a comma was read, and which unit a bare number in a duration took.
  const inferred = typed.includes(",") || (span !== undefined && plain(clean(typed)) !== null);
  return {
    status: "set",
    value,
    say: `${wasRounded ? "Rounded" : "Set"} to ${spec.format(value)}.`,
    show: wasRounded || inferred,
  };
}

/** While typing: "Reads as $10,000" when the text would commit to a different value, else null. Pure. */
export function preview(spec: ValueSpec, text: string, current: number | null): string | null {
  const result = settle(spec, text, current);
  return result.status === "set" ? `Reads as ${display(spec, result.value)}` : null;
}
