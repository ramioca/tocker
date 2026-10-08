/**
 * Candidate discovery — the wide end of the funnel.
 *
 * Each tick an agent sweeps its configured feeds across its configured chains,
 * de-duplicates by `chain:address`, throws away everything that already fails a gate
 * we can evaluate for free (blocklist, age, liquidity, holders), pre-ranks what is
 * left with a cheap {@link quickScore} computed from the discovery payload alone, and
 * hands back the top `limit`. Only then does the caller pay the (still free, but much
 * chattier) full scoring pass on a handful of tokens instead of several hundred.
 *
 * Feeds, all free and keyless:
 *
 * | Feed           | Solana                                  | Base                                    |
 * |----------------|-----------------------------------------|-----------------------------------------|
 * | `new_launches` | Jupiter `/tokens/v2/recent`             | DexScreener `/token-profiles/latest/v1` |
 * | `trending`     | Jupiter `/tokens/v2/toptraded/24h`      | DexScreener `/token-boosts/top/v1`      |
 * | `top_organic`  | Jupiter `/tokens/v2/toporganicscore/24h`| n/a — falls back to `trending`          |
 * | `momentum`     | derived from `stats1h`/`stats24h`       | derived from `priceChange` + `volume`   |
 * | `gecko_launches` | GeckoTerminal `new_pools` p1-2 + `trending_pools` p1, kept only when GeckoTerminal's own GT Score rates the token ≥ 50 — same two endpoints on both chains |
 *
 * `gecko_launches` has a second mode. When the sweep's `maxAgeHours` is 15 minutes or
 * less it reads `new_pools` p1-3, filters on the five-minute buyer counts, requires a
 * known reserve, and drops the GT Score requirement entirely — see
 * {@link isSuperFresh}. Nothing outside that window changes.
 *
 * And one feed that is **not** free, off by default, and only runs when the agent
 * turned it on *and* the caller passed an x402 context:
 *
 * | `paid_launches` | SolEnrich `new-tokens` ($0.012, Solana wallet) | gate402 `/v1/launches` ($0.02, Base wallet) |
 *
 * It buys a pre-screened launch radar per chain per sweep — one call, not one per
 * token — and its rows are merged into the same de-duplicated pool as the free feeds,
 * so a token both a free and a paid feed found is still scored once. A caller that
 * sweeps twice hands both sweeps one record of what was bought
 * (`DiscoverInput.paidLaunches`), and the second pays for nothing the first bought.
 */
import type { Chain, DiscoveryFeed, TokenCandidate, TokenRef } from "@/server/types";
import type { PaidLaunch } from "@/lib/data-sources/normalize";
import type { X402Context } from "@/lib/x402/types";
import { getDexScreenerTokens, getLatestTokenProfiles, getTopBoostedTokens } from "./providers/dexscreener";
import {
  getGeckoPools,
  getGeckoPoolTokens,
  getGeckoTokenInfo,
  type GeckoFeed,
  type GeckoPool,
  type GeckoTokenInfo,
} from "./providers/geckoterminal";
import { mapLimit } from "./providers/http";
import { getJupiterRecent, getJupiterTopOrganic, getJupiterTopTraded } from "./providers/jupiter";
import { hardGates, toFacts, type Universe } from "./score";
import type { DexScreenerToken, JupiterToken, TokenFacts } from "./types";

export interface DiscoverInput {
  chains: readonly Chain[];
  /** Which feeds to sweep. Defaults to the agent's `universe.discovery`. */
  feeds?: readonly DiscoveryFeed[];
  limit?: number;
  universe: Universe;
  /**
   * Filters for this sweep only; the agent's universe is not mutated. They can only
   * narrow it (see {@link sweepFilters}); absent or `null` means the universe's own.
   */
  minLiquidityUsd?: number;
  maxAgeHours?: number | null;
  /**
   * Required by the `paid_launches` feed and by nothing else. Without it that feed is
   * silently skipped rather than erroring: a sweep must never fail because the caller
   * has no wallet, and it must never spend without one being handed to it.
   */
  x402?: X402Context;
  /** Sources the agent is allowed to pay for. Empty or absent means "any". */
  dataSources?: readonly string[];
  /** Sweep the paid launch radars whether or not `dataSources` names them — the platform pays for them to be used. */
  alwaysPaidLaunches?: boolean;
  /**
   * The paid launch radars already bought, by chain. A sweep takes a chain's rows from
   * here instead of paying for them, and adds what it buys. Hand one map to two sweeps
   * and the second never pays for a radar the first bought. A chain recorded with no
   * rows is not bought either, which is how a caller keeps a sweep from paying at all.
   */
  paidLaunches?: Map<Chain, TokenCandidate[]>;
  /** Injected in tests so age maths is deterministic. */
  now?: number;
}

export const DEFAULT_DISCOVERY_LIMIT = 20;
/** The most rows one sweep hands back, whatever limit it is asked for. */
export const MAX_DISCOVERY_LIMIT = 100;
/** Hard ceiling on how many raw records one feed contributes, so a sweep stays cheap. */
const PER_FEED_CAP = 60;
/** Base needs a second round-trip per token, so its feeds are capped tighter. */
const BASE_ENRICH_CAP = 24;

