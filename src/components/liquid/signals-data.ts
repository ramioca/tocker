/**
 * The data sources shown on the landing page — the ones the app actually
 * pays for, from `src/lib/data-sources/registry.ts`, not a Bazaar sampler.
 *
 * This is a hand-written mirror because the registry module drags zod, the
 * x402 client and every fixture into whatever imports it, and the landing is
 * a client bundle. `signals-data.test.ts` fails the build the moment an id,
 * name, price, network or tier here disagrees with the registry, so this
 * list cannot quietly go stale the way the last one did.
 *
 * `returns` rows are the response keys each vendor's fixture documents.
 * `tier` mirrors the registry: `default` ships on in every new agent,
 * `experimental` means the paid response has not been seen yet.
 */
export type LandingSource = {
  id: string;
  provider: string;
  host: string;
  name: string;
  /** Registry `priceUsd`, formatted. */
  price: string;
  priceUsd: number;
  /** Which chain the platform pays it on. */
  network: "Base" | "Solana";
  category: "sentiment" | "prices" | "onchain" | "news" | "social" | "other";
  tier: "default" | "standard" | "experimental";
  /** Feeds a hard gate (sellability, mint/freeze, concentration). */
  guard?: boolean;
  desc: string;
  returns: ReadonlyArray<readonly [string, string]>;
};

