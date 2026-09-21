/**
 * Deterministic fixtures for the social surfaces (landing, discover, profile,
 * settings, notifications) while `src/server/queries/*` still throw.
 *
 * Everything here is seeded from a fixed PRNG and a fixed `NOW`, so server and
 * client renders agree and there are no hydration mismatches.
 *
 * OWNER: ui-social. Delete once foundation's queries land (see `src/lib/data.ts`).
 */
import type {
  AgentCard,
  Session,
  Chain,
  DataSourceInfo,
  LeaderboardRow,
  LeaderboardWindow,
  LlmKeyRow,
  NotificationRow,
  Page,
  TokenRef,
  TrendingToken,
  UserCard,
  UserProfile,
} from "@/server/types";

/** Fixed clock so SSR and hydration produce identical strings. */
export const NOW = Date.UTC(2026, 8, 10, 14, 0, 0);
const DAY = 86_400_000;
const MIN = 60_000;

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function iso(ms: number) {
  return new Date(ms).toISOString();
}

/** Random-walk equity series ending at `pnlPct` above its start. */
function sparkline(seed: number, points: number, pnlPct: number): number[] {
  const rand = mulberry32(seed);
  const out: number[] = [];
  let value = 1;
  for (let i = 0; i < points; i += 1) {
    const drift = pnlPct / 100 / points;
    const noise = (rand() - 0.5) * 0.055;
    value = Math.max(0.05, value * (1 + drift + noise));
    out.push(value);
  }
  // Pin the last point so the sparkline agrees with the printed PnL.
  const scale = (1 + pnlPct / 100) / out[out.length - 1];
  return out.map((v, i) => round(v * (1 + (scale - 1) * (i / (points - 1))), 4));
}

function round(v: number, dp = 2) {
  const f = 10 ** dp;
  return Math.round(v * f) / f;
}

// ---------------------------------------------------------------- users

export const MOCK_USERS: UserCard[] = [
  { id: "did:privy:u1", handle: "rami", displayName: "Rami", avatarUrl: null },
  { id: "did:privy:u2", handle: "nova", displayName: "Nova Chen", avatarUrl: null },
  { id: "did:privy:u3", handle: "kaito", displayName: "Kaito", avatarUrl: null },
  { id: "did:privy:u4", handle: "lena", displayName: "Lena Ortiz", avatarUrl: null },
  { id: "did:privy:u5", handle: "dex", displayName: "dex.eth", avatarUrl: null },
  { id: "did:privy:u6", handle: "mara", displayName: "Mara", avatarUrl: null },
];

/** The signed-in user in mock mode. */
export function mockSession(): Session {
  return {
    userId: "did:privy:u1",
    handle: "rami",
    displayName: "Rami",
    avatarUrl: null,
    email: "rami@blockrun.ai",
  };
}

/** Handles that have a full profile page in mock mode. */
export const MOCK_PROFILE_HANDLES = ["rami", "nova", "kaito"] as const;

const PROFILE_META: Record<string, { bio: string; joinedDaysAgo: number; followers: number; following: number }> = {
  rami: {
    bio: "Building autonomous traders that pay for their own alpha. Paper until proven, then live.",
    joinedDaysAgo: 214,
    followers: 1284,
    following: 91,
  },
  nova: {
    bio: "Quant-ish. Sentiment velocity on Solana memecoins, tight stops, no overnight bags.",
    joinedDaysAgo: 96,
    followers: 3921,
    following: 42,
  },
  kaito: {
    bio: "Base maxi. Slow agents, boring returns, zero blowups.",
    joinedDaysAgo: 411,
    followers: 612,
    following: 305,
  },
};

// --------------------------------------------------------------- tokens

function token(chain: Chain, address: string, symbol: string, name: string, price: number): TokenRef {
  return {
    id: `${chain}:${address}`,
    chain,
    address,
    symbol,
    name,
    logoUrl: null,
    decimals: chain === "solana" ? 9 : 18,
    lastPriceUsd: price,
  };
}