type DiscoveryContext = { universe: Universe; now: number; maxTradeUsd: number };

function tokenRefFor(facts: TokenFacts): TokenRef {
  return {
    id: `${facts.chain}:${facts.address}`,
    chain: facts.chain,
    address: facts.address,
    symbol: (facts.symbol || facts.address.slice(0, 6)).toUpperCase(),
    name: facts.name,
    logoUrl: facts.logoUrl,
    decimals: facts.decimals ?? (facts.chain === "base" ? 18 : 6),
    lastPriceUsd: facts.priceUsd,
  };
}

/**
 * A cheap 0-100 pre-rank from the discovery payload alone — no extra requests.
 *
 * Deliberately crude: it only has to order candidates well enough that the expensive
 * pass looks at the right twenty. `scoreToken` is the number anyone acts on.
 */
export function quickScore(facts: TokenFacts, organicScore: number | null): number {
  const liquidity = facts.liquidityUsd === null || facts.liquidityUsd <= 0
    ? 0
    : Math.min(100, Math.max(0, ((Math.log10(facts.liquidityUsd) - 3) / 3) * 100));
  const holders = facts.holderCount === null || facts.holderCount <= 0
    ? 0
    : Math.min(100, Math.max(0, ((Math.log10(facts.holderCount) - 1) / 3) * 100));
  const organic = organicScore === null ? 35 : Math.min(100, Math.max(0, organicScore));
  const move = facts.priceChange24hPct === null ? 50 : Math.min(100, Math.max(0, 50 + facts.priceChange24hPct / 2));
  const concentration = facts.top10HolderPct === null ? 50 : Math.min(100, Math.max(0, ((90 - facts.top10HolderPct) / 70) * 100));
  const score = liquidity * 0.3 + organic * 0.25 + holders * 0.2 + move * 0.15 + concentration * 0.1;
  return Math.round(score * 10) / 10;
}

function candidateFrom(
  facts: TokenFacts,
  origin: DiscoveryFeed,
  organicScore: number | null,
  volume24hUsd: number | null,
  /** Pre-rank override for feeds that know something `quickScore` cannot read. */
  preRank?: number,
  /** Distinct five-minute buyers, for the feeds whose payload carries them. */
  buyers5m?: number | null,
): TokenCandidate {
  return {
    token: tokenRefFor(facts),
    origin,
    liquidityUsd: facts.liquidityUsd,
    volume24hUsd: volume24hUsd ?? facts.volume24hUsd,
    marketCapUsd: facts.marketCapUsd,
    holderCount: facts.holderCount,
    ageHours: facts.ageHours === null ? null : roundAge(facts.ageHours),
    priceChange24hPct: facts.priceChange24hPct,
    quickScore: preRank ?? quickScore(facts, organicScore),
    ...(buyers5m === undefined ? {} : { buyers5m }),
  };
}

/**
 * Age is rounded finely under an hour and coarsely above it. Two decimals of an hour
 * is 36 seconds, which is the difference between "just minted" and "three minutes in"
 * — the whole distinction a super-fresh sweep exists to make.
 */
function roundAge(ageHours: number): number {
  const places = ageHours < 1 ? 10_000 : 100;
  return Math.round(ageHours * places) / places;
}

function fromJupiter(token: JupiterToken, origin: DiscoveryFeed, ctx: DiscoveryContext): TokenCandidate {
  const facts = toFacts({
    chain: "solana",
    address: token.id,
    symbol: token.symbol ?? token.id.slice(0, 6),
    jupiter: token,
    now: ctx.now,
    maxTradeUsd: ctx.maxTradeUsd,
  });
  return candidateFrom(facts, origin, token.organicScore, facts.volume24hUsd);
}

function fromDexScreener(token: DexScreenerToken, origin: DiscoveryFeed, ctx: DiscoveryContext): TokenCandidate {
  const facts = toFacts({
    chain: "base",
    address: token.address,
    symbol: token.symbol ?? token.address.slice(0, 8),
    dexscreener: token,
    now: ctx.now,
    maxTradeUsd: ctx.maxTradeUsd,
  });
  // DexScreener has no organic-buyer data, so the pre-rank leans on depth and flow.
  return candidateFrom(facts, origin, null, token.volume24hUsd);
}

/**
 * The free half of the gate set: the checks that need nothing but the discovery
 * payload. Safety gates (mint authority, honeypot, taxes) cannot be evaluated here,
 * so they stay for `scoreToken`.
 */
//
// Only *known* violations are rejected here. An unknown (Base has no holder count in
// any discovery payload; Aerodrome pairs omit their creation time) defers to
// `scoreToken`, which fills the gap from GoPlus / RugCheck and still emits the
// `*_unknown` blocker if it cannot — so the risk guard refuses the buy either way.
// Rejecting unknowns here silently emptied every Base sweep.
const FREE_GATES = new Set([
  "blocklisted",
  "liquidity_below_floor",
  "holders_below_floor",
  "age_below_min",
  "age_above_max",
]);

