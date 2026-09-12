/**
 * Token intelligence — the public entry point.
 *
 *   discoverCandidates()  wide, free, cheap pre-rank      → src/lib/tokens/discover.ts
 *   scoreToken()          pure, free, fully testable      → src/lib/tokens/score.ts
 *   getTokenScore()       gathers providers, caches, persists  (here)
 *
 * `getTokenScore` is the only function in the subsystem that touches the network or
 * the database. It reads the shared `token_scores` cache (10-minute TTL, keyed by
 * `chain:address` *and* a fingerprint of the agent's universe rules, because the hard
 * gates are per-agent), and otherwise fans out to the free providers, calls the pure
 * scorer and writes the row back.
 *
 * Scoring is free by design: Jupiter, RugCheck, DexScreener and GoPlus all cost
 * nothing, so an agent can sweep hundreds of tokens on a $0.25 data budget. x402
 * money is spent only when the caller explicitly asks for `deep: true`.
 */
import { eq } from "drizzle-orm";
import { getDb, tokenScores } from "@/db";
import type { Chain, TokenScore, TradeScore } from "@/server/types";
import type { X402Context } from "@/lib/x402/types";
import { getDexScreenerToken } from "./providers/dexscreener";
import { getGoPlusSecurity } from "./providers/goplus";
import { getJupiterToken } from "./providers/jupiter";
import { getRugcheckSummary } from "./providers/rugcheck";
import { scoreToken, type Universe } from "./score";
import type { ScoreInput, SentimentInput } from "./types";

export { discoverCandidates, quickScore, renderCandidates, DEFAULT_DISCOVERY_LIMIT } from "./discover";
export {
  explainBlocker,
  hardGates,
  renderScore,
  scoreToken,
  toFacts,
  verdictFor,
  SENTIMENT_WEIGHT,
  VERDICT_BANDS,
  WEIGHTS,
  type ScoredToken,
  type Universe,
} from "./score";
export type * from "./types";

/** How long a persisted score may be reused. */
export const SCORE_TTL_MS = 600_000;

/** Data sources whose `signals.sentiment` we will fold into a deep score. */
const SENTIMENT_SOURCE_IDS = ["sentimentalpha", "xquik-search", "x-search"] as const;

export interface GetTokenScoreInput {
  chain: Chain;
  address: string;
  universe: Universe;
  /** Sizes the `liquidity` component against the clip the agent actually trades. */
  maxTradeUsd?: number;
  /** Used only until a provider tells us the real symbol. */
  symbolHint?: string;
  /**
   * Buy a sentiment reading over x402 and fold it into the score. This is the only
   * path in the subsystem that spends money, and only the caller can ask for it.
   */
  deep?: boolean;
  x402?: X402Context;
  /** Sources the agent is allowed to pay for; the first sentiment-capable one wins. */
  dataSources?: readonly string[];
  /** Skip the cache read (not the write). */
  force?: boolean;
  now?: number;
}

/**
 * Stable fingerprint of the gate-relevant universe fields. Two agents with identical
 * thresholds share a cached score; one stricter agent does not inherit a looser
 * agent's verdict.
 */
export function universeKey(universe: Universe): string {
  const parts = [
    universe.minScore,
    universe.minLiquidityUsd,
    universe.minHolderCount,
    universe.minAgeMinutes,
    universe.maxAgeHours ?? "null",
    universe.maxTop10HolderPct,
    universe.maxBuyTaxPct,
    universe.requireMintRevoked ? 1 : 0,
    universe.requireFreezeRevoked ? 1 : 0,
    universe.blocklist
      .map((b) => `${b.chain}:${b.address.toLowerCase()}`)
      .sort()
      .join(","),
  ];
  const raw = parts.join("|");
  // djb2 — short, stable, and this only has to detect difference, not resist attack.
  let hash = 5381;
  for (let i = 0; i < raw.length; i += 1) hash = ((hash << 5) + hash + raw.charCodeAt(i)) >>> 0;
  return hash.toString(36);
}

function rowToScore(row: typeof tokenScores.$inferSelect): TokenScore {
  const components = row.components;
  return {
    tokenId: row.id,
    chain: row.chain,
    address: row.address,
    symbol: row.symbol,
    name: null,
    total: Number(row.total),
    verdict: row.verdict,
    components: {
      safety: components.safety ?? 0,
      liquidity: components.liquidity ?? 0,
      organic: components.organic ?? 0,
      distribution: components.distribution ?? 0,
      momentum: components.momentum ?? 0,
      sentiment: components.sentiment ?? null,
    },
    blockers: row.blockers,
    warnings: row.warnings,
    priceUsd: row.priceUsd === null ? null : Number(row.priceUsd),
    liquidityUsd: row.liquidityUsd === null ? null : Number(row.liquidityUsd),
    volume24hUsd: row.volume24hUsd === null ? null : Number(row.volume24hUsd),
    marketCapUsd: row.marketCapUsd === null ? null : Number(row.marketCapUsd),
    holderCount: row.holderCount,
    ageHours: row.ageHours === null ? null : Number(row.ageHours),
    priceChange24hPct: row.priceChange24hPct === null ? null : Number(row.priceChange24hPct),
    sources: row.sources,
    scoredAt: row.scoredAt.toISOString(),
  };
}

async function readCache(id: string, key: string, now: number, wantSentiment: boolean): Promise<TokenScore | null> {
  try {
    const db = await getDb();
    const rows = await db.select().from(tokenScores).where(eq(tokenScores.id, id)).limit(1);
    const row = rows[0];
    if (!row) return null;
    if (row.universeKey !== key) return null;
    if (now - row.scoredAt.getTime() > SCORE_TTL_MS) return null;
    // A deep request cannot be served by a row that was scored without sentiment.
    if (wantSentiment && (row.components.sentiment ?? null) === null) return null;
    return rowToScore(row);
  } catch {
    // The cache is an optimisation; a database hiccup must not stop a run scoring.
    return null;
  }
}

