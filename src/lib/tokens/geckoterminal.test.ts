/**
 * The `gecko_launches` pipeline, end to end but without a network: parse a real
 * GeckoTerminal payload, filter it, decide on it, and map what survives.
 *
 * Both fixtures are live captures from 2026-09-21 (`new_pools` page 1 on Solana,
 * trimmed to eight pools; five `/info` responses across both chains), so the odd
 * shapes they contain are the real ones — a `reserve_in_usd` of `"0.0"`, the same
 * token appearing in three pools, `is_honeypot: "unknown"` on Solana against a real
 * boolean on Base, and a `gt_score_details.creation` of 0 for anything young.
 */
import { describe, expect, it } from "vitest";
import newPoolsFixture from "./fixtures/geckoterminal-new-pools.json";
import tokenInfoFixture from "./fixtures/geckoterminal-token-info.json";
import {
  parseGeckoPools,
  parseGeckoTokenInfo,
  parsePoolTokens,
  type GeckoPool,
} from "./providers/geckoterminal";
import {
  filterGeckoPools,
  geckoCandidate,
  geckoPoolRank,
  geckoQuickScore,
  passesGeckoInfo,
  GECKO_MIN_BUYERS_H1,
  GECKO_MIN_GT_SCORE,
} from "./discover";

/** Every pool on the fixture page was created at 21:44 on 2026-09-21. */
const NOW = Date.parse("2026-09-21T22:44:12Z");

const info = (key: string) =>
  parseGeckoTokenInfo(
    (tokenInfoFixture as Record<string, unknown>)[key],
    key.startsWith("base:") ? "base" : "solana",
  );

const BONK = "solana:DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const STAMP = "solana:EKtmPPLaCbEEKiwoHHtV7TsRsmPXs5CMGtQtZFSiinsc";
const TTF = "solana:13QZa6e5VXei2XFq4wQCEAKD5RDy453KtFBfrQ9mB7wP";
const AERO = "base:0x940181a94a35a4569e4529a3cdfb74e38fd98631";
const LAPTOP = "base:0x869b2f0b6bcd22dbdbf9c94f1a1477c347b7907d";

function pool(overrides: Partial<GeckoPool> = {}): GeckoPool {
  return {
    poolAddress: "pool",
    name: "T / SOL",
    createdAtMs: NOW - 3_600_000,
    reserveUsd: 25_000,
    volume1hUsd: 5_000,
    volume24hUsd: 40_000,
    priceUsd: 0.001,
    fdvUsd: 900_000,
    marketCapUsd: null,
    priceChange1hPct: 12,
    priceChange6hPct: 12,
    priceChange24hPct: 12,
    buysH1: 40,
    sellsH1: 10,
    buyersH1: 30,
    sellersH1: 8,
    dexId: "raydium",
    token: { address: "MintT", name: "Token T", symbol: "T", decimals: 6, imageUrl: null },
    ...overrides,
  };
}

describe("parseGeckoPools", () => {
  const pools = parseGeckoPools(newPoolsFixture, "solana");

  it("reads the page's attributes and joins the base token from included[]", () => {
    expect(pools).toHaveLength(8);
    const first = pools[0];
    expect(first).toMatchObject({
      name: "TTF / SOL",
      createdAtMs: Date.parse("2026-09-21T21:44:12Z"),
      reserveUsd: 5162.9206080247,
      buysH1: 11,
      sellsH1: 1,
      buyersH1: 9,
      sellersH1: 1,
      dexId: "pump-fun",
    });
    expect(first?.token).toEqual({
      address: "13QZa6e5VXei2XFq4wQCEAKD5RDy453KtFBfrQ9mB7wP",
      name: "The Tree Fund",
      symbol: "TTF",
      decimals: 6,
      imageUrl: "https://assets.geckoterminal.com/cza88ib99yavvuxsdf7edrnhz3tn",
    });
    // Numeric strings are numbers by the time anything else sees them.
    expect(typeof first?.reserveUsd).toBe("number");
    expect(typeof first?.volume24hUsd).toBe("number");
  });

  it("keeps a $0 reserve as 0 rather than null — 'no liquidity' is a fact, not a gap", () => {
    const empty = pools.find((p) => p.reserveUsd === 0);
    expect(empty).toBeDefined();
    expect(empty?.token.symbol).toBe("FOMO LISA");
  });

  it("drops rows whose base token is on another network, and survives junk", () => {
    const body = {
      data: [
        { attributes: { name: "A / SOL" }, relationships: { base_token: { data: { id: "base_0x1234" } } } },
        { relationships: {} },
        null,
      ],
    };
    expect(parseGeckoPools(body, "solana")).toEqual([]);
    expect(parseGeckoPools(null, "solana")).toEqual([]);
    expect(parseGeckoPools({ data: "nope" }, "base")).toEqual([]);
  });

  it("still identifies the token when the request omitted include=base_token", () => {
    const body = {
      data: [{ attributes: { name: "A / SOL" }, relationships: { base_token: { data: { id: `solana_${"1".repeat(40)}` } } } }],
    };
    const parsed = parseGeckoPools(body, "solana");
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.token).toMatchObject({ address: "1".repeat(40), symbol: null, decimals: null });
  });
});