function passesFreeGates(candidate: TokenCandidate, universe: Universe): boolean {
  const facts: TokenFacts = {
    chain: candidate.token.chain,
    address: candidate.token.address,
    symbol: candidate.token.symbol,
    name: candidate.token.name,
    decimals: candidate.token.decimals,
    logoUrl: candidate.token.logoUrl,
    priceUsd: candidate.token.lastPriceUsd,
    liquidityUsd: candidate.liquidityUsd,
    volume24hUsd: candidate.volume24hUsd,
    marketCapUsd: candidate.marketCapUsd,
    holderCount: candidate.holderCount,
    ageHours: candidate.ageHours,
    priceChange1hPct: null,
    priceChange6hPct: null,
    priceChange24hPct: candidate.priceChange24hPct,
    // Unknown here on purpose: these are the gates the expensive pass owns.
    mintAuthorityDisabled: null,
    freezeAuthorityDisabled: null,
    top10HolderPct: null,
    devBalancePct: null,
    buyTaxPct: null,
    sellTaxPct: null,
    isHoneypot: null,
    // Only a paid pre-trade check can answer this, and discovery never buys one.
    sellable: null,
  };
  return !hardGates(facts, universe).some((b) => FREE_GATES.has(b));
}

// ---------- the paid sweep ----------

/** One launch radar per chain. Both are paid; neither is called unless asked for. */
const PAID_LAUNCH_SOURCE: Record<Chain, string> = {
  solana: "solenrich-launches",
  base: "gate402-base-radar",
};

function paidFactsFor(launch: PaidLaunch): TokenFacts {
  return {
    chain: launch.chain,
    address: launch.address,
    symbol: launch.symbol,
    name: launch.name,
    decimals: launch.chain === "base" ? 18 : 6,
    logoUrl: null,
    priceUsd: launch.priceUsd,
    liquidityUsd: launch.liquidityUsd,
    volume24hUsd: launch.volume24hUsd,
    marketCapUsd: launch.marketCapUsd,
    holderCount: launch.holderCount,
    ageHours: launch.ageHours,
    priceChange1hPct: null,
    priceChange6hPct: null,
    priceChange24hPct: launch.priceChange24hPct,
    // A launch radar reports none of the safety facts, and the free gates treat an
    // unknown as "defer to scoreToken" — which is exactly right here.
    mintAuthorityDisabled: null,
    freezeAuthorityDisabled: null,
    top10HolderPct: null,
    devBalancePct: null,
    buyTaxPct: null,
    sellTaxPct: null,
    isHoneypot: null,
    sellable: null,
  };
}

/**
 * Buys one chain's launch radar and turns it into candidates. Never throws: a budget
 * that cannot cover the call, a source the agent did not enable, or an upstream
 * failure all return an empty list and the free feeds carry the sweep.
 *
 * `bought` is the caller's record of radars already paid for (`DiscoverInput.paidLaunches`).
 * A chain in it is answered from it and nothing is paid. The rows are the radar's own,
 * before any gate, so a second sweep under other filters reads them through its own.
 */
async function sweepPaidLaunches(
  chain: Chain,
  x402: X402Context,
  dataSources: readonly string[] | undefined,
  minLiquidityUsd: number,
  bought?: Map<Chain, TokenCandidate[]>,
): Promise<TokenCandidate[]> {
  const id = PAID_LAUNCH_SOURCE[chain];
  if (dataSources !== undefined && !dataSources.includes(id)) return [];
  const already = bought?.get(chain);
  if (already) return already;

  try {
    const [{ getDataSource }, { parseGate402Launches }, { parseSolEnrichLaunches }] = await Promise.all([
      import("@/lib/data-sources/registry"),
      import("@/lib/data-sources/gate402"),
      import("@/lib/data-sources/solenrich"),
    ]);
    const source = getDataSource(id);
    if (!source) return [];

    const result = await source.query(x402, {
      mode: "launches",
      minLiquidityUsd,
      limit: chain === "solana" ? 20 : 30,
    });
    const launches = chain === "solana" ? parseSolEnrichLaunches(result.data) : parseGate402Launches(result.data);
    const rows = launches
      .filter((l) => l.chain === chain)
      .map((l) => candidateFrom(paidFactsFor(l), "paid_launches", null, l.volume24hUsd));
    bought?.set(chain, rows);
    return rows;
  } catch {
    // Recorded as bought, with nothing in it: a payment that got as far as a signature is
    // charged whether or not the radar then answered (`paidFetch`), and from here a
    // failure before that point looks the same. Asking again could pay twice.
    bought?.set(chain, []);
    return [];
  }
}

// ---------- the GeckoTerminal launch sweep (`gecko_launches`) ----------

/**
 * `gecko_launches` is the only feed that asks a second provider "and what do *you*
 * think of this token" before it emits a candidate.
 *
 * The pool pages are cheap (three requests a chain) and full of noise: a `new_pools`
 * page on Solana is mostly pump.fun mints seconds old with a $0 reserve and two
 * wallets in them. So the pages are filtered on what the page itself says — age,
 * reserve, and *distinct buyers in the last hour* — and only the best
 * {@link GECKO_INFO_LOOKUPS_PER_SWEEP} survivors across every chain are worth a
 * `/info` lookup. That lookup is the actual point of the feed: it returns
 * GeckoTerminal's GT Score, and a token GeckoTerminal has not really assessed
 * (`gt_score_details.creation === 0`) or rates under
 * {@link GECKO_MIN_GT_SCORE} never becomes a candidate.
 *
 * The lookup budget is per *sweep*, not per chain, because the rate limit is per
 * process: 3 pages × 2 chains + 15 lookups = 21 requests, inside the free tier's
 * ~30/min even before the provider's caches and limiter get involved.
 *
 * **Super-fresh mode inverts the last paragraph.** Inside a 15-minute window there is
 * no GT Score to read — GeckoTerminal rates a two-minute-old mint in the twenties, and
 * will not have looked properly until long after the trade was worth making — so the
 * lookup still happens (for the holder count, when the budget allows) but decides
 * nothing, and the pool page's own numbers are the entire free filter. The safety read
 * moves where it belongs: `score_token`, where RugCheck answers instantly and Deepnets
 * is bought automatically. Request count is unchanged.
 */