async function writeCache(score: TokenScore, key: string): Promise<void> {
  try {
    const db = await getDb();
    const values = {
      id: score.tokenId,
      chain: score.chain,
      address: score.address,
      symbol: score.symbol,
      total: score.total.toFixed(2),
      verdict: score.verdict,
      components: { ...score.components } as Record<string, number | null>,
      blockers: score.blockers,
      warnings: score.warnings,
      priceUsd: score.priceUsd === null ? null : score.priceUsd.toFixed(12),
      liquidityUsd: score.liquidityUsd === null ? null : score.liquidityUsd.toFixed(2),
      volume24hUsd: score.volume24hUsd === null ? null : score.volume24hUsd.toFixed(2),
      marketCapUsd: score.marketCapUsd === null ? null : score.marketCapUsd.toFixed(2),
      holderCount: score.holderCount,
      ageHours: score.ageHours === null ? null : score.ageHours.toFixed(2),
      priceChange24hPct: score.priceChange24hPct === null ? null : score.priceChange24hPct.toFixed(4),
      sources: score.sources,
      universeKey: key,
      scoredAt: new Date(score.scoredAt),
    };
    await db.insert(tokenScores).values(values).onConflictDoUpdate({ target: tokenScores.id, set: values });
  } catch {
    // Same reasoning as readCache: never let cache persistence fail a run.
  }
}

/** Buys one sentiment reading over x402. Returns `null` on any failure, never throws. */
async function fetchSentiment(
  symbol: string,
  x402: X402Context,
  allowed: readonly string[] | undefined,
): Promise<SentimentInput | null> {
  const { getDataSource } = await import("@/lib/data-sources/registry");
  const candidates = SENTIMENT_SOURCE_IDS.filter((id) => !allowed || allowed.length === 0 || allowed.includes(id));
  for (const id of candidates) {
    const source = getDataSource(id);
    if (!source) continue;
    try {
      const result = await source.query(x402, { query: symbol, watchlist: [symbol] });
      const signals = result.signals ?? {};
      if (signals.sentiment === undefined && signals.velocity === undefined) continue;
      return {
        sentiment: signals.sentiment ?? null,
        velocity: signals.velocity ?? null,
        source: id,
      };
    } catch {
      // Budget exhausted, source down, bad params — fall through to the next one.
    }
  }
  return null;
}

/** Gathers every free provider for a token. Each failure degrades, none throws. */
async function gather(input: GetTokenScoreInput): Promise<ScoreInput> {
  const { chain, address } = input;
  const base: ScoreInput = {
    chain,
    address,
    symbol: input.symbolHint ?? address.slice(0, 6),
    ...(input.maxTradeUsd === undefined ? {} : { maxTradeUsd: input.maxTradeUsd }),
    ...(input.now === undefined ? {} : { now: input.now }),
  };

  if (chain === "solana") {
    const [jupiter, rugcheck] = await Promise.all([getJupiterToken(address), getRugcheckSummary(address)]);
    return { ...base, jupiter, rugcheck, dexscreener: null, goplus: null };
  }
  const [dexscreener, goplus] = await Promise.all([getDexScreenerToken(address), getGoPlusSecurity(address)]);
  return { ...base, jupiter: null, rugcheck: null, dexscreener, goplus };
}

/**
 * The token's score, from cache when it is fresh and was produced under the same
 * universe rules, otherwise freshly gathered, scored and persisted.
 *
 * Never throws for provider reasons: a token every provider has failed on comes back
 * with zeroed components, `low_confidence`, and — if the agent's universe gates
 * anything at all — `*_unknown` blockers, so the risk guard refuses the buy.
 */
export async function getTokenScore(input: GetTokenScoreInput): Promise<TokenScore> {
  const now = input.now ?? Date.now();
  const id = `${input.chain}:${input.address}`;
  const key = universeKey(input.universe);
  const wantSentiment = input.deep === true && input.x402 !== undefined;

  if (input.force !== true) {
    const cached = await readCache(id, key, now, wantSentiment);
    if (cached) return cached;
  }

  const gathered = await gather(input);

  if (wantSentiment && input.x402) {
    const symbol =
      gathered.jupiter?.symbol ?? gathered.dexscreener?.symbol ?? gathered.goplus?.symbol ?? input.symbolHint ?? null;
    if (symbol) {
      const sentiment = await fetchSentiment(symbol, input.x402, input.dataSources);
      if (sentiment) gathered.sentiment = sentiment;
    }
  }

  const score = scoreToken(gathered, input.universe);
  await writeCache(score, key);
  return score;
}

/** The compact form frozen onto `trades.scoreSnapshot`. */
export function toTradeScore(score: TokenScore): TradeScore {
  return {
    total: score.total,
    verdict: score.verdict,
    components: { ...score.components },
    blockers: score.blockers,
    warnings: score.warnings,
    liquidityUsd: score.liquidityUsd,
    ageHours: score.ageHours,
    scoredAt: score.scoredAt,
  };
}

/** Test seam: forget every in-process provider cache. */
export async function resetTokenCaches(): Promise<void> {
  const [{ resetJupiterCache }, { resetRugcheckCache }, { resetDexScreenerCache }, { resetGoPlusCache }] =
    await Promise.all([
      import("./providers/jupiter"),
      import("./providers/rugcheck"),
      import("./providers/dexscreener"),
      import("./providers/goplus"),
    ]);
  resetJupiterCache();
  resetRugcheckCache();
  resetDexScreenerCache();
  resetGoPlusCache();
}
