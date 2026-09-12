/**
 * `scoreToken` is pure and synchronous, so every one of these runs with no network,
 * no database and a pinned clock. The Solana fixtures are real Jupiter/RugCheck
 * payloads captured live; the rug and wash-trading cases are hand-built so the exact
 * failure being asserted is the only thing wrong with the token.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_AGENT_CONFIG } from "@/lib/agent/config";
import { parseJupiterToken } from "./providers/jupiter";
import { parseRugcheckSummary } from "./providers/rugcheck";
import { parseGoPlusSecurity } from "./providers/goplus";
import { collapsePairs } from "./providers/dexscreener";
import { explainBlocker, hardGates, LOW_CONFIDENCE, scoreToken, toFacts, verdictFor, type Universe } from "./score";
import type { JupiterStats, JupiterToken, ScoreInput } from "./types";
import jupiterFixture from "./fixtures/jupiter.json";
import rugcheckFixture from "./fixtures/rugcheck.json";
import dexFixture from "./fixtures/dexscreener.json";
import goplusFixture from "./fixtures/goplus.json";

const NOW = Date.parse("2026-09-11T18:00:00.000Z");
const HOUR = 3_600_000;

const BONK_MINT = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const BRETT = "0x532f27101965dd16442E59d40670FaF5eBB142E4";

const jupTokens = (jupiterFixture as unknown as { tokens: Record<string, unknown> }).tokens;
const rugSummaries = rugcheckFixture as unknown as Record<string, unknown>;
const dexPairs = (dexFixture as unknown as { pairs: Record<string, unknown[]> }).pairs;
const goplusRows = goplusFixture as unknown as Record<string, unknown>;

function universe(overrides: Partial<Universe> = {}): Universe {
  return { ...DEFAULT_AGENT_CONFIG.universe, ...overrides };
}

/** Every gate off, so a test can switch exactly one on. */
const OPEN_UNIVERSE: Universe = universe({
  minScore: 0,
  minLiquidityUsd: 0,
  minHolderCount: 0,
  minAgeMinutes: 0,
  maxAgeHours: null,
  maxTop10HolderPct: 100,
  maxBuyTaxPct: 100,
  requireMintRevoked: false,
  requireFreezeRevoked: false,
  blocklist: [],
});

function stats(overrides: Partial<JupiterStats> = {}): JupiterStats {
  return {
    priceChange: null,
    holderChange: null,
    liquidityChange: null,
    volumeChange: null,
    buyVolume: null,
    sellVolume: null,
    buyOrganicVolume: null,
    sellOrganicVolume: null,
    numBuys: null,
    numSells: null,
    numTraders: null,
    numOrganicBuyers: null,
    numNetBuyers: null,
    ...overrides,
  };
}

function jupiterToken(overrides: Partial<JupiterToken> = {}): JupiterToken {
  return {
    id: "Rug1111111111111111111111111111111111111111",
    name: "Rug",
    symbol: "RUG",
    icon: null,
    decimals: 6,
    dev: "Dev111",
    circSupply: 1_000_000_000,
    totalSupply: 1_000_000_000,
    tokenProgram: null,
    holderCount: 400,
    fdv: 50_000,
    mcap: 50_000,
    usdPrice: 0.00005,
    liquidity: 40_000,
    stats5m: null,
    stats1h: null,
    stats6h: null,
    stats24h: stats({ priceChange: 4, buyVolume: 10_000, sellVolume: 9_000, numBuys: 300, numSells: 280, numTraders: 180, numOrganicBuyers: 40, buyOrganicVolume: 2_000 }),
    firstPoolCreatedAtMs: NOW - 72 * HOUR,
    createdAtMs: NOW - 72 * HOUR,
    audit: {
      mintAuthorityDisabled: true,
      freezeAuthorityDisabled: true,
      topHoldersPercentage: 28,
      devBalancePercentage: 1,
      devMints: 1,
      isSus: false,
    },
    organicScore: 60,
    organicScoreLabel: "medium",
    isVerified: false,
    tags: [],
    ...overrides,
  };
}

