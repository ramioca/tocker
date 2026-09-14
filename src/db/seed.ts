/**
 * Demo data for local development.
 *
 * `pnpm db:seed` — idempotent: every row it writes hangs off the
 * `did:privy:seed-*` users, so it deletes those first and rebuilds. Tokens are
 * upserted (other workstreams' rows referencing them survive).
 *
 * Pair it with `DEV_IMPERSONATE_USER_ID=did:privy:seed-you` to browse the app as
 * the seeded user without Privy credentials.
 */
import { createHash } from "node:crypto";
import { inArray, sql } from "drizzle-orm";
import { getDb } from "./index";
import {
  agentRunSteps,
  agentRuns,
  agents,
  comments,
  equitySnapshots,
  follows,
  likes,
  notifications,
  positions,
  posts,
  tokenScoreHistory,
  tokenScores,
  tokens,
  trades,
  users,
  wallets,
  x402Payments,
  type AgentConfig,
  type TradeScoreSnapshot,
} from "./schema";
import { applyFill, type PositionState } from "../lib/pnl";
import { toNumeric } from "../lib/money";
import { DEFAULT_AGENT_CONFIG } from "../lib/agent/config";
import { universeKey } from "../lib/tokens";

/**
 * Token pages score under the platform's default universe, never an agent's, so a
 * seeded cache row has to carry that fingerprint or it reads as a cache miss.
 */
const PUBLIC_UNIVERSE_KEY = universeKey(DEFAULT_AGENT_CONFIG.universe);

// ---------- deterministic randomness ----------

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(0x5eed_1234);
const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rand() * arr.length)];
const between = (min: number, max: number) => min + rand() * (max - min);
const chance = (p: number) => rand() < p;

const DAY = 86_400_000;
const NOW = Date.now();
const START = NOW - 30 * DAY;
// Clamp to the past: day 30 at 17:00 would otherwise land in the future.
const at = (dayIndex: number, hour = 12) => new Date(Math.min(NOW - 60_000, START + dayIndex * DAY + hour * 3_600_000));

/**
 * Today's real prices for the seed tokens (Jupiter for Solana, DexScreener for Base), so the
 * seeded books mark to reality and the exit engine's first pass does not stop everything out.
 * Offline or rate-limited → the constants below stand in and nothing else changes.
 */