describe("parsePoolTokens", () => {
  it("defaults to Base, so the existing Base callers are untouched", () => {
    const body = { data: [{ relationships: { base_token: { data: { id: "base_0xAbCdEf0000000000000000000000000000000001" } } } }] };
    expect(parsePoolTokens(body)).toEqual(["0xabcdef0000000000000000000000000000000001"]);
  });

  it("reads Solana ids when asked, preserving base58 case, deduped", () => {
    expect(parsePoolTokens(newPoolsFixture, "solana")).toEqual([
      "13QZa6e5VXei2XFq4wQCEAKD5RDy453KtFBfrQ9mB7wP",
      "F1BWTdpL59iCGmG442P6AgrEo1VPYq596iUKK4DTpump",
      "ZknWLFGTUhT5FBKj8KahmNqm8SNiSuuKygpVkFrpump",
      "8rwHs5YGWpPzTu65g7V9Se3WVfaJvKdNdgCPXcmdiDsD",
      "7wtw6eUM9gdteuvywkoQmtViai2wbcLULHdJ5oEkpump",
      "2L6Gt2tZUjxzrDXh9wqBpcYjeRT3NAWpgFHoS3TMpump",
    ]);
  });
});

describe("parseGeckoTokenInfo", () => {
  it("reads the GT Score, its sub-scores, holders and concentration", () => {
    const bonk = info(BONK);
    expect(bonk?.gtScore).toBeCloseTo(61.967, 2);
    expect(bonk?.gtScoreDetails).toMatchObject({ creation: 100, transaction: 100, holders: 68.75 });
    expect(bonk?.holderCount).toBe(1_019_571);
    expect(bonk?.top10HolderPct).toBeCloseTo(38.5432, 4);
    expect(bonk?.symbol).toBe("Bonk");
  });

  it("treats Solana's \"unknown\" honeypot flag as null and Base's boolean as itself", () => {
    expect(info(BONK)?.isHoneypot).toBeNull();
    expect(info(STAMP)?.isHoneypot).toBeNull();
    expect(info(AERO)?.isHoneypot).toBe(false);
  });

  it("lowercases Base addresses and leaves base58 mints alone", () => {
    expect(info(AERO)?.address).toBe("0x940181a94a35a4569e4529a3cdfb74e38fd98631");
    expect(info(BONK)?.address).toBe("DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263");
  });

  it("returns null for a missing payload", () => {
    expect(parseGeckoTokenInfo(null, "solana")).toBeNull();
    expect(parseGeckoTokenInfo({ data: {} }, "solana")).toBeNull();
    expect(parseGeckoTokenInfo({ data: { attributes: { gt_score: 70 } } }, "solana")).toBeNull();
    // …unless the caller can name the address the payload left out.
    expect(parseGeckoTokenInfo({ data: { attributes: { gt_score: 70 } } }, "solana", "MintX")?.gtScore).toBe(70);
  });

  it("reads the nine-holder, 99%-concentrated hour-old token for exactly what it is", () => {
    const laptop = info(LAPTOP);
    expect(laptop?.holderCount).toBe(9);
    expect(laptop?.top10HolderPct).toBeCloseTo(99.3818, 4);
    expect(laptop?.gtScoreDetails).toMatchObject({ creation: 0, transaction: 0, info: 0 });
  });

  it("nulls every sub-score when the payload has no gt_score_details", () => {
    const bare = parseGeckoTokenInfo({ data: { attributes: { address: "MintX" } } }, "solana");
    expect(bare?.gtScore).toBeNull();
    expect(bare?.gtScoreDetails).toEqual({ pool: null, transaction: null, creation: null, info: null, holders: null });
  });
});