function solanaInput(overrides: Partial<ScoreInput> = {}): ScoreInput {
  return {
    chain: "solana",
    address: "Rug1111111111111111111111111111111111111111",
    symbol: "RUG",
    jupiter: jupiterToken(),
    rugcheck: {
      mint: "Rug1111111111111111111111111111111111111111",
      risks: [],
      score: 40,
      scoreNormalised: 12,
      lpLockedPct: 60,
    },
    maxTradeUsd: 100,
    now: NOW,
    ...overrides,
  };
}

// ---------- the blue chip ----------

describe("a clean blue chip", () => {
  const bonk: ScoreInput = {
    chain: "solana",
    address: BONK_MINT,
    symbol: "BONK",
    jupiter: parseJupiterToken(jupTokens[BONK_MINT]),
    rugcheck: parseRugcheckSummary(BONK_MINT, rugSummaries[BONK_MINT]),
    maxTradeUsd: 100,
    now: NOW,
  };

  it("uses the real captured Jupiter and RugCheck payloads", () => {
    expect(bonk.jupiter?.symbol).toBe("Bonk");
    expect(bonk.rugcheck?.scoreNormalised).toBe(7);
  });

  it("scores strong with no blockers under the default universe", () => {
    const score = scoreToken(bonk, universe());
    expect(score.blockers).toEqual([]);
    expect(score.verdict).toBe("strong");
    expect(score.total).toBeGreaterThanOrEqual(80);
    expect(score.confidence).toBe(1);
  });

  it("scores every component highly and leaves sentiment null when nothing was paid for", () => {
    const score = scoreToken(bonk, universe());
    expect(score.components.safety).toBeGreaterThan(85);
    expect(score.components.liquidity).toBeGreaterThan(90);
    expect(score.components.organic).toBeGreaterThan(75);
    expect(score.components.distribution).toBeGreaterThan(85);
    expect(score.components.sentiment).toBeNull();
    expect(score.sources).toEqual(["jupiter", "rugcheck"]);
  });

  it("carries the market facts through onto the score", () => {
    const score = scoreToken(bonk, universe());
    expect(score.symbol).toBe("Bonk");
    expect(score.liquidityUsd).toBeGreaterThan(500_000);
    expect(score.holderCount).toBeGreaterThan(1_000_000);
    expect(score.ageHours).toBeGreaterThan(20_000);
    expect(score.tokenId).toBe(`solana:${BONK_MINT}`);
    expect(score.scoredAt).toBe(new Date(NOW).toISOString());
  });

  it("is deterministic — the same input scores the same twice", () => {
    expect(scoreToken(bonk, universe())).toEqual(scoreToken(bonk, universe()));
  });
});

// ---------- the rug ----------

