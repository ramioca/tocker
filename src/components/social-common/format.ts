/**
 * Number + time formatting for the social surfaces.
 * OWNER: ui-social. If UI-CORE ships an equivalent, dedupe into one module at merge.
 *
 * All money/percent output is meant to be rendered in `tabular-nums`.
 */

const USD = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const COMPACT = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

export function formatUsd(value: number | null | undefined, opts?: { compact?: boolean; signed?: boolean }): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  const sign = opts?.signed ? (value > 0 ? "+" : value < 0 ? "−" : "") : value < 0 ? "−" : "";
  // Same threshold as `formatUsd` in common/format: compact from five figures, cents
  // below. Compacting at four put "+$1.3K" in a leaderboard column of "+$930.75"s, the
  // largest value the least precise.
  if (opts?.compact && abs >= 10_000) return `${sign}$${COMPACT.format(abs)}`;
  return `${sign}${USD.format(abs)}`;
}

export function formatPct(value: number | null | undefined, opts?: { signed?: boolean; dp?: number }): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const dp = opts?.dp ?? 1;
  // Sign the number as printed: −0.004 at 1dp is "0.0%", not "−0.0%".
  const rounded = Number(Math.abs(value).toFixed(dp));
  const sign = opts?.signed !== false && rounded !== 0 ? (value > 0 ? "+" : "−") : "";
  return `${sign}${rounded.toFixed(dp)}%`;
}

export function formatCount(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value >= 10_000 ? COMPACT.format(value) : value.toLocaleString("en-US");
}

export function formatPrice(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  if (value === 0) return "$0";
  if (value < 0.01) return `$${value.toPrecision(2)}`;
  return USD.format(value);
}

const MONTH_YEAR = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
const DAY_LABEL = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" });

export function formatJoined(iso: string): string {
  return MONTH_YEAR.format(new Date(iso));
}

export function formatDayLabel(iso: string): string {
  return DAY_LABEL.format(new Date(iso));
}

/**
 * The clock relative timestamps are measured against. Pass a fixed value to freeze it
 * (mock fixtures do, so dev output is stable); otherwise it is the wall clock.
 * Server components only — a client render would disagree with the server HTML.
 */
export function referenceNow(fixed?: number): number {
  return fixed ?? Date.now();
}

/**
 * Short relative time ("12m", "3h", "5d"). Server-render only — calling this during
 * client render can disagree with the server HTML.
 */
export function formatAgo(iso: string, now = Date.now()): string {
  const diff = Math.max(0, now - Date.parse(iso));
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d`;
  return `${Math.floor(days / 30)}mo`;
}

/** Bucket an ISO timestamp into Today / Yesterday / a date, for day-grouped lists. */
export function dayBucket(iso: string, now = Date.now()): string {
  const day = 86_400_000;
  const startOfToday = Math.floor(now / day) * day;
  const t = Date.parse(iso);
  if (t >= startOfToday) return "Today";
  if (t >= startOfToday - day) return "Yesterday";
  return DAY_LABEL.format(new Date(t));
}