/** Distinct buying wallets in the last hour a pool needs before it is worth a lookup. */
export const GECKO_MIN_BUYERS_H1 = 5;
/**
 * At or below this `maxAgeHours` the feed switches to **super-fresh** mode (15
 * minutes): `new_pools` pages 1-3 instead of two pages plus trending, the `m5`
 * transaction counters instead of the `h1` ones, a required `reserve_in_usd`, and no
 * GT Score requirement at all — GeckoTerminal has not rated a two-minute-old mint and
 * never will in time, so demanding a score is the same as returning nothing.
 */
export const GECKO_SUPER_FRESH_MAX_AGE_HOURS = 0.25;
/** Distinct buying wallets in the last *five minutes* a super-fresh pool needs. */
export const GECKO_MIN_BUYERS_M5 = 3;

/** Whether this sweep's age ceiling puts the feed in super-fresh mode. */
export function isSuperFresh(maxAgeHours: number | null): boolean {
  return maxAgeHours !== null && maxAgeHours > 0 && maxAgeHours <= GECKO_SUPER_FRESH_MAX_AGE_HOURS;
}
/** GT Score a token needs to be emitted as a candidate. */
export const GECKO_MIN_GT_SCORE = 50;
/** Hard ceiling on `/info` lookups for one sweep, across every chain. */
export const GECKO_INFO_LOOKUPS_PER_SWEEP = 15;

export interface GeckoPoolFilter {
  pools: readonly GeckoPool[];
  now: number;
  minLiquidityUsd: number;
  maxAgeHours: number | null;
}

/**
 * Which survivors get the lookup, best first: real buyers dominate, depth breaks
 * ties, and the reserve only gets a log's worth of influence so a $40k pool with two
 * wallets in it never outranks a $5k pool with forty.
 */
export function geckoPoolRank(pool: GeckoPool, superFresh = false): number {
  // In a 15-minute window `buyersH1` is just `buyersM5` copied forward for every pool
  // on the page, which flattens the ranking; the five-minute counter is the only one
  // that distinguishes a launch forty wallets found from one two wallets found.
  const buyers = Math.max(0, (superFresh ? pool.buyersM5 : pool.buyersH1) ?? 0);
  const reserve = Math.max(0, pool.reserveUsd ?? 0);
  return Math.log10(1 + buyers) * 2 + Math.log10(1 + reserve);
}

/**
 * The free half of the `gecko_launches` filter — everything the pool page can answer
 * without a second request. Deduped by base token (one token often has several fresh
 * pools; the best-ranked one wins) and returned best-first.
 *
 * An unknown is rejected here rather than deferred, unlike the other feeds: a pool
 * with no `reserve_in_usd` and no `pool_created_at` is a pool GeckoTerminal has not
 * caught up with yet, and the next page will have twenty more.
 */
export function filterGeckoPools(input: GeckoPoolFilter): GeckoPool[] {
  const best = new Map<string, GeckoPool>();
  const superFresh = isSuperFresh(input.maxAgeHours);

  for (const pool of input.pools) {
    // Super-fresh reads the five-minute counters. A pool three minutes old with three
    // distinct buyers in it is a real launch; the same pool's `buyersH1` says nothing
    // the `m5` block did not already say.
    const buyers = superFresh ? pool.buyersM5 : pool.buyersH1;
    const floor = superFresh ? GECKO_MIN_BUYERS_M5 : GECKO_MIN_BUYERS_H1;
    if (buyers === null || buyers < floor) continue;

    // An unknown reserve is always rejected in this mode, floor or no floor: in the
    // first minute `reserve_in_usd` is simply null, and a pool we cannot size is one
    // the risk guard would refuse anyway.
    if (pool.reserveUsd === null && superFresh) continue;
    if (input.minLiquidityUsd > 0) {
      if (pool.reserveUsd === null || pool.reserveUsd < input.minLiquidityUsd) continue;
    }

    if (input.maxAgeHours !== null) {
      if (pool.createdAtMs === null) continue;
      const ageHours = Math.max(0, (input.now - pool.createdAtMs) / 3_600_000);
      if (ageHours > input.maxAgeHours) continue;
    }

    const existing = best.get(pool.token.address);
    if (!existing || geckoPoolRank(pool, superFresh) > geckoPoolRank(existing, superFresh)) {
      best.set(pool.token.address, pool);
    }
  }

  return Array.from(best.values()).sort((a, b) => {
    const delta = geckoPoolRank(b, superFresh) - geckoPoolRank(a, superFresh);
    return delta !== 0 ? delta : (b.createdAtMs ?? 0) - (a.createdAtMs ?? 0);
  });
}

