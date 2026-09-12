/**
 * The composite token score. **Pure, synchronous, no network** — every provider
 * payload arrives already parsed in {@link ScoreInput}, which is what makes the whole
 * model unit-testable and what keeps scoring free.
 *
 * ## Weights (SPEC → "Token universe & scoring")
 *
 * | Component      | Weight | Reads                                                        |
 * |----------------|--------|--------------------------------------------------------------|
 * | `safety`       | 30     | mint/freeze authority, RugCheck risks, LP lock, honeypot/tax, owner powers, dev balance |
 * | `liquidity`    | 20     | absolute USD depth, and depth relative to the agent's `maxTradeUsd` |
 * | `organic`      | 20     | organic buyers vs total buys, buy/sell balance, trader diversity |
 * | `distribution` | 15     | holder count, top-10 share, dev share                        |
 * | `momentum`     | 15     | 1h/6h/24h price trend, volume trend, liquidity trend          |
 * | `sentiment`    | 15*    | x402 sentiment, only when the agent chose to pay              |
 *
 * \*`sentiment` *reweights* the rest rather than adding to them: when present the
 * five free components are scaled by 0.85 so the total stays 0-100.
 *
 * ## Verdict bands
 * `avoid` < 40 · `watch` 40-59 · `candidate` 60-79 · `strong` 80+.
 *
 * ## Hard gates
 * Run before scoring and cannot be outscored. Any failure appends a stable,
 * machine-readable blocker string and forces `verdict: "avoid"`, whatever the total.
 * A gate the operator configured but that we have **no data for** also blocks, with
 * an `_unknown` suffix: refusing to buy blind is the whole point of the gate.
 */
import type { AgentConfig } from "@/db/schema";
import type { ScoreComponents, ScoreVerdict, TokenScore } from "@/server/types";
import type { JupiterStats, ScoreInput, TokenFacts } from "./types";

export type Universe = AgentConfig["universe"];

/** Component weights before any sentiment reweighting. They sum to 100. */
export const WEIGHTS = {
  safety: 30,
  liquidity: 20,
  organic: 20,
  distribution: 15,
  momentum: 15,
} as const;

/** Weight sentiment takes when the agent paid for it; the rest are scaled by 0.85. */
export const SENTIMENT_WEIGHT = 15;

export const VERDICT_BANDS = { watch: 40, candidate: 60, strong: 80 } as const;

/**
 * Below this, the token cannot reach `strong` however well it scores: we simply do
 * not know enough about it. Expressed as the share of expected provider inputs seen.
 */
export const LOW_CONFIDENCE = 0.6;

/** A {@link TokenScore} plus how much of the expected provider data actually arrived. */
export interface ScoredToken extends TokenScore {
  /** 0-1. 1 = every provider for this chain answered with the fields we wanted. */
  confidence: number;
}

// ---------- small maths helpers ----------

function clamp(n: number, lo = 0, hi = 100): number {
  if (!Number.isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, n));
}

