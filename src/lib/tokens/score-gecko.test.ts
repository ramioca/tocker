/**
 * The `gecko` component: GeckoTerminal's GT Score folded into the composite, and the
 * reweighting that keeps the total on 0-100 whether it, the paid components, all of
 * them or none of them arrived.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_AGENT_CONFIG } from "@/lib/agent/config";
import type { GeckoTokenInfo, ScoreInput } from "./types";
import {
  renderScore,
  scoreToken,
  CORE_WEIGHT_TOTAL,
  GECKO_WEIGHT,
  SENTIMENT_WEIGHT,
  SMART_MONEY_WEIGHT,
  WEIGHTS,
} from "./score";

const MINT = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const NOW = Date.parse("2026-09-21T22:00:00Z");
const universe = {
  ...DEFAULT_AGENT_CONFIG.universe,
  minLiquidityUsd: 0,
  minHolderCount: 0,
  minAgeMinutes: 0,
  maxAgeHours: null,
  maxTop10HolderPct: 100,
  requireMintRevoked: false,
  requireFreezeRevoked: false,
};

function geckoInfo(overrides: Partial<GeckoTokenInfo> = {}): GeckoTokenInfo {
  return {
    address: MINT,
    name: "Bonk",
    symbol: "BONK",
    decimals: 5,
    imageUrl: null,
    gtScore: 62,
    gtScoreDetails: { pool: 62.9, transaction: 100, creation: 100, info: 100, holders: 68.75 },
    holderCount: 1_019_571,
    top10HolderPct: 38.5,
    devHoldingPct: null,
    mintAuthority: "no",
    freezeAuthority: "no",
    isHoneypot: null,
    ...overrides,
  };
}

/** A plain, fully-known Solana token so only the component under test moves. */
function input(overrides: Partial<ScoreInput> = {}): ScoreInput {
  return {
    chain: "solana",
    address: MINT,
    symbol: "BONK",
    now: NOW,
    maxTradeUsd: 100,
    jupiter: {
      id: MINT,
      name: "Bonk",
      symbol: "BONK",
      icon: null,
      decimals: 5,
      dev: null,
      circSupply: null,
      totalSupply: null,
      tokenProgram: null,
      holderCount: 900_000,
      fdv: 2_000_000_000,
      mcap: 1_500_000_000,
      usdPrice: 0.00002,
      liquidity: 4_000_000,
      stats5m: null,
      stats1h: null,
      stats6h: null,
      stats24h: {
        priceChange: 4,
        holderChange: 1,
        liquidityChange: 2,
        volumeChange: 5,
        buyVolume: 600_000,
        sellVolume: 500_000,
        buyOrganicVolume: 90_000,
        sellOrganicVolume: 70_000,
        numBuys: 9_000,
        numSells: 8_000,
        numTraders: 4_000,
        numOrganicBuyers: 1_200,
        numNetBuyers: 400,
      },
      firstPoolCreatedAtMs: NOW - 800 * 3_600_000,
      createdAtMs: NOW - 800 * 3_600_000,
      audit: {
        mintAuthorityDisabled: true,
        freezeAuthorityDisabled: true,
        topHoldersPercentage: 38,
        devBalancePercentage: 0.4,
        devMints: 0,
        isSus: false,
      },
      organicScore: 71,
      organicScoreLabel: "high",
      isVerified: true,
      tags: ["verified"],
    },
    rugcheck: { mint: MINT, risks: [], score: 90, scoreNormalised: 8, lpLockedPct: 92 },
    dexscreener: null,
    goplus: null,
    ...overrides,
  };
}

/** The core five, weighted, as a 0-100 number before any reweighting. */
function coreTotal(components: { safety: number; liquidity: number; organic: number; distribution: number; momentum: number }): number {
  return (
    (components.safety * WEIGHTS.safety +
      components.liquidity * WEIGHTS.liquidity +
      components.organic * WEIGHTS.organic +
      components.distribution * WEIGHTS.distribution +
      components.momentum * WEIGHTS.momentum) /
    CORE_WEIGHT_TOTAL
  );
}

describe("the weight table", () => {
  it("has five core components summing to 100, and three that reweight them", () => {
    expect(CORE_WEIGHT_TOTAL).toBe(100);
    expect(WEIGHTS.gecko).toBe(10);
    expect(GECKO_WEIGHT).toBe(10);
    expect(SENTIMENT_WEIGHT).toBe(15);
    expect(SMART_MONEY_WEIGHT).toBe(10);
  });
});