/**
 * Whether GeckoTerminal's own read clears the feed's bar. Both halves matter: the
 * score says "rated well", and a non-zero `creation` sub-score says the rating is
 * about a token it actually looked at rather than a default for something it first
 * saw ninety seconds ago.
 */
/**
 * The GT Score floor for an agent hunting the first hours: GeckoTerminal's score rewards
 * age, holders and a creator's record, so a 40-minute-old launch it has assessed sits
 * in the 30s even when every safety field is clean. Holding such an agent to 50 meant
 * an empty window every tick (2026-09-22).
 */
export const GECKO_FRESH_MIN_GT_SCORE = 30;
/** Below this many hours of max age, the fresh floor applies. */
export const GECKO_FRESH_WINDOW_HOURS = 6;

export function geckoFloorFor(maxAgeHours: number | null): number {
  return maxAgeHours !== null && maxAgeHours <= GECKO_FRESH_WINDOW_HOURS ? GECKO_FRESH_MIN_GT_SCORE : GECKO_MIN_GT_SCORE;
}

export function passesGeckoInfo(info: GeckoTokenInfo | null, minGtScore: number = GECKO_MIN_GT_SCORE): boolean {
  if (info === null) return false;
  // The GT Score alone. A `creation` sub-score of 0 was also required at first, but a
  // day-old launch GeckoTerminal rates 52 overall (STAMP, 2026-09-21) still carries
  // creation 0 — that sub-score measures the creator's track record, which a fresh
  // launch never has, and it is exactly the launch this feed exists to surface. A
  // minutes-old mint scores 23 overall and fails the bar on its own.
  return info.gtScore !== null && info.gtScore >= minGtScore;
}

/** Pool page + `/info` → the chain-agnostic facts the pre-rank and the gates read. */
export function geckoFactsFor(pool: GeckoPool, info: GeckoTokenInfo | null, chain: Chain, now: number): TokenFacts {
  const ageHours = pool.createdAtMs === null ? null : Math.max(0, (now - pool.createdAtMs) / 3_600_000);
  return {
    chain,
    address: pool.token.address,
    symbol: pool.token.symbol ?? info?.symbol ?? pool.token.address.slice(0, 6),
    name: pool.token.name ?? info?.name ?? null,
    decimals: pool.token.decimals ?? info?.decimals ?? null,
    logoUrl: pool.token.imageUrl ?? info?.imageUrl ?? null,
    priceUsd: pool.priceUsd,
    liquidityUsd: pool.reserveUsd,
    volume24hUsd: pool.volume24hUsd,
    marketCapUsd: pool.marketCapUsd ?? pool.fdvUsd,
    holderCount: info?.holderCount ?? null,
    ageHours,
    priceChange1hPct: pool.priceChange1hPct,
    priceChange6hPct: pool.priceChange6hPct,
    priceChange24hPct: pool.priceChange24hPct,
    // GeckoTerminal does report `mint_authority` / `freeze_authority` as "yes"/"no",
    // but the authority gates are the expensive pass's job (Jupiter's audit, GoPlus)
    // and a discovery feed must not be the thing that clears a safety gate.
    mintAuthorityDisabled: null,
    freezeAuthorityDisabled: null,
    top10HolderPct: info?.top10HolderPct ?? null,
    // `developer_holding_percentage` is left alone: "0.24" could be 0.24% or 24%.
    devBalancePct: null,
    buyTaxPct: null,
    sellTaxPct: null,
    isHoneypot: info?.isHoneypot ?? null,
    sellable: null,
  };
}

/**
 * The pre-rank for this feed. GT Score is itself a composite of pool depth,
 * transaction quality, creation and holders, so it stands in for the organic term in
 * {@link quickScore} *and* takes a further fifth of the pre-rank on its own — a token
 * GeckoTerminal rates 90 should out-rank one it rates 55 with the same pool.
 */
export function geckoQuickScore(facts: TokenFacts, gtScore: number | null): number {
  const base = quickScore(facts, gtScore);
  if (gtScore === null) return base;
  const gt = Math.min(100, Math.max(0, gtScore));
  return Math.round((base * 0.8 + gt * 0.2) * 10) / 10;
}

/** One survivor, with GeckoTerminal's read folded into the pre-rank. */
export function geckoCandidate(
  pool: GeckoPool,
  info: GeckoTokenInfo | null,
  chain: Chain,
  now: number,
): TokenCandidate {
  const facts = geckoFactsFor(pool, info, chain, now);
  return candidateFrom(
    facts,
    "gecko_launches",
    info?.gtScore ?? null,
    pool.volume24hUsd,
    geckoQuickScore(facts, info?.gtScore ?? null),
    pool.buyersM5,
  );
}

/**
 * Sweeps `gecko_launches` across every requested chain in one pass, so the `/info`
 * lookup budget is shared rather than multiplied. Never throws: a page that failed
 * contributes nothing, and a token whose lookup failed is simply not a candidate.
 */