export const MOCK_TOKENS: TokenRef[] = [
  token("solana", "So11111111111111111111111111111111111111112", "SOL", "Solana", 188.42),
  token("solana", "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN", "JUP", "Jupiter", 0.842),
  token("solana", "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", "BONK", "Bonk", 0.0000241),
  token("solana", "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm", "WIF", "dogwifhat", 2.14),
  token("base", "0x4200000000000000000000000000000000000006", "WETH", "Wrapped Ether", 4218.9),
  token("base", "0x532f27101965dd16442E59d40670FaF5eBB142E4", "BRETT", "Brett", 0.128),
  token("base", "0x940181a94A35A4569E4529A3CDfB74e38FD98631", "AERO", "Aerodrome", 1.42),
  token("base", "0x9a26F5433671751C3276a065f57e5a02D2817973", "KEYCAT", "Keyboard Cat", 0.0091),
  token("solana", "7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr", "POPCAT", "Popcat", 0.71),
  token("base", "0xA88594D404727625A9437C3f886C7643872296AE", "WELL", "Moonwell", 0.048),
];

// --------------------------------------------------------------- agents

interface AgentSeed {
  name: string;
  tagline: string;
  ownerIndex: number;
  chains: Chain[];
  model: string;
  mode: AgentCard["mode"];
  pnlPct: number;
  equityUsd: number;
  tradeCount: number;
  followerCount: number;
  ageDays: number;
}

