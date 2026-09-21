/**
 * The super-fresh path, end to end without a network: the pool page that finds a
 * pump.fun mint minutes old, the filter that keeps it, and the facts that let it score
 * with real numbers instead of `_unknown` blockers.
 *
 * Every fixture here is a live capture from 2026-09-22, which is why the awkward parts
 * are the real ones: `/tokens/<mint>/pools` arrives with no `included[]` (so the base
 * token has an address and nothing else), one mint carries three pools created eight
 * seconds apart whose reserves are $21,021, $0.35 and $0, and DexScreener's pair for a
 * four-minute-old mint has a price, a volume, an age — and no `liquidity` block at all.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_AGENT_CONFIG } from "@/lib/agent/config";
import dexFixture from "./fixtures/dexscreener.json";
import tokenPoolsFixture from "./fixtures/geckoterminal-token-pools.json";
import { collapsePairs } from "./providers/dexscreener";
import { deepestGeckoPool, parseGeckoPools, type GeckoPool } from "./providers/geckoterminal";
import { parseJupiterToken } from "./providers/jupiter";
import {
  filterGeckoPools,
  geckoCandidate,
  geckoPoolRank,
  isSuperFresh,
  renderCandidates,
  GECKO_MIN_BUYERS_M5,
  GECKO_SUPER_FRESH_MAX_AGE_HOURS,
} from "./discover";
import { hardGates, toFacts, type Universe } from "./score";

const DOVE = "EYL6TxbBfPRsV2WV41wv2rNFPNLLRFLaNH2dFByopump";
const POPCATE = "52uRN8P97aTv1QEDcTQ3rG2yX7iaRoLLE38GPMr825RJ";

/** DOVE's pool was created at 23:12:22Z. Everything below is four minutes later. */
const BORN = Date.parse("2026-09-21T23:12:22Z");
const NOW = BORN + 4 * 60_000;

const poolsFor = (mint: string): GeckoPool[] =>
  parseGeckoPools((tokenPoolsFixture as Record<string, unknown>)[`solana:${mint}`], "solana");

const dexPairs = (dexFixture as unknown as { pairs: Record<string, unknown[]> }).pairs;
const dovePairs = () => collapsePairs(DOVE, dexPairs[DOVE.toLowerCase()] ?? []);

function universe(overrides: Partial<Universe> = {}): Universe {
  return { ...DEFAULT_AGENT_CONFIG.universe, ...overrides };
}

/** Deliberately loose on everything a fresh mint cannot answer for. */
const FRESH_UNIVERSE: Universe = universe({
  minLiquidityUsd: 2_000,
  minHolderCount: 0,
  minAgeMinutes: 0,
  maxAgeHours: 0.25,
  maxTop10HolderPct: 100,
  requireMintRevoked: false,
  requireFreezeRevoked: false,
  blocklist: [],
});

function pool(overrides: Partial<GeckoPool> = {}): GeckoPool {
  return {
    poolAddress: "pool",
    name: "T / SOL",
    createdAtMs: NOW - 180_000,
    reserveUsd: 5_000,
    volume1hUsd: 4_000,
    volume24hUsd: 4_000,
    priceUsd: 0.000001,
    fdvUsd: 9_000,
    marketCapUsd: null,
    priceChange1hPct: 30,
    priceChange6hPct: 30,
    priceChange24hPct: 30,
    buysH1: 20,
    sellsH1: 5,
    buyersH1: 14,
    sellersH1: 4,
    buysM5: 20,
    buyersM5: 14,
    dexId: "pump-fun",
    token: { address: "MintT", name: null, symbol: null, decimals: null, imageUrl: null },
    ...overrides,
  };
}