export const LANDING_SOURCES: readonly LandingSource[] = [
  {
    id: "x-search",
    provider: "x402Atlas",
    host: "x402atlas.com",
    name: "X / Twitter search",
    price: "$0.006",
    priceUsd: 0.006,
    network: "Base",
    category: "social",
    tier: "default",
    desc: "Up to 20 normalized tweets for a ticker or query, with a weighted sentiment read.",
    returns: [
      ["tweets[]", "text · author"],
      ["followers", "per author"],
      ["sentiment", "−1 … 1"],
    ],
  },
  {
    id: "cmc-quotes",
    provider: "CoinMarketCap",
    host: "coinmarketcap.com",
    name: "Market quotes",
    price: "$0.01",
    priceUsd: 0.01,
    network: "Base",
    category: "prices",
    tier: "default",
    desc: "Price, 24h volume, 1h/24h/7d change and market cap for up to ten symbols in one call.",
    returns: [
      ["price", "spot"],
      ["volume_24h", "usd"],
      ["change", "1h · 24h · 7d"],
    ],
  },
  {
    id: "deepnets-token-safety",
    provider: "Deepnets",
    host: "deepnets.ai",
    name: "Token safety",
    price: "$0.01",
    priceUsd: 0.01,
    network: "Solana",
    category: "onchain",
    tier: "default",
    guard: true,
    desc: "Solana due diligence: risk level, wallet-network concentration, bundles, mint and freeze authority.",
    returns: [
      ["overallSafetyLevel", "ok … critical"],
      ["topTenOwnership", "% supply"],
      ["isMintable", "true / false"],
    ],
  },
  {
    id: "nansen-smart-money",
    provider: "Nansen",
    host: "nansen.ai",
    name: "Smart Money netflow",
    price: "$0.05",
    priceUsd: 0.05,
    network: "Base",
    category: "onchain",
    tier: "standard",
    desc: "Net USD flow into a token from Nansen-labelled funds and proven traders, per chain and window.",
    returns: [
      ["net_flow_1h_usd", "signed"],
      ["net_flow_24h_usd", "signed"],
      ["token_sectors", "labels"],
    ],
  },
  {
    id: "plexa-pretrade",
    provider: "Plexa",
    host: "getplexa.com",
    name: "Pre-trade check",
    price: "$0.05",
    priceUsd: 0.05,
    network: "Base",
    category: "onchain",
    tier: "standard",
    guard: true,
    desc: "A live sell simulation at your size: can the position be exited, and for how much.",
    returns: [
      ["verdict", "clear · avoid"],
      ["triggers[]", "proven traps"],
      ["risk_profile", "liq · conc · age"],
    ],
  },
  {
    id: "gate402-base-radar",
    provider: "gate402",
    host: "gate402.app",
    name: "Base launch radar",
    price: "$0.02",
    priceUsd: 0.02,
    network: "Base",
    category: "onchain",
    tier: "standard",
    desc: "The newest Base pools pre-screened by liquidity, age and flow, or a momentum read on one token.",
    returns: [
      ["launches[]", "age · liquidity"],
      ["momentum", "classified"],
      ["tradeable", "honeypot-gated"],
    ],
  },
  {
    id: "cmc-dex-search",
    provider: "CoinMarketCap",
    host: "coinmarketcap.com",
    name: "DEX search",
    price: "$0.01",
    priceUsd: 0.01,
    network: "Base",
    category: "onchain",
    tier: "standard",
    desc: "Find a DEX-listed token by name, symbol or contract and get price, liquidity and 24h volume.",
    returns: [
      ["contract_address", "resolved"],
      ["liquidity", "usd"],
      ["volume_24h", "usd"],
    ],
  },
  {
    id: "dripmetrics-summary",
    provider: "DripMetrics",
    host: "dripmetrics.ai",
    name: "Market regime",
    price: "$0.25",
    priceUsd: 0.25,
    network: "Base",
    category: "prices",
    tier: "standard",
    desc: "What kind of tape a token is trading into: order-flow toxicity, imbalance, liquidity, dealer gamma.",
    returns: [
      ["vpin", "vs baseline"],
      ["buySellImbalance", "−1 … 1"],
      ["dealerGamma", "regime"],
    ],
  },
  {
    id: "agentdata",
    provider: "AgentData",
    host: "agentdata-api.com",
    name: "Funding & volatility",
    price: "$0.003",
    priceUsd: 0.003,
    network: "Base",
    category: "prices",
    tier: "standard",
    desc: "Macro context for the majors: funding rates, realized vol, correlation and liquidation levels.",
    returns: [
      ["funding_rate_8h", "per asset"],
      ["annualized_vol", "btc · eth · sol"],
      ["fear_greed", "0 … 100"],
    ],
  },
  {
    id: "dripmetrics-metric",
    provider: "DripMetrics",
    host: "dripmetrics.ai",
    name: "Execution impact",
    price: "$0.05",
    priceUsd: 0.05,
    network: "Base",
    category: "prices",
    tier: "standard",
    desc: "One microstructure metric: CVD, imbalance, illiquidity, or what an order of your size would actually cost.",
    returns: [
      ["metric", "cvd · imbalance"],
      ["value", "windowed"],
      ["impactBps", "at size"],
    ],
  },
  {
    id: "solenrich-launches",
    provider: "SolEnrich",
    host: "solenrich.com",
    name: "Solana launch radar",
    price: "$0.012",
    priceUsd: 0.012,
    network: "Solana",
    category: "onchain",
    tier: "experimental",
    desc: "Freshly launched Solana tokens already filtered by liquidity and a 0–1 risk score, safest first.",
    returns: [
      ["tokens[]", "ranked"],
      ["liquidity_usd", "floor"],
      ["holder_count", "per token"],
    ],
  },
  {
    id: "otto-pulse",
    provider: "Otto AI",
    host: "ottoai.services",
    name: "Crypto Twitter pulse",
    price: "$0.001",
    priceUsd: 0.001,
    network: "Base",
    category: "news",
    tier: "experimental",
    desc: "The cheapest read in the kit: breaking news, trending narratives and sentiment shifts at a glance.",
    returns: [
      ["summary", "text"],
      ["sentimentScore", "−1 … 1"],
      ["narratives[]", "ranked"],
    ],
  },
  {
    id: "sentimentalpha",
    provider: "SentimentAlpha",
    host: "sentimentalpha.ai",
    name: "Narrative alpha",
    price: "$0.01",
    priceUsd: 0.01,
    network: "Base",
    category: "sentiment",
    tier: "experimental",
    desc: "Sentiment score, narrative velocity and a contrarian signal for a topic or ticker, in real time.",
    returns: [
      ["sentiment_score", "−1 … 1"],
      ["narrative_velocity", "0 … 1"],
      ["contrarian_score", "signed"],
    ],
  },
];

/** The per-run data budget a new agent starts with (`DEFAULT_AGENT_CONFIG.risk.maxDataSpendUsdPerRun`). */
export const DEFAULT_DATA_BUDGET_USD = 1;