describe("a fresh rug", () => {
  // Mint authority live, 90% of supply in the top 10 wallets, $2k of liquidity.
  const rug = solanaInput({
    jupiter: jupiterToken({
      symbol: "SCAM",
      liquidity: 2_000,
      holderCount: 38,
      firstPoolCreatedAtMs: NOW - 4 * HOUR,
      createdAtMs: NOW - 4 * HOUR,
      organicScore: 0,
      organicScoreLabel: "low",
      audit: {
        mintAuthorityDisabled: false,
        freezeAuthorityDisabled: false,
        topHoldersPercentage: 90,
        devBalancePercentage: 42,
        devMints: 9,
        isSus: true,
      },
      stats24h: stats({ priceChange: -60, buyVolume: 900, sellVolume: 2_400, numBuys: 20, numSells: 60, numTraders: 12, numOrganicBuyers: 0 }),
    }),
    rugcheck: {
      mint: "Rug1111111111111111111111111111111111111111",
      risks: [
        { name: "Mint authority still enabled", description: null, score: 900, level: "danger" },
        { name: "Top 10 holders high ownership", description: null, score: 700, level: "danger" },
        { name: "Low liquidity", description: null, score: 400, level: "warn" },
      ],
      score: 2_000,
      scoreNormalised: 78,
      lpLockedPct: 0,
    },
  });

  it("is an avoid with the blockers spelled out", () => {
    const score = scoreToken(rug, universe());
    expect(score.verdict).toBe("avoid");
    expect(score.blockers).toContain("mint_authority_active");
    expect(score.blockers).toContain("freeze_authority_active");
    expect(score.blockers).toContain("liquidity_below_floor");
    expect(score.blockers).toContain("holders_below_floor");
    expect(score.blockers).toContain("top10_holders_90pct");
  });

  it("scores badly on the numbers too, not just on the gates", () => {
    const score = scoreToken(rug, universe());
    expect(score.total).toBeLessThan(40);
    expect(score.components.safety).toBeLessThan(20);
    expect(score.components.liquidity).toBeLessThan(35);
    expect(score.components.distribution).toBeLessThan(30);
  });

  it("warns about the things that are ugly but not disqualifying", () => {
    const score = scoreToken(rug, universe());
    expect(score.warnings).toContain("jupiter_flags_suspicious");
    expect(score.warnings).toContain("dev_holds_over_25pct");
    expect(score.warnings).toContain("lp_barely_locked");
    expect(score.warnings).toContain("top10_holders_concentrated");
  });

  it("stays an avoid even if every component somehow scored perfectly", () => {
    expect(verdictFor(100, ["mint_authority_active"])).toBe("avoid");
    expect(verdictFor(100, [])).toBe("strong");
  });
});

// ---------- each gate, one at a time ----------