describe("parseGeckoPools on /tokens/<mint>/pools", () => {
  it("reads the five-minute counters and identifies the token without an include", () => {
    const [dove] = poolsFor(DOVE);
    expect(poolsFor(DOVE)).toHaveLength(1);
    expect(dove).toMatchObject({
      name: "DOVE / SOL",
      createdAtMs: BORN,
      reserveUsd: 4751.9539,
      buysM5: 234,
      buyersM5: 92,
      // The hourly windows are the same numbers copied forward at this age — which is
      // exactly why the super-fresh filter reads `m5` instead.
      buysH1: 234,
      buyersH1: 92,
      dexId: "pump-fun",
    });
    expect(dove?.priceUsd).toBeCloseTo(7.464858451e-6, 12);
    expect(dove?.volume24hUsd).toBeCloseTo(12_107.44, 2);
    // No `included[]` on this endpoint: an address, and no symbol to go with it.
    expect(dove?.token).toEqual({ address: DOVE, name: null, symbol: null, decimals: null, imageUrl: null });
  });

  it("nulls the m5 counters when the payload has no m5 block", () => {
    const body = {
      data: [
        {
          attributes: { name: "A / SOL", transactions: { h1: { buys: 4, buyers: 3 } } },
          relationships: { base_token: { data: { id: `solana_${DOVE}` } } },
        },
      ],
    };
    expect(parseGeckoPools(body, "solana")[0]).toMatchObject({ buysM5: null, buyersM5: null, buyersH1: 3 });
  });
});

describe("deepestGeckoPool", () => {
  it("picks the pool an order would route through, not the first or the newest", () => {
    const pools = poolsFor(POPCATE);
    expect(pools).toHaveLength(3);
    const deepest = deepestGeckoPool(pools);
    expect(deepest?.reserveUsd).toBeCloseTo(21_021.07, 2);
    expect(deepest?.dexId).toBe("pumpswap");
    expect(deepest?.buyersM5).toBe(817);
  });

  it("ignores pools of another token, and answers null for nothing at all", () => {
    expect(deepestGeckoPool(poolsFor(POPCATE), DOVE)).toBeNull();
    expect(deepestGeckoPool(poolsFor(POPCATE), POPCATE)?.dexId).toBe("pumpswap");
    expect(deepestGeckoPool([])).toBeNull();
  });

  it("still returns a pool when every reserve is unknown", () => {
    const blind = [pool({ poolAddress: "a", reserveUsd: null }), pool({ poolAddress: "b", reserveUsd: null })];
    expect(deepestGeckoPool(blind)?.poolAddress).toBe("a");
  });
});

describe("isSuperFresh", () => {
  it("is the 15-minute window and nothing wider", () => {
    expect(isSuperFresh(GECKO_SUPER_FRESH_MAX_AGE_HOURS)).toBe(true);
    expect(isSuperFresh(0.0833)).toBe(true);
    expect(isSuperFresh(0.26)).toBe(false);
    expect(isSuperFresh(1)).toBe(false);
    expect(isSuperFresh(null)).toBe(false);
    // A zero ceiling is a misconfiguration, not a hunt: today's behaviour, not fresh mode.
    expect(isSuperFresh(0)).toBe(false);
  });
});

