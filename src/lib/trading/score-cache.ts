/**
 * Read-only access to the shared `token_scores` cache, for *display* and for the exit
 * engine's "what does this look like now" question.
 *
 * {@link loadCachedScores} deliberately ignores `universeKey`: the agent's own "seen
 * recently" check and its prompt only want to know that a token was looked at. Anything
 * that *shows* a verdict to a person goes through {@link loadDisplayScores} instead,
 * which does not: one row per token is overwritten by whoever scored it last, and a
 * verdict produced under another operator's private universe is theirs, not ours.
 *
 * **Never use this to authorise a buy.** The entry path must go through
 * `getTokenScore()`, which matches the agent's universe fingerprint and refreshes on a
 * TTL; see `src/lib/tokens/index.ts` and the risk guard's header.
 */
import { desc, inArray } from "drizzle-orm";
import { getDb, tokenScoreHistory, tokenScores } from "@/db";
import { isNoData } from "@/lib/tokens/history";
import type { ScoreVerdict } from "@/server/types";

export interface CachedScore {
  tokenId: string;
  total: number;
  verdict: ScoreVerdict;
  blockers: string[];
  liquidityUsd: number | null;
  scoredAt: Date;
  /** The universe fingerprint the row was scored under (`universeKey()` in `@/lib/tokens`). */
  universeKey: string | null;
  /** Providers that answered. Empty means none did, and the reading is not a verdict. */
  sources: string[];
  priceUsd: number | null;
  holderCount: number | null;
}

/** Cached scores for a set of `${chain}:${address}` ids. Missing ids are simply absent. */
export async function loadCachedScores(tokenIds: readonly string[]): Promise<Map<string, CachedScore>> {
  const out = new Map<string, CachedScore>();
  const ids = Array.from(new Set(tokenIds));
  if (ids.length === 0) return out;
  try {
    const db = await getDb();
    const rows = await db.select().from(tokenScores).where(inArray(tokenScores.id, ids));
    for (const row of rows) {
      out.set(row.id, {
        tokenId: row.id,
        total: Number(row.total),
        verdict: row.verdict,
        blockers: row.blockers,
        liquidityUsd: row.liquidityUsd === null ? null : Number(row.liquidityUsd),
        scoredAt: row.scoredAt,
        universeKey: row.universeKey,
        sources: row.sources,
        priceUsd: row.priceUsd === null ? null : Number(row.priceUsd),
        holderCount: row.holderCount,
      });
    }
  } catch {
    // The cache is an optimisation everywhere else too: a read failure means "unknown".
  }
  return out;
}

/** A score a person may be shown next to a holding. */
export interface DisplayScore {
  total: number;
  /**
   * Only when the reading was produced under the universe asked for. A history fallback
   * has no universe on record, so its verdict and blockers could be anyone's.
   */
  verdict: ScoreVerdict | null;
  blockers: string[] | null;
  scoredAt: Date;
}

/**
 * The latest score to print next to each held token, for a viewer entitled to
 * `universeKey`'s verdicts: the agent's own fingerprint for its owner, the public
 * default's for everyone else.
 *
 *  1. The cached row, when it was scored under that universe and a provider answered.
 *  2. Otherwise the newest `token_score_history` reading — its total only. History keeps
 *     no no-data readings, and a total carries no threshold (the token page charts the
 *     same numbers publicly).
 *  3. Otherwise nothing, and the table prints "—" rather than a stranger's "0 Avoid".
 */
export async function loadDisplayScores(
  tokenIds: readonly string[],
  universeKey: string,
): Promise<Map<string, DisplayScore>> {
  const out = new Map<string, DisplayScore>();
  const ids = Array.from(new Set(tokenIds));
  if (ids.length === 0) return out;

  const cached = await loadCachedScores(ids);
  const missing: string[] = [];
  for (const id of ids) {
    const row = cached.get(id);
    if (row && row.universeKey === universeKey && !isNoData(row)) {
      out.set(id, { total: row.total, verdict: row.verdict, blockers: row.blockers, scoredAt: row.scoredAt });
    } else {
      missing.push(id);
    }
  }
  if (missing.length === 0) return out;

  try {
    const db = await getDb();
    const rows = await db
      .selectDistinctOn([tokenScoreHistory.tokenId], {
        tokenId: tokenScoreHistory.tokenId,
        total: tokenScoreHistory.total,
        scoredAt: tokenScoreHistory.scoredAt,
      })
      .from(tokenScoreHistory)
      .where(inArray(tokenScoreHistory.tokenId, missing))
      .orderBy(tokenScoreHistory.tokenId, desc(tokenScoreHistory.scoredAt));
    for (const row of rows) {
      out.set(row.tokenId, { total: Number(row.total), verdict: null, blockers: null, scoredAt: row.scoredAt });
    }
  } catch {
    // Same contract as the cache read: a failure leaves the token unscored, not wrong.
  }
  return out;
}