describe("hard gates fire individually", () => {
  const facts = toFacts(solanaInput());

  it("passes everything with the gates open", () => {
    expect(hardGates(facts, OPEN_UNIVERSE)).toEqual([]);
  });

  it("blocklist", () => {
    const gated = universe({
      ...OPEN_UNIVERSE,
      blocklist: [{ chain: "solana", address: facts.address.toLowerCase(), symbol: "RUG" }],
    });
    expect(hardGates(facts, gated)).toEqual(["blocklisted"]);
  });

  it("mint authority live", () => {
    const live = toFacts(solanaInput({ jupiter: jupiterToken({ audit: { ...jupiterToken().audit!, mintAuthorityDisabled: false } }) }));
    expect(hardGates(live, universe({ ...OPEN_UNIVERSE, requireMintRevoked: true }))).toEqual(["mint_authority_active"]);
  });

  it("mint authority unknown blocks too — a gate we cannot evaluate is not a pass", () => {
    const unknown = toFacts(solanaInput({ jupiter: jupiterToken({ audit: null }) }));
    expect(hardGates(unknown, universe({ ...OPEN_UNIVERSE, requireMintRevoked: true }))).toEqual([
      "mint_authority_unknown",
    ]);
  });

  it("freeze authority live", () => {
    const live = toFacts(solanaInput({ jupiter: jupiterToken({ audit: { ...jupiterToken().audit!, freezeAuthorityDisabled: false } }) }));
    expect(hardGates(live, universe({ ...OPEN_UNIVERSE, requireFreezeRevoked: true }))).toEqual([
      "freeze_authority_active",
    ]);
  });

  it("honeypot", () => {
    const honeypot = toFacts({
      chain: "base",
      address: BRETT,
      symbol: "TRAP",
      goplus: parseGoPlusSecurity(BRETT, { is_honeypot: "1", buy_tax: "0", sell_tax: "0" }),
      now: NOW,
    });
    expect(hardGates(honeypot, OPEN_UNIVERSE)).toEqual(["honeypot"]);
  });

  it("buy and sell tax above the ceiling, with the rate in the blocker", () => {
    const taxed = toFacts({
      chain: "base",
      address: BRETT,
      symbol: "TAXED",
      // GoPlus reports fractions: "0.12" is 12%.
      goplus: parseGoPlusSecurity(BRETT, { buy_tax: "0.12", sell_tax: "0.15", is_honeypot: "0" }),
      now: NOW,
    });
    const blockers = hardGates(taxed, universe({ ...OPEN_UNIVERSE, maxBuyTaxPct: 5 }));
    expect(blockers).toEqual(["buy_tax_12pct", "sell_tax_15pct"]);
  });

  it("a tax inside the ceiling does not block", () => {
    const taxed = toFacts({
      chain: "base",
      address: BRETT,
      symbol: "TAXED",
      goplus: parseGoPlusSecurity(BRETT, { buy_tax: "0.03", sell_tax: "0.03", is_honeypot: "0" }),
      now: NOW,
    });
    expect(hardGates(taxed, universe({ ...OPEN_UNIVERSE, maxBuyTaxPct: 5 }))).toEqual([]);
  });

  it("liquidity below the floor, and liquidity we could not read at all", () => {
    const thin = toFacts(solanaInput({ jupiter: jupiterToken({ liquidity: 900 }) }));
    expect(hardGates(thin, universe({ ...OPEN_UNIVERSE, minLiquidityUsd: 15_000 }))).toEqual(["liquidity_below_floor"]);

    const unknown = toFacts(solanaInput({ jupiter: jupiterToken({ liquidity: null }) }));
    expect(hardGates(unknown, universe({ ...OPEN_UNIVERSE, minLiquidityUsd: 15_000 }))).toEqual(["liquidity_unknown"]);
  });

  it("holder count below the floor", () => {
    const few = toFacts(solanaInput({ jupiter: jupiterToken({ holderCount: 12 }) }));
    expect(hardGates(few, universe({ ...OPEN_UNIVERSE, minHolderCount: 150 }))).toEqual(["holders_below_floor"]);
  });

  it("top-10 concentration, with the percentage baked into the blocker string", () => {
    const concentrated = toFacts(
      solanaInput({ jupiter: jupiterToken({ audit: { ...jupiterToken().audit!, topHoldersPercentage: 72.4 } }) }),
    );
    expect(hardGates(concentrated, universe({ ...OPEN_UNIVERSE, maxTop10HolderPct: 60 }))).toEqual([
      "top10_holders_72pct",
    ]);
  });

  it("maxTop10HolderPct of 100 disables the gate entirely, even with no data", () => {
    const unknown = toFacts(solanaInput({ jupiter: jupiterToken({ audit: null }) }));
    expect(hardGates(unknown, universe({ ...OPEN_UNIVERSE, maxTop10HolderPct: 100 }))).toEqual([]);
    expect(hardGates(unknown, universe({ ...OPEN_UNIVERSE, maxTop10HolderPct: 99 }))).toEqual([
      "top10_holders_unknown",
    ]);
  });
});

describe("age boundaries", () => {
  const gated = universe({ ...OPEN_UNIVERSE, minAgeMinutes: 30, maxAgeHours: 168 });

  function atAge(ms: number) {
    return toFacts(solanaInput({ jupiter: jupiterToken({ firstPoolCreatedAtMs: NOW - ms, createdAtMs: NOW - ms }) }));
  }

  it("blocks a token 29 minutes old", () => {
    expect(hardGates(atAge(29 * 60_000), gated)).toEqual(["age_below_min"]);
  });

  it("admits a token exactly 30 minutes old", () => {
    expect(hardGates(atAge(30 * 60_000), gated)).toEqual([]);
  });

  it("admits a token exactly at maxAgeHours", () => {
    expect(hardGates(atAge(168 * HOUR), gated)).toEqual([]);
  });

  it("blocks a token one minute past maxAgeHours", () => {
    expect(hardGates(atAge(168 * HOUR + 60_000), gated)).toEqual(["age_above_max"]);
  });

  it("blocks when the age is unknowable but an age gate is configured", () => {
    const ageless = toFacts(solanaInput({ jupiter: jupiterToken({ firstPoolCreatedAtMs: null, createdAtMs: null }) }));
    expect(hardGates(ageless, gated)).toEqual(["age_unknown"]);
  });

  it("ignores age entirely when neither bound is set", () => {
    const ageless = toFacts(solanaInput({ jupiter: jupiterToken({ firstPoolCreatedAtMs: null, createdAtMs: null }) }));
    expect(hardGates(ageless, universe({ ...OPEN_UNIVERSE, minAgeMinutes: 0, maxAgeHours: null }))).toEqual([]);
  });

  it("falls back to the DexScreener pair age on Base", () => {
    const pairs = dexPairs[BRETT.toLowerCase()] ?? [];
    const facts = toFacts({ chain: "base", address: BRETT, symbol: "BRETT", dexscreener: collapsePairs(BRETT, pairs), now: NOW });
    expect(facts.ageHours).not.toBeNull();
    expect(facts.ageHours ?? 0).toBeGreaterThan(1_000);
  });
});