describe("filterGeckoPools in super-fresh mode", () => {
  const fresh = { now: NOW, minLiquidityUsd: 2_000, maxAgeHours: 0.25 };

  it("keeps a three-minute-old pool on five-minute buyers, where the hourly floor would not", () => {
    // Three m5 buyers clears the fresh floor; the same pool has too few for `h1`'s five.
    const thin = pool({ buyersM5: GECKO_MIN_BUYERS_M5, buysM5: 4, buyersH1: 4 });
    expect(filterGeckoPools({ ...fresh, pools: [thin] })).toHaveLength(1);
    expect(filterGeckoPools({ pools: [thin], now: NOW, minLiquidityUsd: 2_000, maxAgeHours: 6 })).toEqual([]);
  });

  it("drops a pool nobody has bought in the last five minutes, however busy its hour was", () => {
    const stale = pool({ buyersM5: 0, buysM5: 0, buyersH1: 40, buysH1: 60 });
    expect(filterGeckoPools({ ...fresh, pools: [stale] })).toEqual([]);
    // Outside the window that same pool is a survivor: today's behaviour is untouched.
    expect(filterGeckoPools({ pools: [stale], now: NOW, minLiquidityUsd: 2_000, maxAgeHours: 6 })).toHaveLength(1);
  });

  it("requires a known reserve even with no liquidity floor configured", () => {
    const unpriced = pool({ reserveUsd: null });
    expect(filterGeckoPools({ pools: [unpriced], now: NOW, minLiquidityUsd: 0, maxAgeHours: 0.25 })).toEqual([]);
    // With no floor and no fresh window, an unknown reserve still defers to `scoreToken`.
    expect(filterGeckoPools({ pools: [unpriced], now: NOW, minLiquidityUsd: 0, maxAgeHours: null })).toHaveLength(1);
  });

  it("applies the floor and the 15-minute ceiling", () => {
    expect(filterGeckoPools({ ...fresh, pools: [pool({ reserveUsd: 1_999 })] })).toEqual([]);
    expect(filterGeckoPools({ ...fresh, pools: [pool({ createdAtMs: NOW - 16 * 60_000 })] })).toEqual([]);
    expect(filterGeckoPools({ ...fresh, pools: [pool({ createdAtMs: null })] })).toEqual([]);
  });

  it("collapses one mint's three pools down to the deepest, busiest one", () => {
    const kept = filterGeckoPools({ pools: poolsFor(POPCATE), ...fresh });
    expect(kept).toHaveLength(1);
    expect(kept[0]?.dexId).toBe("pumpswap");
    expect(kept[0]?.buyersM5).toBe(817);
  });

  it("ranks forty five-minute buyers in a thin pool above two in a deep one", () => {
    const busy = pool({ reserveUsd: 5_000, buyersM5: 40, buyersH1: 40 });
    const quiet = pool({ reserveUsd: 40_000, buyersM5: 2, buyersH1: 41 });
    expect(geckoPoolRank(busy, true)).toBeGreaterThan(geckoPoolRank(quiet, true));
    // The hourly rank, which is what the pages report for both at this age, disagrees —
    // and would have spent the sweep's lookups on the quiet one.
    expect(geckoPoolRank(quiet)).toBeGreaterThan(geckoPoolRank(busy));
  });
});

describe("geckoCandidate on a four-minute-old launch", () => {
  const candidate = geckoCandidate(poolsFor(DOVE)[0] as GeckoPool, null, "solana", NOW);

  it("carries the five-minute buyers and an age fine enough to read in minutes", () => {
    expect(candidate.buyers5m).toBe(92);
    expect(candidate.ageHours).toBeCloseTo(4 / 60, 4);
    expect(candidate.liquidityUsd).toBeCloseTo(4_751.95, 2);
    // fdv stands in for a market cap GeckoTerminal has not computed.
    expect(candidate.marketCapUsd).toBeCloseTo(7_464.86, 2);
    expect(candidate.holderCount).toBeNull();
  });

  it("clears the free gates of a fresh-window universe on the pool page alone", () => {
    const blockers = hardGates(
      toFacts({ chain: "solana", address: DOVE, symbol: "DOVE", geckoPool: poolsFor(DOVE)[0], now: NOW }),
      FRESH_UNIVERSE,
    );
    expect(blockers).toEqual([]);
  });
});

describe("renderCandidates", () => {
  const rows = () =>
    renderCandidates([
      geckoCandidate(poolsFor(DOVE)[0] as GeckoPool, null, "solana", NOW),
      geckoCandidate(pool({ token: { ...pool().token, address: "MintOld" }, createdAtMs: NOW - 5 * 3_600_000 }), null, "solana", NOW),
    ]);

  it("prints minutes under the hour and hours above it", () => {
    const table = rows();
    expect(table).toContain("4m");
    expect(table).toContain("5.0h");
  });

  it("shows the five-minute buyer column only when a feed reported one", () => {
    expect(rows()).toContain("BUY5M");
    const withoutBuyers = renderCandidates([
      { ...geckoCandidate(poolsFor(DOVE)[0] as GeckoPool, null, "solana", NOW), buyers5m: null },
    ]);
    expect(withoutBuyers).not.toContain("BUY5M");
  });
});

