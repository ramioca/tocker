/**
 * The arithmetic behind a proposal card, kept pure so the card, the live panel and the
 * server read can never disagree — and so the interesting decisions (what counts as
 * "buying is accelerating", when authorities may be called revoked) are testable
 * without a browser.
 *
 * Two rules run through the whole file:
 *
 * - **Absent is not zero.** Every input is allowed to be null, and every formatter
 *   answers `"—"` rather than inventing a number. A launch two minutes old has no
 *   hourly history and no GT Score, and the card has to say so.
 * - **Nothing here claims a token is safe.** `deriveSafety` will answer `null` for
 *   "nobody checked" but never `true` — a gate that did not run is not a gate passed.
 */
import type { ProposalSafety, ProposalStats, TradeScore } from "@/server/types";

export type Trend = "up" | "down" | "flat";

/** Above this multiple of the hourly rate the last five minutes count as hot. */
export const TREND_HOT = 1.25;
/** Below this multiple they count as cooling. */
export const TREND_COLD = 0.75;

/** Under two minutes the countdown goes amber: this is the last chance to decide. */
export const URGENT_MS = 120_000;

/**
 * Is the last five minutes busier than the hour behind it?
 *
 * The hourly count is read as a rate — a typical five minutes of that hour is
 * `buyersH1 / 12` — and the live window is compared against it. When the hour holds no
 * more buyers than the five minutes do, the pool's whole life is inside the live
 * window: there is no earlier rate to compare against, so the honest answer is `flat`
 * rather than a spurious spike.
 */
export function buyersTrend(buyers5m: number | null, buyersH1: number | null): Trend | null {
  if (buyers5m === null || buyersH1 === null) return null;
  if (!Number.isFinite(buyers5m) || !Number.isFinite(buyersH1)) return null;
  if (buyersH1 <= buyers5m) return "flat";
  const expected = buyersH1 / 12;
  if (expected <= 0) return buyers5m > 0 ? "up" : "flat";
  const ratio = buyers5m / expected;
  if (ratio >= TREND_HOT) return "up";
  if (ratio <= TREND_COLD) return "down";
  return "flat";
}

/** `↑` / `↓` / `→`. Null trend has no glyph — the value renders bare. */
export const TREND_GLYPH: Record<Trend, string> = { up: "↑", down: "↓", flat: "→" };

/** What a trend means, spelled out for a title attribute and a screen reader. */
export const TREND_LABEL: Record<Trend, string> = {
  up: "buying faster than the last hour",
  down: "buying slower than the last hour",
  flat: "buying in line with the last hour",
};

/**
 * Age as a stat strip shows it: `"<1m"`, `"4m"`, `"1h 5m"`, `"7h"`, `"3d"`.
 *
 * At most two units, and never more precision than the magnitude earns — the minutes
 * matter on a launch and stop mattering by lunchtime.
 */
export function formatAgeMinutes(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined || !Number.isFinite(minutes) || minutes < 0) return "—";
  if (minutes < 1) return "<1m";
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 3) {
    const rest = Math.round(minutes - hours * 60);
    return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
  }
  if (hours < 48) return `${hours}h`;
  const days = minutes / 1_440;
  return `${days < 10 ? days.toFixed(1) : Math.round(days)}d`;
}

/** `"12:04"` under an hour, `"3h 12m"` over it, `"Expired"` past the TTL. */
export function formatCountdown(msRemaining: number): string {
  if (!Number.isFinite(msRemaining) || msRemaining <= 0) return "Expired";
  const totalSeconds = Math.floor(msRemaining / 1000);
  if (totalSeconds < 3_600) {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
  }
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  return `${hours}h ${minutes}m`;
}

/** `"3m"` — the coarse form, for a list header that says when the queue runs out. */
export function formatCountdownCoarse(msRemaining: number): string {
  if (!Number.isFinite(msRemaining) || msRemaining <= 0) return "now";
  if (msRemaining < 60_000) return `${Math.max(1, Math.round(msRemaining / 1_000))}s`;
  return formatAgeMinutes(msRemaining / 60_000);
}

export type CountdownTone = "expired" | "urgent" | "calm";

export function countdownTone(msRemaining: number): CountdownTone {
  if (msRemaining <= 0) return "expired";
  return msRemaining < URGENT_MS ? "urgent" : "calm";
}

/** How much of the TTL is left, 0-1. Drives the countdown ring. */
export function countdownProgress(msRemaining: number, ttlMs: number): number {
  if (!Number.isFinite(msRemaining) || !Number.isFinite(ttlMs) || ttlMs <= 0) return 0;
  return Math.min(1, Math.max(0, msRemaining / ttlMs));
}

// ---------------------------------------------------------------- sparkline

export interface SparklineGeometry {
  /** An SVG path, `M`/`L` only — a price line is not smooth and should not look it. */
  d: string;
  /** last − first. Positive is up; the caller picks the colour. */
  direction: number;
}

export interface SparklineBox {
  width?: number;
  height?: number;
  /** Half the stroke width plus a hair, so the extremes are not clipped. */
  pad?: number;
}

/**
 * Points → a path inside the box, oldest on the left.
 *
 * `null` for fewer than two usable points: a single price is a dot, not a trend, and
 * drawing it would suggest a history that does not exist. A perfectly flat series is
 * drawn down the middle rather than along the bottom.
 */