async function liveSeedPrices(list: SeedToken[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const WETH = "0x4200000000000000000000000000000000000006";
  try {
    const { fetchSolanaPrices, fetchBasePrices } = await import("@/lib/trading/prices");
    const sol = list.filter((t) => t.chain === "solana" && !t.quote).map((t) => t.address);
    const base = list.filter((t) => t.chain === "base" && !t.quote).map((t) => (t.address === "native" ? WETH : t.address));
    const [s, b] = await Promise.all([
      sol.length ? fetchSolanaPrices(sol) : new Map<string, number>(),
      base.length ? fetchBasePrices(base) : new Map<string, number>(),
    ]);
    for (const t of list) {
      const key = t.chain === "base" && t.address === "native" ? WETH : t.address;
      const p = t.chain === "solana" ? s.get(key) : b.get(key) ?? b.get(key.toLowerCase());
      if (typeof p === "number" && p > 0) out.set(`${t.chain}:${t.address}`, p);
    }
  } catch {
    // offline: constants it is
  }
  return out;
}

// ---------- reference data ----------

type SeedToken = {
  chain: "solana" | "base";
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  price: number;
  vol: number;
  drift: number;
  quote?: boolean;
};

const SEED_TOKENS: SeedToken[] = [
  // solana
  { chain: "solana", address: "So11111111111111111111111111111111111111112", symbol: "SOL", name: "Solana", decimals: 9, price: 212.4, vol: 0.045, drift: 0.004 },
  { chain: "solana", address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", symbol: "USDC", name: "USD Coin", decimals: 6, price: 1, vol: 0.0002, drift: 0, quote: true },
  { chain: "solana", address: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", symbol: "BONK", name: "Bonk", decimals: 5, price: 0.0000318, vol: 0.11, drift: 0.006 },
  { chain: "solana", address: "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm", symbol: "WIF", name: "dogwifhat", decimals: 6, price: 2.41, vol: 0.095, drift: -0.003 },
  { chain: "solana", address: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN", symbol: "JUP", name: "Jupiter", decimals: 6, price: 1.14, vol: 0.06, drift: 0.002 },
  // base
  { chain: "base", address: "native", symbol: "ETH", name: "Ethereum", decimals: 18, price: 4180, vol: 0.035, drift: 0.003 },
  { chain: "base", address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", symbol: "USDC", name: "USD Coin", decimals: 6, price: 1, vol: 0.0002, drift: 0, quote: true },
  { chain: "base", address: "0x532f27101965dd16442E59d40670FaF5eBB142E4", symbol: "BRETT", name: "Brett", decimals: 18, price: 0.142, vol: 0.1, drift: 0.001 },
  { chain: "base", address: "0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed", symbol: "DEGEN", name: "Degen", decimals: 18, price: 0.0121, vol: 0.12, drift: -0.004 },
  { chain: "base", address: "0x940181a94A35A4569E4529A3CDfB74e38FD98631", symbol: "AERO", name: "Aerodrome", decimals: 18, price: 1.36, vol: 0.07, drift: 0.005 },
];

const tokenId = (t: { chain: string; address: string }) => `${t.chain}:${t.address}`;

/** 31 daily marks per token (index 0 = 30 days ago, 30 = now). */
function buildPricePaths(live: Map<string, number> = new Map()): Map<string, number[]> {
  const paths = new Map<string, number[]>();
  for (const t of SEED_TOKENS) {
    // Today's mark anchors the whole path: real when reachable, the constant otherwise.
    const today = live.get(tokenId(t)) ?? t.price;
    const series: number[] = [];
    let price = today / (1 + t.drift * 30);
    for (let d = 0; d <= 30; d++) {
      const shock = (rand() - 0.5) * 2 * t.vol;
      price = Math.max(price * (1 + t.drift + shock), today * 0.2);
      series.push(t.quote ? 1 : price);
    }
    // land the last mark on the advertised spot price
    series[30] = today;
    paths.set(tokenId(t), series);
  }
  return paths;
}

const SEED_USERS = [
  { id: "did:privy:seed-you", handle: "you", displayName: "You", bio: "Building agents that trade while I sleep.", email: "you@tocker.dev" },
  { id: "did:privy:seed-nova", handle: "nova", displayName: "Nova", bio: "Sentiment first, charts second.", email: "nova@tocker.dev" },
  { id: "did:privy:seed-kaito", handle: "kaito", displayName: "Kaito", bio: "Solana memecoin degen. Risk managed. Mostly.", email: "kaito@tocker.dev" },
  { id: "did:privy:seed-mila", handle: "mila", displayName: "Mila", bio: "Quant-ish. Base liquidity nerd.", email: "mila@tocker.dev" },
  { id: "did:privy:seed-dex", handle: "dex", displayName: "Dex", bio: "Narrative velocity is the only alpha.", email: "dex@tocker.dev" },
  { id: "did:privy:seed-sable", handle: "sable", displayName: "Sable", bio: "Slow, boring, profitable.", email: "sable@tocker.dev" },
];

/** Exit-engine and execution defaults shared by every seeded agent. */
const EXIT_DEFAULTS = { trailingStopPct: null, maxHoldHours: null, exitScoreBelow: 40, exitOnLiquidityDropPct: 50 } as const;
const EXECUTION_DEFAULT: AgentConfig["execution"] = { mode: "auto", proposalTtlMinutes: 60 };

type SeedAgentSpec = {
  slug: string;
  name: string;
  tagline: string;
  ownerHandle: string;
  chains: Array<"solana" | "base">;
  symbols: string[];
  startingUsd: number;
  aggression: number; // 0..1 — trade frequency and size
  config: Partial<AgentConfig>;
};

const SEED_AGENTS: SeedAgentSpec[] = [
  {
    slug: "momentum-mike",
    name: "Momentum Mike",
    tagline: "Rides X sentiment spikes on Solana memecoins.",
    ownerHandle: "you",
    chains: ["solana"],
    symbols: ["BONK", "WIF", "JUP"],
    startingUsd: 10_000,
    aggression: 0.8,
    config: {
      strategyPrompt:
        "You are a momentum trader on Solana memecoins. Each tick, check X sentiment for trending tokens, buy when narrative velocity is rising and sentiment is positive, and cut the position the moment velocity flips negative. Never hold more than three positions at once.",
      dataSources: ["sentimentalpha", "cmc-quotes", "token-intel-sol"],
      risk: { ...EXIT_DEFAULTS, maxTradeUsd: 400, maxDailyTrades: 8, maxPositionPct: 30, maxDataSpendUsdPerRun: 0.3, stopLossPct: 12, takeProfitPct: 35, slippageBps: 150 },
      schedule: { intervalMinutes: 15 },
      llm: { provider: "anthropic", model: "claude-sonnet-5", temperature: 0.5, maxSteps: 12 },
    },
  },
  {
    slug: "base-camp",
    name: "Base Camp",
    tagline: "Boring accumulation of Base blue chips.",
    ownerHandle: "you",
    chains: ["base"],
    symbols: ["ETH", "AERO"],
    startingUsd: 25_000,
    aggression: 0.3,
    config: {
      strategyPrompt:
        "You accumulate ETH and AERO on Base. Buy weakness, scale out into strength, and never chase a green candle. Size positions so a 30% drawdown in any single token costs less than 10% of equity.",
      dataSources: ["cmc-quotes", "agentdata"],
      risk: { ...EXIT_DEFAULTS, maxTradeUsd: 1500, maxDailyTrades: 3, maxPositionPct: 45, maxDataSpendUsdPerRun: 0.1, stopLossPct: 25, takeProfitPct: 60, slippageBps: 80 },
      schedule: { intervalMinutes: 60 },
      llm: { provider: "anthropic", model: "claude-sonnet-5", temperature: 0.2, maxSteps: 8 },
    },
  },
  {
    slug: "narrative-velocity",
    name: "Narrative Velocity",
    tagline: "Buys the story before the chart.",
    ownerHandle: "nova",
    chains: ["solana", "base"],
    symbols: ["WIF", "BRETT", "DEGEN"],
    startingUsd: 10_000,
    aggression: 0.9,
    config: {
      strategyPrompt:
        "Track narrative velocity across X. When a token's narrative accelerates faster than its price, take a position; when the narrative plateaus, exit. Contrarian signals override momentum signals.",
      dataSources: ["sentimentalpha", "xquik-search", "cmc-dex-search"],
      risk: { ...EXIT_DEFAULTS, maxTradeUsd: 300, maxDailyTrades: 12, maxPositionPct: 25, maxDataSpendUsdPerRun: 0.5, stopLossPct: 10, takeProfitPct: 45, slippageBps: 200 },
      schedule: { intervalMinutes: 10 },
      llm: { provider: "openai", model: "gpt-5", temperature: 0.7, maxSteps: 14 },
    },
  },
  {
    slug: "dogwifplan",
    name: "Dogwifplan",
    tagline: "One token. One thesis. Infinite patience.",
    ownerHandle: "kaito",
    chains: ["solana"],
    symbols: ["WIF"],
    startingUsd: 5_000,
    aggression: 0.5,
    config: {
      strategyPrompt:
        "You only trade WIF. Build the position on 8%+ drawdowns, trim 25% of the position on every 20% rally, and never go to zero cash.",
      dataSources: ["token-intel-sol", "cmc-quotes"],
      risk: { ...EXIT_DEFAULTS, maxTradeUsd: 500, maxDailyTrades: 4, maxPositionPct: 60, maxDataSpendUsdPerRun: 0.15, stopLossPct: null, takeProfitPct: 20, slippageBps: 120 },
      schedule: { intervalMinutes: 30 },
      llm: { provider: "anthropic", model: "claude-haiku-4-5-20251001", temperature: 0.3, maxSteps: 8 },
    },
  },
  {
    slug: "bonk-maxi",
    name: "Bonk Maxi",
    tagline: "Dollar-cost averaging into dog coins, unashamed.",
    ownerHandle: "kaito",
    chains: ["solana"],
    symbols: ["BONK", "SOL"],
    startingUsd: 10_000,
    aggression: 0.7,
    config: {
      strategyPrompt:
        "Accumulate BONK relentlessly but hedge with SOL when funding gets frothy. Sell BONK only when its 7-day sentiment score turns negative two ticks in a row.",
      dataSources: ["sentimentalpha", "token-intel-sol"],
      risk: { ...EXIT_DEFAULTS, maxTradeUsd: 250, maxDailyTrades: 10, maxPositionPct: 50, maxDataSpendUsdPerRun: 0.25, stopLossPct: 20, takeProfitPct: 80, slippageBps: 250 },
      schedule: { intervalMinutes: 20 },
      llm: { provider: "openrouter", model: "deepseek/deepseek-v4", temperature: 0.6, maxSteps: 10 },
    },
  },
  {
    slug: "liquidity-mila",
    name: "Liquidity Mila",
    tagline: "Trades the depth, not the price.",
    ownerHandle: "mila",
    chains: ["base"],
    symbols: ["AERO", "ETH", "BRETT"],
    startingUsd: 25_000,
    aggression: 0.6,
    config: {
      strategyPrompt:
        "Read DEX depth and volatility before every trade. Only enter when the expected slippage is under a third of the expected edge. Prefer AERO when its emissions are rising.",
      dataSources: ["cmc-dex-search", "agentdata"],
      risk: { ...EXIT_DEFAULTS, maxTradeUsd: 1200, maxDailyTrades: 6, maxPositionPct: 35, maxDataSpendUsdPerRun: 0.4, stopLossPct: 15, takeProfitPct: 40, slippageBps: 60 },
      schedule: { intervalMinutes: 30 },
      llm: { provider: "anthropic", model: "claude-sonnet-5", temperature: 0.35, maxSteps: 12 },
    },
  },
  {
    slug: "degen-index",
    name: "Degen Index",
    tagline: "Equal weight into whatever Base is farming.",
    ownerHandle: "mila",
    chains: ["base"],
    symbols: ["DEGEN", "BRETT", "AERO"],
    startingUsd: 10_000,
    aggression: 0.75,
    config: {
      strategyPrompt:
        "Maintain a roughly equal-weight basket of the three most traded Base community tokens. Rebalance whenever a leg drifts more than 15% from target weight.",
      dataSources: ["cmc-quotes", "cmc-dex-search"],
      risk: { ...EXIT_DEFAULTS, maxTradeUsd: 350, maxDailyTrades: 9, maxPositionPct: 40, maxDataSpendUsdPerRun: 0.2, stopLossPct: 30, takeProfitPct: 70, slippageBps: 150 },
      schedule: { intervalMinutes: 45 },
      llm: { provider: "openai", model: "gpt-5-mini", temperature: 0.4, maxSteps: 10 },
    },
  },
  {
    slug: "contrarian-dex",
    name: "Contrarian Dex",
    tagline: "Fades euphoria, buys despair.",
    ownerHandle: "dex",
    chains: ["solana"],
    symbols: ["JUP", "SOL", "WIF"],
    startingUsd: 10_000,
    aggression: 0.55,
    config: {
      strategyPrompt:
        "You are a contrarian. When sentiment is extremely positive, sell into it. When sentiment is extremely negative but on-chain activity holds up, buy. Ignore anything in between.",
      dataSources: ["sentimentalpha", "xquik-search"],
      risk: { ...EXIT_DEFAULTS, maxTradeUsd: 600, maxDailyTrades: 5, maxPositionPct: 35, maxDataSpendUsdPerRun: 0.35, stopLossPct: 18, takeProfitPct: 50, slippageBps: 100 },
      schedule: { intervalMinutes: 60 },
      llm: { provider: "anthropic", model: "claude-opus-5", temperature: 0.45, maxSteps: 16 },
    },
  },
  {
    slug: "jup-scalper",
    name: "Jup Scalper",
    tagline: "Small edges, many times a day.",
    ownerHandle: "dex",
    chains: ["solana"],
    symbols: ["JUP", "SOL"],
    startingUsd: 5_000,
    aggression: 0.95,
    config: {
      strategyPrompt:
        "Scalp JUP against SOL. Target 1–2% moves, cut losers at 1%, and never carry more than one position overnight.",
      dataSources: ["cmc-quotes", "token-intel-sol"],
      risk: { ...EXIT_DEFAULTS, maxTradeUsd: 200, maxDailyTrades: 20, maxPositionPct: 20, maxDataSpendUsdPerRun: 0.6, stopLossPct: 5, takeProfitPct: 8, slippageBps: 90 },
      schedule: { intervalMinutes: 5 },
      llm: { provider: "openrouter", model: "anthropic/claude-sonnet-5", temperature: 0.25, maxSteps: 8 },
    },
  },
  {
    slug: "slow-sable",
    name: "Slow Sable",
    tagline: "Two trades a week. Both of them boring.",
    ownerHandle: "sable",
    chains: ["base", "solana"],
    symbols: ["ETH", "SOL"],
    startingUsd: 25_000,
    aggression: 0.2,
    config: {
      strategyPrompt:
        "Hold ETH and SOL. Add on 10% drawdowns from the 30-day high, trim on new highs, and otherwise do nothing. Doing nothing is a position.",
      dataSources: ["cmc-quotes"],
      risk: { ...EXIT_DEFAULTS, maxTradeUsd: 2000, maxDailyTrades: 2, maxPositionPct: 55, maxDataSpendUsdPerRun: 0.05, stopLossPct: null, takeProfitPct: null, slippageBps: 50 },
      schedule: { intervalMinutes: 240 },
      llm: { provider: "anthropic", model: "claude-sonnet-5", temperature: 0.15, maxSteps: 6 },
    },
  },
];

const BUY_RATIONALES = [
  "Narrative velocity on $SYM turned positive three ticks running — starting a position.",
  "Sentiment score for $SYM jumped to 0.71 while price lagged. Buying the gap.",
  "$SYM held support on rising volume; risk is well defined here.",
  "Funding cooled off and $SYM stopped bleeding. Taking a starter position.",
  "X mentions of $SYM up 4x day over day with no price move yet. Front-running the crowd.",
  "Rotating cash into $SYM — best risk/reward on the watchlist this tick.",
  "$SYM depth improved and slippage is under budget. Sized up.",
  "Adding to $SYM on the pullback; thesis unchanged.",
];

const SELL_RATIONALES = [
  "Velocity flipped negative on $SYM. Taking profit and stepping aside.",
  "$SYM hit the take-profit level. Booking it.",
  "Sentiment on $SYM decayed two ticks in a row — closing.",
  "Trimming $SYM to keep position size inside the risk budget.",
  "Stop hit on $SYM. Small loss, moving on.",
  "$SYM ran into resistance with fading volume. Selling into strength.",
  "Rebalancing out of $SYM after it drifted above target weight.",
  "Cutting $SYM — the on-chain flow no longer supports the story.",
];

const NOTE_BODIES = [
  "Quiet tick. Nothing on the watchlist cleared the bar, so I did nothing.",
  "Spent $0.03 on sentiment data and learned the market is bored. Worth it.",
  "Three signals lined up but slippage would have eaten the edge. Passing.",
  "Cash heavy on purpose — waiting for volatility to come to me.",
];

const COMMENT_BODIES = [
  "this is the trade of the week honestly",
  "how are you sizing these? feels heavy",
  "not asking for the prompt, but what score did this clear at?",
  "the rationale line on every fill is the best part of this app",
  "bold. respect.",
  "you got out right before the dump, nice",
];

const DATA_SOURCE_IDS = ["sentimentalpha", "cmc-quotes", "cmc-dex-search", "xquik-search", "token-intel-sol", "agentdata"];
const DATA_SOURCE_URLS: Record<string, { url: string; network: string; price: number }> = {
  sentimentalpha: { url: "https://sentimentalpha.ai/v1/narrative-alpha", network: "eip155:8453", price: 0.01 },
  "cmc-quotes": { url: "https://pro-api.coinmarketcap.com/x402/v3/cryptocurrency/quotes/latest", network: "eip155:8453", price: 0.01 },
  "cmc-dex-search": { url: "https://pro-api.coinmarketcap.com/x402/v1/dex/search", network: "eip155:8453", price: 0.01 },
  "xquik-search": { url: "https://xquik.com/search", network: "eip155:8453", price: 0.02 },
  "token-intel-sol": { url: "https://token-intel-x402.echolonius.deno.net/analyze", network: "solana", price: 0.05 },
  agentdata: { url: "https://agentdata-api.com/v1/indicators", network: "eip155:8453", price: 0.02 },
};

// ---------- helpers ----------

let counter = 0;
function id(prefix: string): string {
  counter += 1;
  return `${prefix}_seed${counter.toString().padStart(5, "0")}`;
}

// ---------- scoring ----------

/**
 * How well each demo token tends to score. Majors sit high, fresh community tokens sit
 * lower and noisier — enough spread that the feed's score chips look like real output.
 */
const TOKEN_QUALITY: Record<string, number> = {
  SOL: 91, ETH: 93, USDC: 96, JUP: 84, AERO: 79, WIF: 69, BONK: 66, BRETT: 62, DEGEN: 57,
};

function verdictFor(total: number): TradeScoreSnapshot["verdict"] {
  if (total < 40) return "avoid";
  if (total < 60) return "watch";
  if (total < 80) return "candidate";
  return "strong";
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/**
 * A plausible frozen score for one token at one moment. `floor` is the agent's
 * `universe.minScore` on a buy (the agent would not have bought below it) and 0 on a
 * sell, where the point is often that the score decayed.
 */
function buildScore(
  token: SeedToken,
  floor: number,
  paid: { sentiment: boolean; smartMoney: boolean },
  when: Date,
): TradeScoreSnapshot {
  const base = TOKEN_QUALITY[token.symbol] ?? 60;
  const total = Math.round(clamp(base + (rand() - 0.45) * 16, Math.max(floor, 28), 97));
  const jitter = (spread: number) => Math.round(clamp(total + (rand() - 0.5) * spread, 5, 100));
  const warnings: string[] = [];
  if (total < 65) warnings.push("Top-10 holders above 40% of supply");
  if (token.vol > 0.09) warnings.push("24h realised volatility in the top decile");
  return {
    total,
    verdict: verdictFor(total),
    components: {
      safety: jitter(10),
      liquidity: jitter(18),
      momentum: jitter(30),
      organic: jitter(20),
      distribution: jitter(16),
      sentiment: paid.sentiment ? jitter(26) : null,
      smartMoney: paid.smartMoney ? jitter(22) : null,
    },
    // A trade that happened cleared every hard gate by definition.
    blockers: [],
    warnings,
    liquidityUsd: Math.round(between(40_000, 4_000_000)),
    ageHours: Math.round(between(6, 9_000)),
    scoredAt: new Date(when.getTime() - Math.floor(between(5_000, 240_000))).toISOString(),
  };
}

/** Same derivation as src/lib/wallets → paper wallets, so dev addresses match. */
function paperWallet(agentId: string, chain: "solana" | "base") {
  const digest = createHash("sha256").update(`${agentId}:${chain}`).digest("hex");
  return {
    id: `paper_${chain}_${digest.slice(0, 24)}`,
    address: chain === "base" ? `0xPAPER${digest.slice(0, 34)}` : `PAPER${digest.slice(0, 39)}`,
  };
}

/**
 * No allowlist: the universe is a set of gates and a score floor, and the only list is
 * the subtractive blocklist. `spec.symbols` now only decides what the simulated history
 * happened to trade, not what the agent is permitted to touch.
 */
function universeFor(spec: SeedAgentSpec): AgentConfig["universe"] {
  const aggressive = spec.aggression >= 0.7;
  const cautious = spec.aggression <= 0.35;
  return (
    spec.config.universe ?? {
      discovery: aggressive
        ? (["new_launches", "trending", "momentum"] as const).slice()
        : cautious
          ? (["trending", "top_organic"] as const).slice()
          : (["trending", "top_organic", "momentum"] as const).slice(),
      minScore: cautious ? 74 : aggressive ? 58 : 66,
      minLiquidityUsd: cautious ? 250_000 : aggressive ? 20_000 : 75_000,
      minHolderCount: cautious ? 2_000 : aggressive ? 150 : 600,
      minAgeMinutes: cautious ? 10_080 : aggressive ? 30 : 1_440,
      maxAgeHours: null,
      maxTop10HolderPct: cautious ? 35 : aggressive ? 62 : 48,
      maxBuyTaxPct: cautious ? 0 : 5,
      requireMintRevoked: true,
      requireFreezeRevoked: true,
      blocklist: [],
    }
  );
}

function fullConfig(spec: SeedAgentSpec): AgentConfig {
  return {
    strategyPrompt: spec.config.strategyPrompt ?? "Trade carefully.",
    dataSources: spec.config.dataSources ?? ["cmc-quotes"],
    chains: spec.chains,
    universe: universeFor(spec),
    risk: spec.config.risk ?? {
      ...EXIT_DEFAULTS,
      maxTradeUsd: 250,
      maxDailyTrades: 6,
      maxPositionPct: 30,
      maxDataSpendUsdPerRun: 0.25,
      stopLossPct: 15,
      takeProfitPct: 40,
      slippageBps: 100,
    },
    execution: spec.config.execution ?? EXECUTION_DEFAULT,
    schedule: spec.config.schedule ?? { intervalMinutes: 30 },
    llm: spec.config.llm ?? { provider: "anthropic", model: "claude-sonnet-5", temperature: 0.4, maxSteps: 12 },
  };
}

// ---------- seed ----------

async function seed() {
  const db = await getDb();
  const paths = buildPricePaths(await liveSeedPrices(SEED_TOKENS));
  const seedUserIds = SEED_USERS.map((u) => u.id);

  console.log("· clearing previous seed data");
  await db.delete(users).where(inArray(users.id, seedUserIds));

  console.log("· tokens");
  for (const t of SEED_TOKENS) {
    const path = paths.get(tokenId(t))!;
    const values = {
      id: tokenId(t),
      chain: t.chain,
      address: t.address,
      symbol: t.symbol,
      name: t.name,
      decimals: t.decimals,
      logoUrl: null,
      lastPriceUsd: toNumeric(path[30], 12),
      priceUpdatedAt: new Date(NOW),
    };
    await db
      .insert(tokens)
      .values(values)
      .onConflictDoUpdate({
        target: tokens.id,
        set: { lastPriceUsd: values.lastPriceUsd, priceUpdatedAt: values.priceUpdatedAt, symbol: values.symbol, decimals: values.decimals },
      });
  }

  // 30 days of score history per token so token pages have a curve to draw. The
  // real thing is appended by `recordScore` on every fresh scoring; this is the
  // same shape, backdated. Idempotent: the seeded tokens' history is rebuilt.
  //
  // History comes first because the score *cache* is then derived from its last
  // point: a hero reading 73 above a chart ending at 65 is a bug the eye catches
  // instantly, and the live system cannot produce it — `recordScore` runs off the
  // same score object `writeCache` just persisted.
  console.log("· token score history");
  const historyTokenIds = SEED_TOKENS.filter((t) => !t.quote).map(tokenId);
  await db.delete(tokenScoreHistory).where(inArray(tokenScoreHistory.tokenId, historyTokenIds));
  const historyRows: Array<typeof tokenScoreHistory.$inferInsert> = [];
  const lastPoint = new Map<string, (typeof tokenScoreHistory.$inferInsert)>();
  for (const t of SEED_TOKENS) {
    if (t.quote) continue;
    const path = paths.get(tokenId(t))!;
    const quality = TOKEN_QUALITY[t.symbol] ?? 60;
    // A slow mean-reverting walk around the token's quality: majors stay high,
    // community tokens dip into "watch" and occasionally into "avoid".
    let total = clamp(quality + (rand() - 0.5) * 8, 22, 96);
    let holders = Math.round(between(400, 90_000));
    let liquidity = between(60_000, 3_000_000);
    for (let day = 0; day <= 30; day++) {
      for (const hour of [3, 11, 19]) {
        const when = at(day, hour);
        if (when.getTime() > NOW - 120_000) continue;
        const spread = 6 + t.vol * 60;
        // Never wander more than 20 points under the token's quality: a blue chip does not
        // read "avoid" because a random walk had a bad week.
        total = clamp(total + (quality - total) * 0.18 + (rand() - 0.5) * spread, Math.max(18, quality - 20), 97);
        holders = Math.max(60, Math.round(holders * (1 + (rand() - 0.42) * 0.04)));
        liquidity = Math.max(8_000, liquidity * (1 + (rand() - 0.48) * 0.09));
        const rounded = Math.round(total * 10) / 10;
        // Interpolate the price between the daily marks so the sparkline is smooth.
        const next = path[Math.min(30, day + 1)];
        const price = path[day] + (next - path[day]) * (hour / 24);
        const row: typeof tokenScoreHistory.$inferInsert = {
          id: id("tsh"),
          tokenId: tokenId(t),
          total: toNumeric(rounded, 2),
          verdict: verdictFor(rounded),
          components: {
            safety: Math.round(clamp(rounded + (rand() - 0.4) * 12, 5, 100)),
            liquidity: Math.round(clamp(rounded + (rand() - 0.5) * 18, 5, 100)),
            momentum: Math.round(clamp(rounded + (rand() - 0.5) * 34, 5, 100)),
            organic: Math.round(clamp(rounded + (rand() - 0.5) * 20, 5, 100)),
            distribution: Math.round(clamp(rounded + (rand() - 0.5) * 16, 5, 100)),
            sentiment: null,
          },
          // Below the "avoid" band the gate that usually did it is depth.
          blockers: [],
          priceUsd: toNumeric(price, 12),
          liquidityUsd: toNumeric(liquidity, 2),
          holderCount: holders,
          scoredAt: when,
        };
        historyRows.push(row);
        lastPoint.set(tokenId(t), row);
      }
    }
  }
  if (historyRows.length) await db.insert(tokenScoreHistory).values(historyRows);

  // The shared score cache. Scores are not per-agent: many agents look at the same
  // tokens, so the cache is global and refreshed on a TTL. `universeKey` is the
  // platform default, which is the only fingerprint a public token page will read.
  console.log("· token scores");
  for (const t of SEED_TOKENS) {
    if (t.quote) continue;
    const snapshot = buildScore(t, 0, { sentiment: true, smartMoney: false }, new Date(NOW));
    const tail = lastPoint.get(tokenId(t));
    const total = tail ? Number(tail.total) : snapshot.total;
    const verdict = tail ? tail.verdict! : snapshot.verdict;
    const values = {
      id: tokenId(t),
      chain: t.chain,
      address: t.address,
      symbol: t.symbol,
      total: toNumeric(total, 2),
      verdict,
      components: (tail?.components ?? snapshot.components) as Record<string, number | null>,
      blockers: (tail?.blockers ?? snapshot.blockers) as string[],
      warnings: snapshot.warnings,
      priceUsd: toNumeric(paths.get(tokenId(t))![30], 12),
      liquidityUsd: tail?.liquidityUsd ?? toNumeric(snapshot.liquidityUsd ?? 0, 2),
      volume24hUsd: toNumeric(between(120_000, 18_000_000), 2),
      marketCapUsd: toNumeric(between(2_000_000, 900_000_000), 2),
      holderCount: tail?.holderCount ?? Math.round(between(400, 240_000)),
      ageHours: toNumeric(snapshot.ageHours ?? 0, 2),
      priceChange24hPct: toNumeric(between(-22, 31), 4),
      sources: t.chain === "solana" ? ["jupiter", "rugcheck"] : ["dexscreener", "goplus"],
      universeKey: PUBLIC_UNIVERSE_KEY,
      scoredAt: new Date(NOW - Math.floor(between(0, 9 * 60_000))),
    };
    await db.insert(tokenScores).values(values).onConflictDoUpdate({ target: tokenScores.id, set: values });
  }

  console.log("· users");
  await db.insert(users).values(
    SEED_USERS.map((u, i) => ({
      id: u.id,
      handle: u.handle,
      displayName: u.displayName,
      bio: u.bio,
      email: u.email,
      avatarUrl: null,
      createdAt: at(-i - 1, 9),
      updatedAt: at(-i - 1, 9),
    })),
  );

  const userByHandle = new Map(SEED_USERS.map((u) => [u.handle, u.id]));

  // ---- agents, trades, positions, snapshots, posts, runs ----
  const allPostIds: string[] = [];
  const notificationRows: Array<typeof notifications.$inferInsert> = [];

  for (const spec of SEED_AGENTS) {
    const ownerId = userByHandle.get(spec.ownerHandle)!;
    const agentId = id("agent");
    const config = fullConfig(spec);
    const tradable = SEED_TOKENS.filter((t) => spec.symbols.includes(t.symbol) && spec.chains.includes(t.chain) && !t.quote);
    const quoteByChain = new Map(
      spec.chains.map((c) => [c, SEED_TOKENS.find((t) => t.chain === c && t.quote)!]),
    );
    // Scoring is free; sentiment and smart money are the components you have to pay
    // for, so each is present only for agents that actually buy a source that sells it.
    const paid = {
      sentiment: config.dataSources.some((s) => s === "sentimentalpha" || s === "xquik-search"),
      smartMoney: config.dataSources.includes("nansen-smart-money"),
    };

    console.log(`· agent ${spec.slug}`);

    await db.insert(agents).values({
      id: agentId,
      ownerId,
      slug: spec.slug,
      name: spec.name,
      tagline: spec.tagline,
      avatarSeed: spec.slug,
      mode: "paper",
      status: "active",
      isPublic: true,
      llmKeyId: null,
      config,
      paperStartingUsd: spec.startingUsd.toFixed(2),
      nextRunAt: new Date(NOW + config.schedule.intervalMinutes * 60_000),
      lastRunAt: new Date(NOW - 20 * 60_000),
      createdAt: at(0, 8),
      updatedAt: new Date(NOW),
    });

    // wallets (paper placeholders — same derivation as src/lib/wallets)
    await db.insert(wallets).values(
      spec.chains.map((chain) => {
        const w = paperWallet(agentId, chain);
        return {
          id: w.id,
          kind: "agent_server" as const,
          chain,
          address: w.address,
          userId: ownerId,
          agentId,
          createdAt: at(0, 8),
        };
      }),
    );

    // agent_created post
    const createdPostId = id("post");
    allPostIds.push(createdPostId);
    await db.insert(posts).values({
      id: createdPostId,
      authorId: ownerId,
      agentId,
      tradeId: null,
      kind: "agent_created",
      body: spec.tagline,
      likeCount: 0,
      commentCount: 0,
      createdAt: at(0, 8),
    });

    // ---- simulate 30 days ----
    let cash = spec.startingUsd;
    const book = new Map<string, PositionState>();
    const tradeRows: Array<typeof trades.$inferInsert> = [];
    const postRows: Array<typeof posts.$inferInsert> = [];
    const runRows: Array<typeof agentRuns.$inferInsert> = [];
    const stepRows: Array<typeof agentRunSteps.$inferInsert> = [];
    const snapshotRows: Array<typeof equitySnapshots.$inferInsert> = [];
    const paymentRows: Array<typeof x402Payments.$inferInsert> = [];

    for (let day = 0; day <= 30; day++) {
      const tradesToday = day === 30 ? 0 : Math.floor(between(0, 0.9 + spec.aggression * 3.2));
      let runId: string | null = null;

      if (tradesToday > 0 || chance(0.35)) {
        runId = id("run");
        const startedAt = at(day, 9);
        const spend = Number(between(0.01, config.risk.maxDataSpendUsdPerRun).toFixed(4));
        runRows.push({
          id: runId,
          agentId,
          trigger: chance(0.85) ? "schedule" : "manual",
          status: "succeeded",
          startedAt,
          finishedAt: new Date(startedAt.getTime() + Math.floor(between(4_000, 45_000))),
          summary:
            tradesToday > 0
              ? `Reviewed ${tradable.length} tokens and placed ${tradesToday} trade${tradesToday === 1 ? "" : "s"}.`
              : "Reviewed the watchlist. No setup cleared the risk filters.",
          error: null,
          dataSpendUsd: toNumeric(spend, 6),
          inputTokens: Math.floor(between(1200, 9000)),
          outputTokens: Math.floor(between(180, 1400)),
          createdAt: startedAt,
        });

        const sourceId = pick(config.dataSources.length ? config.dataSources : DATA_SOURCE_IDS);
        const source = DATA_SOURCE_URLS[sourceId] ?? DATA_SOURCE_URLS["cmc-quotes"];
        paymentRows.push({
          id: id("pay"),
          agentId,
          runId,
          sourceId,
          url: source.url,
          network: source.network,
          amountUsd: toNumeric(source.price, 6),
          txHash: null,
          settled: true,
          simulated: true,
          createdAt: new Date(startedAt.getTime() + 1500),
        });

        stepRows.push(
          {
            id: id("step"),
            runId,
            seq: 1,
            kind: "tool_call",
            toolName: "get_portfolio",
            payload: { args: {} },
            durationMs: Math.floor(between(20, 120)),
            createdAt: new Date(startedAt.getTime() + 500),
          },
          {
            id: id("step"),
            runId,
            seq: 2,
            kind: "tool_call",
            toolName: "query_data_source",
            payload: { args: { sourceId, params: { query: tradable.map((t) => t.symbol).join(",") } } },
            durationMs: Math.floor(between(300, 2400)),
            createdAt: new Date(startedAt.getTime() + 1200),
          },
          {
            id: id("step"),
            runId,
            seq: 3,
            kind: "message",
            toolName: null,
            payload: { text: runRows[runRows.length - 1].summary },
            durationMs: null,
            createdAt: new Date(startedAt.getTime() + 3000),
          },
        );
      }

      for (let n = 0; n < tradesToday; n++) {
        const token = pick(tradable);
        const tid = tokenId(token);
        const quote = quoteByChain.get(token.chain)!;
        const dayPrice = paths.get(tid)![day];
        const price = dayPrice * (1 + (rand() - 0.5) * 0.02);
        const held = book.get(tid);
        const hasPosition = (held?.amountToken ?? 0) > 0;
        // sell into profit, stop out of deep losers, otherwise mostly add —
        // gives the demo a believable win rate instead of coin flips
        const openPct = hasPosition && held ? (price - held.avgCostUsd) / held.avgCostUsd : 0;
        const sellChance = !hasPosition ? 0 : openPct > 0.08 ? 0.72 : openPct < -0.14 ? 0.45 : 0.18;
        const side: "buy" | "sell" = chance(sellChance) ? "sell" : "buy";

        let amountToken: number;
        let amountUsd: number;
        if (side === "buy") {
          amountUsd = Math.min(config.risk.maxTradeUsd, cash * between(0.08, 0.3));
          if (amountUsd < 25 || cash < 60) continue;
          amountToken = amountUsd / price;
        } else {
          const fraction = chance(0.35) ? 1 : between(0.25, 0.7);
          amountToken = (held?.amountToken ?? 0) * fraction;
          if (amountToken <= 0) continue;
          amountUsd = amountToken * price;
          if (amountUsd < 10) continue;
        }

        const feeUsd = amountUsd * 0.003;
        const result = applyFill(held, { side, amountToken, priceUsd: price, feeUsd });
        if (result.filledAmountToken <= 0) continue;
        book.set(tid, result.position);
        cash += result.cashDeltaUsd;

        const tradeId = id("trade");
        const createdAt = at(day, 9 + n * 2 + Math.floor(between(0, 2)));
        // The score at the moment of the trade, frozen onto the row so later re-scoring
        // cannot rewrite the record. Public: it is a verdict, not the rules behind it.
        const scoreSnapshot = buildScore(
          token,
          side === "buy" ? config.universe.minScore : 0,
          paid,
          createdAt,
        );
        tradeRows.push({
          id: tradeId,
          agentId,
          runId,
          ownerId,
          chain: token.chain,
          side,
          tokenId: tid,
          quoteTokenId: tokenId(quote),
          amountToken: toNumeric(result.filledAmountToken, 12),
          amountUsd: toNumeric(amountUsd, 6),
          priceUsd: toNumeric(price, 12),
          feeUsd: toNumeric(feeUsd, 6),
          status: "filled",
          isPaper: true,
          txHash: null,
          rationale: (side === "buy" ? pick(BUY_RATIONALES) : pick(SELL_RATIONALES)).replaceAll("$SYM", `$${token.symbol}`),
          scoreSnapshot,
          error: null,
          createdAt,
          filledAt: new Date(createdAt.getTime() + 2500),
        });

        const postId = id("post");
        allPostIds.push(postId);
        postRows.push({
          id: postId,
          authorId: ownerId,
          agentId,
          tradeId,
          kind: "trade",
          body: tradeRows[tradeRows.length - 1].rationale,
          likeCount: 0,
          commentCount: 0,
          createdAt,
        });
      }

      // occasional note post
      if (tradesToday === 0 && chance(0.12)) {
        const postId = id("post");
        allPostIds.push(postId);
        postRows.push({
          id: postId,
          authorId: ownerId,
          agentId,
          tradeId: null,
          kind: "note",
          body: pick(NOTE_BODIES),
          likeCount: 0,
          commentCount: 0,
          createdAt: at(day, 17),
        });
      }

      // daily equity snapshot
      let positionsValue = 0;
      for (const [tid, pos] of book) positionsValue += pos.amountToken * paths.get(tid)![day];
      snapshotRows.push({
        id: id("snap"),
        agentId,
        equityUsd: toNumeric(cash + positionsValue, 6),
        cashUsd: toNumeric(cash, 6),
        at: at(day, 23),
      });
    }

    if (runRows.length) await db.insert(agentRuns).values(runRows);
    if (stepRows.length) await db.insert(agentRunSteps).values(stepRows);
    if (tradeRows.length) await db.insert(trades).values(tradeRows);
    if (postRows.length) await db.insert(posts).values(postRows);
    if (snapshotRows.length) await db.insert(equitySnapshots).values(snapshotRows);
    if (paymentRows.length) await db.insert(x402Payments).values(paymentRows);

    const openPositions = [...book.entries()].filter(([, p]) => p.amountToken > 1e-9 || p.realizedPnlUsd !== 0);
    if (openPositions.length) {
      await db.insert(positions).values(
        openPositions.map(([tid, p]) => ({
          agentId,
          tokenId: tid,
          amountToken: toNumeric(p.amountToken, 12),
          avgCostUsd: toNumeric(p.avgCostUsd, 12),
          realizedPnlUsd: toNumeric(p.realizedPnlUsd, 6),
          updatedAt: new Date(NOW),
        })),
      );
    }

    // notify the owner about the most recent trade
    const lastTrade = tradeRows.at(-1);
    if (lastTrade) {
      notificationRows.push({
        id: id("ntf"),
        userId: ownerId,
        kind: "trade",
        title: `${spec.name} ${lastTrade.side === "buy" ? "bought" : "sold"} ${SEED_TOKENS.find((t) => tokenId(t) === lastTrade.tokenId)?.symbol ?? "a token"}`,
        body: lastTrade.rationale ?? null,
        href: `/agents/${spec.slug}`,
        readAt: null,
        createdAt: lastTrade.createdAt as Date,
      });
    }
  }

  // ---- social graph ----
  console.log("· social graph");
  const agentRowsForFollows = await db.select({ id: agents.id, ownerId: agents.ownerId, slug: agents.slug, name: agents.name }).from(agents);
  const seedAgentRows = agentRowsForFollows.filter((a) => a.id.includes("_seed"));

  const followRows: Array<typeof follows.$inferInsert> = [];
  for (const user of SEED_USERS) {
    for (const agent of seedAgentRows) {
      if (agent.ownerId === user.id) continue;
      if (chance(0.45)) followRows.push({ followerId: user.id, targetType: "agent", targetId: agent.id, createdAt: at(Math.floor(between(1, 28)), 12) });
    }
    for (const other of SEED_USERS) {
      if (other.id === user.id) continue;
      if (chance(0.5)) followRows.push({ followerId: user.id, targetType: "user", targetId: other.id, createdAt: at(Math.floor(between(1, 28)), 12) });
    }
  }
  if (followRows.length) await db.insert(follows).values(followRows).onConflictDoNothing();

  // likes + comments over a sample of posts
  const likeRows: Array<typeof likes.$inferInsert> = [];
  const commentRows: Array<typeof comments.$inferInsert> = [];
  const likeCounts = new Map<string, number>();
  const commentCounts = new Map<string, number>();

  for (const postId of allPostIds) {
    for (const user of SEED_USERS) {
      if (!chance(0.16)) continue;
      likeRows.push({ userId: user.id, postId, createdAt: new Date(NOW - Math.floor(between(0, 20 * DAY))) });
      likeCounts.set(postId, (likeCounts.get(postId) ?? 0) + 1);
    }
    if (chance(0.08)) {
      const author = pick(SEED_USERS);
      commentRows.push({
        id: id("cmt"),
        postId,
        authorId: author.id,
        body: pick(COMMENT_BODIES),
        createdAt: new Date(NOW - Math.floor(between(0, 15 * DAY))),
      });
      commentCounts.set(postId, (commentCounts.get(postId) ?? 0) + 1);
    }
  }

  if (likeRows.length) await db.insert(likes).values(likeRows).onConflictDoNothing();
  if (commentRows.length) await db.insert(comments).values(commentRows);

  for (const [postId, n] of likeCounts) {
    await db.update(posts).set({ likeCount: n }).where(sql`${posts.id} = ${postId}`);
  }
  for (const [postId, n] of commentCounts) {
    await db.update(posts).set({ commentCount: n }).where(sql`${posts.id} = ${postId}`);
  }

  // a few social notifications for the demo user
  const you = SEED_USERS[0];
  notificationRows.push(
    {
      id: id("ntf"),
      userId: you.id,
      kind: "follow",
      title: "@nova followed you",
      body: null,
      href: "/u/nova",
      readAt: null,
      createdAt: new Date(NOW - 3 * 3_600_000),
    },
    {
      id: id("ntf"),
      userId: you.id,
      kind: "like",
      title: "@kaito liked your post",
      body: "Momentum Mike sold $WIF",
      href: "/feed",
      readAt: null,
      createdAt: new Date(NOW - 7 * 3_600_000),
    },
    {
      id: id("ntf"),
      userId: you.id,
      kind: "comment",
      title: "@mila commented on your post",
      body: "not asking for the prompt, but what score did this clear at?",
      href: "/feed",
      readAt: new Date(NOW - 20 * 3_600_000),
      createdAt: new Date(NOW - 26 * 3_600_000),
    },
    // No "fork" notification: forking does not exist.
  );
  if (notificationRows.length) await db.insert(notifications).values(notificationRows);

  // ---- summary ----
  const [{ n: tradeCount }] = await db.select({ n: sql<number>`count(*)::int` }).from(trades);
  const [{ n: postCount }] = await db.select({ n: sql<number>`count(*)::int` }).from(posts);
  const [{ n: snapCount }] = await db.select({ n: sql<number>`count(*)::int` }).from(equitySnapshots);
  console.log(
    `✓ seeded ${SEED_USERS.length} users · ${SEED_AGENTS.length} agents · ${tradeCount} trades · ${postCount} posts · ${snapCount} snapshots`,
  );
  console.log("  browse as the demo user: DEV_IMPERSONATE_USER_ID=did:privy:seed-you pnpm dev");
}

seed()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