describe("passesGeckoInfo", () => {
  it("needs a GT Score at or above the bar — a fresh launch's zero creation sub-score does not disqualify it", () => {
    expect(passesGeckoInfo(info(BONK))).toBe(true); // 62.0, creation 100
    expect(passesGeckoInfo(info(AERO))).toBe(true); // 91.0, creation 100
    // A day-old launch rated 52 overall with creation 0: the launch this feed is for.
    expect(info(STAMP)?.gtScore).toBeGreaterThan(GECKO_MIN_GT_SCORE);
    expect(info(STAMP)?.gtScoreDetails.creation).toBe(0);
    expect(passesGeckoInfo(info(STAMP))).toBe(true);
    expect(passesGeckoInfo(info(LAPTOP))).toBe(false); // 23.9
    expect(passesGeckoInfo(info(TTF))).toBe(false); // minutes old: 23.8
    expect(passesGeckoInfo(null)).toBe(false);
  });

  it("rejects a token with no score at all rather than assuming an average one", () => {
    const unrated = { ...(info(BONK) as NonNullable<ReturnType<typeof info>>), gtScore: null };
    expect(passesGeckoInfo(unrated)).toBe(false);
  });
});

describe("filterGeckoPools", () => {
  const pools = parseGeckoPools(newPoolsFixture, "solana");

  it("keeps only pools with real buyers, ranked buyers-first, one row per token", () => {
    const kept = filterGeckoPools({ pools, now: NOW, minLiquidityUsd: 0, maxAgeHours: null });
    expect(kept.map((p) => p.token.symbol)).toEqual(["Call", "GOTCHIFY", "TTF", "MOO"]);
    // Everything dropped was dropped for want of buyers, not for want of depth: the
    // deepest pool on the page ($40k) had four.
    for (const p of pools) {
      const survived = kept.includes(p);
      expect(survived).toBe((p.buyersH1 ?? 0) >= GECKO_MIN_BUYERS_H1);
    }
  });

  it("applies the universe's liquidity floor, and rejects an unknown reserve", () => {
    expect(
      filterGeckoPools({ pools, now: NOW, minLiquidityUsd: 5_000, maxAgeHours: null }).map((p) => p.token.symbol),
    ).toEqual(["Call", "TTF", "MOO"]);
    expect(filterGeckoPools({ pools, now: NOW, minLiquidityUsd: 1_000_000, maxAgeHours: null })).toEqual([]);

    const unknown = [pool({ reserveUsd: null })];
    expect(filterGeckoPools({ pools: unknown, now: NOW, minLiquidityUsd: 1, maxAgeHours: null })).toEqual([]);
    // With no floor configured, an unknown reserve is not a reason to drop it.
    expect(filterGeckoPools({ pools: unknown, now: NOW, minLiquidityUsd: 0, maxAgeHours: null })).toHaveLength(1);
  });

  it("applies the universe's age ceiling, and rejects an unknown creation time", () => {
    const old = pool({ token: { ...pool().token, address: "MintOld" }, createdAtMs: NOW - 48 * 3_600_000 });
    const undated = pool({ token: { ...pool().token, address: "MintUndated" }, createdAtMs: null });

    const kept = filterGeckoPools({ pools: [...pools, old, undated], now: NOW, minLiquidityUsd: 0, maxAgeHours: 6 });
    expect(kept.map((p) => p.token.address)).not.toContain("MintOld");
    expect(kept.map((p) => p.token.address)).not.toContain("MintUndated");
    // No ceiling configured: both come back.
    const all = filterGeckoPools({ pools: [old, undated], now: NOW, minLiquidityUsd: 0, maxAgeHours: null });
    expect(all).toHaveLength(2);
  });

  it("collapses several pools of one token down to the best-ranked one", () => {
    const thin = pool({ poolAddress: "thin", reserveUsd: 900, buysH1: 9, buyersH1: 6 });
    const deep = pool({ poolAddress: "deep", reserveUsd: 90_000, buysH1: 60, buyersH1: 41 });
    const kept = filterGeckoPools({ pools: [thin, deep], now: NOW, minLiquidityUsd: 0, maxAgeHours: null });
    expect(kept).toHaveLength(1);
    expect(kept[0]?.poolAddress).toBe("deep");
    expect(geckoPoolRank(deep)).toBeGreaterThan(geckoPoolRank(thin));
  });

  it("ranks forty buyers in a thin pool above four buyers in a deep one", () => {
    const busy = pool({ reserveUsd: 5_000, buyersH1: 40 });
    const quiet = pool({ reserveUsd: 40_000, buyersH1: 4 });
    expect(geckoPoolRank(busy)).toBeGreaterThan(geckoPoolRank(quiet));
  });
});

