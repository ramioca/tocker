/**
 * The data sources shown on the landing page — the ones the app actually
 * pays for, from `src/lib/data-sources/registry.ts`, not a Bazaar sampler.
 *
 * A hand-written mirror, so the client islands that quote a price (the How
 * console's receipt) and the server-rendered Data table never import the
 * registry, which drags zod, the x402 client and every fixture along with it.
 * `signals-data.test.ts` fails the moment an id, price, category or tier here
 * disagrees with the registry, so the list cannot quietly go stale.
 *
 * `tier` mirrors the registry: `default` ships on in every new agent,
 * `experimental` means the paid response has not been seen yet.
 */
export type LandingSource = {
  id: string;
  provider: string;
  name: string;
  /** Registry `priceUsd`. */
  priceUsd: number;
  category: "sentiment" | "prices" | "onchain" | "news" | "social" | "other";
  tier: "default" | "standard" | "experimental";
  /** Safety data: sellability, mint/freeze flags, concentration. */
  guard?: boolean;
};

export const LANDING_SOURCES: readonly LandingSource[] = [
  {
    id: "x-search",
    provider: "x402Atlas",
    name: "X / Twitter search",
    priceUsd: 0.006,
    category: "social",
    tier: "default",
  },
  {
    id: "cmc-quotes",
    provider: "CoinMarketCap",
    name: "Market quotes",
    priceUsd: 0.01,
    category: "prices",
    tier: "default",
  },
  {
    id: "deepnets-token-safety",
    provider: "Deepnets",
    name: "Token safety",
    priceUsd: 0.01,
    category: "onchain",
    tier: "default",
    guard: true,
  },
  {
    id: "nansen-smart-money",
    provider: "Nansen",
    name: "Smart Money netflow",
    priceUsd: 0.01,
    category: "onchain",
    tier: "standard",
  },
  {
    id: "plexa-pretrade",
    provider: "Plexa",
    name: "Pre-trade check",
    priceUsd: 0.05,
    category: "onchain",
    tier: "standard",
    guard: true,
  },
  {
    id: "gate402-base-radar",
    provider: "gate402",
    name: "Base launch radar",
    priceUsd: 0.02,
    category: "onchain",
    tier: "standard",
  },
  {
    id: "cmc-dex-search",
    provider: "CoinMarketCap",
    name: "DEX search",
    priceUsd: 0.01,
    category: "onchain",
    tier: "standard",
  },
  {
    id: "dripmetrics-summary",
    provider: "DripMetrics",
    name: "Market regime",
    priceUsd: 0.25,
    category: "prices",
    tier: "standard",
  },
  {
    id: "agentdata",
    provider: "AgentData",
    name: "Funding & volatility",
    priceUsd: 0.003,
    category: "prices",
    tier: "standard",
  },
  {
    id: "dripmetrics-metric",
    provider: "DripMetrics",
    name: "Execution impact",
    priceUsd: 0.05,
    category: "prices",
    tier: "standard",
  },
  {
    id: "solenrich-launches",
    provider: "SolEnrich",
    name: "Solana launch radar",
    priceUsd: 0.012,
    category: "onchain",
    tier: "experimental",
  },
  {
    id: "otto-pulse",
    provider: "Otto AI",
    name: "Crypto Twitter pulse",
    priceUsd: 0.001,
    category: "news",
    tier: "experimental",
  },
  {
    id: "sentimentalpha",
    provider: "SentimentAlpha",
    name: "Narrative alpha",
    priceUsd: 0.01,
    category: "sentiment",
    tier: "experimental",
  },
];

/** The per-run data budget a new agent starts with (`DEFAULT_AGENT_CONFIG.risk.maxDataSpendUsdPerRun`). */
export const DEFAULT_DATA_BUDGET_USD = 1;

/** A data price to the tenth of a cent, so every price on the page lines up on the point. */
export const usd3 = (n: number) => `$${n.toFixed(3)}`;
/** Dollars and cents. */
export const usd2 = (n: number) => `$${n.toFixed(2)}`;
