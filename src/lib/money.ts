/**
 * Money + number helpers.
 *
 * Persistence rule (CLAUDE.md): drizzle `numeric` columns are strings in JS.
 * Convert at the boundary with {@link toNum} / {@link toNumeric}; format for
 * display with the `fmt*` helpers. Never do arithmetic on the strings.
 */

/** numeric column (string | null) → number. Returns 0 for null/blank/NaN unless a fallback is given. */
export function toNum(value: string | number | null | undefined, fallback = 0): number {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "number") return Number.isFinite(value) ? value : fallback;
  const trimmed = value.trim();
  if (trimmed === "") return fallback;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : fallback;
}

/** Like {@link toNum} but preserves null (for nullable columns like `lastPriceUsd`). */
export function toNumOrNull(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

/** number → a string safe to write into a `numeric(p, scale)` column (never exponential). */
export function toNumeric(value: number, scale = 6): string {
  if (!Number.isFinite(value)) return (0).toFixed(scale);
  let s = value.toFixed(scale);
  if (s.includes("e") || s.includes("E")) {
    // |value| >= 1e21 — toFixed goes exponential, which Postgres numeric rejects.
    s = value.toLocaleString("en-US", {
      useGrouping: false,
      minimumFractionDigits: scale,
      maximumFractionDigits: scale,
    });
  }
  // -0.000000 → 0.000000
  return s === `-${(0).toFixed(scale)}` ? (0).toFixed(scale) : s;
}

const usd0 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const usd2 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * "$1,234.56". Large values get compacted ($1.2M) and sub-cent values get more
 * precision ($0.00042) so memecoin prices stay readable.
 */
export function fmtUsd(value: number | string | null | undefined, opts?: { compact?: boolean; precise?: boolean }): string {
  const n = toNumOrNull(value);
  if (n === null) return "—";
  const abs = Math.abs(n);
  if (opts?.compact && abs >= 10_000) {
    return `$${compactNumber(n)}`;
  }
  if (opts?.precise || (abs > 0 && abs < 0.01)) {
    const digits = abs === 0 ? 2 : Math.min(12, Math.max(2, Math.ceil(-Math.log10(abs)) + 3));
    return `$${n.toFixed(digits)}`;
  }
  if (abs >= 100_000) return usd0.format(n);
  return usd2.format(n);
}

/**
 * A dollar amount for a sentence whose figures have to add up: "$5.00" when it is whole
 * cents, and otherwise every decimal down to the ledger's sixth with the padding zeros
 * dropped ("$5.0049", "$0.005"). {@link fmtUsd} rounds to the cent, which turns a buy
 * that needs $5.0049 into one that "needs $5.00" beside $5.00 of cash.
 */
export function fmtUsdExact(value: number | string | null | undefined): string {
  const n = toNumOrNull(value);
  if (n === null) return "—";
  const [whole = "0", decimals = ""] = toNumeric(Math.abs(n), 6).split(".");
  const kept = decimals.replace(/0+$/, "");
  if (kept.length <= 2) return fmtUsd(Number(toNumeric(n, 6)));
  return `${n < 0 ? "-" : ""}$${Number(whole).toLocaleString("en-US")}.${kept}`;
}

/** "+12.4%" / "-3.0%". `value` is a percentage already (12.4 means 12.4%). */
export function fmtPct(value: number | string | null | undefined, opts?: { digits?: number; sign?: boolean }): string {
  const n = toNumOrNull(value);
  if (n === null) return "—";
  const abs = Math.abs(n);
  const digits = opts?.digits ?? (abs >= 100 ? 0 : abs > 0 && abs < 1 ? 2 : 1);
  const body = `${abs.toFixed(digits)}%`;
  if (opts?.sign === false) return body;
  return `${n > 0 ? "+" : n < 0 ? "-" : ""}${body}`;
}

/** "1,234.5678 BONK" — token amounts, scaled precision for tiny/large balances. */
export function fmtToken(amount: number | string | null | undefined, symbol?: string, opts?: { digits?: number }): string {
  const n = toNumOrNull(amount);
  if (n === null) return "—";
  const abs = Math.abs(n);
  const digits = opts?.digits ?? (abs === 0 ? 2 : abs >= 1000 ? 2 : abs >= 1 ? 4 : 6);
  const body =
    abs >= 1_000_000
      ? compactNumber(n)
      : new Intl.NumberFormat("en-US", { minimumFractionDigits: 0, maximumFractionDigits: digits }).format(n);
  return symbol ? `${body} ${symbol}` : body;
}

/** Prefix an already-formatted number with an explicit sign ("+$12.00"). */
export function signed(value: number | string | null | undefined, format: (n: number) => string = (n) => fmtUsd(n)): string {
  const n = toNumOrNull(value);
  if (n === null) return "—";
  const body = format(Math.abs(n));
  if (n > 0) return `+${body}`;
  if (n < 0) return `-${body}`;
  return body;
}

/** "up" | "down" | "flat" — for PnL coloring. Never use color for anything else (SPEC). */
export function direction(value: number | string | null | undefined): "up" | "down" | "flat" {
  const n = toNumOrNull(value);
  if (n === null || n === 0) return "flat";
  return n > 0 ? "up" : "down";
}

/** 1234567 → "1.23M" */
export function compactNumber(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1_000_000_000) return `${sign}${trim(abs / 1_000_000_000)}B`;
  if (abs >= 1_000_000) return `${sign}${trim(abs / 1_000_000)}M`;
  if (abs >= 1_000) return `${sign}${trim(abs / 1_000)}K`;
  return `${sign}${trim(abs)}`;
}

function trim(n: number): string {
  const fixed = n.toFixed(n >= 100 ? 0 : n >= 10 ? 1 : 2);
  // Only zeros after a decimal point are padding. Stripping them from a whole number
  // turned 100 into "1", so a $100,000 floor read "$1K".
  return fixed.includes(".") ? fixed.replace(/\.?0+$/, "") : fixed;
}

/** Percent change from `from` to `to`; null when the base is 0/absent. */
export function pctChange(from: number | null | undefined, to: number | null | undefined): number | null {
  if (from === null || from === undefined || to === null || to === undefined) return null;
  if (from === 0) return null;
  return ((to - from) / Math.abs(from)) * 100;
}

/** Clamp a number into [min, max]. */
export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

export interface PnlSplit {
  /** equity − basis: the headline every surface prints. */
  pnlUsd: number;
  realizedPnlUsd: number;
  unrealizedPnlUsd: number;
}

/**
 * All-time P&L and its two wells, derived so they always add up to the headline.
 *
 * The headline is equity − basis, the subtraction the agent card, agent header and
 * chart make. Open is what the positions are worth at the mark (equity − cash) less
 * what they cost. Realised is the remainder, not the positions ledger's own column —
 * that column misses fees and any fill the ledger never booked, and summing it with
 * open drifted ~$10 from the cards right below it. A null cash means no mark yet:
 * nothing is open, so the whole move is realised.
 */
export function splitPnl(input: {
  equityUsd: number;
  cashUsd: number | null;
  basisUsd: number;
  costBasisUsd: number;
}): PnlSplit {
  const pnlUsd = input.equityUsd - input.basisUsd;
  const unrealizedPnlUsd = input.cashUsd === null ? 0 : input.equityUsd - input.cashUsd - input.costBasisUsd;
  return { pnlUsd, realizedPnlUsd: pnlUsd - unrealizedPnlUsd, unrealizedPnlUsd };
}