describe("the gecko component", () => {
  it("is null — never 50 — when GeckoTerminal has no read on the token", () => {
    const score = scoreToken(input(), universe);
    expect(score.components.gecko).toBeNull();
    expect(score.sources).not.toContain("geckoterminal");
  });

  it("is null when GeckoTerminal answered without a score", () => {
    const score = scoreToken(input({ gecko: geckoInfo({ gtScore: null }) }), universe);
    expect(score.components.gecko).toBeNull();
    // The source still contributed — holders, concentration, the honeypot flag.
    expect(score.sources).toContain("geckoterminal");
  });

  it("is the GT Score itself, and records the source", () => {
    const score = scoreToken(input({ gecko: geckoInfo({ gtScore: 62 }) }), universe);
    expect(score.components.gecko).toBe(62);
    expect(score.sources).toContain("geckoterminal");
    expect(score.warnings).not.toContain("gt_score_low");
  });

  it("clamps a nonsense score onto 0-100", () => {
    expect(scoreToken(input({ gecko: geckoInfo({ gtScore: 140 }) }), universe).components.gecko).toBe(100);
    expect(scoreToken(input({ gecko: geckoInfo({ gtScore: -3 }) }), universe).components.gecko).toBe(0);
  });

  it("warns when GeckoTerminal rates the token under 40", () => {
    expect(scoreToken(input({ gecko: geckoInfo({ gtScore: 39.9 }) }), universe).warnings).toContain("gt_score_low");
    expect(scoreToken(input({ gecko: geckoInfo({ gtScore: 40 }) }), universe).warnings).not.toContain("gt_score_low");
  });

  it("appears in the rendered line only when it exists", () => {
    expect(renderScore(scoreToken(input({ gecko: geckoInfo() }), universe))).toContain("GT Score 62");
    expect(renderScore(scoreToken(input(), universe))).not.toContain("GT Score");
  });
});

describe("reweighting", () => {
  it("leaves the core five at full weight when gecko is absent", () => {
    const score = scoreToken(input(), universe);
    expect(score.total).toBeCloseTo(coreTotal(score.components), 1);
  });

  it("takes gecko's 10 points out of the core five rather than adding a sixth slice", () => {
    const score = scoreToken(input({ gecko: geckoInfo({ gtScore: 62 }) }), universe);
    const expected = coreTotal(score.components) * 0.9 + 62 * 0.1;
    expect(score.total).toBeCloseTo(expected, 1);
  });

  it("scales the core five by 0.65 when gecko, sentiment and smart money are all present", () => {
    const score = scoreToken(
      input({
        gecko: geckoInfo({ gtScore: 62 }),
        sentiment: { sentiment: 0.4, velocity: 0.2, source: "x-search" },
        smartMoney: { netflowUsd: 120_000, traderCount: 22, source: "nansen-smart-money" },
      }),
      universe,
    );
    expect(score.components.gecko).toBe(62);
    expect(score.components.sentiment).not.toBeNull();
    expect(score.components.smartMoney).not.toBeNull();

    const expected =
      coreTotal(score.components) * 0.65 +
      62 * (GECKO_WEIGHT / 100) +
      (score.components.sentiment ?? 0) * (SENTIMENT_WEIGHT / 100) +
      (score.components.smartMoney ?? 0) * (SMART_MONEY_WEIGHT / 100);
    expect(score.total).toBeCloseTo(expected, 1);
    expect(score.total).toBeLessThanOrEqual(100);
  });

  it("moves the total in the GT Score's direction, by at most its weight", () => {
    const without = scoreToken(input(), universe).total;
    const high = scoreToken(input({ gecko: geckoInfo({ gtScore: 100 }) }), universe).total;
    const low = scoreToken(input({ gecko: geckoInfo({ gtScore: 0 }) }), universe).total;

    expect(high).toBeGreaterThan(without);
    expect(low).toBeLessThan(without);
    // A 10% slice cannot move a ~75 score by more than ~10 points either way.
    expect(Math.abs(high - without)).toBeLessThanOrEqual(10.5);
    expect(Math.abs(without - low)).toBeLessThanOrEqual(10.5);
  });
});

describe("the honeypot path", () => {
  it("raises the existing honeypot blocker when GeckoTerminal says so — on Solana too", () => {
    const score = scoreToken(input({ gecko: geckoInfo({ isHoneypot: true }) }), universe);
    expect(score.blockers).toContain("honeypot");
    expect(score.verdict).toBe("avoid");
  });

  it("does not gate on an unanswered honeypot check", () => {
    for (const isHoneypot of [null, false] as const) {
      expect(scoreToken(input({ gecko: geckoInfo({ isHoneypot }) }), universe).blockers).not.toContain("honeypot");
    }
  });

  it("never lets GeckoTerminal clear an authority gate", () => {
    const strict = { ...universe, requireMintRevoked: true, requireFreezeRevoked: true };
    const score = scoreToken(
      input({ jupiter: null, rugcheck: null, gecko: geckoInfo({ mintAuthority: "no", freezeAuthority: "no" }) }),
      strict,
    );
    expect(score.blockers).toContain("mint_authority_unknown");
    expect(score.blockers).toContain("freeze_authority_unknown");
  });
});

describe("facts GeckoTerminal fills in", () => {
  it("supplies holders and top-10 concentration when no other provider did", () => {
    const score = scoreToken(
      input({ jupiter: null, rugcheck: null, gecko: geckoInfo({ holderCount: 8_534, top10HolderPct: 25.05 }) }),
      universe,
    );
    expect(score.holderCount).toBe(8_534);
    // Which means a concentration gate is judged rather than blocked as unknown.
    const gated = scoreToken(
      input({ jupiter: null, rugcheck: null, gecko: geckoInfo({ top10HolderPct: 99.38 }) }),
      { ...universe, maxTop10HolderPct: 60 },
    );
    expect(gated.blockers).toContain("top10_holders_99pct");
    expect(gated.blockers).not.toContain("top10_holders_unknown");
  });

  it("yields to the chain's own provider when there is one", () => {
    const score = scoreToken(input({ gecko: geckoInfo({ holderCount: 1, top10HolderPct: 99 }) }), universe);
    expect(score.holderCount).toBe(900_000); // Jupiter's number, not Gecko's
  });
});