// ---------- wash trading ----------

describe("wash-traded volume", () => {
  const washed = solanaInput({
    jupiter: jupiterToken({
      symbol: "WASH",
      organicScore: 2,
      organicScoreLabel: "low",
      stats24h: stats({
        priceChange: 18,
        // Enormous volume, almost entirely one-sided, and essentially nobody real behind it.
        buyVolume: 4_200_000,
        sellVolume: 60_000,
        buyOrganicVolume: 120,
        numBuys: 9_400,
        numSells: 140,
        numTraders: 22,
        numOrganicBuyers: 1,
      }),
    }),
  });

  it("crushes the organic component", () => {
    const score = scoreToken(washed, universe());
    expect(score.components.organic).toBeLessThan(20);
  });

  it("names the pattern in the warnings", () => {
    const score = scoreToken(washed, universe()).warnings;
    expect(score).toContain("volume_without_organic_buyers");
  });

  it("still rates the same token highly once the buyers are real", () => {
    const honest = solanaInput({
      jupiter: jupiterToken({
        organicScore: 84,
        stats24h: stats({
          priceChange: 18,
          buyVolume: 4_200_000,
          sellVolume: 3_600_000,
          buyOrganicVolume: 520_000,
          numBuys: 9_400,
          numSells: 8_100,
          numTraders: 3_100,
          numOrganicBuyers: 640,
        }),
      }),
    });
    const organic = scoreToken(honest, universe()).components.organic;
    expect(organic).toBeGreaterThan(70);
    expect(scoreToken(honest, universe()).warnings).not.toContain("volume_without_organic_buyers");
  });

  it("flags DexScreener turnover that looks manufactured on Base", () => {
    const pairs = [
      {
        baseToken: { address: BRETT, symbol: "PUMP", name: "Pump" },
        priceUsd: "0.01",
        liquidity: { usd: 20_000 },
        volume: { h24: 3_000_000, h6: 900_000, h1: 100_000 },
        priceChange: { h1: 2, h6: 8, h24: 30 },
        txns: { h24: { buys: 4_000, sells: 40 }, h1: { buys: 200, sells: 2 } },
        pairCreatedAt: NOW - 200 * HOUR,
      },
    ];
    const score = scoreToken(
      { chain: "base", address: BRETT, symbol: "PUMP", dexscreener: collapsePairs(BRETT, pairs), now: NOW },
      universe(),
    );
    expect(score.warnings).toContain("turnover_suggests_wash_trading");
    expect(score.warnings).toContain("organic_proxy_only");
    expect(score.components.organic).toBeLessThan(50);
  });
});

// ---------- partial and missing data ----------

