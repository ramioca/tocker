/**
 * Token discovery & scoring fixtures.
 *
 * The real engine (`src/lib/tokens/*`) is being built in parallel, so nothing in
 * the UI imports it yet. These shapes are `@/server/types` exactly, which is the
 * contract both sides agreed on — at merge the scoreboard and the trade context
 * swap these arrays for the live queries and nothing else changes.
 *
 * Everything is anchored to the top of the current hour so server and client
 * render the same relative times.
 */
import type {
  Chain,
  ScoreComponents,
  TokenCandidate,
  TokenRef,
  TokenScore,
  TradeScore,
} from "@/server/types";

const HOUR = 3_600_000;

/** Top of the current hour — stable across an SSR pass. */
function anchor(): number {
  return Math.floor(Date.now() / HOUR) * HOUR;
}

function token(
  chain: Chain,
  address: string,
  symbol: string,
  name: string,
  decimals: number,
  price: number,
): TokenRef {
  return { id: `${chain}:${address}`, chain, address, symbol, name, logoUrl: null, decimals, lastPriceUsd: price };
}

function components(
  safety: number,
  liquidity: number,
  organic: number,
  distribution: number,
  momentum: number,
  sentiment: number | null = null,
  smartMoney: number | null = null,
): ScoreComponents {
  return { safety, liquidity, organic, distribution, momentum, sentiment, smartMoney };
}

interface ScoreSeed {
  token: TokenRef;
  total: number;
  verdict: TokenScore["verdict"];
  components: ScoreComponents;
  blockers: string[];
  warnings: string[];
  liquidityUsd: number;
  volume24hUsd: number;
  marketCapUsd: number;
  holderCount: number;
  ageHours: number;
  priceChange24hPct: number;
  sources: string[];
  origin: TokenCandidate["origin"];
}

const SEEDS: ScoreSeed[] = [
  {
    // The blue chip: everything revoked, deep book, real buyers.
    token: token("solana", "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN", "JUP", "Jupiter", 6, 1.08),
    total: 88,
    verdict: "strong",
    components: components(96, 94, 85, 82, 71, 78),
    blockers: [],
    warnings: [],
    liquidityUsd: 41_800_000,
    volume24hUsd: 96_400_000,
    marketCapUsd: 1_460_000_000,
    holderCount: 812_400,
    ageHours: 15_600,
    priceChange24hPct: 3.8,
    sources: ["jupiter", "rugcheck", "sentimentalpha"],
    origin: "top_organic",
  },
  {
    // Three hours old and behaving: authorities gone, holders climbing, no wash.
    token: token("solana", "9tGveXCPn1HrQWYsKpbUHzR1mYq5cVuLNsMsfgqLPUmp", "PLNK", "Plankton", 6, 0.0041),
    total: 71,
    verdict: "candidate",
    components: components(78, 58, 81, 64, 79, null),
    blockers: [],
    warnings: ["top10_holders_38pct", "liquidity_thin_for_size"],
    liquidityUsd: 96_500,
    volume24hUsd: 412_000,
    marketCapUsd: 1_840_000,
    holderCount: 1_260,
    ageHours: 3,
    priceChange24hPct: 142.6,
    sources: ["jupiter", "rugcheck"],
    origin: "new_launches",
  },
  {
    // Alive, but the book is thin and the buying looks manufactured.
    token: token("base", "0x532f27101965dd16442E59d40670FaF5eBB142E4", "BRETT", "Brett", 18, 0.077),
    total: 44,
    verdict: "watch",
    components: components(62, 34, 29, 51, 48, null),
    blockers: [],
    warnings: ["low_organic_volume", "liquidity_drop_18pct", "holder_growth_stalled"],
    liquidityUsd: 21_400,
    volume24hUsd: 184_000,
    marketCapUsd: 740_000,
    holderCount: 318,
    ageHours: 61,
    priceChange24hPct: -12.4,
    sources: ["dexscreener", "goplus"],
    origin: "trending",
  },
  {
    // The rug. Three hard gates, so the verdict is "avoid" whatever the number says.
    token: token("solana", "7xKXtg2CW3s1M4vQrNVaHdFbJzPq9mYnCfLdEuRw6Aa2", "MOONZ", "Moonzilla", 9, 0.00008),
    total: 12,
    verdict: "avoid",
    components: components(4, 9, 17, 6, 38, null),
    blockers: ["mint_authority_active", "top10_holders_91pct", "liquidity_below_floor"],
    warnings: ["dev_balance_44pct", "age_18m"],
    liquidityUsd: 3_200,
    volume24hUsd: 58_000,
    marketCapUsd: 210_000,
    holderCount: 47,
    ageHours: 0.3,
    priceChange24hPct: 318.0,
    sources: ["jupiter", "rugcheck"],
    origin: "new_launches",
  },
  {
    token: token("solana", "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm", "WIF", "dogwifhat", 6, 2.71),
    total: 81,
    verdict: "strong",
    components: components(92, 88, 74, 76, 66, null),
    blockers: [],
    warnings: ["momentum_cooling"],
    liquidityUsd: 8_900_000,
    volume24hUsd: 31_200_000,
    marketCapUsd: 2_710_000_000,
    holderCount: 214_800,
    ageHours: 13_100,
    priceChange24hPct: -2.1,
    sources: ["jupiter", "rugcheck"],
    origin: "trending",
  },
  {
    token: token("base", "0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed", "DEGEN", "Degen", 18, 0.0091),
    total: 66,
    verdict: "candidate",
    components: components(81, 69, 57, 68, 54, null),
    blockers: [],
    warnings: ["buy_tax_1pct"],
    liquidityUsd: 1_240_000,
    volume24hUsd: 2_980_000,
    marketCapUsd: 168_000_000,
    holderCount: 92_300,
    ageHours: 11_400,
    priceChange24hPct: 6.7,
    sources: ["dexscreener", "goplus"],
    origin: "momentum",
  },
  {
    token: token("solana", "4mQbTzKpVnRxLd8yWuHc3NpFgEaJ2sYvBd7QxRkTnU1c", "SPORE", "Spore", 6, 0.00062),
    total: 58,
    verdict: "watch",
    components: components(74, 41, 52, 59, 63, null),
    blockers: [],
    warnings: ["holders_below_comfort", "age_47m"],
    liquidityUsd: 34_900,
    volume24hUsd: 118_000,
    marketCapUsd: 620_000,
    holderCount: 96,
    ageHours: 0.8,
    priceChange24hPct: 61.2,
    sources: ["jupiter"],
    origin: "new_launches",
  },
  {
    token: token("base", "0x9bE4B8b2fD1A7d0c3E5f6A8B2c4D6e8F0a2B4c6D", "HYDRA", "Hydra", 18, 0.0134),
    total: 29,
    verdict: "avoid",
    components: components(18, 37, 24, 22, 55, null),
    blockers: ["freeze_authority_active", "buy_tax_12pct"],
    warnings: ["hidden_owner"],
    liquidityUsd: 48_000,
    volume24hUsd: 96_000,
    marketCapUsd: 1_100_000,
    holderCount: 204,
    ageHours: 9,
    priceChange24hPct: -34.8,
    sources: ["dexscreener", "goplus"],
    origin: "trending",
  },
];