export function sparklinePath(values: readonly number[], box: SparklineBox = {}): SparklineGeometry | null {
  const width = box.width ?? 80;
  const height = box.height ?? 24;
  const pad = box.pad ?? 2;

  const points = values.filter((value) => typeof value === "number" && Number.isFinite(value));
  if (points.length < 2) return null;

  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min;
  const innerW = Math.max(1, width - pad * 2);
  const innerH = Math.max(1, height - pad * 2);
  const stepX = innerW / (points.length - 1);
  // A flat line sits on the centre line: the value did not move, and the chart should
  // say "no movement", not "at the floor".
  const y = (value: number) => (span === 0 ? pad + innerH / 2 : pad + (1 - (value - min) / span) * innerH);

  const d = points
    .map((value, index) => `${index === 0 ? "M" : "L"}${(pad + index * stepX).toFixed(2)},${y(value).toFixed(2)}`)
    .join(" ");

  return { d, direction: (points[points.length - 1] as number) - (points[0] as number) };
}

// ---------------------------------------------------------------- safety

const AUTHORITY_LIVE = new Set(["mint_authority_active", "freeze_authority_active"]);
const AUTHORITY_UNKNOWN = new Set(["mint_authority_unknown", "freeze_authority_unknown"]);
const TOP10_CODE = /^top10_holders_(\d+(?:\.\d+)?)pct$/;

export const EMPTY_SAFETY: ProposalSafety = {
  authoritiesRevoked: null,
  top10Pct: null,
  blockers: [],
  warnings: [],
  safety: 0,
  organic: 0,
  distribution: 0,
};

function componentOf(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * The badge row's facts, read out of the score the agent actually traded on.
 *
 * `authoritiesRevoked` is deliberately three-valued. A live mint or freeze authority is
 * `false`; a gate that ran and could not confirm is `null`; and `true` is only claimed
 * when a safety provider answered at all — otherwise "Authorities revoked" would appear
 * on a token nobody has ever checked, which is the single most expensive lie this card
 * could tell.
 */
export function deriveSafety(score: TradeScore | null | undefined): ProposalSafety {
  if (!score) return EMPTY_SAFETY;

  const blockers = score.blockers ?? [];
  const warnings = score.warnings ?? [];

  const top10Blocker = blockers.map((code) => TOP10_CODE.exec(code)).find((match) => match !== null);
  const rawSafety = score.components?.safety;
  const assessed = typeof rawSafety === "number" && Number.isFinite(rawSafety);

  const authoritiesRevoked = blockers.some((code) => AUTHORITY_LIVE.has(code))
    ? false
    : blockers.some((code) => AUTHORITY_UNKNOWN.has(code))
      ? null
      : assessed
        ? true
        : null;

  return {
    authoritiesRevoked,
    top10Pct: top10Blocker ? Number(top10Blocker[1]) : null,
    blockers: [...blockers],
    warnings: [...warnings],
    safety: componentOf(rawSafety),
    organic: componentOf(score.components?.organic),
    distribution: componentOf(score.components?.distribution),
  };
}

/**
 * The strip a surface can fill from the trade alone.
 *
 * The live wizard holds a `TradeRow`, not a proposal read, so it has no pool lookup to
 * show. Rather than give it a different, smaller component — two layouts for the same
 * decision, drifting apart by the month — it gets the same five cells with the two live
 * ones dashed out. Age, depth and the GT Score all exist in the frozen snapshot, and a
 * proposal is seconds old on that screen, so they are current in every sense that
 * matters there.
 */
export function statsFromSnapshot(score: TradeScore | null | undefined): ProposalStats {
  const gecko = score?.components?.gecko;
  return {
    ageMinutes: typeof score?.ageHours === "number" ? score.ageHours * 60 : null,
    buyers5m: null,
    buyersH1: null,
    reserveUsd: score?.liquidityUsd ?? null,
    priceChangeM5Pct: null,
    priceChangeH1Pct: null,
    gtScore: typeof gecko === "number" ? gecko : null,
    sparkline: [],
    safety: deriveSafety(score ?? null),
  };
}

// ---------------------------------------------------------------- reserve

export interface ReserveTrend {
  pct: number;
  /** Which window the number is actually from, so the label never overstates it. */
  window: "5m" | "1h";
}

/**
 * The move to show beside the reserve. Five minutes when the pool reports it, the hour
 * otherwise — labelled either way, because "+40%" over an hour and over five minutes
 * are different facts and a card that blurs them is worse than one that stays silent.
 */
export function reserveTrend(
  stats: Pick<ProposalStats, "priceChangeM5Pct" | "priceChangeH1Pct">,
): ReserveTrend | null {
  const m5 = stats.priceChangeM5Pct;
  if (typeof m5 === "number" && Number.isFinite(m5)) return { pct: m5, window: "5m" };
  const h1 = stats.priceChangeH1Pct;
  if (typeof h1 === "number" && Number.isFinite(h1)) return { pct: h1, window: "1h" };
  return null;
}

/** Newest first, the order the compare grid reads in. Stable for equal timestamps. */
export function byNewestFirst<T extends { proposedAt: string | null; createdAt: string }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => {
    const at = new Date(b.proposedAt ?? b.createdAt).getTime() - new Date(a.proposedAt ?? a.createdAt).getTime();
    return Number.isNaN(at) ? 0 : at;
  });
}

/** The soonest expiry in a queue, in ms from `now`. Null when nothing is open. */
export function soonestExpiry(rows: readonly { expiresAt: string }[], now: number): number | null {
  let soonest: number | null = null;
  for (const row of rows) {
    const at = new Date(row.expiresAt).getTime();
    if (Number.isNaN(at)) continue;
    const remaining = at - now;
    if (soonest === null || remaining < soonest) soonest = remaining;
  }
  return soonest;
}
