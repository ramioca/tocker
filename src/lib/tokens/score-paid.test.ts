/**
 * The paid half of the scorer: the `smartMoney` component and the `cannot_sell` gate.
 *
 * Both are additive and both are inert unless the caller hands the scorer a paid
 * reading, so most of what is asserted here is what happens when nobody paid —
 * nothing. `scoreToken` stays pure and synchronous, so none of this touches x402.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_AGENT_CONFIG } from "@/lib/agent/config";
import { isDeteriorationBlocker } from "@/lib/trading/exits";
import {
  explainBlocker,
  hardGates,
  scoreToken,
  toFacts,
  SENTIMENT_WEIGHT,
  SMART_MONEY_WEIGHT,
  type Universe,
} from "./score";
import type { JupiterStats, JupiterToken, ScoreInput } from "./types";

const NOW = Date.parse("2026-09-12T09:30:00.000Z");
const HOUR = 3_600_000;
const MINT = "Pln1111111111111111111111111111111111111111";

function universe(overrides: Partial<Universe> = {}): Universe {
  return { ...DEFAULT_AGENT_CONFIG.universe, ...overrides };
}

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

function jupiter(overrides: Partial<JupiterToken> = {}): JupiterToken {
  return {
    id: MINT,
    name: "Plankton",
    symbol: "PLNK",
    icon: null,
    decimals: 6,
    dev: "Dev111",
    circSupply: 1_000_000_000,
    totalSupply: 1_000_000_000,
    tokenProgram: null,
    holderCount: 1_284,
    fdv: 400_000,
    mcap: 400_000,
    usdPrice: 0.00041,
    liquidity: 200_000,
    stats5m: null,
    stats1h: null,
    stats6h: null,
    stats24h: stats({
      priceChange: 6,
      buyVolume: 120_000,
      sellVolume: 96_000,
      numBuys: 900,
      numSells: 740,
      numTraders: 410,
      numOrganicBuyers: 180,
      buyOrganicVolume: 30_000,
    }),
    firstPoolCreatedAtMs: NOW - 40 * HOUR,
    createdAtMs: NOW - 40 * HOUR,
    audit: {
      mintAuthorityDisabled: true,
      freezeAuthorityDisabled: true,
      topHoldersPercentage: 24,
      devBalancePercentage: 1.5,
      devMints: 1,
      isSus: false,
    },
    organicScore: 68,
    organicScoreLabel: "medium",
    isVerified: false,
    tags: [],
    ...overrides,
  };
}

function input(overrides: Partial<ScoreInput> = {}): ScoreInput {
  return {
    chain: "solana",
    address: MINT,
    symbol: "PLNK",
    jupiter: jupiter(),
    rugcheck: { mint: MINT, risks: [], score: 30, scoreNormalised: 10, lpLockedPct: 70 },
    maxTradeUsd: 100,
    now: NOW,
    ...overrides,
  };
}

// ---------- the component ----------

describe("smartMoney", () => {
  it("is null when nobody paid for it, and the free five carry the whole score", () => {
    const score = scoreToken(input(), universe());
    expect(score.components.smartMoney).toBeNull();
    expect(score.sources).not.toContain("nansen-smart-money");
  });

  it("is null when the source answered without a netflow figure", () => {
    const score = scoreToken(
      input({ smartMoney: { netflowUsd: null, traderCount: null, source: "nansen-smart-money" } }),
      universe(),
    );
    // `null`, not 50: "nobody tracked touched this" is not "flow is balanced".
    expect(score.components.smartMoney).toBeNull();
    expect(score.sources).toContain("nansen-smart-money");
  });

  it("scores accumulation high and distribution low against the same pool", () => {
    const pool = 200_000;
    const bullish = scoreToken(
      input({
        jupiter: jupiter({ liquidity: pool }),
        smartMoney: { netflowUsd: 80_000, traderCount: 37, source: "nansen-smart-money" },
      }),
      universe(),
    );
    const bearish = scoreToken(
      input({
        jupiter: jupiter({ liquidity: pool }),
        smartMoney: { netflowUsd: -80_000, traderCount: 19, source: "nansen-smart-money" },
      }),
      universe(),
    );

    expect(bullish.components.smartMoney ?? 0).toBeGreaterThan(85);
    expect(bearish.components.smartMoney ?? 100).toBeLessThan(15);
    expect(bullish.total).toBeGreaterThan(bearish.total);
  });

  it("weighs the same dollars against the pool they have to move", () => {
    const flow = 80_000;
    const thin = scoreToken(
      input({
        jupiter: jupiter({ liquidity: 200_000 }),
        smartMoney: { netflowUsd: flow, traderCount: 12, source: "nansen-smart-money" },
      }),
      universe(),
    );
    const deep = scoreToken(
      input({
        jupiter: jupiter({ liquidity: 40_000_000 }),
        smartMoney: { netflowUsd: flow, traderCount: 12, source: "nansen-smart-money" },
      }),
      universe(),
    );
    // $80k is an avalanche in a $200k pool and a rounding error in a $40M one.
    expect(thin.components.smartMoney ?? 0).toBeGreaterThan((deep.components.smartMoney ?? 0) + 25);
  });

  it("reweights the free components exactly the way sentiment does", () => {
    const free = scoreToken(input(), universe());
    const withSmart = scoreToken(
      input({ smartMoney: { netflowUsd: 60_000, traderCount: 20, source: "nansen-smart-money" } }),
      universe(),
    );

    const freeSum =
      free.components.safety * 30 +
      free.components.liquidity * 20 +
      free.components.organic * 20 +
      free.components.distribution * 15 +
      free.components.momentum * 15;
    const expected =
      (freeSum * ((100 - SMART_MONEY_WEIGHT) / 100)) / 100 +
      (withSmart.components.smartMoney ?? 0) * (SMART_MONEY_WEIGHT / 100);

    expect(withSmart.total).toBeCloseTo(Math.round(expected * 10) / 10, 1);
  });

  it("keeps the total on the 0-100 scale when both paid components are present", () => {
    const both = scoreToken(
      input({
        sentiment: { sentiment: 1, velocity: 1, source: "sentimentalpha" },
        smartMoney: { netflowUsd: 5_000_000, traderCount: 60, source: "nansen-smart-money" },
      }),
      universe(),
    );
    expect(SENTIMENT_WEIGHT + SMART_MONEY_WEIGHT).toBe(25);
    expect(both.components.sentiment).toBe(100);
    expect(both.total).toBeLessThanOrEqual(100);
    expect(both.total).toBeGreaterThan(scoreToken(input(), universe()).total);
  });
});

// ---------- the gate ----------

describe("cannot_sell", () => {
  it("does not exist unless a sell check was paid for", () => {
    const facts = toFacts(input());
    expect(facts.sellable).toBeNull();
    expect(hardGates(facts, universe())).not.toContain("cannot_sell");
  });

  it("stays clear when the check ran but did not conclude", () => {
    // Plexa's "unknown": nothing fired, but the liquidity sweep did not finish. An
    // unfinished check is not a failed one and must never block a trade.
    const facts = toFacts(input({ sellCheck: { sellable: null, verdict: "unknown", source: "plexa-pretrade" } }));
    expect(hardGates(facts, universe())).not.toContain("cannot_sell");
  });

  it("stays clear when the check proved the token IS sellable", () => {
    const facts = toFacts(input({ sellCheck: { sellable: true, verdict: "clear", source: "plexa-pretrade" } }));
    expect(hardGates(facts, universe())).not.toContain("cannot_sell");
  });

  it("blocks, and forces avoid, when a check proved the exit is gone", () => {
    const score = scoreToken(
      input({ sellCheck: { sellable: false, verdict: "avoid", source: "plexa-pretrade" } }),
      universe(),
    );
    expect(score.blockers).toContain("cannot_sell");
    expect(score.verdict).toBe("avoid");
    expect(score.sources).toContain("plexa-pretrade");
  });

  it("cannot be outscored by a token that is otherwise excellent", () => {
    const score = scoreToken(
      input({
        sentiment: { sentiment: 1, velocity: 1, source: "sentimentalpha" },
        smartMoney: { netflowUsd: 2_000_000, traderCount: 50, source: "nansen-smart-money" },
        sellCheck: { sellable: false, verdict: "avoid", source: "plexa-pretrade" },
      }),
      universe(),
    );
    expect(score.total).toBeGreaterThan(60);
    expect(score.verdict).toBe("avoid");
  });

  it("reads as prose, not as a machine string", () => {
    expect(explainBlocker("cannot_sell")).toContain("cannot be exited");
  });

  it("is a deterioration blocker, so the exit engine sells a holding that develops it", () => {
    // It describes the token getting worse after entry — the exit venue drained,
    // trading switched off — not the operator's entry appetite.
    expect(isDeteriorationBlocker("cannot_sell")).toBe(true);
    expect(isDeteriorationBlocker("honeypot")).toBe(true);
    // Guard the other half of that function's contract while we are here.
    expect(isDeteriorationBlocker("age_above_max")).toBe(false);
    expect(isDeteriorationBlocker("top10_holders_72pct")).toBe(false);
    expect(isDeteriorationBlocker("mint_authority_unknown")).toBe(false);
  });
});