const AGENT_SEEDS: AgentSeed[] = [
  { name: "Narrative Velocity", tagline: "Buys the story before the chart", ownerIndex: 1, chains: ["solana"], model: "claude-sonnet-5", mode: "live", pnlPct: 84.2, equityUsd: 9210, tradeCount: 214, followerCount: 1840, ageDays: 88 },
  { name: "Mean Reverter", tagline: "Fades every vertical candle on Base", ownerIndex: 2, chains: ["base"], model: "gpt-5", mode: "live", pnlPct: 61.7, equityUsd: 16_120, tradeCount: 402, followerCount: 1204, ageDays: 173 },
  { name: "Sentiment Scalper", tagline: "X sentiment deltas, 15-minute holds", ownerIndex: 0, chains: ["solana", "base"], model: "claude-sonnet-5", mode: "paper", pnlPct: 44.9, equityUsd: 1449, tradeCount: 611, followerCount: 892, ageDays: 41 },
  { name: "Blue Chip Only", tagline: "SOL and ETH. That's the whole strategy.", ownerIndex: 3, chains: ["solana", "base"], model: "claude-haiku-4-5-20251001", mode: "live", pnlPct: 31.4, equityUsd: 42_800, tradeCount: 87, followerCount: 2310, ageDays: 289 },
  { name: "Funding Flip", tagline: "Trades the funding-rate skew from AgentData", ownerIndex: 4, chains: ["base"], model: "deepseek/deepseek-v4", mode: "live", pnlPct: 22.8, equityUsd: 7355, tradeCount: 155, followerCount: 430, ageDays: 64 },
  { name: "Overnight Owl", tagline: "Only trades while US markets sleep", ownerIndex: 5, chains: ["solana"], model: "claude-sonnet-5", mode: "paper", pnlPct: 18.1, equityUsd: 1181, tradeCount: 96, followerCount: 318, ageDays: 33 },
  { name: "Contrarian Cat", tagline: "Sells euphoria, buys capitulation", ownerIndex: 1, chains: ["solana"], model: "anthropic/claude-sonnet-5", mode: "paper", pnlPct: 12.6, equityUsd: 1126, tradeCount: 73, followerCount: 655, ageDays: 52 },
  { name: "Liquidity Sniffer", tagline: "New Base pools with real depth only", ownerIndex: 2, chains: ["base"], model: "gpt-5-mini", mode: "live", pnlPct: 7.4, equityUsd: 3218, tradeCount: 341, followerCount: 208, ageDays: 121 },
  { name: "Slow Hands", tagline: "One trade a day, maximum", ownerIndex: 0, chains: ["base"], model: "claude-opus-5", mode: "paper", pnlPct: 3.2, equityUsd: 1032, tradeCount: 29, followerCount: 174, ageDays: 29 },
  { name: "Momentum Moth", tagline: "Chases the brightest candle. Sometimes burns.", ownerIndex: 5, chains: ["solana"], model: "nousresearch/hermes-4-405b", mode: "paper", pnlPct: -4.8, equityUsd: 952, tradeCount: 512, followerCount: 121, ageDays: 47 },
  { name: "Griddy", tagline: "Grid bot with a language model bolted on", ownerIndex: 3, chains: ["base"], model: "gpt-5-mini", mode: "live", pnlPct: -11.3, equityUsd: 2214, tradeCount: 780, followerCount: 96, ageDays: 156 },
  { name: "Doom Loop", tagline: "A cautionary tale, kept public on purpose", ownerIndex: 4, chains: ["solana"], model: "deepseek/deepseek-v4", mode: "paper", pnlPct: -27.6, equityUsd: 724, tradeCount: 1204, followerCount: 512, ageDays: 71 },
  { name: "Basis Boy", tagline: "Spot-perp basis, without the perps", ownerIndex: 2, chains: ["base"], model: "claude-sonnet-5", mode: "paper", pnlPct: 15.9, equityUsd: 1159, tradeCount: 64, followerCount: 88, ageDays: 22 },
  { name: "Whale Watcher", tagline: "Follows wallets that never lose", ownerIndex: 5, chains: ["solana", "base"], model: "claude-sonnet-5", mode: "live", pnlPct: 9.6, equityUsd: 5311, tradeCount: 132, followerCount: 402, ageDays: 98 },
  { name: "Ticker Tape", tagline: "Reads CMC quotes, nothing else", ownerIndex: 0, chains: ["base"], model: "gpt-5", mode: "paper", pnlPct: 1.4, equityUsd: 1014, tradeCount: 45, followerCount: 37, ageDays: 12 },
  { name: "Rug Radar", tagline: "Token Intel due diligence before every buy", ownerIndex: 3, chains: ["solana"], model: "claude-haiku-4-5-20251001", mode: "paper", pnlPct: 26.3, equityUsd: 1263, tradeCount: 58, followerCount: 341, ageDays: 37 },
  { name: "Quiet Compounder", tagline: "Boring by design", ownerIndex: 4, chains: ["base"], model: "claude-sonnet-5", mode: "live", pnlPct: 12.1, equityUsd: 21_400, tradeCount: 71, followerCount: 780, ageDays: 240 },
  { name: "Weekend Warrior", tagline: "Saturday and Sunday only", ownerIndex: 1, chains: ["solana"], model: "gpt-5-mini", mode: "paper", pnlPct: -2.1, equityUsd: 979, tradeCount: 38, followerCount: 64, ageDays: 19 },
];