function toScore(seed: ScoreSeed, scoredAt: string): TokenScore {
  return {
    tokenId: seed.token.id,
    chain: seed.token.chain,
    address: seed.token.address,
    symbol: seed.token.symbol,
    name: seed.token.name,
    total: seed.total,
    verdict: seed.verdict,
    components: seed.components,
    blockers: seed.blockers,
    warnings: seed.warnings,
    priceUsd: seed.token.lastPriceUsd,
    liquidityUsd: seed.liquidityUsd,
    volume24hUsd: seed.volume24hUsd,
    marketCapUsd: seed.marketCapUsd,
    holderCount: seed.holderCount,
    ageHours: seed.ageHours,
    priceChange24hPct: seed.priceChange24hPct,
    sources: seed.sources,
    scoredAt,
  };
}

/** Every fixture, newest scoring first. */
export function mockTokenScores(): TokenScore[] {
  const at = anchor();
  return SEEDS.map((seed, index) => toScore(seed, new Date(at - index * 4 * 60_000).toISOString()));
}

/** The four named fixtures, by symbol, for stories and single-token surfaces. */
export function mockTokenScore(symbol: string): TokenScore | null {
  return mockTokenScores().find((score) => score.symbol === symbol) ?? null;
}

/** Discovery output: what a feed surfaced, before the scoring pass. */
export function mockTokenCandidates(): TokenCandidate[] {
  return SEEDS.map((seed) => ({
    token: seed.token,
    origin: seed.origin,
    liquidityUsd: seed.liquidityUsd,
    volume24hUsd: seed.volume24hUsd,
    marketCapUsd: seed.marketCapUsd,
    holderCount: seed.holderCount,
    ageHours: seed.ageHours,
    priceChange24hPct: seed.priceChange24hPct,
    quickScore: seed.total,
  }));
}

/** What the fresh-launch scoreboard shows: young tokens first. */
export function mockFreshLaunches(limit = 8): TokenScore[] {
  return mockTokenScores()
    .slice()
    .sort((a, b) => (a.ageHours ?? Infinity) - (b.ageHours ?? Infinity))
    .slice(0, limit);
}

/** The compact form frozen onto a trade. */
export function mockTradeScore(symbol = "PLNK"): TradeScore {
  const score = mockTokenScore(symbol) ?? mockTokenScores()[0];
  return {
    total: score.total,
    verdict: score.verdict,
    components: score.components,
    blockers: score.blockers,
    warnings: score.warnings,
    liquidityUsd: score.liquidityUsd,
    ageHours: score.ageHours,
    scoredAt: score.scoredAt,
  };
}
