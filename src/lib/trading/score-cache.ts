/**
 * Read-only access to the shared `token_scores` cache, for *display* and for the exit
 * engine's "what does this look like now" question.
 *
 * Deliberately ignores `universeKey`: a row scored under another agent's thresholds is
 * still a useful number to show next to a position ("74 at entry → 31 now"), and the
 * exit rules are comparisons against the operator's own floor, not hard gates.
 *
 * **Never use this to authorise a buy.** The entry path must go through
 * `getTokenScore()`, which matches the agent's universe fingerprint and refreshes on a
 * TTL; see `src/lib/tokens/index.ts` and the risk guard's header.
 */
import { inArray } from "drizzle-orm";
import { getDb, tokenScores } from "@/db";
import type { ScoreVerdict } from "@/server/types";

export interface CachedScore {
  tokenId: string;
  total: number;
  verdict: ScoreVerdict;
  blockers: string[];
  liquidityUsd: number | null;
  scoredAt: Date;
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
      });
    }
  } catch {
    // The cache is an optimisation everywhere else too: a read failure means "unknown".
  }
  return out;
}