describe("geckoCandidate", () => {
  const bonk = info(BONK);
  const source = pool({
    token: {
      address: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
      name: "Bonk",
      symbol: "BONK",
      decimals: 5,
      imageUrl: "https://example.test/bonk.png",
    },
  });

  it("carries the pool's market data and the info's holders onto the candidate", () => {
    const candidate = geckoCandidate(source, bonk, "solana", NOW);
    expect(candidate.origin).toBe("gecko_launches");
    expect(candidate.token).toMatchObject({
      id: "solana:DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
      chain: "solana",
      symbol: "BONK",
      decimals: 5,
      logoUrl: "https://example.test/bonk.png",
    });
    expect(candidate.liquidityUsd).toBe(25_000);
    expect(candidate.volume24hUsd).toBe(40_000);
    expect(candidate.marketCapUsd).toBe(900_000); // fdv stands in when mcap is null
    expect(candidate.holderCount).toBe(1_019_571);
    expect(candidate.ageHours).toBe(1);
    expect(candidate.priceChange24hPct).toBe(12);
  });

  it("still produces a candidate when there is no info, just without Gecko's numbers", () => {
    const candidate = geckoCandidate(source, null, "solana", NOW);
    expect(candidate.holderCount).toBeNull();
    expect(candidate.quickScore).toBeGreaterThan(0);
  });

  it("ranks a better-rated token higher on an identical pool", () => {
    const rated = (gtScore: number) =>
      geckoCandidate(source, { ...(bonk as NonNullable<typeof bonk>), gtScore }, "solana", NOW).quickScore ?? 0;
    expect(rated(95)).toBeGreaterThan(rated(75));
    expect(rated(75)).toBeGreaterThan(rated(50));
  });
});

describe("geckoQuickScore", () => {
  const facts = {
    chain: "solana" as const,
    address: "MintT",
    symbol: "T",
    name: null,
    decimals: 6,
    logoUrl: null,
    priceUsd: 0.01,
    liquidityUsd: 50_000,
    volume24hUsd: 10_000,
    marketCapUsd: 500_000,
    holderCount: 2_000,
    ageHours: 5,
    priceChange1hPct: null,
    priceChange6hPct: null,
    priceChange24hPct: 8,
    mintAuthorityDisabled: null,
    freezeAuthorityDisabled: null,
    top10HolderPct: 30,
    devBalancePct: null,
    buyTaxPct: null,
    sellTaxPct: null,
    isHoneypot: null,
    sellable: null,
  };

  it("is monotonic in the GT Score and stays on the 0-100 scale", () => {
    const low = geckoQuickScore(facts, 20);
    const mid = geckoQuickScore(facts, 60);
    const high = geckoQuickScore(facts, 100);
    expect(low).toBeLessThan(mid);
    expect(mid).toBeLessThan(high);
    expect(high).toBeLessThanOrEqual(100);
    expect(geckoQuickScore(facts, -50)).toBeGreaterThanOrEqual(0);
  });

  it("falls back to the plain pre-rank when there is no GT Score", () => {
    expect(geckoQuickScore(facts, null)).toBeGreaterThan(0);
    expect(geckoQuickScore(facts, null)).toBeLessThan(geckoQuickScore(facts, 100));
  });
});
