/**
 * Which paid signals a `score_token` call buys on its own (W7).
 *
 * The paid add-ons used to be the model's call, and the model's call was almost always
 * "no": a whole tick of scoring, three candidates above the floor, $0.00 of data spent,
 * and a decision made on free components alone. The operator pays for those sources so
 * they get used. So: every token the agent scores is enriched automatically, in a fixed
 * order, until the run's data budget is spent — and the model reads the result rather
 * than deciding whether to ask for it. Explicit flags on the call still win.
 *
 * The one exception is a token the free data has *confirmed* unbuyable (a live mint
 * authority, a honeypot, below the liquidity floor): no paid read changes that. A
 * blocker that merely says `_unknown` is the opposite case — it is exactly what the
 * Deepnets read resolves — so it never blocks the purchase. The operator's instruction
 * (2026-09-22): when paid endpoints are configured, use them; the free pass is a
 * pre-read, not a gate.
 *
 * Pure, so the order and the thresholds are testable without a run.
 */
import type { Chain } from "@/server/types";

/** Sources whose `signals.sentiment` feeds the `deep` add-on. Mirrors `@/lib/tokens`. */
export const SENTIMENT_SOURCES: readonly string[] = ["x-search", "sentimentalpha"];
export const SMART_MONEY_SOURCE = "nansen-smart-money";
export const SELL_CHECK_SOURCE = "plexa-pretrade";
export const INTEL_SOURCE = "deepnets-token-safety";

/** What each add-on costs, for planning; `paidFetch` charges the real price. */
export const ENRICHMENT_PRICE_USD = {
  intel: 0.01,
  deep: 0.01,
  smartMoney: 0.05,
  sellCheck: 0.05,
} as const;

export interface EnrichmentPlan {
  /** Deepnets token safety (Solana): mint/freeze flags, bundling, network concentration. */
  intel: boolean;
  /** X sentiment, folded into the score as a sixth component. */
  deep: boolean;
  /** Nansen tracked-wallet netflow, folded in as a component. */
  smartMoney: boolean;
  /** Plexa live sell simulation (Base): a proven failure raises `cannot_sell`. */
  sellCheck: boolean;
  /** Why nothing (or less) was bought — surfaced to the model so it knows what it is missing. */
  skipped: string[];
  /** What the plan expects to spend, in dollars. */
  plannedUsd: number;
}

export function noEnrichment(reason: string): EnrichmentPlan {
  return { intel: false, deep: false, smartMoney: false, sellCheck: false, skipped: [reason], plannedUsd: 0 };
}

export function planEnrichment(input: {
  free: { total: number; verdict: string; blockers: readonly string[] };
  chain: Chain;
  /** The agent's configured data sources. */
  sources: readonly string[];
  remainingUsd: number;
  minScore: number;
  /** Already enriched this tick: the cache holds the paid components, do not pay twice. */
  already: boolean;
}): EnrichmentPlan {
  if (input.already) return noEnrichment("already enriched this tick");
  const confirmed = input.free.blockers.filter((blocker) => !blocker.endsWith("_unknown"));
  if (confirmed.length > 0) {
    return noEnrichment(`unbuyable on confirmed free data (${confirmed.join(", ")}) — no paid read changes that`);
  }

  const plan: EnrichmentPlan = { intel: false, deep: false, smartMoney: false, sellCheck: false, skipped: [], plannedUsd: 0 };
  let left = input.remainingUsd;
  const has = (id: string) => input.sources.includes(id);
  const buy = (key: "intel" | "deep" | "smartMoney" | "sellCheck", price: number) => {
    if (left + 1e-9 < price) {
      plan.skipped.push(`${key}: $${price.toFixed(2)} exceeds the $${Math.max(0, left).toFixed(2)} left in this run's data budget`);
      return;
    }
    plan[key] = true;
    plan.plannedUsd += price;
    left -= price;
  };

  // Safety first: the cheapest read and the one that can make a token unbuyable.
  if (input.chain === "solana" && has(INTEL_SOURCE)) buy("intel", ENRICHMENT_PRICE_USD.intel);
  if (input.chain === "base" && has(SELL_CHECK_SOURCE)) buy("sellCheck", ENRICHMENT_PRICE_USD.sellCheck);
  if (SENTIMENT_SOURCES.some(has)) buy("deep", ENRICHMENT_PRICE_USD.deep);
  if (has(SMART_MONEY_SOURCE)) buy("smartMoney", ENRICHMENT_PRICE_USD.smartMoney);
  return plan;
}