describe("missing and partial provider data", () => {
  it("does not throw when every provider is down and refuses to look safe", () => {
    const blind: ScoreInput = { chain: "solana", address: BONK_MINT, symbol: "BONK", now: NOW };
    const score = scoreToken(blind, universe());
    expect(score.total).toBe(0);
    expect(score.verdict).toBe("avoid");
    expect(score.confidence).toBe(0);
    expect(score.warnings).toContain("low_confidence");
    expect(score.warnings).toContain("safety_unscored");
    expect(score.sources).toEqual([]);
    expect(score.blockers).toContain("liquidity_unknown");
  });

  it("does not throw on the skeletal records /tokens/v2/recent actually returns", () => {
    const skeletal = parseJupiterToken({
      id: "Hod1YQojqmYQwowbpxR7nvaAwgyGiJ4LjiUHN13kn7Y6",
      symbol: "牛来",
      decimals: 6,
      holderCount: 4,
      stats5m: { buyVolume: 0.0102, numBuys: 1 },
      firstPool: { createdAt: "2026-09-11T16:50:44Z" },
      audit: { isSus: true, mintAuthorityDisabled: true, freezeAuthorityDisabled: true, devMints: 1 },
      organicScore: 0,
      organicScoreLabel: "low",
    });
    const score = scoreToken({ chain: "solana", address: skeletal!.id, symbol: "?", jupiter: skeletal, now: NOW }, universe());
    expect(score.verdict).toBe("avoid");
    expect(score.blockers).toContain("liquidity_unknown");
    expect(score.blockers).toContain("holders_below_floor");
    expect(Number.isFinite(score.total)).toBe(true);
  });

  it("lowers confidence when RugCheck is unavailable, without failing the score", () => {
    const full = solanaInput();
    const partial = solanaInput({ rugcheck: null });
    expect(scoreToken(partial, universe()).confidence).toBeLessThan(scoreToken(full, universe()).confidence);
    expect(scoreToken(partial, universe()).warnings).toContain("rugcheck_unavailable");
    expect(scoreToken(partial, universe()).blockers).toEqual([]);
  });

  it("caps a low-confidence token below strong, however good the numbers it did return", () => {
    // Jupiter only: no stats, no audit, no RugCheck. Half the expected inputs are
    // missing, so even a token reporting $5M of liquidity and 900k holders cannot
    // be rated strong — we simply do not know enough about it.
    const thin = solanaInput({
      rugcheck: null,
      jupiter: jupiterToken({
        stats24h: null,
        stats6h: null,
        stats1h: null,
        stats5m: null,
        audit: null,
        liquidity: 5_000_000,
        holderCount: 900_000,
        organicScore: 99,
      }),
    });
    const score = scoreToken(thin, universe({ ...OPEN_UNIVERSE }));
    expect(score.confidence).toBeLessThan(LOW_CONFIDENCE);
    expect(score.warnings).toContain("low_confidence");
    expect(score.blockers).toEqual([]);
    expect(score.verdict).not.toBe("strong");
    expect(score.total).toBeLessThan(80);
  });

  it("scores Base off DexScreener alone when GoPlus is down, and says safety is unscored", () => {
    const pairs = dexPairs[BRETT.toLowerCase()] ?? [];
    const score = scoreToken(
      { chain: "base", address: BRETT, symbol: "BRETT", dexscreener: collapsePairs(BRETT, pairs), goplus: null, now: NOW, maxTradeUsd: 100 },
      universe({ ...OPEN_UNIVERSE, minLiquidityUsd: 15_000 }),
    );
    expect(score.warnings).toContain("no_contract_security_data");
    expect(score.components.safety).toBe(0);
    expect(score.components.liquidity).toBeGreaterThan(80);
    expect(score.blockers).toEqual([]);
  });
});

// ---------- Base end to end ----------

