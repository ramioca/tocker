/**
 * Append-only score history.
 *
 * `token_scores` is a cache: one row per token, overwritten on every refresh. That
 * is the right shape for the run loop and the wrong shape for a chart, so every
 * fresh scoring also appends here. The table is the only record of what a token
 * looked like *before* it rugged — the reason a token page can show a score
 * collapsing three days ahead of the price.
 *
 * Two rules keep it from becoming noise:
 *  - a write is skipped when the newest row for that token is younger than
 *    {@link DEDUPE_WINDOW_MS} **and** carries the same total. A tick that rescores
 *    fifty holdings every ten minutes would otherwise write a row per token per
 *    tick and say nothing new.
 *  - nothing here ever throws for database reasons. History is a nice-to-have on
 *    the write path; a failed insert must not fail a run.
 *
 * KNOWN GAP (W7 review, not fixed here): rows carry no `universeKey`. Every scoring
 * appends, whichever agent's universe produced it, so a public token chart can mix
 * points computed under different thresholds and present them as one series — while the
 * token page tells the reader the score is the platform default's. It is a correctness
 * and an honesty problem, not a leak (only the total and components land here, never the
 * thresholds). Closing it needs a `universe_key` column on `token_score_history` plus a
 * filter in `getScoreHistory`, and `src/db/schema.ts` is another workstream's file.
 */
import { and, asc, desc, eq, gte } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getDb, tokenScoreHistory } from "@/db";
import { toNum, toNumOrNull } from "@/lib/money";
import type { ScoreHistoryPoint, TokenScore } from "@/server/types";

/** Two minutes: shorter than the score TTL, long enough to swallow a tick burst. */
export const DEDUPE_WINDOW_MS = 120_000;

/** How much history a token page asks for by default. */
export const DEFAULT_HISTORY_DAYS = 30;

/**
 * Does this score say something the last row did not? Exported for the test —
 * the decision is pure, the IO around it is not.
 */
