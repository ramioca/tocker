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
 *
 * One asymmetry worth knowing: on Solana `gather` makes a *second*, conditional round
 * trip (DexScreener + the token's GeckoTerminal pools) whenever Jupiter has no price
 * or no liquidity for the mint. That is the normal answer for a launch minutes old,
 * and without the fallback such a token scores with `liquidity_unknown` and
 * `age_unknown` blockers — a refusal about our data, not about the token.
 */
import { eq } from "drizzle-orm";
import { getDb, publicTokenScores, tokenScores } from "@/db";
import { DEFAULT_AGENT_CONFIG } from "@/lib/agent/config";
import type { Chain, TokenScore, TradeScore } from "@/server/types";
import type { X402Context } from "@/lib/x402/types";
import { getDexScreenerToken } from "./providers/dexscreener";
import { deepestGeckoPool, getGeckoTokenInfo, getGeckoTokenPools } from "./providers/geckoterminal";
import { getGoPlusSecurity } from "./providers/goplus";
import { getJupiterToken } from "./providers/jupiter";
import { getRugcheckSummary } from "./providers/rugcheck";
import { isNoData, recordScore } from "./history";
import { scoreToken, type Universe } from "./score";
import type { ScoreInput, SellCheckInput, SentimentInput, SmartMoneyInput } from "./types";

export { discoverCandidates, quickScore, renderCandidates, DEFAULT_DISCOVERY_LIMIT } from "./discover";
export {
  explainBlocker,
  hardGates,
  renderScore,
  scoreToken,
  toFacts,
  verdictFor,
  CORE_WEIGHT_TOTAL,
  GECKO_WEIGHT,
  SENTIMENT_WEIGHT,
  SMART_MONEY_WEIGHT,
  VERDICT_BANDS,
  WEIGHTS,
  type ScoredToken,
  type Universe,
} from "./score";
export type * from "./types";

/** How long a persisted score may be reused. */
export const SCORE_TTL_MS = 600_000;

/**
 * Data sources whose `signals.sentiment` we will fold into a deep score, tried in this
 * order until one answers with a usable signal.
 *
 * `x-search` leads because it is the one that has been proven to pay: its 402 advertises
 * the Base USDC EIP-712 domain correctly. `sentimentalpha` advertises the wrong domain
 * name; `paidFetch` corrects it before signing, but no payment to it has settled yet, so
 * it is the fallback rather than the first call. `xquik-search` was dropped in W7 — the
 * endpoint 404s (see `src/lib/data-sources/registry.ts`).
 */
const SENTIMENT_SOURCE_IDS = ["x-search", "sentimentalpha"] as const;

/** Data sources whose `signals.smartMoneyNetflowUsd` feeds the `smartMoney` component. */
const SMART_MONEY_SOURCE_IDS: readonly string[] = ["nansen-smart-money"];

/**
 * Data sources whose `signals.sellable` can raise the `cannot_sell` gate. EVM only:
 * the check is a sell simulation against the token's pools, and nothing in this list
 * covers Solana.
 */
const SELL_CHECK_SOURCE_IDS: readonly string[] = ["plexa-pretrade"];

/** Which paid signals, beyond sentiment, the caller wants folded into this score. */
export interface PaidScoreSignals {
  /** Buy smart-money netflow (Nansen) and score it against the token's liquidity. */
  smartMoney?: boolean;
  /** Buy a live sell simulation (Plexa, Base only). A proven failure blocks the buy. */
  sellCheck?: boolean;
}

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
  /**
   * The other paid signals, each behind its own explicit flag. Like `deep`, nothing
   * here spends anything unless the caller asks, and every call is charged against
   * `x402.budget` by `paidFetch` — a signal the budget cannot cover is skipped, not
   * borrowed against.
   */
  paid?: PaidScoreSignals;
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

/**
 * The platform default universe's fingerprint. Token pages and `/discover` show only
 * readings taken under it, because an agent's gates are part of its private strategy.
 */
export const PUBLIC_UNIVERSE_KEY = universeKey(DEFAULT_AGENT_CONFIG.universe);

/**
 * Whether a reading is the public one: the default universe, sized against the default
 * clip, and with no paid signal folded in. An agent whose universe happens to match the
 * default still scores with its own clip size and its own paid sources, and those move
 * the total — so its reading shares the cache but is not published.
 */
export function isPublicReading(input: Pick<GetTokenScoreInput, "universe" | "maxTradeUsd" | "x402">): boolean {
  return (
    universeKey(input.universe) === PUBLIC_UNIVERSE_KEY &&
    input.x402 === undefined &&
    (input.maxTradeUsd ?? 0) === DEFAULT_AGENT_CONFIG.risk.maxTradeUsd
  );
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
      gecko: components.gecko ?? null,
      sentiment: components.sentiment ?? null,
      smartMoney: components.smartMoney ?? null,
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

interface CacheWants {
  sentiment: boolean;
  smartMoney: boolean;
  sellCheck: boolean;
}

async function readCache(id: string, key: string, now: number, wants: CacheWants): Promise<TokenScore | null> {
  try {
    const db = await getDb();
    const rows = await db.select().from(tokenScores).where(eq(tokenScores.id, id)).limit(1);
    const row = rows[0];
    if (!row) return null;
    if (row.universeKey !== key) return null;
    if (now - row.scoredAt.getTime() > SCORE_TTL_MS) return null;
    // A deep request cannot be served by a row that was scored without sentiment.
    if (wants.sentiment && (row.components.sentiment ?? null) === null) return null;
    // The paid signals are recorded in `sources`, which is the only honest test: a
    // null component can mean "not bought" *or* "bought and the source had nothing",
    // and re-buying a source that already answered empty is just burning budget.
    if (wants.smartMoney && !row.sources.some((s) => SMART_MONEY_SOURCE_IDS.includes(s))) return null;
    if (wants.sellCheck && !row.sources.some((s) => SELL_CHECK_SOURCE_IDS.includes(s))) return null;
    return rowToScore(row);
  } catch {
    // The cache is an optimisation; a database hiccup must not stop a run scoring.
    return null;
  }
}

async function writeCache(score: TokenScore, key: string, isPublic: boolean): Promise<void> {
  try {
    const db = await getDb();
    const market = {
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
      scoredAt: new Date(score.scoredAt),
    };
    const values = { ...market, universeKey: key };
    await db.insert(tokenScores).values(values).onConflictDoUpdate({ target: tokenScores.id, set: values });
    // The public row is written only by a public reading, so no agent's rescore under
    // its own rules can replace what the token page shows.
    if (isPublic) {
      await db.insert(publicTokenScores).values(market).onConflictDoUpdate({ target: publicTokenScores.id, set: market });
    }
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
  const candidates = SENTIMENT_SOURCE_IDS.filter((id) => allowedBy(allowed, id));
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

/**
 * True when this source is enabled for the agent. `undefined` means the caller did not
 * restrict; an empty list means none, the same rule `query_data_source` applies.
 */
function allowedBy(allowed: readonly string[] | undefined, id: string): boolean {
  return allowed === undefined || allowed.includes(id);
}

/**
 * Buys one smart-money netflow reading over x402. Returns `null` on any failure —
 * including an exhausted budget — because a signal the agent could not afford must
 * degrade the score's *completeness*, never fail the scoring pass.
 */
async function fetchSmartMoney(
  chain: Chain,
  address: string,
  symbol: string | null,
  x402: X402Context,
  allowed: readonly string[] | undefined,
): Promise<SmartMoneyInput | null> {
  const { getDataSource } = await import("@/lib/data-sources/registry");
  for (const id of SMART_MONEY_SOURCE_IDS.filter((s) => allowedBy(allowed, s))) {
    const source = getDataSource(id);
    if (!source) continue;
    try {
      const result = await source.query(x402, {
        chains: [chain],
        tokenAddress: address,
        ...(symbol ? { symbol } : {}),
      });
      const signals = result.signals ?? {};
      if (signals.smartMoneyNetflowUsd === undefined) continue;
      return { netflowUsd: signals.smartMoneyNetflowUsd, traderCount: null, source: id };
    } catch {
      // Same contract as sentiment: a paid signal never breaks a free score.
    }
  }
  return null;
}

/**
 * Buys one live sell simulation over x402. Base only — the sources in this list
 * simulate an EVM sell, and pretending a Solana mint was checked would be worse than
 * not checking it.
 */
async function fetchSellCheck(
  chain: Chain,
  address: string,
  sizeUsd: number | undefined,
  x402: X402Context,
  allowed: readonly string[] | undefined,
): Promise<SellCheckInput | null> {
  if (chain !== "base") return null;
  const { getDataSource } = await import("@/lib/data-sources/registry");
  for (const id of SELL_CHECK_SOURCE_IDS.filter((s) => allowedBy(allowed, s))) {
    const source = getDataSource(id);
    if (!source) continue;
    try {
      const result = await source.query(x402, {
        token: address,
        ...(sizeUsd === undefined ? {} : { sizeUsd }),
        chain: "base",
      });
      const signals = result.signals ?? {};
      // `undefined` here is the source saying "inconclusive", which stays `null` —
      // it must not become `false` and gate the token.
      return {
        sellable: signals.sellable ?? null,
        verdict: null,
        source: id,
      };
    } catch {
      // Budget, upstream failure or an address the service does not cover.
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

  // GeckoTerminal is the one free provider that covers both chains, so it is fetched
  // on both. It is also the one with a per-process rate limit, which its own module
  // owns: a refused call is indistinguishable from an unrated token here, and both
  // mean `components.gecko === null` rather than a failed score.
  if (chain === "solana") {
    const [jupiter, rugcheck, gecko] = await Promise.all([
      getJupiterToken(address),
      getRugcheckSummary(address),
      getGeckoTokenInfo("solana", address),
    ]);
    // A mint minutes old is exactly the one Jupiter's token API has not indexed yet, so
    // the first pass comes back with no price, no liquidity and no age — and the hard
    // gates then refuse the buy on `liquidity_unknown` / `age_unknown` rather than on
    // anything about the token (2026-09-22). Both endpoints below *do* answer for it, so
    // a second, conditional round-trip buys the difference between a real score and a
    // blind refusal. Only when Jupiter fell short: an indexed token costs nothing extra.
    if (jupiter === null || jupiter.usdPrice === null || jupiter.liquidity === null) {
      const [dexscreener, pools] = await Promise.all([
        getDexScreenerToken(address, "solana"),
        getGeckoTokenPools("solana", address),
      ]);
      return {
        ...base,
        jupiter,
        rugcheck,
        dexscreener,
        goplus: null,
        gecko,
        geckoPool: deepestGeckoPool(pools, address),
      };
    }
    return { ...base, jupiter, rugcheck, dexscreener: null, goplus: null, gecko };
  }
  // Native ETH has no contract; DexScreener, GoPlus and GeckoTerminal know it as WETH.
  const WETH_BASE = "0x4200000000000000000000000000000000000006";
  const lookup = address.toLowerCase() === "native" ? WETH_BASE : address;
  const [dexscreener, goplus, gecko] = await Promise.all([
    getDexScreenerToken(lookup),
    getGoPlusSecurity(lookup),
    getGeckoTokenInfo("base", lookup),
  ]);
  return { ...base, jupiter: null, rugcheck: null, dexscreener, goplus, gecko };
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
  const paying = input.x402 !== undefined;
  const wants: CacheWants = {
    sentiment: input.deep === true && paying,
    smartMoney: input.paid?.smartMoney === true && paying,
    // A sell check on Solana is not a cache miss, it is a request nobody can serve.
    sellCheck: input.paid?.sellCheck === true && paying && input.chain === "base",
  };

  if (input.force !== true) {
    const cached = await readCache(id, key, now, wants);
    if (cached) return cached;
  }

  const gathered = await gather(input);

  if (input.x402) {
    const symbol =
      gathered.jupiter?.symbol ?? gathered.dexscreener?.symbol ?? gathered.goplus?.symbol ?? input.symbolHint ?? null;

    // Sequential on purpose: each call checks the same budget, and a parallel pair
    // could both see room for the last $0.05 and spend it twice.
    if (wants.sentiment && symbol) {
      const sentiment = await fetchSentiment(symbol, input.x402, input.dataSources);
      if (sentiment) gathered.sentiment = sentiment;
    }
    if (wants.smartMoney) {
      const smartMoney = await fetchSmartMoney(input.chain, input.address, symbol, input.x402, input.dataSources);
      if (smartMoney) gathered.smartMoney = smartMoney;
    }
    if (wants.sellCheck) {
      const sellCheck = await fetchSellCheck(
        input.chain,
        input.address,
        input.maxTradeUsd,
        input.x402,
        input.dataSources,
      );
      if (sellCheck) gathered.sellCheck = sellCheck;
    }
  }

  const score = scoreToken(gathered, input.universe);
  // A reading no provider answered is an outage, not a verdict: caching it would replace
  // the token's last real score (and, under the public universe, its public page) with
  // "0 · avoid". The caller still gets it, so a buy is still refused on it.
  const isPublic = isPublicReading(input);
  if (!isNoData(score)) await writeCache(score, key, isPublic);
  // Append-only history for token pages; deduped, never throws. A default-universe
  // reading taken with private inputs is filed under no key, so it never charts as public.
  await recordScore(score, key === PUBLIC_UNIVERSE_KEY && !isPublic ? null : key);
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
  const [
    { resetJupiterCache },
    { resetRugcheckCache },
    { resetDexScreenerCache },
    { resetGoPlusCache },
    { resetGeckoTerminalCache },
  ] = await Promise.all([
    import("./providers/jupiter"),
    import("./providers/rugcheck"),
    import("./providers/dexscreener"),
    import("./providers/goplus"),
    import("./providers/geckoterminal"),
  ]);
  resetJupiterCache();
  resetRugcheckCache();
  resetDexScreenerCache();
  resetGoPlusCache();
  resetGeckoTerminalCache();
}
