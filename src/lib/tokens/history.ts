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
 * Append one point of history for a freshly computed score. Deduped per
 * {@link shouldRecord}; never throws.
 */
export async function recordScore(score: TokenScore): Promise<void> {
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