async function sweepGeckoLaunches(chains: readonly Chain[], ctx: DiscoveryContext): Promise<TokenCandidate[]> {
  const superFresh = isSuperFresh(ctx.universe.maxAgeHours);
  // Same three requests a chain either way, spent differently: inside a 15-minute
  // window `trending_pools` is led by names hours or years old and page 3 of
  // `new_pools` is still inside the window, so the third slot moves.
  const wanted: ReadonlyArray<readonly [GeckoFeed, number]> = superFresh
    ? ([
        ["new_pools", 1],
        ["new_pools", 2],
        ["new_pools", 3],
      ] as const)
    : ([
        ["new_pools", 1],
        ["new_pools", 2],
        ["trending_pools", 1],
      ] as const);

  const pages = await Promise.allSettled(
    chains.flatMap((chain) =>
      wanted.map(([feed, page]) => getGeckoPools(chain, feed, page).then((pools) => ({ chain, pools }))),
    ),
  );

  const byChain = new Map<Chain, GeckoPool[]>();
  for (const page of pages) {
    if (page.status !== "fulfilled") continue;
    const existing = byChain.get(page.value.chain) ?? [];
    existing.push(...page.value.pools);
    byChain.set(page.value.chain, existing);
  }

  // Filter per chain, then re-rank across chains so one busy chain cannot eat the
  // whole lookup budget.
  const survivors: Array<{ chain: Chain; pool: GeckoPool }> = [];
  for (const [chain, pools] of byChain) {
    for (const pool of filterGeckoPools({
      pools,
      now: ctx.now,
      minLiquidityUsd: ctx.universe.minLiquidityUsd,
      maxAgeHours: ctx.universe.maxAgeHours,
    })) {
      // Before the lookup, not after: `trending_pools` is led by WETH, USDC and
      // cbBTC on Base, and a lookup spent on something that can never be a candidate
      // is a lookup the rest of the page does not get.
      if (!isDiscoveryCandidate({ address: pool.token.address, symbol: pool.token.symbol ?? "" })) continue;
      survivors.push({ chain, pool });
    }
  }
  survivors.sort((a, b) => geckoPoolRank(b.pool, superFresh) - geckoPoolRank(a.pool, superFresh));

  // The provider's own limiter owns the rate, so a *small* fan-out is safe and turns
  // a ~30s sweep into a ~10s one; the request count is identical either way.
  const looked = await mapLimit(survivors.slice(0, GECKO_INFO_LOOKUPS_PER_SWEEP), 3, async ({ chain, pool }) => ({
    chain,
    pool,
    info: await getGeckoTokenInfo(chain, pool.token.address),
  }));

  // In super-fresh mode the lookup is for the holder count and nothing else: a mint
  // three minutes old has no GT Score to clear, so requiring one empties the window
  // every tick. The pool page's own filter (buyers, reserve, age) is the whole gate,
  // and the real safety read is `score_token`'s — RugCheck answers immediately, and
  // Deepnets is bought for every candidate the free pass did not already refuse.
  if (superFresh) return looked.map(({ chain, pool, info }) => geckoCandidate(pool, info, chain, ctx.now));

  return looked
    .filter(({ info }) => passesGeckoInfo(info, geckoFloorFor(ctx.universe.maxAgeHours)))
    .map(({ chain, pool, info }) => geckoCandidate(pool, info, chain, ctx.now));
}

// ---------- per-chain sweeps ----------

async function sweepSolana(feeds: ReadonlySet<DiscoveryFeed>, ctx: DiscoveryContext): Promise<TokenCandidate[]> {
  const jobs: Array<Promise<TokenCandidate[]>> = [];

  if (feeds.has("new_launches")) {
    jobs.push(getJupiterRecent().then((rows) => rows.slice(0, PER_FEED_CAP).map((t) => fromJupiter(t, "new_launches", ctx))));
  }
  if (feeds.has("trending") || feeds.has("momentum")) {
    jobs.push(getJupiterTopTraded().then((rows) => rows.slice(0, PER_FEED_CAP).map((t) => fromJupiter(t, "trending", ctx))));
  }
  if (feeds.has("top_organic")) {
    jobs.push(
      getJupiterTopOrganic().then((rows) => rows.slice(0, PER_FEED_CAP).map((t) => fromJupiter(t, "top_organic", ctx))),
    );
  }

  const settled = await Promise.allSettled(jobs);
  const out = settled.flatMap((s) => (s.status === "fulfilled" ? s.value : []));

  // `momentum` is derived, not fetched: re-label the movers already in hand.
  if (feeds.has("momentum")) {
    for (const candidate of out) {
      const move = candidate.priceChange24hPct;
      if (move !== null && move > 10 && candidate.origin === "trending") candidate.origin = "momentum";
    }
  }
  return out;
}