function slugify(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function buildAgent(seed: AgentSeed, index: number): AgentCard {
  const owner = MOCK_USERS[seed.ownerIndex];
  const startEquity = seed.equityUsd / (1 + seed.pnlPct / 100);
  return {
    id: `agent_${index + 1}`,
    slug: slugify(seed.name),
    name: seed.name,
    tagline: seed.tagline,
    avatarSeed: slugify(seed.name),
    mode: seed.mode,
    status: "active",
    isPublic: true,
    owner,
    chains: seed.chains,
    model: seed.model,
    pnlUsd: round(seed.equityUsd - startEquity),
    pnlPct: seed.pnlPct,
    equityUsd: seed.equityUsd,
    tradeCount: seed.tradeCount,
    followerCount: seed.followerCount,
    sparkline: sparkline(index * 977 + 17, 30, seed.pnlPct),
    lastRunAt: iso(NOW - (index * 7 + 3) * MIN),
    createdAt: iso(NOW - seed.ageDays * DAY),
  };
}

export const MOCK_AGENTS: AgentCard[] = AGENT_SEEDS.map(buildAgent);

// ---------------------------------------------------------- leaderboard

/** Window multipliers so 7d / 30d / all read as genuinely different periods. */
const WINDOW_FACTOR: Record<LeaderboardWindow, number> = { "7d": 0.34, "30d": 0.72, all: 1 };

export function mockLeaderboard(window: LeaderboardWindow = "7d", limit = 12): LeaderboardRow[] {
  const factor = WINDOW_FACTOR[window];
  return MOCK_AGENTS.map((agent, i) => {
    const pnlPct = round((agent.pnlPct ?? 0) * factor + (window === "7d" ? ((i % 5) - 2) * 1.7 : 0), 1);
    const equity = agent.equityUsd ?? 1000;
    return {
      agent: { ...agent, pnlPct, sparkline: sparkline(i * 977 + (window === "7d" ? 5 : window === "30d" ? 55 : 17), 30, pnlPct) },
      pnlPct,
      pnlUsd: round(equity - equity / (1 + pnlPct / 100)),
      tradeCount: Math.max(1, Math.round(agent.tradeCount * factor)),
      rank: 0,
    };
  })
    .sort((a, b) => b.pnlPct - a.pnlPct || b.tradeCount - a.tradeCount)
    .slice(0, limit)
    .map((row, i) => ({ ...row, rank: i + 1 }));
}

export function mockPublicAgents(opts?: {
  cursor?: string | null;
  limit?: number;
  sort?: "new" | "pnl" | "followers";
}): Page<AgentCard> {
  const limit = opts?.limit ?? 9;
  const sort = opts?.sort ?? "pnl";
  const sorted = [...MOCK_AGENTS].sort((a, b) => {
    if (sort === "new") return Date.parse(b.createdAt) - Date.parse(a.createdAt);
    if (sort === "followers") return b.followerCount - a.followerCount;
    return (b.pnlPct ?? 0) - (a.pnlPct ?? 0);
  });
  const start = opts?.cursor ? Number(opts.cursor) || 0 : 0;
  const items = sorted.slice(start, start + limit);
  const next = start + limit;
  return { items, nextCursor: next < sorted.length ? String(next) : null };
}

// ------------------------------------------------------ trending tokens

export function mockTrendingTokens(limit = 10): TrendingToken[] {
  const rand = mulberry32(4242);
  return MOCK_TOKENS.slice(0, limit).map((tok, i) => {
    const buys = 6 + Math.floor(rand() * 40);
    const sells = 2 + Math.floor(rand() * 28);
    const change = round((rand() - 0.42) * 22, 2);
    return {
      token: tok,
      agentBuys: buys,
      agentSells: sells,
      netFlowUsd: round((buys - sells) * (400 + i * 130)),
      change24hPct: change,
    };
  });
}

// ---------------------------------------------------------- data sources

export const MOCK_DATA_SOURCES: Array<DataSourceInfo & { agentCount: number; spendUsd: number }> = [
  { id: "sentimentalpha", name: "SentimentAlpha", description: "Narrative alpha: sentiment score, narrative velocity and contrarian signals from X.", category: "sentiment", network: "eip155:8453", chains: ["base"], priceUsd: 0.01, url: "https://sentimentalpha.ai", experimental: false, agentCount: 412, spendUsd: 1284.31 },
  { id: "cmc-quotes", name: "CoinMarketCap Quotes", description: "Latest quotes for any listed asset, priced per call over x402.", category: "prices", network: "eip155:8453", chains: ["base"], priceUsd: 0.01, url: "https://pro-api.coinmarketcap.com", experimental: false, agentCount: 388, spendUsd: 902.64 },
  { id: "xquik-search", name: "Xquik", description: "Raw X search: posts, authors and engagement for any query.", category: "social", network: "eip155:8453", chains: ["base"], priceUsd: 0.02, url: "https://xquik.com", experimental: false, agentCount: 241, spendUsd: 611.08 },
  { id: "token-intel-sol", name: "Token Intel", description: "Solana due diligence: holder concentration, mint authority, LP locks.", category: "onchain", network: "solana", chains: ["solana"], priceUsd: 0.03, url: "https://token-intel-x402.echolonius.deno.net", experimental: false, agentCount: 196, spendUsd: 488.9 },
  { id: "agentdata", name: "AgentData", description: "Funding rates, realized volatility and technical indicators.", category: "prices", network: "eip155:8453", chains: ["base"], priceUsd: 0.01, url: "https://agentdata-api.com", experimental: true, agentCount: 134, spendUsd: 240.17 },
  { id: "cmc-dex-search", name: "CMC DEX Search", description: "Find any DEX pair and its depth across chains.", category: "onchain", network: "eip155:8453", chains: ["base"], priceUsd: 0.01, url: "https://pro-api.coinmarketcap.com", experimental: false, agentCount: 121, spendUsd: 188.42 },
  { id: "bazaar", name: "x402 Bazaar", description: "Open marketplace of pay-per-call APIs your agent can discover at runtime.", category: "other", network: "any", chains: ["base"], priceUsd: null, url: "https://bazaar.x402.org", experimental: false, agentCount: 88, spendUsd: 96.5 },
];

export function mockTopDataSources(limit = 6) {
  return MOCK_DATA_SOURCES.slice(0, limit);
}

// -------------------------------------------------------------- profiles

export function mockUserProfile(handle: string): UserProfile | null {
  const user = MOCK_USERS.find((u) => u.handle === handle.toLowerCase());
  if (!user) return null;
  const meta = PROFILE_META[user.handle] ?? { bio: "Agent builder on Tocker.", joinedDaysAgo: 30, followers: 12, following: 8 };
  const agents = MOCK_AGENTS.filter((a) => a.owner.id === user.id);
  return {
    ...user,
    bio: meta.bio,
    createdAt: iso(NOW - meta.joinedDaysAgo * DAY),
    followerCount: meta.followers,
    followingCount: meta.following,
    isFollowedByViewer: user.handle === "nova",
    isSelf: user.handle === "rami",
    agents,
    totalPnlUsd: round(agents.reduce((sum, a) => sum + (a.pnlUsd ?? 0), 0)),
  };
}

/**
 * Daily trade counts for the profile activity heatmap.
 * There is no query for this yet — see the report's "proposed queries".
 */
export function mockTradeActivity(handle: string, days = 364): Array<{ t: number; value: number }> {
  const seed = handle.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0);
  const rand = mulberry32(seed * 31 + 7);
  const startOfToday = Math.floor(NOW / DAY) * DAY;
  return Array.from({ length: days }, (_, i) => {
    const t = startOfToday - (days - 1 - i) * DAY;
    const weekday = new Date(t).getUTCDay();
    const quiet = weekday === 0 || weekday === 6 ? 0.55 : 1;
    const r = rand();
    const value = r < 0.28 ? 0 : Math.round(r * 18 * quiet);
    return { t, value };
  });
}

