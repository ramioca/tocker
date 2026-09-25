/** Display-only formatting. Money math never happens here — see src/lib/money.ts. */

const usdFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Prices between a cent and a dollar — see `formatPriceUsd`. */
const subDollar3 = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 3,
});

const subDollar4 = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
});

const compactFormatter = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

/** Compact with a fixed two decimals, for columns where "1.60M" must line up with "25.00M". */
const fixedCompactFormatter = new Intl.NumberFormat("en-US", {
  notation: "compact",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * Sub-cent digits, never exponential.
 *
 * `toPrecision(2)` on 0.00000045 returns the string `"4.5e-7"`, so the feed, the
 * positions table and the receipt all rendered memecoin prices as `$4.5e-7` — which is
 * not a price anyone reads, and which sorts and copies wrong. Three significant digits
 * written out is what a token page shows and what the exit messages say
 * (`priceText` in src/lib/trading/exits.ts), so this matches it.
 *
 * Capped at 18 decimals: that is the most a token can have, and past it the value is
 * noise from a float anyway.
 */
function subCentText(value: number): string {
  const abs = Math.abs(value);
  const digits = Math.min(18, Math.ceil(-Math.log10(abs)) + 2);
  const fixed = value.toFixed(digits);
  return fixed.includes(".") ? fixed.replace(/0+$/, "").replace(/\.$/, "") : fixed;
}

export function formatUsd(value: number | null | undefined, opts?: { compact?: boolean }): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  if (!Number.isFinite(value)) return "—";
  if (opts?.compact && Math.abs(value) >= 10_000) return `$${compactFormatter.format(value)}`;
  if (Math.abs(value) > 0 && Math.abs(value) < 0.01) {
    return `$${subCentText(value)}`;
  }
  return usdFormatter.format(value);
}

/**
 * A token *price*, as opposed to a dollar amount.
 *
 * The distinction matters because prices on this platform routinely live eight decimal
 * places below a cent, and everything that shows one — the feed line, the positions
 * table's cost and mark, the receipt's quoted→filled pair — has to agree, both with
 * each other and with the server-rendered exit messages. One helper, used everywhere a
 * price is printed, is how they stay in agreement.
 *
 * Zero is `$0.00` and not `$0`: a mark of exactly zero is a real state (an unpriced
 * token) and it should look like a price, not like a missing one, which is what `—` is
 * reserved for.
 */
export function formatPriceUsd(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value) || !Number.isFinite(value)) return "—";
  if (value === 0) return "$0.00";
  const abs = Math.abs(value);
  if (abs < 0.01) return `$${subCentText(value)}`;
  // Between a cent and a dollar, two decimals is one significant digit: a $0.01182 fill
  // printed as "$0.01" is 15% off. Keep three significant digits here too (3 or 4
  // decimals), which is also what `priceText` writes into the exit messages.
  if (abs < 1) return (abs < 0.1 ? subDollar4 : subDollar3).format(value);
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
  // Sign the number as printed, not as stored: −0.004 at 1dp is "0.0%", not "−0.0%".
  const rounded = Number(Math.abs(value).toFixed(dp));
  const sign = rounded === 0 ? "" : value > 0 ? "+" : "−";
  return `${sign}${rounded.toFixed(dp)}%`;
}

export function formatCount(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  if (Math.abs(value) < 1_000) return String(value);
  return compactFormatter.format(value);
}

/**
 * A token *amount*. The one helper the preview, the toast and the receipt of a fill all
 * call, so "786,163.52 BONK" is not "314,465.408805 BONK" two screens later. Two decimals
 * from a thousand up (past that they are dust), four below it so a 1.2345 ETH balance
 * keeps its precision, and four significant digits under one.
 *
 * `fixed` is for a right-aligned table column: every band keeps its trailing zeros, so the
 * decimal points of neighbouring rows line up, and millions read "1.60M", not "1.6M" over
 * "314,465.41". Pair it with a `title` carrying the full amount.
 */
export function formatTokenAmount(value: number | null | undefined, { fixed = false }: { fixed?: boolean } = {}): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  const abs = Math.abs(value);
  if (fixed) {
    if (abs >= 1_000_000) return fixedCompactFormatter.format(value);
    if (abs >= 1_000) return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (abs >= 1) return value.toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 4 });
    return value.toLocaleString("en-US", { minimumSignificantDigits: 4, maximumSignificantDigits: 4 });
  }
  if (abs >= 1_000_000) return compactFormatter.format(value);
  if (abs >= 1_000) return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (abs >= 1) return value.toLocaleString("en-US", { maximumFractionDigits: 4 });
  return value.toLocaleString("en-US", { maximumSignificantDigits: 4 });
}

/**
 * The fee row of a trade preview: "≈ $0.13 (Tocker $0.10 · venue $0.03)". Null when
 * the fee is off and the venue quoted nothing, so the row can be left out. An unquoted
 * venue fee is said, not printed as $0.00.
 */
export function formatPreviewFees(fees: { tockerUsd: number; venueUsd: number | null }): string | null {
  if (fees.venueUsd === null) {
    return fees.tockerUsd > 0 ? `${formatUsd(fees.tockerUsd)} Tocker · venue fee not quoted` : null;
  }
  const total = formatUsd(fees.tockerUsd + fees.venueUsd);
  if (fees.tockerUsd === 0) return `≈ ${total} venue`;
  return `≈ ${total} (Tocker ${formatUsd(fees.tockerUsd)} · venue ${formatUsd(fees.venueUsd)})`;
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
  ["day", 24 * 3_600_000],
  ["hour", 3_600_000],
  ["minute", 60_000],
];

const WEEK_MS = 7 * 24 * 3_600_000;

const relativeFormatter = new Intl.RelativeTimeFormat("en", { numeric: "auto", style: "narrow" });

/**
 * "12m ago" style. Pure so server and client agree on the same input. From a week out
 * it turns into the date itself ("Aug 26"): "last mo." or "3 wk. ago" is vaguer than
 * the day, and sits oddly beside the "2d ago" of the row above.
 */
export function formatRelative(isoDate: string, now = Date.now()): string {
  const then = new Date(isoDate).getTime();
  if (Number.isNaN(then)) return "—";
  const diff = then - now;
  const abs = Math.abs(diff);
  if (abs < 45_000) return "just now";
  if (abs >= WEEK_MS) {
    const date = new Date(then);
    const sameYear = date.getFullYear() === new Date(now).getFullYear();
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      ...(sameYear ? {} : { year: "numeric" }),
    });
  }
  for (const [unit, ms] of RELATIVE_UNITS) {
    if (abs >= ms) return relativeFormatter.format(Math.round(diff / ms), unit);
  }
  return relativeFormatter.format(Math.round(diff / 60_000), "minute");
}

/**
 * The exact moment, in the reader's own zone and saying which: "Sep 24, 6:58:59 PM PDT".
 * For audit trails, where "1h ago" on ten rows in a row tells nobody anything. Call it
 * in the browser only (see `LocalTime`): on the server it would print the server's zone,
 * and hydration keeps the server's text.
 */
export function formatExact(isoDate: string, timeZone?: string): string {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: date.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short",
    ...(timeZone ? { timeZone } : {}),
  });
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