export function shouldRecord(
  score: Pick<TokenScore, "total" | "scoredAt">,
  last: { total: number; scoredAt: Date | string } | null,
  windowMs = DEDUPE_WINDOW_MS,
): boolean {
  if (!last) return true;
  const at = new Date(score.scoredAt).getTime();
  const lastAt = new Date(last.scoredAt).getTime();
  if (!Number.isFinite(at) || !Number.isFinite(lastAt)) return true;
  const ageMs = at - lastAt;
  // A row that is older than the window is always worth joining, even at the same
  // total: a flat line is information.
  if (ageMs >= windowMs || ageMs < 0) return true;
  return round2(score.total) !== round2(last.total);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * A reading no provider answered: no source, or not one market fact. The chart already
 * draws these as gaps (`isNoDataReading`); they are not observations, so none are kept.
 */
function isNoData(score: TokenScore): boolean {
  return (
    score.sources.length === 0 ||
    (score.priceUsd === null && score.liquidityUsd === null && score.holderCount === null)
  );
}

/**
 * Append one point of history for a freshly computed score. Deduped per
 * {@link shouldRecord}, skipped for a no-data reading; never throws.
 */
export async function recordScore(score: TokenScore): Promise<void> {
  if (isNoData(score)) return;
  try {
    const db = await getDb();
    const [last] = await db
      .select({ total: tokenScoreHistory.total, scoredAt: tokenScoreHistory.scoredAt })
      .from(tokenScoreHistory)
      .where(eq(tokenScoreHistory.tokenId, score.tokenId))
      .orderBy(desc(tokenScoreHistory.scoredAt))
      .limit(1);

    if (!shouldRecord(score, last ? { total: toNum(last.total), scoredAt: last.scoredAt } : null)) return;

    await db.insert(tokenScoreHistory).values({
      id: `tsh_${nanoid(16)}`,
      tokenId: score.tokenId,
      total: score.total.toFixed(2),
      verdict: score.verdict,
      components: { ...score.components } as Record<string, number | null>,
      blockers: score.blockers,
      priceUsd: score.priceUsd === null ? null : score.priceUsd.toFixed(12),
      liquidityUsd: score.liquidityUsd === null ? null : score.liquidityUsd.toFixed(2),
      holderCount: score.holderCount,
      scoredAt: new Date(score.scoredAt),
    });
  } catch {
    // Same contract as the score cache: history is an observation, not a dependency.
  }
}

/** Score history for one token, oldest first. Empty when nothing was ever recorded. */
export async function getScoreHistory(
  tokenId: string,
  opts?: { days?: number; limit?: number },
): Promise<ScoreHistoryPoint[]> {
  const days = opts?.days ?? DEFAULT_HISTORY_DAYS;
  const limit = opts?.limit ?? 1_000;
  try {
    const db = await getDb();
    const since = new Date(Date.now() - days * 86_400_000);
    const rows = await db
      .select()
      .from(tokenScoreHistory)
      .where(and(eq(tokenScoreHistory.tokenId, tokenId), gte(tokenScoreHistory.scoredAt, since)))
      .orderBy(asc(tokenScoreHistory.scoredAt))
      .limit(limit);

    return rows.map((row) => ({
      at: row.scoredAt.toISOString(),
      total: toNum(row.total),
      verdict: row.verdict,
      priceUsd: toNumOrNull(row.priceUsd),
      liquidityUsd: toNumOrNull(row.liquidityUsd),
      holderCount: row.holderCount,
    }));
  } catch {
    return [];
  }
}

/** What changed since the agent last scored this token — the cross-tick memory a rule like "rising for two ticks" needs. */
export interface ScoreTrend {
  /** Readings from earlier ticks, newest first, at most three. Empty when this is the first look. */
  readings: Array<{ minutesAgo: number; total: number; priceUsd: number | null; holderCount: number | null; liquidityUsd: number | null }>;
  /** Against the most recent earlier reading. Null when there is none. */
  previous: {
    minutesAgo: number;
    totalDelta: number;
    pricePct: number | null;
    liquidityPct: number | null;
    holdersDelta: number | null;
  } | null;
  /** "rising" when price and holders both grew since the last reading, "falling" when both shrank, else "flat"; "first_look" with no history. */
  velocity: "rising" | "falling" | "flat" | "first_look";
  /** How many consecutive earlier readings the price rose across, newest backwards (0–2). */
  consecutiveRises: number;
}

/** The reading written by this very scoring is not "previous": anything this recent is skipped. */
const SAME_TICK_MS = 3 * 60_000;

/**
 * Pure: the previous-tick view of a token from its score history (oldest first, as
 * `getScoreHistory` returns it), relative to `current`. A strategy that says "enter when
 * velocity has risen for two consecutive ticks" was unevaluable before this — the agent
 * had no memory between ticks and declined every candidate (2026-09-22).
 */
export function scoreTrend(
  history: readonly ScoreHistoryPoint[],
  current: { total: number; priceUsd: number | null; holderCount: number | null; liquidityUsd: number | null },
  now: number = Date.now(),
): ScoreTrend {
  const earlier = history
    .filter((p) => now - new Date(p.at).getTime() > SAME_TICK_MS)
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  const readings = earlier.slice(0, 3).map((p) => ({
    minutesAgo: Math.max(1, Math.round((now - new Date(p.at).getTime()) / 60_000)),
    total: p.total,
    priceUsd: p.priceUsd,
    holderCount: p.holderCount,
    liquidityUsd: p.liquidityUsd,
  }));
  const last = earlier[0];
  if (!last) return { readings, previous: null, velocity: "first_look", consecutiveRises: 0 };

  const pct = (a: number | null, b: number | null) => (a === null || b === null || b === 0 ? null : ((a - b) / b) * 100);
  const pricePct = pct(current.priceUsd, last.priceUsd);
  const holdersDelta = current.holderCount === null || last.holderCount === null ? null : current.holderCount - last.holderCount;
  const velocity: ScoreTrend["velocity"] =
    pricePct !== null && holdersDelta !== null && pricePct > 0 && holdersDelta > 0
      ? "rising"
      : pricePct !== null && holdersDelta !== null && pricePct < 0 && holdersDelta <= 0
        ? "falling"
        : "flat";

  // Price rises across consecutive readings: current > last, last > the one before.
  const chain = [current.priceUsd, ...earlier.slice(0, 2).map((p) => p.priceUsd)];
  let consecutiveRises = 0;
  for (let i = 0; i + 1 < chain.length; i += 1) {
    const a = chain[i], b = chain[i + 1];
    if (a === null || b === null || !(a > b)) break;
    consecutiveRises += 1;
  }

  return {
    readings,
    previous: {
      minutesAgo: readings[0]?.minutesAgo ?? 0,
      totalDelta: Math.round((current.total - last.total) * 10) / 10,
      pricePct: pricePct === null ? null : Math.round(pricePct * 10) / 10,
      liquidityPct: (() => { const v = pct(current.liquidityUsd, last.liquidityUsd); return v === null ? null : Math.round(v * 10) / 10; })(),
      holdersDelta,
    },
    velocity,
    consecutiveRises,
  };
}