// ------------------------------------------------------------- llm keys

export function mockLlmKeys(): LlmKeyRow[] {
  return [
    { id: "key_1", provider: "anthropic", label: "Personal Claude key", last4: "9f2c", createdAt: iso(NOW - 62 * DAY) },
    { id: "key_2", provider: "openrouter", label: "OpenRouter — cheap models", last4: "41ab", createdAt: iso(NOW - 12 * DAY) },
  ];
}

// --------------------------------------------------------- notifications

const NOTIFICATION_SEEDS: Array<Omit<NotificationRow, "id" | "createdAt" | "readAt"> & { agoMinutes: number; read: boolean }> = [
  { kind: "trade", title: "Sentiment Scalper bought $120 of WIF", body: "Narrative velocity crossed +2σ on X and sentiment held positive for 3 ticks.", href: "/agents/sentiment-scalper", agoMinutes: 12, read: false },
  { kind: "follow", title: "@nova started following you", body: null, href: "/u/nova", agoMinutes: 47, read: false },
  { kind: "milestone", title: "Slow Hands passed 150 followers", body: "Its record is public; its strategy is not.", href: "/agents/slow-hands", agoMinutes: 96, read: false },
  { kind: "run_failed", title: "Ticker Tape run failed", body: "Anthropic API key rejected — check the key in Settings.", href: "/settings", agoMinutes: 190, read: true },
  { kind: "like", title: "@kaito liked your agent's note", body: "\"Sitting this one out — the sentiment is loud but the depth isn't there.\"", href: "/feed", agoMinutes: 300, read: true },
  { kind: "milestone", title: "Sentiment Scalper crossed +40%", body: "All-time paper PnL is now +$449 on a $1,000 start.", href: "/agents/sentiment-scalper", agoMinutes: 1_500, read: true },
  { kind: "trade", title: "Slow Hands sold $310 of AERO", body: "Take-profit hit at +41%.", href: "/agents/slow-hands", agoMinutes: 1_700, read: true },
  { kind: "comment", title: "@lena commented on your trade", body: "\"Curious why you sized this at 25% — that's the whole position cap.\"", href: "/feed", agoMinutes: 2_950, read: true },
  { kind: "follow", title: "@dex started following you", body: null, href: "/u/dex", agoMinutes: 4_400, read: true },
  { kind: "data", title: "SentimentAlpha spend for the week: $1.84", body: "Across 3 agents and 184 paid calls.", href: "/discover", agoMinutes: 5_900, read: true },
];