async function sweepBase(feeds: ReadonlySet<DiscoveryFeed>, ctx: DiscoveryContext): Promise<TokenCandidate[]> {
  const wanted = new Map<string, DiscoveryFeed>();

  const jobs: Array<Promise<void>> = [];
  const want = (address: string, origin: DiscoveryFeed) => {
    const key = address.toLowerCase();
    if (!wanted.has(key)) wanted.set(key, origin);
  };
  if (feeds.has("new_launches")) {
    // GeckoTerminal is the real Base new-pool feed; DexScreener profiles are mostly Solana.
    jobs.push(getGeckoPoolTokens("new_pools").then((rows) => rows.forEach((a) => want(a, "new_launches"))));
    jobs.push(
      getLatestTokenProfiles().then((rows) => {
        for (const p of rows) if (p.chainId === "base") want(p.tokenAddress, "new_launches");
      }),
    );
  }
  // Base has no organic feed, so `top_organic` falls back to trending (see SPEC).
  if (feeds.has("trending") || feeds.has("momentum") || feeds.has("top_organic")) {
    jobs.push(getGeckoPoolTokens("trending_pools").then((rows) => rows.forEach((a) => want(a, "trending"))));
    jobs.push(
      getTopBoostedTokens().then((rows) => {
        for (const p of rows) if (p.chainId === "base") want(p.tokenAddress, "trending");
      }),
    );
  }
  await Promise.allSettled(jobs);

  const addresses = Array.from(wanted.keys()).slice(0, BASE_ENRICH_CAP);
  if (addresses.length === 0) return [];
  // One enrichment round-trip per token; the provider caps the fan-out.
  const enriched = await getDexScreenerTokens(addresses);

  const out: TokenCandidate[] = [];
  for (const address of addresses) {
    const token = enriched.get(address);
    if (!token) continue;
    const origin = wanted.get(address) ?? "trending";
    const candidate = fromDexScreener(token, origin, ctx);
    if (feeds.has("momentum") && candidate.priceChange24hPct !== null && candidate.priceChange24hPct > 10) {
      candidate.origin = "momentum";
    }
    out.push(candidate);
  }
  return out;
}

/**
 * Sweeps every enabled feed on every enabled chain and returns the best `limit`
 * candidates, de-duplicated by `chain:address` and pre-filtered on the free gates.
 *
 * Never throws: a provider that is down contributes nothing and the sweep continues
 * with whatever the others returned.
 */
/**
 * Assets discovery never surfaces: stablecoins, the USDC quote asset, and wrapped
 * natives / BTC / ETH. They score "strong" on every safety metric, so without this
 * they crowd the top of every sweep and invite nonsense like buying USDC with USDC.
 * Agents can still trade majors by naming them — this only shapes what is *found*.
 */
const NON_CANDIDATE_ADDRESSES = new Set(
  [
    "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC (Solana)
    "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", // USDT (Solana)
    "So11111111111111111111111111111111111111112", // wrapped SOL
    "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", // USDC (Base)
    "0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA", // USDbC (Base)
    "0x4200000000000000000000000000000000000006", // WETH (Base)
    "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf", // cbBTC (Base)
  ].map((a) => a.toLowerCase()),
);
// Explicit list on purpose: a prefix rule like /^USD/ would also drop memecoins.
const NON_CANDIDATE_SYMBOL = new RegExp(
  "^(?:" +
    [
      "W?SOL", "W?ETH", "W?BTC", "CBBTC", "CBETH", "WSTETH", "JITOSOL", "MSOL", "BSOL", "JUPSOL",
      "USDC", "USDT", "USDS", "USDE", "USDG", "USDH", "USDB", "USDBC", "USDX", "USDY", "USD0", "USD1",
      "PYUSD", "FDUSD", "TUSD", "GUSD", "LUSD", "SUSD", "BUSD", "CRVUSD", "DAI", "EURC", "EUROC",
    ].join("|") +
    ")$",
  "i",
);

export function isDiscoveryCandidate(token: { address: string; symbol: string }): boolean {
  if (NON_CANDIDATE_ADDRESSES.has(token.address.toLowerCase())) return false;
  return !NON_CANDIDATE_SYMBOL.test(token.symbol.trim());
}

/**
 * The liquidity floor and age ceiling one sweep runs under: the caller's, held inside
 * the universe's own. A floor below the owner's is raised to it and a ceiling past the
 * owner's is lowered to it. `scoreToken` enforces the owner's two as hard gates
 * (`liquidity_below_floor`, `age_above_max`), so a candidate outside them can never be
 * bought and listing it is wasted research. A narrower value passes through untouched.
 */
export function sweepFilters(
  universe: Pick<Universe, "minLiquidityUsd" | "maxAgeHours">,
  asked: { minLiquidityUsd?: number; maxAgeHours?: number | null },
): { minLiquidityUsd: number; maxAgeHours: number | null } {
  const floor = universe.minLiquidityUsd;
  const ceiling = universe.maxAgeHours;
  const liquidity = asked.minLiquidityUsd;
  const age = asked.maxAgeHours ?? null;
  return {
    minLiquidityUsd: liquidity === undefined || !Number.isFinite(liquidity) ? floor : Math.max(liquidity, floor),
    maxAgeHours: age === null || !Number.isFinite(age) ? ceiling : ceiling === null ? age : Math.min(age, ceiling),
  };
}