describe("Base, from the captured DexScreener and GoPlus payloads", () => {
  const brett: ScoreInput = {
    chain: "base",
    address: BRETT,
    symbol: "BRETT",
    dexscreener: collapsePairs(BRETT, dexPairs[BRETT.toLowerCase()] ?? []),
    goplus: parseGoPlusSecurity(BRETT.toLowerCase(), goplusRows[BRETT.toLowerCase()]),
    maxTradeUsd: 100,
    now: NOW,
  };

  it("parses GoPlus's string fields and fractional percentages", () => {
    expect(brett.goplus?.isHoneypot).toBe(false);
    expect(brett.goplus?.buyTaxPct).toBe(0);
    expect(brett.goplus?.holderCount).toBeGreaterThan(100_000);
    // owner_percent "0.0" is a fraction, so 0%.
    expect(brett.goplus?.ownerPercent).toBe(0);
  });

  it("sums liquidity across every pair rather than taking one pool", () => {
    expect(brett.dexscreener?.pairCount).toBeGreaterThan(1);
    expect(brett.dexscreener?.liquidityUsd ?? 0).toBeGreaterThan(1_000_000);
  });

  it("clears the default universe and lands at candidate or better", () => {
    const score = scoreToken(brett, universe());
    expect(score.blockers).toEqual([]);
    expect(["candidate", "strong"]).toContain(score.verdict);
    expect(score.sources).toEqual(["dexscreener", "goplus"]);
  });

  it("treats a mintable Base contract as a live mint authority", () => {
    const mintable: ScoreInput = {
      ...brett,
      goplus: parseGoPlusSecurity(BRETT, { is_mintable: "1", is_honeypot: "0", buy_tax: "0", sell_tax: "0", holder_count: "5000" }),
    };
    expect(scoreToken(mintable, universe()).blockers).toContain("mint_authority_active");
  });
});

// ---------- sentiment reweighting ----------

describe("sentiment", () => {
  it("is null and contributes nothing unless the agent paid for it", () => {
    const score = scoreToken(solanaInput(), universe());
    expect(score.components.sentiment).toBeNull();
    expect(score.sources).not.toContain("sentimentalpha");
  });

  it("reweights the free components rather than being added on top", () => {
    const without = scoreToken(solanaInput(), universe());
    const withNeutral = scoreToken(
      solanaInput({ sentiment: { sentiment: 0, velocity: 0, source: "sentimentalpha" } }),
      universe(),
    );
    // A neutral 50 sentiment pulls a good token down slightly, never above 100.
    expect(withNeutral.components.sentiment).toBe(50);
    expect(withNeutral.total).toBeLessThan(without.total);
    expect(withNeutral.total).toBeLessThanOrEqual(100);
    expect(withNeutral.sources).toContain("sentimentalpha");
  });

  it("lifts the total when the narrative is strongly bullish", () => {
    const bullish = scoreToken(
      solanaInput({ sentiment: { sentiment: 0.9, velocity: 0.8, source: "sentimentalpha" } }),
      universe(),
    );
    const bearish = scoreToken(
      solanaInput({ sentiment: { sentiment: -0.9, velocity: -0.6, source: "sentimentalpha" } }),
      universe(),
    );
    expect(bullish.total).toBeGreaterThan(bearish.total);
    expect(bullish.components.sentiment ?? 0).toBeGreaterThan(85);
  });
});

// ---------- verdict bands and blocker prose ----------

describe("verdict bands", () => {
  it("maps totals onto the SPEC bands", () => {
    expect(verdictFor(39.9, [])).toBe("avoid");
    expect(verdictFor(40, [])).toBe("watch");
    expect(verdictFor(59.9, [])).toBe("watch");
    expect(verdictFor(60, [])).toBe("candidate");
    expect(verdictFor(79.9, [])).toBe("candidate");
    expect(verdictFor(80, [])).toBe("strong");
  });
});

describe("explainBlocker", () => {
  it("renders the parameterised blockers with their numbers", () => {
    expect(explainBlocker("top10_holders_72pct")).toBe("top 10 holders control 72% of supply");
    expect(explainBlocker("buy_tax_12pct")).toBe("buy tax is 12%");
  });

  it("renders every fixed blocker as a sentence, never as the raw token", () => {
    for (const blocker of [
      "blocklisted",
      "mint_authority_active",
      "freeze_authority_active",
      "honeypot",
      "liquidity_below_floor",
      "holders_below_floor",
      "age_below_min",
      "age_above_max",
    ]) {
      expect(explainBlocker(blocker)).not.toBe(blocker);
      expect(explainBlocker(blocker).length).toBeGreaterThan(10);
    }
  });

  it("degrades gracefully for a blocker it has never seen", () => {
    expect(explainBlocker("some_new_gate")).toBe("some new gate");
  });
});