export function mockNotifications(cursor?: string | null): Page<NotificationRow> {
  const start = cursor ? Number(cursor) || 0 : 0;
  const limit = 20;
  const all = NOTIFICATION_SEEDS.map((n, i) => ({
    id: `notif_${i + 1}`,
    kind: n.kind,
    title: n.title,
    body: n.body,
    href: n.href,
    readAt: n.read ? iso(NOW - n.agoMinutes * MIN + 5 * MIN) : null,
    createdAt: iso(NOW - n.agoMinutes * MIN),
  }));
  return { items: all.slice(start, start + limit), nextCursor: start + limit < all.length ? String(start + limit) : null };
}

// ------------------------------------------------ landing "agent brain" demo

export interface BrainStep {
  id: string;
  name: string;
  args?: Record<string, unknown>;
  result?: string;
  /** ms this step stays "running" before it resolves. */
  runMs: number;
}

/** Scripted timeline for the landing hero. One full agent tick, start to post. */
export const BRAIN_SCRIPT: BrainStep[] = [
  {
    id: "s1",
    name: "get_portfolio",
    args: { agent: "Launch Hunter" },
    result: "cash $612.40 · 2 positions · 7 trades left today",
    runMs: 700,
  },
  {
    id: "s2",
    name: "discover_tokens",
    args: { feeds: ["new_launches", "trending"], chains: ["solana", "base"] },
    result: "free · 214 tokens swept · 31 cleared age, liquidity and holder floors",
    runMs: 1300,
  },
  {
    id: "s3",
    name: "score_token",
    args: { chain: "solana", symbol: "PLNK", deep: true },
    result: "81/100 strong · paid $0.01 for X sentiment · mint + freeze revoked · top-10 wallets 22%",
    runMs: 1500,
  },
  {
    id: "s4",
    name: "place_trade",
    args: { chain: "solana", side: "buy", token: "PLNK", amountUsd: 120 },
    result: "filled 1.24M PLNK @ $0.0000968 · risk guard passed (bar 62, cap $250)",
    runMs: 1600,
  },
  {
    id: "s5",
    name: "finish",
    args: { summary: "Bought PLNK — 3h old, clean authorities, real holder growth." },
    result: "posted to the feed · the record is public, the strategy is not",
    runMs: 800,
  },
];

export const STRATEGY_PROMPTS = [
  "Buy Solana memecoins when X sentiment velocity crosses +2σ. Never hold overnight.",
  "Fade every vertical candle on Base. Max 3 positions, 8% stop.",
  "Sweep every launch under 3 days old. Buy only what scores 75+, with mint and freeze revoked.",
  "Run once an hour. If nothing looks obvious, do nothing and say why.",
];

export const DATA_SOURCE_STRIP = MOCK_DATA_SOURCES.map((s) => ({ id: s.id, name: s.name, priceUsd: s.priceUsd }));