export async function discoverCandidates(input: DiscoverInput): Promise<TokenCandidate[]> {
  const now = input.now ?? Date.now();
  const limit = Math.max(1, Math.min(input.limit ?? DEFAULT_DISCOVERY_LIMIT, MAX_DISCOVERY_LIMIT));
  const feeds = new Set<DiscoveryFeed>(
    (input.feeds && input.feeds.length > 0 ? input.feeds : input.universe.discovery) as DiscoveryFeed[],
  );
  if (feeds.size === 0) feeds.add("trending");

  // Per-sweep filters let the model narrow one search without editing the agent's
  // configured universe. They never loosen it.
  const universe: Universe = { ...input.universe, ...sweepFilters(input.universe, input) };
  const ctx: DiscoveryContext = { universe, now, maxTradeUsd: 0 };

  const chains = Array.from(new Set(input.chains));
  const jobs: Array<Promise<TokenCandidate[]>> = chains.map((chain) =>
    chain === "solana" ? sweepSolana(feeds, ctx) : sweepBase(feeds, ctx),
  );
  // One job for every chain, not one per chain: the GeckoTerminal rate limit is per
  // process, so the `/info` lookup budget has to be shared.
  if (feeds.has("gecko_launches")) jobs.push(sweepGeckoLaunches(chains, ctx));
  // The one feed that spends money, and only with a wallet in hand.
  const x402 = input.x402;
  if (feeds.has("paid_launches") && x402) {
    for (const chain of chains) {
      jobs.push(
        sweepPaidLaunches(
          chain,
          x402,
          input.alwaysPaidLaunches ? undefined : input.dataSources,
          universe.minLiquidityUsd,
          input.paidLaunches,
        ),
      );
    }
  }
  const sweeps = await Promise.allSettled(jobs);

  const byId = new Map<string, TokenCandidate>();
  for (const sweep of sweeps) {
    if (sweep.status !== "fulfilled") continue;
    for (const candidate of sweep.value) {
      const existing = byId.get(candidate.token.id);
      // Keep the richer record when a token shows up in two feeds.
      if (!existing || (candidate.quickScore ?? 0) > (existing.quickScore ?? 0)) byId.set(candidate.token.id, candidate);
    }
  }

  return rankCandidates(
    Array.from(byId.values()).filter((c) => isDiscoveryCandidate(c.token) && passesFreeGates(c, universe)),
  ).slice(0, limit);
}

/** The feeds that find a launch before the market has priced it: they lead the table. */
export const LAUNCH_FEEDS: ReadonlySet<DiscoveryFeed> = new Set(["gecko_launches", "paid_launches"]);

/**
 * Pure: launches first, then everything else, each tier by quick score. Ranking every
 * feed together by quick score alone put Jupiter's trending names — established,
 * high-volume, already priced — above a GeckoTerminal- or SolEnrich-rated launch that
 * was minutes old, so the model scored the tokens everyone already owned (operator's
 * instruction, 2026-09-22: find the fresh launches first).
 */
export function rankCandidates(candidates: readonly TokenCandidate[]): TokenCandidate[] {
  const tier = (c: TokenCandidate) => (LAUNCH_FEEDS.has(c.origin) ? 0 : 1);
  return [...candidates].sort((a, b) => tier(a) - tier(b) || (b.quickScore ?? 0) - (a.quickScore ?? 0));
}

/** Compact table for the model's context — one line per candidate, no JSON noise. */
export function renderCandidates(candidates: readonly TokenCandidate[]): string {
  if (candidates.length === 0) {
    return "No candidates cleared the free gates (age, liquidity, holders, blocklist) on the feeds you swept.";
  }
  const money = (n: number | null): string =>
    n === null ? "—" : n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `$${(n / 1_000).toFixed(0)}k` : `$${n.toFixed(0)}`;
  // Minutes under the hour: "0.1h" is unreadable for the thing this whole feed is
  // about, and a 4-minute-old launch and a 40-minute-old one are different trades.
  const age = (h: number | null): string =>
    h === null
      ? "—"
      : h < 1
        ? h * 60 < 1
          ? "<1m"
          : `${Math.round(h * 60)}m`
        : h < 48
          ? `${h.toFixed(1)}h`
          : `${(h / 24).toFixed(0)}d`;

  // The five-minute buyer count only appears when a feed actually reported one, so an
  // ordinary sweep's table is unchanged.
  const showBuyers = candidates.some((c) => (c.buyers5m ?? null) !== null);
  const header = `  #  SYMBOL      CHAIN   QUICK  LIQUIDITY  VOL24H     MCAP       HOLDERS  AGE     24H%   ${
    showBuyers ? " BUY5M" : ""
  }  FEED`;
  const rows = candidates.map((c, i) => {
    const cells = [
      String(i + 1).padStart(3),
      c.token.symbol.slice(0, 10).padEnd(11),
      c.token.chain.padEnd(7),
      (c.quickScore ?? 0).toFixed(1).padStart(5),
      money(c.liquidityUsd).padStart(10),
      money(c.volume24hUsd).padStart(10),
      money(c.marketCapUsd).padStart(10),
      (c.holderCount === null ? "—" : c.holderCount.toLocaleString("en-US")).padStart(8),
      age(c.ageHours).padStart(6),
      (c.priceChange24hPct === null ? "—" : `${c.priceChange24hPct > 0 ? "+" : ""}${c.priceChange24hPct.toFixed(1)}`).padStart(7),
      ...(showBuyers ? [(c.buyers5m === null || c.buyers5m === undefined ? "—" : String(c.buyers5m)).padStart(5)] : []),
      `  ${c.origin}`,
    ];
    return cells.join(" ");
  });
  return [header, ...rows, "", "Addresses:", ...candidates.map((c) => `  ${c.token.symbol}: ${c.token.address}`)].join("\n");
}