function round(n: number, places = 1): number {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

/** Maps `value` onto 0-100 between `lo` and `hi` on a log scale. */
function logScale(value: number | null, lo: number, hi: number): number | null {
  if (value === null || value <= 0) return value === null ? null : 0;
  const l = Math.log10(Math.max(lo, 1e-9));
  const h = Math.log10(Math.max(hi, lo * 10));
  return clamp(((Math.log10(value) - l) / (h - l)) * 100);
}

/** A percent change centred on 50: 0% → 50, +40% → 90, -40% → 10. */
function centred(pct: number | null, span = 40): number | null {
  if (pct === null) return null;
  return clamp(50 + (clamp(pct, -span, span) / span) * 50);
}

/** Weighted mean of the terms that are actually known. `null` when none are. */
function blend(terms: ReadonlyArray<readonly [number | null, number]>): number | null {
  let sum = 0;
  let weight = 0;
  for (const [value, w] of terms) {
    if (value === null) continue;
    sum += value * w;
    weight += w;
  }
  return weight === 0 ? null : sum / weight;
}

function sameAddress(a: string, b: string): boolean {
  return a === b || a.toLowerCase() === b.toLowerCase();
}

/** Picks the most populated stats window, preferring longer ones. */
function bestStats(input: ScoreInput): JupiterStats | null {
  const jup = input.jupiter;
  if (!jup) return null;
  for (const stats of [jup.stats24h, jup.stats6h, jup.stats1h, jup.stats5m]) {
    if (stats && (stats.numBuys !== null || stats.buyVolume !== null)) return stats;
  }
  return null;
}

// ---------- fact normalisation ----------

/**
 * Collapses the raw provider payloads into one chain-agnostic view. Exported because
 * discovery pre-ranks on the same numbers and the score cache stores them.
 */
export function toFacts(input: ScoreInput): TokenFacts {
  const now = input.now ?? Date.now();
  const jup = input.jupiter ?? null;
  const dex = input.dexscreener ?? null;
  const gp = input.goplus ?? null;

  const bornMs = jup?.firstPoolCreatedAtMs ?? jup?.createdAtMs ?? dex?.pairCreatedAtMs ?? null;
  const ageHours = bornMs === null ? null : Math.max(0, (now - bornMs) / 3_600_000);

  const stats1h = jup?.stats1h ?? null;
  const stats6h = jup?.stats6h ?? null;
  const stats24h = jup?.stats24h ?? null;

  return {
    chain: input.chain,
    address: input.address,
    symbol: jup?.symbol ?? dex?.symbol ?? gp?.symbol ?? input.symbol,
    name: input.name ?? jup?.name ?? dex?.name ?? gp?.name ?? null,
    decimals: jup?.decimals ?? (input.chain === "base" ? 18 : null),
    logoUrl: jup?.icon ?? dex?.imageUrl ?? null,
    priceUsd: jup?.usdPrice ?? dex?.priceUsd ?? null,
    liquidityUsd: jup?.liquidity ?? dex?.liquidityUsd ?? null,
    volume24hUsd:
      dex?.volume24hUsd ??
      (stats24h && (stats24h.buyVolume !== null || stats24h.sellVolume !== null)
        ? (stats24h.buyVolume ?? 0) + (stats24h.sellVolume ?? 0)
        : null),
    marketCapUsd: jup?.mcap ?? dex?.marketCap ?? jup?.fdv ?? dex?.fdv ?? null,
    holderCount: jup?.holderCount ?? gp?.holderCount ?? null,
    ageHours,
    priceChange1hPct: stats1h?.priceChange ?? dex?.priceChange1hPct ?? null,
    priceChange6hPct: stats6h?.priceChange ?? dex?.priceChange6hPct ?? null,
    priceChange24hPct: stats24h?.priceChange ?? dex?.priceChange24hPct ?? null,
    // Solana authorities come from Jupiter's audit; the EVM equivalent of a live mint
    // authority is GoPlus's `is_mintable`, and EVM has no freeze authority at all.
    mintAuthorityDisabled:
      jup?.audit?.mintAuthorityDisabled ?? (gp?.isMintable === null || gp?.isMintable === undefined ? null : !gp.isMintable),
    freezeAuthorityDisabled:
      jup?.audit?.freezeAuthorityDisabled ??
      (gp === null ? null : gp.transferPausable === null ? null : !gp.transferPausable),
    top10HolderPct: jup?.audit?.topHoldersPercentage ?? gp?.top10HolderPct ?? null,
    devBalancePct: jup?.audit?.devBalancePercentage ?? gp?.creatorPercent ?? gp?.ownerPercent ?? null,
    buyTaxPct: gp?.buyTaxPct ?? (input.chain === "solana" ? 0 : null),
    sellTaxPct: gp?.sellTaxPct ?? (input.chain === "solana" ? 0 : null),
    // Solana has no honeypot equivalent (no transfer hooks in the SPL path we route
    // through), so this stays null there and the freeze authority carries the weight.
    isHoneypot: gp?.isHoneypot ?? null,
  };
}

// ---------- hard gates ----------

/**
 * Every hard gate, in the order the UI should read them. Returns stable blocker
 * strings — `"mint_authority_active"`, `"liquidity_below_floor"`,
 * `"top10_holders_72pct"` — never prose.
 */
export function hardGates(facts: TokenFacts, universe: Universe): string[] {
  const blockers: string[] = [];

  if (universe.blocklist.some((b) => b.chain === facts.chain && sameAddress(b.address, facts.address))) {
    blockers.push("blocklisted");
  }

  if (universe.requireMintRevoked) {
    if (facts.mintAuthorityDisabled === false) blockers.push("mint_authority_active");
    else if (facts.mintAuthorityDisabled === null) blockers.push("mint_authority_unknown");
  }

  if (universe.requireFreezeRevoked) {
    if (facts.freezeAuthorityDisabled === false) blockers.push("freeze_authority_active");
    else if (facts.freezeAuthorityDisabled === null) blockers.push("freeze_authority_unknown");
  }

  if (facts.isHoneypot === true) blockers.push("honeypot");

  if (universe.maxBuyTaxPct < 100) {
    const { buyTaxPct, sellTaxPct } = facts;
    if (buyTaxPct !== null && buyTaxPct > universe.maxBuyTaxPct) blockers.push(`buy_tax_${round(buyTaxPct)}pct`);
    if (sellTaxPct !== null && sellTaxPct > universe.maxBuyTaxPct) blockers.push(`sell_tax_${round(sellTaxPct)}pct`);
  }

  if (universe.minLiquidityUsd > 0) {
    if (facts.liquidityUsd === null) blockers.push("liquidity_unknown");
    else if (facts.liquidityUsd < universe.minLiquidityUsd) blockers.push("liquidity_below_floor");
  }

  if (universe.minHolderCount > 0) {
    if (facts.holderCount === null) blockers.push("holder_count_unknown");
    else if (facts.holderCount < universe.minHolderCount) blockers.push("holders_below_floor");
  }

  const ageGated = universe.minAgeMinutes > 0 || universe.maxAgeHours !== null;
  if (ageGated) {
    if (facts.ageHours === null) blockers.push("age_unknown");
    else {
      if (facts.ageHours * 60 < universe.minAgeMinutes) blockers.push("age_below_min");
      if (universe.maxAgeHours !== null && facts.ageHours > universe.maxAgeHours) blockers.push("age_above_max");
    }
  }

  if (universe.maxTop10HolderPct < 100) {
    if (facts.top10HolderPct === null) blockers.push("top10_holders_unknown");
    else if (facts.top10HolderPct > universe.maxTop10HolderPct) {
      blockers.push(`top10_holders_${Math.round(facts.top10HolderPct)}pct`);
    }
  }

  return blockers;
}

/** Human-readable rendering of a blocker string, for prompts and the UI. */
export function explainBlocker(blocker: string): string {
  const top10 = /^top10_holders_(\d+)pct$/.exec(blocker);
  if (top10) return `top 10 holders control ${top10[1]}% of supply`;
  const buyTax = /^buy_tax_([\d.]+)pct$/.exec(blocker);
  if (buyTax) return `buy tax is ${buyTax[1]}%`;
  const sellTax = /^sell_tax_([\d.]+)pct$/.exec(blocker);
  if (sellTax) return `sell tax is ${sellTax[1]}%`;
  const known: Record<string, string> = {
    blocklisted: "the token is on this agent's blocklist",
    mint_authority_active: "the mint authority is still live — supply can be inflated",
    mint_authority_unknown: "no provider could confirm the mint authority is revoked",
    freeze_authority_active: "the freeze authority is still live — balances can be frozen",
    freeze_authority_unknown: "no provider could confirm the freeze authority is revoked",
    honeypot: "the contract is a honeypot — buys succeed, sells do not",
    liquidity_below_floor: "liquidity is under the agent's floor",
    liquidity_unknown: "no provider reported liquidity",
    holders_below_floor: "there are fewer holders than the agent's floor",
    holder_count_unknown: "no provider reported a holder count",
    age_below_min: "the token is younger than the agent's minimum age",
    age_above_max: "the token is older than the agent's maximum age",
    age_unknown: "the token's age could not be established",
    top10_holders_unknown: "no provider reported top-10 holder concentration",
  };
  return known[blocker] ?? blocker.replace(/_/g, " ");
}

// ---------- components ----------

function scoreSafety(input: ScoreInput, facts: TokenFacts, warnings: string[]): number | null {
  if (input.chain === "solana") {
    const rug = input.rugcheck ?? null;
    const audit = input.jupiter?.audit ?? null;
    if (rug === null && audit === null) return null;

    // RugCheck's normalised score is 0-100 with LOWER being safer, so invert it.
    let score = rug?.scoreNormalised === null || rug?.scoreNormalised === undefined ? 60 : clamp(100 - rug.scoreNormalised);

    if (facts.mintAuthorityDisabled === false) score -= 35;
    if (facts.freezeAuthorityDisabled === false) score -= 25;
    if (audit?.isSus === true) {
      score -= 20;
      warnings.push("jupiter_flags_suspicious");
    }

    const danger = rug?.risks.filter((r) => r.level === "danger").length ?? 0;
    const warn = rug?.risks.filter((r) => r.level === "warn").length ?? 0;
    score -= Math.min(45, danger * 15);
    score -= Math.min(15, warn * 5);
    if (danger > 0) warnings.push(`rugcheck_${danger}_danger_risks`);

    const lp = rug?.lpLockedPct ?? null;
    if (lp !== null) {
      if (lp < 10) {
        score -= 15;
        warnings.push("lp_barely_locked");
      } else if (lp >= 50) {
        score += 5;
      }
    }

    const dev = facts.devBalancePct;
    if (dev !== null && dev > 25) {
      score -= 20;
      warnings.push("dev_holds_over_25pct");
    } else if (dev !== null && dev > 10) {
      score -= 10;
    }

    if (input.jupiter?.isVerified === true) score += 5;
    return clamp(score);
  }

  // Base
  const gp = input.goplus ?? null;
  if (gp === null) {
    warnings.push("no_contract_security_data");
    return null;
  }
  if (gp.isHoneypot === true) return 0;

  let score = 75;
  if (gp.isOpenSource === false) {
    score -= 20;
    warnings.push("contract_not_verified");
  }
  if (gp.isMintable === true) {
    score -= 20;
    warnings.push("contract_is_mintable");
  }
  if (gp.canTakeBackOwnership === true) {
    score -= 25;
    warnings.push("ownership_can_be_reclaimed");
  }
  if (gp.hiddenOwner === true) {
    score -= 25;
    warnings.push("hidden_owner");
  }
  if (gp.transferPausable === true) {
    score -= 15;
    warnings.push("transfers_pausable");
  }
  if (gp.slippageModifiable === true) {
    score -= 15;
    warnings.push("tax_can_be_changed");
  }
  if (gp.cannotSellAll === true) {
    score -= 20;
    warnings.push("cannot_sell_entire_balance");
  }
  if (gp.isProxy === true) score -= 5;
  if (gp.tradingCooldown === true) score -= 5;
  if (gp.selfdestruct === true) score -= 25;

  const tax = Math.max(gp.buyTaxPct ?? 0, gp.sellTaxPct ?? 0);
  if (tax > 0) score -= Math.min(30, tax * 2);

  const lp = gp.lpLockedPct;
  if (lp !== null) {
    if (lp < 10) {
      score -= 15;
      warnings.push("lp_barely_locked");
    } else if (lp >= 50) {
      score += 5;
    }
  }
  if (gp.ownerPercent !== null && gp.ownerPercent > 5) score -= 10;
  if (gp.isOpenSource === true && gp.ownerPercent === 0) score += 5;

  return clamp(score);
}

function scoreLiquidity(facts: TokenFacts, maxTradeUsd: number): number | null {
  const depth = facts.liquidityUsd;
  if (depth === null) return null;
  // $1k → 0, ~$32k → 50, $1M → 100.
  const absolute = logScale(depth, 1_000, 1_000_000);
  // Depth relative to the clip the agent actually trades: 5x → 0, 200x → 100.
  const size = maxTradeUsd > 0 ? maxTradeUsd : 100;
  const relative = logScale(depth / size, 5, 200);
  return blend([
    [absolute, 0.6],
    [relative, 0.4],
  ]);
}

/**
 * Real demand versus manufactured volume.
 *
 * Jupiter's `organicScore` is the strongest single signal on Solana, backed by the
 * organic share of buy volume and the buy/sell balance. Base has no organic data at
 * all, so we fall back to transaction-count and turnover proxies and say so.
 */
function scoreOrganic(input: ScoreInput, warnings: string[]): number | null {
  if (input.chain === "solana") {
    const stats = bestStats(input);
    const organicScore = input.jupiter?.organicScore ?? null;
    if (stats === null && organicScore === null) return null;

    const buyVolume = stats?.buyVolume ?? null;
    const sellVolume = stats?.sellVolume ?? null;
    const organicVolume = stats?.buyOrganicVolume ?? null;
    const organicShare =
      buyVolume !== null && buyVolume > 0 && organicVolume !== null ? clamp((organicVolume / buyVolume) / 0.1 * 100) : null;

    const numBuys = stats?.numBuys ?? null;
    const organicBuyers = stats?.numOrganicBuyers ?? null;
    // Volume with essentially no organic buyers behind it is the wash-trading tell.
    if (numBuys !== null && numBuys >= 50 && organicBuyers !== null && organicBuyers <= 1) {
      warnings.push("volume_without_organic_buyers");
    }

    const total = (buyVolume ?? 0) + (sellVolume ?? 0);
    const buyShare = total > 0 ? (buyVolume ?? 0) / total : null;
    // Healthiest around 55% buys; a 100%-one-sided book is either a bot or a rug.
    const balance = buyShare === null ? null : clamp(100 - Math.abs(buyShare - 0.55) * 220);

    const traders = stats?.numTraders ?? null;
    const diversity = traders === null ? null : logScale(traders, 5, 500);

    if (organicScore !== null) {
      return blend([
        [clamp(organicScore), 0.55],
        [organicShare, 0.2],
        [balance, 0.15],
        [diversity, 0.1],
      ]);
    }
    warnings.push("no_organic_score");
    return blend([
      [organicShare, 0.4],
      [balance, 0.3],
      [diversity, 0.3],
    ]);
  }

  const dex = input.dexscreener ?? null;
  if (dex === null) return null;
  warnings.push("organic_proxy_only");

  const t24 = dex.txns24h;
  const buys = t24?.buys ?? null;
  const sells = t24?.sells ?? null;
  const txCount = buys === null && sells === null ? null : (buys ?? 0) + (sells ?? 0);
  const activity = logScale(txCount, 10, 2_000);
  const totalTx = (buys ?? 0) + (sells ?? 0);
  const buyShare = totalTx > 0 ? (buys ?? 0) / totalTx : null;
  const balance = buyShare === null ? null : clamp(100 - Math.abs(buyShare - 0.55) * 220);

  // Turnover: volume/liquidity. Around 1x a day is healthy; 20x+ is manufactured.
  const turnover =
    dex.volume24hUsd !== null && dex.liquidityUsd !== null && dex.liquidityUsd > 0
      ? dex.volume24hUsd / dex.liquidityUsd
      : null;
  let turnoverScore: number | null = null;
  if (turnover !== null) {
    turnoverScore = turnover <= 0 ? 0 : turnover <= 2 ? clamp((turnover / 2) * 100) : clamp(100 - (turnover - 2) * 5);
    if (turnover > 15) warnings.push("turnover_suggests_wash_trading");
  }

  return blend([
    [activity, 0.4],
    [balance, 0.3],
    [turnoverScore, 0.3],
  ]);
}

function scoreDistribution(facts: TokenFacts, warnings: string[]): number | null {
  // 10 holders → 0, 10k → 100.
  const holders = logScale(facts.holderCount, 10, 10_000);
  // 20% in the top 10 → 100, 90% → 0.
  const top10 = facts.top10HolderPct === null ? null : clamp(((90 - facts.top10HolderPct) / 70) * 100);
  const dev = facts.devBalancePct === null ? null : clamp(100 - facts.devBalancePct * 4);

  if (facts.top10HolderPct !== null && facts.top10HolderPct > 50) warnings.push("top10_holders_concentrated");

  return blend([
    [holders, 0.35],
    [top10, 0.45],
    [dev, 0.2],
  ]);
}

function scoreMomentum(input: ScoreInput, facts: TokenFacts, warnings: string[]): number | null {
  const priceTrend = blend([
    [centred(facts.priceChange1hPct), 0.3],
    [centred(facts.priceChange6hPct), 0.35],
    [centred(facts.priceChange24hPct), 0.35],
  ]);

  const jup = input.jupiter ?? null;
  const dex = input.dexscreener ?? null;
  const volumeTrend =
    jup?.stats24h?.volumeChange !== null && jup?.stats24h?.volumeChange !== undefined
      ? centred(jup.stats24h.volumeChange, 100)
      : dex?.volume24hUsd !== null && dex?.volume24hUsd !== undefined && dex.volume6hUsd !== null
        ? // 6h running at a quarter of the daily pace is flat; faster is accelerating.
          centred(dex.volume24hUsd > 0 ? ((dex.volume6hUsd * 4) / dex.volume24hUsd - 1) * 100 : null, 100)
        : null;

  const liquidityTrend =
    jup?.stats24h?.liquidityChange !== null && jup?.stats24h?.liquidityChange !== undefined
      ? centred(jup.stats24h.liquidityChange, 50)
      : null;

  const holderTrend =
    jup?.stats24h?.holderChange !== null && jup?.stats24h?.holderChange !== undefined
      ? centred(jup.stats24h.holderChange, 20)
      : null;

  const base = blend([
    [priceTrend, 0.5],
    [volumeTrend, 0.2],
    [liquidityTrend, 0.2],
    [holderTrend, 0.1],
  ]);
  if (base === null) return null;

  // Chasing a vertical candle is how agents buy tops; damp it and say so.
  const hour = facts.priceChange1hPct;
  if (hour !== null && hour > 50) {
    warnings.push("parabolic_1h_move");
    return clamp(base * 0.85);
  }
  if (facts.priceChange24hPct !== null && facts.priceChange24hPct < -40) warnings.push("down_over_40pct_24h");
  return clamp(base);
}

function scoreSentiment(input: ScoreInput): number | null {
  const s = input.sentiment ?? null;
  if (s === null) return null;
  const sentiment = s.sentiment === null ? null : clamp(((s.sentiment + 1) / 2) * 100);
  const velocity = s.velocity === null ? null : clamp(((s.velocity + 1) / 2) * 100);
  return blend([
    [sentiment, 0.7],
    [velocity, 0.3],
  ]);
}

// ---------- confidence ----------

/**
 * How much of the data we *expected* for this chain actually arrived. Partial data
 * never throws and never silently scores as if it were complete — it lowers this
 * number, adds a `low_confidence` warning, and caps the verdict at `candidate`.
 */
function confidenceOf(input: ScoreInput, facts: TokenFacts): number {
  const checks: boolean[] =
    input.chain === "solana"
      ? [
          input.jupiter !== null && input.jupiter !== undefined,
          bestStats(input) !== null,
          input.jupiter?.audit !== null && input.jupiter?.audit !== undefined,
          input.rugcheck !== null && input.rugcheck !== undefined,
          facts.liquidityUsd !== null,
          facts.holderCount !== null,
        ]
      : [
          input.dexscreener !== null && input.dexscreener !== undefined,
          input.dexscreener?.txns24h != null,
          input.goplus !== null && input.goplus !== undefined,
          facts.liquidityUsd !== null,
          facts.holderCount !== null,
          facts.top10HolderPct !== null,
        ];
  const seen = checks.filter(Boolean).length;
  return Math.round((seen / checks.length) * 100) / 100;
}

// ---------- the scorer ----------

export function verdictFor(total: number, blockers: readonly string[]): ScoreVerdict {
  if (blockers.length > 0) return "avoid";
  if (total >= VERDICT_BANDS.strong) return "strong";
  if (total >= VERDICT_BANDS.candidate) return "candidate";
  if (total >= VERDICT_BANDS.watch) return "watch";
  return "avoid";
}

/**
 * Scores one token against one agent's universe rules.
 *
 * Pure and synchronous: give it the same input twice (with `now` pinned) and it
 * returns the same score. Nothing here touches the network, the database or the
 * clock unless `input.now` is omitted.
 */
export function scoreToken(input: ScoreInput, universe: Universe): ScoredToken {
  const warnings: string[] = [];
  const facts = toFacts(input);
  const blockers = hardGates(facts, universe);

  const safety = scoreSafety(input, facts, warnings);
  const liquidity = scoreLiquidity(facts, input.maxTradeUsd ?? 0);
  const organic = scoreOrganic(input, warnings);
  const distribution = scoreDistribution(facts, warnings);
  const momentum = scoreMomentum(input, facts, warnings);
  const sentiment = scoreSentiment(input);

  // A component we could not compute scores 0 rather than being dropped: absent
  // safety data is not neutral, it is a reason not to size into something.
  const components: ScoreComponents = {
    safety: round(safety ?? 0),
    liquidity: round(liquidity ?? 0),
    organic: round(organic ?? 0),
    distribution: round(distribution ?? 0),
    momentum: round(momentum ?? 0),
    sentiment: sentiment === null ? null : round(sentiment),
  };

  const freeScale = sentiment === null ? 1 : (100 - SENTIMENT_WEIGHT) / 100;
  let total =
    (components.safety * WEIGHTS.safety +
      components.liquidity * WEIGHTS.liquidity +
      components.organic * WEIGHTS.organic +
      components.distribution * WEIGHTS.distribution +
      components.momentum * WEIGHTS.momentum) *
      (freeScale / 100) +
    (sentiment === null ? 0 : (components.sentiment ?? 0) * (SENTIMENT_WEIGHT / 100));

  const confidence = confidenceOf(input, facts);
  if (confidence < LOW_CONFIDENCE) {
    warnings.push("low_confidence");
    // Never let a token we barely know anything about read as `strong`.
    total = Math.min(total, VERDICT_BANDS.strong - 1);
  }
  if (safety === null) warnings.push("safety_unscored");
  if (input.chain === "solana" && input.rugcheck === null) warnings.push("rugcheck_unavailable");

  total = round(clamp(total), 1);

  return {
    tokenId: `${input.chain}:${input.address}`,
    chain: input.chain,
    address: input.address,
    symbol: facts.symbol,
    name: facts.name,
    total,
    verdict: verdictFor(total, blockers),
    components,
    blockers,
    warnings: Array.from(new Set(warnings)),
    priceUsd: facts.priceUsd,
    liquidityUsd: facts.liquidityUsd,
    volume24hUsd: facts.volume24hUsd,
    marketCapUsd: facts.marketCapUsd,
    holderCount: facts.holderCount,
    ageHours: facts.ageHours === null ? null : round(facts.ageHours, 2),
    priceChange24hPct: facts.priceChange24hPct === null ? null : round(facts.priceChange24hPct, 2),
    sources: sourcesOf(input),
    scoredAt: new Date(input.now ?? Date.now()).toISOString(),
    confidence,
  };
}

function sourcesOf(input: ScoreInput): string[] {
  const sources: string[] = [];
  if (input.jupiter) sources.push("jupiter");
  if (input.rugcheck) sources.push("rugcheck");
  if (input.dexscreener) sources.push("dexscreener");
  if (input.goplus) sources.push("goplus");
  if (input.sentiment) sources.push(input.sentiment.source);
  return sources;
}

/** One-line rendering for the model's context and the run transcript. */
export function renderScore(score: TokenScore): string {
  const parts = [
    `${score.symbol} [${score.chain}] score ${score.total.toFixed(1)}/100 — ${score.verdict}`,
    `safety ${score.components.safety} · liquidity ${score.components.liquidity} · organic ${score.components.organic} · distribution ${score.components.distribution} · momentum ${score.components.momentum}${
      score.components.sentiment === null ? "" : ` · sentiment ${score.components.sentiment}`
    }`,
  ];
  if (score.blockers.length > 0) {
    parts.push(`BLOCKED: ${score.blockers.map((b) => `${b} (${explainBlocker(b)})`).join("; ")}`);
  }
  if (score.warnings.length > 0) parts.push(`warnings: ${score.warnings.join(", ")}`);
  return parts.join("\n");
}