describe("toFacts fallback order for a mint Jupiter has not indexed", () => {
  const address = DOVE;
  const base = { chain: "solana" as const, address, symbol: "DOVE", now: NOW };

  it("reads price, liquidity, age, volume, mcap and trend off the pool when nothing else answers", () => {
    const facts = toFacts({ ...base, geckoPool: poolsFor(DOVE)[0] });
    expect(facts.priceUsd).toBeCloseTo(7.464858451e-6, 12);
    expect(facts.liquidityUsd).toBeCloseTo(4_751.95, 2);
    expect(facts.ageHours).toBeCloseTo(4 / 60, 6);
    expect(facts.volume24hUsd).toBeCloseTo(12_107.44, 2);
    expect(facts.marketCapUsd).toBeCloseTo(7_464.86, 2);
    expect(facts.priceChange1hPct).toBeCloseTo(23.34, 2);
    expect(facts.priceChange24hPct).toBeCloseTo(23.34, 2);
    // The pool answers no safety question at all: those stay RugCheck's and Jupiter's.
    expect(facts.mintAuthorityDisabled).toBeNull();
    expect(facts.freezeAuthorityDisabled).toBeNull();
    expect(facts.isHoneypot).toBeNull();
    expect(facts.holderCount).toBeNull();
  });

  it("turns `liquidity_unknown` and `age_unknown` into no blockers at all", () => {
    const blind = hardGates(toFacts({ ...base }), FRESH_UNIVERSE);
    expect(blind).toContain("liquidity_unknown");
    expect(blind).toContain("age_unknown");

    const seeing = hardGates(toFacts({ ...base, geckoPool: poolsFor(DOVE)[0] }), FRESH_UNIVERSE);
    expect(seeing).toEqual([]);
  });

  it("lets DexScreener answer first, and fills the one field it omits for a fresh pair", () => {
    const dex = dovePairs();
    // DexScreener knows this mint four minutes in — but not its depth.
    expect(dex?.priceUsd).toBeCloseTo(6.913e-6, 9);
    expect(dex?.liquidityUsd).toBeNull();
    expect(dex?.pairCreatedAtMs).toBe(BORN);

    const facts = toFacts({ ...base, dexscreener: dex, geckoPool: poolsFor(DOVE)[0] });
    expect(facts.priceUsd).toBeCloseTo(6.913e-6, 9); // DexScreener's, not the pool's
    expect(facts.symbol).toBe("DOVE");
    expect(facts.name).toBe("The Dove");
    expect(facts.liquidityUsd).toBeCloseTo(4_751.95, 2); // the pool's, because DexScreener has none
    expect(facts.volume24hUsd).toBeCloseTo(9_925.34, 2); // DexScreener's
    expect(facts.ageHours).toBeCloseTo(4 / 60, 6);
  });

  it("still puts Jupiter first the moment it has a record", () => {
    const jupiter = parseJupiterToken({
      id: address,
      symbol: "DOVE",
      usdPrice: 0.0000086,
      liquidity: 5_793.5,
      holderCount: 43,
      mcap: 8_616.73,
      firstPool: { createdAt: new Date(NOW - 6 * 60_000).toISOString() },
    });
    const facts = toFacts({ ...base, jupiter, dexscreener: dovePairs(), geckoPool: poolsFor(DOVE)[0] });
    expect(facts.priceUsd).toBeCloseTo(0.0000086, 9);
    expect(facts.liquidityUsd).toBeCloseTo(5_793.5, 2);
    expect(facts.marketCapUsd).toBeCloseTo(8_616.73, 2);
    expect(facts.holderCount).toBe(43);
    expect(facts.ageHours).toBeCloseTo(6 / 60, 6);
  });
});
