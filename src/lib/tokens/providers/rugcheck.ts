/**
 * RugCheck — free Solana safety summary.
 *
 * Verified live: `GET https://api.rugcheck.xyz/v1/tokens/<mint>/report/summary`
 * → `{ tokenProgram, tokenType, risks: [{ name, value, description, score, level }],
 *      score, score_normalised, lpLockedPct }`.
 *
 * `score_normalised` is 0-100 where **lower is safer** (BONK returns 7); the scorer
 * inverts it. `level` is `danger` | `warn` | `info`.
 */
import fixture from "../fixtures/rugcheck.json";
import type { RugcheckRisk, RugcheckSummary } from "../types";
import { asArray, asRecord, getJson, isTokensMock, mapLimit, MAX_CONCURRENCY, num, str, TtlCache } from "./http";

const BASE = "https://api.rugcheck.xyz/v1";
/** Safety facts change slowly; ten minutes matches the score TTL. */
const TTL_MS = 600_000;

const cache = new TtlCache<RugcheckSummary>(TTL_MS);

export function resetRugcheckCache(): void {
  cache.clear();
}

const FIXTURE = fixture as unknown as Record<string, unknown>;

function level(value: unknown): RugcheckRisk["level"] {
  const s = str(value)?.toLowerCase();
  return s === "danger" || s === "warn" ? s : "info";
}

export function parseRugcheckSummary(mint: string, value: unknown): RugcheckSummary | null {
  const r = asRecord(value);
  if (!r) return null;
  // A 404/"not found" body has neither of these; treat it as no data rather than a
  // token with a perfect score.
  const scoreNormalised = num(r.score_normalised);
  const score = num(r.score);
  if (scoreNormalised === null && score === null && !Array.isArray(r.risks)) return null;
  return {
    mint,
    risks: asArray(r.risks)
      .map((raw): RugcheckRisk | null => {
        const item = asRecord(raw);
        const name = item ? str(item.name) : null;
        if (!item || name === null) return null;
        return { name, description: str(item.description), score: num(item.score), level: level(item.level) };
      })
      .filter((x): x is RugcheckRisk => x !== null),
    score,
    scoreNormalised,
    lpLockedPct: num(r.lpLockedPct),
  };
}

/** Safety summary for one mint. `null` when RugCheck has no report or is unreachable. */
export async function getRugcheckSummary(mint: string): Promise<RugcheckSummary | null> {
  const cached = cache.get(mint);
  if (cached.hit) return cached.value;

  const raw = isTokensMock()
    ? (FIXTURE[mint] ?? null)
    : await getJson(`${BASE}/tokens/${encodeURIComponent(mint)}/report/summary`);
  const parsed = raw === null ? null : parseRugcheckSummary(mint, raw);
  cache.set(mint, parsed);
  return parsed;
}

/** RugCheck has no batch endpoint, so this fans out under the concurrency cap. */
export async function getRugcheckSummaries(mints: readonly string[]): Promise<Map<string, RugcheckSummary>> {
  const unique = Array.from(new Set(mints));
  const results = await mapLimit(unique, MAX_CONCURRENCY, (mint) => getRugcheckSummary(mint));
  const out = new Map<string, RugcheckSummary>();
  results.forEach((summary, i) => {
    if (summary) out.set(unique[i] as string, summary);
  });
  return out;
}
