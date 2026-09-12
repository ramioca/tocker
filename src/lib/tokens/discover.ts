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
 */
import type { Chain, DiscoveryFeed, TokenCandidate, TokenRef } from "@/server/types";
import { getDexScreenerTokens, getLatestTokenProfiles, getTopBoostedTokens } from "./providers/dexscreener";
import { getJupiterRecent, getJupiterTopOrganic, getJupiterTopTraded } from "./providers/jupiter";
import { hardGates, toFacts, type Universe } from "./score";
import type { DexScreenerToken, JupiterToken, TokenFacts } from "./types";

export interface DiscoverInput {
  chains: readonly Chain[];
  /** Which feeds to sweep. Defaults to the agent's `universe.discovery`. */
  feeds?: readonly DiscoveryFeed[];
  limit?: number;
  universe: Universe;
  /** Overrides for this sweep only; the agent's universe is not mutated. */
  minLiquidityUsd?: number;
  maxAgeHours?: number | null;
  /** Injected in tests so age maths is deterministic. */
  now?: number;
}

export const DEFAULT_DISCOVERY_LIMIT = 20;
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
): TokenCandidate {
  return {
    token: tokenRefFor(facts),
    origin,
    liquidityUsd: facts.liquidityUsd,
    volume24hUsd: volume24hUsd ?? facts.volume24hUsd,
    marketCapUsd: facts.marketCapUsd,
    holderCount: facts.holderCount,
    ageHours: facts.ageHours === null ? null : Math.round(facts.ageHours * 100) / 100,
    priceChange24hPct: facts.priceChange24hPct,
    quickScore: quickScore(facts, organicScore),
  };
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
const FREE_GATES = new Set([
  "blocklisted",
  "liquidity_below_floor",
  "liquidity_unknown",
  "holders_below_floor",
  "holder_count_unknown",
  "age_below_min",
  "age_above_max",
  "age_unknown",
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
  };
  return !hardGates(facts, universe).some((b) => FREE_GATES.has(b));
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
  if (feeds.has("new_launches")) {
    jobs.push(
      getLatestTokenProfiles().then((rows) => {
        for (const p of rows) {
          if (p.chainId !== "base") continue;
          if (!wanted.has(p.tokenAddress.toLowerCase())) wanted.set(p.tokenAddress.toLowerCase(), "new_launches");
        }
      }),
    );
  }
  // Base has no organic feed, so `top_organic` falls back to trending (see SPEC).
  if (feeds.has("trending") || feeds.has("momentum") || feeds.has("top_organic")) {
    jobs.push(
      getTopBoostedTokens().then((rows) => {
        for (const p of rows) {
          if (p.chainId !== "base") continue;
          if (!wanted.has(p.tokenAddress.toLowerCase())) wanted.set(p.tokenAddress.toLowerCase(), "trending");
        }
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
export async function discoverCandidates(input: DiscoverInput): Promise<TokenCandidate[]> {
  const now = input.now ?? Date.now();
  const limit = Math.max(1, Math.min(input.limit ?? DEFAULT_DISCOVERY_LIMIT, 100));
  const feeds = new Set<DiscoveryFeed>(
    (input.feeds && input.feeds.length > 0 ? input.feeds : input.universe.discovery) as DiscoveryFeed[],
  );
  if (feeds.size === 0) feeds.add("trending");

  // Per-sweep overrides let the model widen or narrow one search without editing the
  // agent's configured universe.
  const universe: Universe = {
    ...input.universe,
    minLiquidityUsd: input.minLiquidityUsd ?? input.universe.minLiquidityUsd,
    maxAgeHours: input.maxAgeHours === undefined ? input.universe.maxAgeHours : input.maxAgeHours,
  };
  const ctx: DiscoveryContext = { universe, now, maxTradeUsd: 0 };

  const chains = Array.from(new Set(input.chains));
  const sweeps = await Promise.allSettled(
    chains.map((chain) => (chain === "solana" ? sweepSolana(feeds, ctx) : sweepBase(feeds, ctx))),
  );

  const byId = new Map<string, TokenCandidate>();
  for (const sweep of sweeps) {
    if (sweep.status !== "fulfilled") continue;
    for (const candidate of sweep.value) {
      const existing = byId.get(candidate.token.id);
      // Keep the richer record when a token shows up in two feeds.
      if (!existing || (candidate.quickScore ?? 0) > (existing.quickScore ?? 0)) byId.set(candidate.token.id, candidate);
    }
  }

  return Array.from(byId.values())
    .filter((c) => passesFreeGates(c, universe))
    .sort((a, b) => (b.quickScore ?? 0) - (a.quickScore ?? 0))
    .slice(0, limit);
}

/** Compact table for the model's context — one line per candidate, no JSON noise. */
export function renderCandidates(candidates: readonly TokenCandidate[]): string {
  if (candidates.length === 0) {
    return "No candidates cleared the free gates (age, liquidity, holders, blocklist) on the feeds you swept.";
  }
  const money = (n: number | null): string =>
    n === null ? "—" : n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `$${(n / 1_000).toFixed(0)}k` : `$${n.toFixed(0)}`;
  const age = (h: number | null): string => (h === null ? "—" : h < 48 ? `${h.toFixed(1)}h` : `${(h / 24).toFixed(0)}d`);

  const header = "  #  SYMBOL      CHAIN   QUICK  LIQUIDITY  VOL24H     MCAP       HOLDERS  AGE     24H%    FEED";
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
      `  ${c.origin}`,
    ];
    return cells.join(" ");
  });
  return [header, ...rows, "", "Addresses:", ...candidates.map((c) => `  ${c.token.symbol}: ${c.token.address}`)].join("\n");
}
