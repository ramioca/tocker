/**
 * Day grouping for the notification list, in the viewer's own time zone.
 *
 * The server renders the list, and UTC midnight is not the viewer's: across the Americas
 * every evening, today's rows moved under "Yesterday", and a "1d" row sat under a date
 * two days back. The browser reports its zone in a `tz` cookie (written by AppShell);
 * without one — the very first paint — this falls back to UTC, as it always did.
 */

/** A `tz` cookie value, or UTC when it is missing or not a zone this runtime knows. */
export function resolveTimeZone(raw: string | null | undefined): string {
  if (!raw) return "UTC";
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: raw }).resolvedOptions().timeZone;
  } catch {
    return "UTC";
  }
}

const DAY_KEYS = new Map<string, Intl.DateTimeFormat>();
const DAY_LABELS = new Map<string, Intl.DateTimeFormat>();

function cached(cache: Map<string, Intl.DateTimeFormat>, timeZone: string, make: () => Intl.DateTimeFormat) {
  let format = cache.get(timeZone);
  if (!format) {
    format = make();
    cache.set(timeZone, format);
  }
  return format;
}

/** "2026-09-23": the calendar day `t` falls on in `timeZone`, comparable as a string. */
function dayKey(t: number, timeZone: string): string {
  const parts = cached(DAY_KEYS, timeZone, () =>
    new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }),
  ).formatToParts(t);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/**
 * The calendar day before `key`. Stepped on the calendar, not by subtracting 24 hours:
 * on the days a clock change makes 23 or 25 hours long, "24h ago" is two days back or
 * still today.
 */
function previousDay(key: string): string {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day - 1)).toISOString().slice(0, 10);
}

/** Today / Yesterday / "Wednesday, Sep 23", by the calendar in `timeZone`. */
export function dayBucket(iso: string, now: number, timeZone = "UTC"): string {
  const t = Date.parse(iso);
  const day = dayKey(t, timeZone);
  const today = dayKey(now, timeZone);
  if (day === today) return "Today";
  if (day === previousDay(today)) return "Yesterday";
  return cached(DAY_LABELS, timeZone, () =>
    new Intl.DateTimeFormat("en-US", { weekday: "long", month: "short", day: "numeric", timeZone }),
  ).format(t);
}

const CLOCK = new Map<string, Intl.DateTimeFormat>();
const FULL = new Map<string, Intl.DateTimeFormat>();

/**
 * "3:06 PM" in `timeZone`. Rows under a past day's heading show this rather than "1d":
 * elapsed days are floored hours, the heading is the calendar, and the two disagreed.
 */
export function clockTime(iso: string, timeZone = "UTC"): string {
  return cached(CLOCK, timeZone, () =>
    new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone }),
  ).format(Date.parse(iso));
}

/** "Wed, Sep 23, 2026, 3:06 PM" in `timeZone`, for the `<time>` tooltip. */
export function fullDateTime(iso: string, timeZone = "UTC"): string {
  return cached(FULL, timeZone, () =>
    new Intl.DateTimeFormat("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone,
    }),
  ).format(Date.parse(iso));
}
