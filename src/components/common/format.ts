/** Display-only formatting. Money math never happens here — see src/lib/money.ts. */

const usdFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const compactFormatter = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

export function formatUsd(value: number | null | undefined, opts?: { compact?: boolean }): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  if (opts?.compact && Math.abs(value) >= 10_000) return `$${compactFormatter.format(value)}`;
  if (Math.abs(value) > 0 && Math.abs(value) < 0.01) {
    return `$${value.toPrecision(2)}`;
  }
  return usdFormatter.format(value);
}

export function formatSignedUsd(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${formatUsd(Math.abs(value))}`;
}

export function formatPct(value: number | null | undefined, dp = 2): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${value.toFixed(dp)}%`;
}

export function formatSignedPct(value: number | null | undefined, dp = 2): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${Math.abs(value).toFixed(dp)}%`;
}

export function formatCount(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  if (Math.abs(value) < 1_000) return String(value);
  return compactFormatter.format(value);
}

export function formatTokenAmount(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  if (Math.abs(value) >= 1_000_000) return compactFormatter.format(value);
  if (Math.abs(value) >= 1) return value.toLocaleString("en-US", { maximumFractionDigits: 4 });
  return value.toLocaleString("en-US", { maximumSignificantDigits: 4 });
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "—";
  if (ms < 1_000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1_000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1_000)}s`;
}

export function truncateAddress(address: string, lead = 4, tail = 4): string {
  if (address.length <= lead + tail + 1) return address;
  return `${address.slice(0, lead)}…${address.slice(-tail)}`;
}

const RELATIVE_UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ["year", 365 * 24 * 3_600_000],
  ["month", 30 * 24 * 3_600_000],
  ["day", 24 * 3_600_000],
  ["hour", 3_600_000],
  ["minute", 60_000],
];

const relativeFormatter = new Intl.RelativeTimeFormat("en", { numeric: "auto", style: "narrow" });

/** "12m ago" style. Pure so server and client agree on the same input. */
export function formatRelative(isoDate: string, now = Date.now()): string {
  const then = new Date(isoDate).getTime();
  if (Number.isNaN(then)) return "—";
  const diff = then - now;
  const abs = Math.abs(diff);
  if (abs < 45_000) return "just now";
  for (const [unit, ms] of RELATIVE_UNITS) {
    if (abs >= ms) return relativeFormatter.format(Math.round(diff / ms), unit);
  }
  return relativeFormatter.format(Math.round(diff / 60_000), "minute");
}

export function formatAbsolute(isoDate: string): string {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
