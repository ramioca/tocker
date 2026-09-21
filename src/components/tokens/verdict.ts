/**
 * The score vocabulary. One file decides what a number means, what it is called
 * and what colour it wears, so a badge in the feed, a dial on a trade and a row
 * in the scoreboard can never disagree.
 *
 * Green and red are spoken for — they mean PnL and nothing else. Verdicts get
 * their own ramp: inert grey → amber → cyan → the product's violet, so "better"
 * reads as "closer to the accent" rather than "less red".
 */
import type { ScoreVerdict, ScoreComponents } from "@/server/types";

/** Lower bound of each band, per SPEC: avoid <40, watch 40-59, candidate 60-79, strong 80+. */
export const VERDICT_BANDS: Array<{ verdict: ScoreVerdict; min: number }> = [
  { verdict: "strong", min: 80 },
  { verdict: "candidate", min: 60 },
  { verdict: "watch", min: 40 },
  { verdict: "avoid", min: 0 },
];

/** The band a raw total falls into, ignoring blockers. */
export function verdictForScore(total: number): ScoreVerdict {
  for (const band of VERDICT_BANDS) {
    if (total >= band.min) return band.verdict;
  }
  return "avoid";
}

/**
 * A hard-gate failure outranks the number: SPEC says a non-empty `blockers`
 * always means "avoid", whatever the composite says.
 */
export function effectiveVerdict(total: number, blockers: readonly string[] = []): ScoreVerdict {
  return blockers.length > 0 ? "avoid" : verdictForScore(total);
}

export interface VerdictMeta {
  label: string;
  /** One line, plain English, for a legend or a tooltip. */
  meaning: string;
  /** Mid-lightness so the same value is legible on the near-black ground and on paper. */
  color: string;
  range: string;
}

export const VERDICT_META: Record<ScoreVerdict, VerdictMeta> = {
  avoid: {
    label: "Avoid",
    meaning: "Fails a hard gate or scores too low to be worth the spread.",
    color: "oklch(0.62 0.025 285)",
    range: "0–39",
  },
  watch: {
    label: "Watch",
    meaning: "Alive, but something is thin. Worth a second look, not a buy.",
    color: "oklch(0.72 0.145 75)",
    range: "40–59",
  },
  candidate: {
    label: "Candidate",
    meaning: "Clears every gate and ranks well. The agent may buy it.",
    color: "oklch(0.68 0.13 215)",
    range: "60–79",
  },
  strong: {
    label: "Strong",
    meaning: "Deep liquidity, real buyers, clean authorities. The best the sweep found.",
    color: "oklch(0.68 0.2 300)",
    range: "80–100",
  },
};

export function verdictColor(verdict: ScoreVerdict): string {
  return VERDICT_META[verdict].color;
}

/** The colour a bare number wears when nothing has blocked it yet. */
export function scoreColor(total: number): string {
  return verdictColor(verdictForScore(total));
}

/** Tint helpers — kept here so every surface tints by the same amounts. */
export function verdictTint(color: string, percent: number): string {
  return `color-mix(in oklab, ${color} ${percent}%, transparent)`;
}

// ---------------------------------------------------------------- components

export type ScoreComponentKey = keyof ScoreComponents;

export interface ComponentMeta {
  key: ScoreComponentKey;
  label: string;
  /**
   * Weight out of 100, per SPEC. The nullable components reweight the core five
   * rather than adding a slice; the paid ones show no weight at all, because whether
   * they are there is a spending decision rather than a property of the token.
   */
  weight: number | null;
  /** What the sub-score is actually reading. Shown on hover. */
  reads: string;
  /** Shown instead of `reads` when the component is null — i.e. nobody paid for it. */
  missingNote?: string;
}

export const SCORE_COMPONENTS: ComponentMeta[] = [
  {
    key: "safety",
    label: "Safety",
    weight: 30,
    reads:
      "Mint and freeze authorities, LP lock, honeypot and tax checks, owner powers, dev balance.",
  },
  {
    key: "liquidity",
    label: "Liquidity",
    weight: 20,
    reads: "Absolute USD depth, and depth measured against the size this agent trades.",
  },
  {
    key: "organic",
    label: "Organic",
    weight: 20,
    reads: "Organic buyers against total buys, buy/sell balance, holder growth — the wash filter.",
  },
  {
    key: "distribution",
    label: "Distribution",
    weight: 15,
    reads: "Holder count, top-10 share and dev share. How evenly the supply is held.",
  },
  {
    key: "momentum",
    label: "Momentum",
    weight: 15,
    reads: "1h / 6h / 24h price and volume trend, plus whether liquidity is growing or leaving.",
  },
  {
    key: "gecko",
    label: "GT Score",
    weight: 10,
    reads:
      "GeckoTerminal's own 0-100 rating of the token: pool depth, transaction quality, how much it knows about the token's creation, listed info and holder spread. Free, and it reweights the five above rather than adding a sixth slice.",
    missingNote: "GeckoTerminal has no rating for this token — usually because it is too new to have one.",
  },
  {
    key: "sentiment",
    label: "Sentiment",
    weight: null,
    reads:
      "Only present when the agent paid an x402 source for it. It reweights the other five rather than adding a sixth slice.",
    missingNote: "Not bought for this token — sentiment costs money, so it is optional.",
  },
  {
    key: "smartMoney",
    label: "Smart money",
    weight: null,
    reads:
      "Net flow from tracked smart-money wallets, measured against this token's own liquidity. Paid, and like sentiment it reweights the free components rather than adding to them.",
    missingNote: "Not bought for this token — a smart-money read costs money, so it is optional.",
  },
];

export const COMPONENT_BY_KEY: Record<ScoreComponentKey, ComponentMeta> = Object.fromEntries(
  SCORE_COMPONENTS.map((component) => [component.key, component]),
) as Record<ScoreComponentKey, ComponentMeta>;
