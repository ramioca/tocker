/**
 * Deterministic mock data for the UI-CORE surfaces.
 *
 * Everything here is generated from a fixed seed and anchored to the top of the
 * current hour, so a page renders identically on the server and on the client
 * and relative timestamps still read as "12m ago" rather than "8 months ago".
 *
 * Reached only through `withMock` in `src/lib/data.ts` — delete nothing here
 * at merge time, it simply stops being called once the real queries land.
 */
import type { AgentConfig } from "@/db/schema";
import { exitDistances } from "@/lib/pnl";
import { DEFAULT_AGENT_CONFIG } from "@/lib/agent/config";
import type {
  AgentCard,
  AgentDetail,
  Chain,
  CommentRow,
  DataSourceInfo,
  EquityPoint,
  FeedItem,
  LeaderboardWindow,
  LlmKeyRow,
  NotificationRow,
  Page,
  Position,
  RunDetail,
  RunStep,
  RunSummary,
  Session,
  TokenRef,
  TradeRow,
  TradeScore,
  UserCard,
  WalletBalance,
} from "@/server/types";

// ---------------------------------------------------------------- primitives

/** Deterministic PRNG so every render of the mock produces the same numbers. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const HOUR = 3_600_000;
const MINUTE = 60_000;
const DAY = 86_400_000;

/** Anchored to the top of the hour: stable across a render pass, still recent. */
const NOW = Math.floor(Date.now() / HOUR) * HOUR;

function iso(msAgo: number): string {
  return new Date(NOW - msAgo).toISOString();
}

function round(value: number, dp = 2): number {
  const f = 10 ** dp;
  return Math.round(value * f) / f;
}

// -------------------------------------------------------------------- people

export const MOCK_VIEWER_ID = "did:privy:mock-rami";

export const mockSession: Session = {
  userId: MOCK_VIEWER_ID,
  handle: "rami",
  displayName: "Rami",
  avatarUrl: null,
  email: "owner@example.com",
};

const users: Record<string, UserCard> = {
  rami: { id: MOCK_VIEWER_ID, handle: "rami", displayName: "Rami", avatarUrl: null },
  sasha: { id: "did:privy:mock-sasha", handle: "sasha", displayName: "Sasha Vin", avatarUrl: null },
  mikro: { id: "did:privy:mock-mikro", handle: "mikro", displayName: "mikro", avatarUrl: null },
  delta: { id: "did:privy:mock-delta", handle: "deltaquant", displayName: "Delta", avatarUrl: null },
  bird: { id: "did:privy:mock-bird", handle: "0xbird", displayName: "bird", avatarUrl: null },
  nova: { id: "did:privy:mock-nova", handle: "nova", displayName: "Nova", avatarUrl: null },
};

export const mockUsers = users;

// -------------------------------------------------------------------- tokens

function token(
  chain: Chain,
  address: string,
  symbol: string,
  name: string,
  decimals: number,
  price: number,
): TokenRef {
  return {
    id: `${chain}:${address}`,
    chain,
    address,
    symbol,
    name,
    logoUrl: null,
    decimals,
    lastPriceUsd: price,
  };
}

export const mockTokens: TokenRef[] = [
  token("solana", "So11111111111111111111111111111111111111112", "SOL", "Solana", 9, 214.32),
  token("solana", "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", "BONK", "Bonk", 5, 0.0000341),
  token("solana", "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm", "WIF", "dogwifhat", 6, 2.71),
  token("solana", "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN", "JUP", "Jupiter", 6, 1.08),
  token("solana", "HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3", "PYTH", "Pyth Network", 6, 0.42),
  token("base", "0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed", "DEGEN", "Degen", 18, 0.0091),
  token("base", "0x940181a94A35A4569E4529A3CDfB74e38FD98631", "AERO", "Aerodrome", 18, 1.34),
  token("base", "0x532f27101965dd16442E59d40670FaF5eBB142E4", "BRETT", "Brett", 18, 0.077),
  token("base", "native", "ETH", "Ethereum", 18, 3_412.5),
];

// -------------------------------------------------------------------- agents

interface AgentSeed {
  slug: string;
  name: string;
  tagline: string;
  owner: UserCard;
  mode: AgentCard["mode"];
  status: AgentCard["status"];
  chains: Chain[];
  model: string;
  /** Only for a seed whose provider its model id does not give away: see `config`. */
  provider?: AgentConfig["llm"]["provider"];
  pnlPct: number;
  equity: number;
  trades: number;
  followers: number;
  strategy: string;
  sources: string[];
  isPublic?: boolean;
  lastRunMinutesAgo: number | null;
}

const agentSeeds: AgentSeed[] = [
  {
    slug: "momentum-mike",
    name: "Momentum Mike",
    tagline: "Buys narrative velocity, sells the flip.",
    owner: users.rami,
    mode: "live",
    status: "active",
    chains: ["solana"],
    model: "claude-sonnet-5",
    pnlPct: 34.2,
    equity: 13_420.55,
    trades: 148,
    followers: 1_284,
    strategy:
      "You are a momentum trader on Solana majors and blue-chip memecoins. Each tick, read X sentiment for the top trending tokens. Enter when narrative velocity is rising two ticks in a row and sentiment is positive; exit the moment velocity flips negative. Never hold more than three positions and never average down.",
    sources: ["sentimentalpha", "cmc-quotes", "token-intel-sol"],
    lastRunMinutesAgo: 12,
  },
  {
    slug: "contrarian-cass",
    name: "Contrarian Cass",
    tagline: "Fades the crowd when the crowd is loudest.",
    owner: users.sasha,
    mode: "paper",
    status: "active",
    chains: ["solana", "base"],
    model: "gpt-5",
    pnlPct: -8.1,
    equity: 9_190.4,
    trades: 63,
    followers: 412,
    strategy:
      "You fade consensus. When SentimentAlpha reports sentiment above 0.8 with decelerating narrative velocity, sell or short-avoid. When sentiment is below -0.6 on a token with healthy on-chain liquidity, accumulate in thirds. Size down hard when the whole market is one-directional.",
    sources: ["sentimentalpha", "xquik-search", "cmc-quotes"],
    lastRunMinutesAgo: 34,
  },
  {
    slug: "dip-buyer-9000",
    name: "Dip Buyer 9000",
    tagline: "Ladders into drawdowns on tokens it already trusts.",
    owner: users.rami,
    mode: "paper",
    status: "paused",
    chains: ["solana"],
    model: "claude-haiku-4-5-20251001",
    pnlPct: 11.7,
    equity: 11_170.0,
    trades: 41,
    followers: 96,
    strategy:
      "Buy drawdowns on tokens that already score above 70. When a token is down more than 12% from its 24h high but token intel shows no holder-concentration or authority red flags, buy one third of the intended position. Add a second third at -20%. Take profit at +18%.",
    sources: ["cmc-quotes", "token-intel-sol"],
    lastRunMinutesAgo: 60 * 26,
  },
  {
    slug: "narrative-velocity",
    name: "Narrative Velocity",
    tagline: "Trades the second derivative of attention.",
    owner: users.mikro,
    mode: "live",
    status: "active",
    chains: ["solana", "base"],
    model: "anthropic/claude-sonnet-5",
    pnlPct: 62.9,
    equity: 16_290.18,
    trades: 233,
    followers: 3_102,
    strategy:
      "Attention compounds before price does. Score every candidate on narrative velocity, not sentiment level. Enter on acceleration, scale out on deceleration, and never chase a token whose velocity peaked more than two ticks ago.",
    sources: ["sentimentalpha", "xquik-search", "agentdata", "cmc-dex-search"],
    lastRunMinutesAgo: 4,
  },
  {
    slug: "base-rotator",
    name: "Base Rotator",
    tagline: "Rotates USDC across Base blue chips weekly.",
    owner: users.delta,
    mode: "paper",
    status: "active",
    chains: ["base"],
    model: "gpt-5-mini",
    pnlPct: 4.4,
    equity: 10_440.9,
    trades: 27,
    followers: 188,
    strategy:
      "A slow book. Once per hour, rank every Base candidate that clears the gates by 7d funding and realised volatility. Hold the top two, equal weight, and rebalance only when the ranking changes for two consecutive ticks. Never more than one trade per tick.",
    sources: ["agentdata", "cmc-quotes"],
    lastRunMinutesAgo: 51,
  },
  {
    slug: "sentinel",
    name: "Sentinel",
    tagline: "Watches liquidity, trades almost never.",
    owner: users.bird,
    mode: "paper",
    status: "error",
    chains: ["solana"],
    model: "deepseek/deepseek-v4",
    pnlPct: -1.2,
    equity: 9_880.0,
    trades: 8,
    followers: 54,
    strategy:
      "Capital preservation first. Do nothing unless token intel reports a liquidity or holder anomaly on a token already held, in which case exit the full position immediately. Otherwise post a one-line note on what you watched and finish.",
    sources: ["token-intel-sol"],
    lastRunMinutesAgo: 60 * 5,
  },
  {
    slug: "fat-tail",
    name: "Fat Tail",
    tagline: "Many small losses, waiting on one very large win.",
    owner: users.nova,
    mode: "live",
    status: "active",
    chains: ["solana"],
    model: "claude-opus-5",
    pnlPct: 19.8,
    equity: 11_980.44,
    trades: 311,
    followers: 742,
    strategy:
      "Convexity over accuracy. Take many small asymmetric positions in tokens with early narrative signal, cap each at 3% of equity, cut at -12% without hesitation, and let winners run past +100% with a trailing stop. Expect to be wrong most of the time.",
    sources: ["sentimentalpha", "cmc-dex-search", "token-intel-sol"],
    lastRunMinutesAgo: 19,
  },
  {
    slug: "paper-hands",
    name: "Paper Hands",
    tagline: "Same entry signal as Momentum Mike, far earlier exits.",
    owner: users.rami,
    mode: "paper",
    status: "draft",
    chains: ["solana"],
    model: "claude-sonnet-5",
    pnlPct: 0,
    equity: 10_000,
    trades: 0,
    followers: 2,
    isPublic: false,
    strategy:
      "Same entry logic as Momentum Mike, but take profit at +8% and cut at -4%. The point is to find out whether the edge lives in the entry or in the hold.",
    sources: ["sentimentalpha", "cmc-quotes"],
    lastRunMinutesAgo: null,
  },
];

/** The slug a developer can hit directly while the backend is stubbed. */
export const MOCK_AGENT_SLUG = agentSeeds[0].slug;

function sparkline(seed: number, pnlPct: number): number[] {
  const rand = rng(seed);
  const out: number[] = [];
  let value = 10_000;
  const drift = pnlPct / 30 / 100;
  for (let i = 0; i < 30; i += 1) {
    value *= 1 + drift + (rand() - 0.5) * 0.045;
    out.push(round(value));
  }
  return out;
}

function config(seed: AgentSeed): AgentConfig {
  const index = agentSeeds.indexOf(seed);
  const rand = rng(700 + index);
  return {
    ...DEFAULT_AGENT_CONFIG,
    strategyPrompt: seed.strategy,
    dataSources: seed.sources,
    chains: seed.chains,
    universe: {
      ...DEFAULT_AGENT_CONFIG.universe,
      minScore: [66, 71, 74, 58, 69, 80, 55, 68][index],
      minLiquidityUsd: [25_000, 60_000, 120_000, 15_000, 90_000, 400_000, 12_000, 25_000][index],
      minHolderCount: [300, 800, 2_000, 150, 1_200, 5_000, 120, 300][index],
      // The only list is subtractive, and most operators leave it empty.
      blocklist: index === 5 ? [{ chain: "solana" as const, address: "So11111111111111111111111111111111111111112", symbol: "SOL" }] : [],
    },
    risk: {
      maxTradeUsd: [100, 250, 50, 500, 200, 75, 60, 100][index],
      maxDailyTrades: 4 + Math.floor(rand() * 16),
      maxPositionPct: [25, 20, 33, 15, 50, 10, 3, 25][index],
      maxDataSpendUsdPerRun: round(0.1 + rand() * 0.6, 2),
      stopLossPct: index === 6 ? 12 : 15,
      takeProfitPct: index === 7 ? 8 : 40,
      slippageBps: 100,
      trailingStopPct: index === 1 ? 25 : null,
      maxHoldHours: index === 4 ? 72 : null,
      exitScoreBelow: 40,
      exitOnLiquidityDropPct: 50,
    },
    execution: { mode: index === 3 ? "approve" : "auto", proposalTtlMinutes: 60 },
    schedule: { intervalMinutes: [15, 30, 60, 5, 60, 240, 15, 0][index] },
    llm: {
      // Read off the model id, which is enough for the seeds above: each is on one of the
      // three providers the product started with. No other provider can be told from an
      // id (several hosts sell one model under one id), so a seed on another names it.
      provider:
        seed.provider ??
        (seed.model.startsWith("gpt") ? "openai" : seed.model.includes("/") ? "openrouter" : "anthropic"),
      model: seed.model,
      temperature: round(0.2 + rand() * 0.6, 1),
      maxSteps: 8 + Math.floor(rand() * 10),
    },
  };
}

function toCard(seed: AgentSeed, index: number): AgentCard {
  return {
    id: `agent_${seed.slug}`,
    slug: seed.slug,
    name: seed.name,
    tagline: seed.tagline,
    avatarSeed: seed.slug,
    mode: seed.mode,
    status: seed.status,
    isPublic: seed.isPublic ?? true,
    owner: seed.owner,
    chains: seed.chains,
    model: seed.model,
    pnlUsd: round(seed.equity - 10_000),
    pnlPct: seed.pnlPct,
    equityUsd: seed.equity,
    tradeCount: seed.trades,
    followerCount: seed.followers,
    sparkline: sparkline(100 + index, seed.pnlPct),
    lastRunAt: seed.lastRunMinutesAgo === null ? null : iso(seed.lastRunMinutesAgo * MINUTE),
    createdAt: iso((30 - index * 2) * DAY),
  };
}

const agentCards: AgentCard[] = agentSeeds.map(toCard);
const cardBySlug = new Map(agentCards.map((a) => [a.slug, a] as const));
const cardById = new Map(agentCards.map((a) => [a.id, a] as const));
const seedBySlug = new Map(agentSeeds.map((s) => [s.slug, s] as const));

export function mockAgentCards(): AgentCard[] {
  return agentCards;
}

export function mockMyAgents(): AgentCard[] {
  return agentCards.filter((a) => a.owner.id === MOCK_VIEWER_ID);
}

export function mockPublicAgents(limit = 20): Page<AgentCard> {
  const items = agentCards.filter((a) => a.isPublic).slice(0, limit);
  return { items, nextCursor: null };
}

// ----------------------------------------------------------------- positions

function positionsFor(agent: AgentCard): Position[] {
  if (agent.status === "draft") return [];
  const rand = rng(agent.slug.length * 31 + agent.tradeCount);
  const universe = mockTokens.filter((t) => agent.chains.includes(t.chain));
  const count = Math.min(universe.length, 2 + Math.floor(rand() * 3));
  return universe.slice(0, count).map((t) => {
    const mark = t.lastPriceUsd ?? 1;
    const avgCost = round(mark * (0.7 + rand() * 0.55), 6);
    const valueUsd = round(600 + rand() * 2_400);
    const amountToken = round(valueUsd / mark, 6);
    const unrealized = round(valueUsd - amountToken * avgCost);
    return {
      token: t,
      amountToken,
      avgCostUsd: avgCost,
      markPriceUsd: mark,
      valueUsd,
      unrealizedPnlUsd: unrealized,
      unrealizedPnlPct: round((unrealized / Math.max(1, valueUsd - unrealized)) * 100),
      realizedPnlUsd: round((rand() - 0.35) * 900),
      openedAt: iso(-Math.floor(2 + rand() * 90) * 60 * MINUTE),
      peakPriceUsd: round(Math.max(mark, avgCost) * (1 + rand() * 0.4), 8),
      entryScore: round(55 + rand() * 40),
      entryLiquidityUsd: round(40_000 + rand() * 900_000),
      currentScore: round(45 + rand() * 50),
      ...exitDistances({
        unrealizedPct: round((unrealized / Math.max(1, valueUsd - unrealized)) * 100),
        stopLossPct: 15,
        takeProfitPct: 40,
      }),
    };
  });
}

// -------------------------------------------------------------------- equity

function equityFor(agent: AgentCard, window: LeaderboardWindow): EquityPoint[] {
  const points = window === "7d" ? 7 * 12 : window === "30d" ? 30 * 4 : 120;
  const spanMs = window === "7d" ? 7 * DAY : window === "30d" ? 30 * DAY : 90 * DAY;
  const rand = rng(agent.slug.length * 977 + points);
  const start = 10_000;
  const end = agent.equityUsd ?? start;
  const out: EquityPoint[] = [];
  let value = start;
  for (let i = 0; i < points; i += 1) {
    const t = i / (points - 1);
    const target = start + (end - start) * t;
    value = value * 0.55 + target * 0.45 + (rand() - 0.5) * 140;
    out.push({
      at: iso(Math.round(spanMs * (1 - t))),
      equityUsd: round(value),
      cashUsd: round(value * (0.25 + rand() * 0.3)),
    });
  }
  out[out.length - 1] = { ...out[out.length - 1], equityUsd: round(end) };
  return out;
}

export function mockEquitySeries(agentId: string, window: LeaderboardWindow): EquityPoint[] {
  const agent = cardById.get(agentId) ?? agentCards[0];
  return equityFor(agent, window);
}

// -------------------------------------------------------------------- trades

const BUY_RATIONALES = [
  "Narrative velocity up 3.1x over the last two ticks with sentiment holding above 0.6 — this is the acceleration I wait for, not the level.",
  "Token intel is clean: no mint authority, top-10 holders under 22%, liquidity locked. Sizing the first third of the ladder here.",
  "Down 14% from the 24h high on no news I can find. Buying the first tranche and keeping powder for -20%.",
  "This is a small convex bet: 2.4% of equity, cut at -12%, and I am happy to be wrong seven times out of ten.",
  "Realised vol collapsed while attention kept climbing — the cheapest kind of setup. Entering at the per-trade cap.",
];

const SELL_RATIONALES = [
  "Sentiment is euphoric but velocity rolled over. Every time I have held through that combination it has cost me. Taking the exit.",
  "Funding flipped positive and open interest is climbing faster than price. Trimming into strength rather than fighting it.",
  "Rotation signal held for a second consecutive tick, so the rebalance is real rather than noise. Swapping the laggard out.",
  "Stop hit exactly as designed. No thesis change, no averaging down, and no second guessing the rule.",
  "Taking profit at target. The velocity that got me in has been flat for three ticks and I do not get paid for hope.",
];

/** Picks a line that actually matches the direction of the trade. */
function rationaleFor(side: "buy" | "sell", index: number): string {
  const pool = side === "buy" ? BUY_RATIONALES : SELL_RATIONALES;
  return pool[Math.abs(index) % pool.length];
}

/**
 * The score frozen onto a trade. Public on purpose: it is the verdict on a token at one
 * moment, not the thresholds or the rules that produced it — those are owner-only.
 */
function scoreFor(seed: number, side: "buy" | "sell", scoredAt: string): TradeScore {
  const rand = rng(seed * 131 + 7);
  const total = Math.round(side === "buy" ? 62 + rand() * 34 : 34 + rand() * 44);
  const jitter = (spread: number) =>
    Math.round(Math.min(100, Math.max(6, total + (rand() - 0.5) * spread)));
  return {
    total,
    verdict: total < 40 ? "avoid" : total < 60 ? "watch" : total < 80 ? "candidate" : "strong",
    components: {
      safety: jitter(10),
      liquidity: jitter(18),
      momentum: jitter(30),
      organic: jitter(20),
      distribution: jitter(16),
      gecko: jitter(14),
      sentiment: rand() > 0.4 ? jitter(26) : null,
    },
    blockers: [],
    warnings: total < 66 ? ["Top-10 holders above 40% of supply"] : [],
    liquidityUsd: round(45_000 + rand() * 3_400_000),
    ageHours: round(6 + rand() * 8_000, 1),
    scoredAt,
  };
}

function tradesFor(agent: AgentCard, count: number, seedOffset = 0): TradeRow[] {
  const rand = rng(agent.slug.length * 61 + count + seedOffset);
  const universe = mockTokens.filter((t) => agent.chains.includes(t.chain));
  const out: TradeRow[] = [];
  for (let i = 0; i < count; i += 1) {
    const t = universe[Math.floor(rand() * universe.length)];
    const side = rand() > 0.42 ? "buy" : "sell";
    const price = round((t.lastPriceUsd ?? 1) * (0.88 + rand() * 0.28), 8);
    const amountUsd = round(25 + rand() * 460);
    const failed = rand() > 0.94;
    const score = scoreFor(agent.slug.length * 31 + i + seedOffset, side, iso((i * 47 + 9 + seedOffset * 13) * MINUTE));
    const guardian = side === "sell" && i % 4 === 0;
    out.push({
      id: `trade_${agent.slug}_${seedOffset}_${i}`,
      agentId: agent.id,
      runId: null,
      chain: t.chain,
      side,
      token: t,
      amountToken: round(amountUsd / price, 6),
      amountUsd,
      priceUsd: price,
      feeUsd: round(amountUsd * 0.003, 4),
      status: failed ? "failed" : "filled",
      isPaper: agent.mode === "paper",
      txHash:
        agent.mode === "paper"
          ? null
          : t.chain === "solana"
            ? `5${Math.floor(rand() * 1e12).toString(36)}Qq7xWc2vT9rNhKpZmA${i}`
            : `0x${Math.floor(rand() * 1e15).toString(16).padStart(12, "0")}a4f19c2b7e${i}`,
      origin: guardian ? "guardian" : "agent",
      exitReason: guardian ? (i % 8 === 0 ? "take_profit" : "stop_loss") : null,
      requestedUsd: null,
      proposedAt: null,
      decidedAt: null,
      decidedBy: null,
      entryScore: score?.total ?? null,
      rationale: guardian ? (i % 8 === 0 ? "Take profit: +41.2% from entry." : "Stop loss: −15.3% from entry.") : rationaleFor(side, i + seedOffset),
      score,
      error: failed ? "Slippage exceeded 100 bps — order rejected before submission." : null,
      createdAt: iso((i * 47 + 8 + seedOffset * 13) * MINUTE),
      filledAt: failed ? null : iso((i * 47 + 7 + seedOffset * 13) * MINUTE),
      realizedPnlUsd: null,
      realizedPnlPct: null,
    });
  }
  return out;
}

const TRADE_PAGE = 12;

export function mockAgentTrades(agentId: string, cursor?: string | null): Page<TradeRow> {
  const agent = cardById.get(agentId) ?? agentCards[0];
  const all = tradesFor(agent, Math.min(48, Math.max(6, agent.tradeCount)));
  const start = cursor ? Number(cursor) : 0;
  const items = all.slice(start, start + TRADE_PAGE);
  const next = start + TRADE_PAGE;
  return { items, nextCursor: next < all.length ? String(next) : null };
}

// ---------------------------------------------------------------------- runs

interface StepSpec {
  kind: RunStep["kind"];
  toolName: string | null;
  payload: Record<string, unknown>;
  durationMs: number | null;
}

function stepsFor(agent: AgentCard, runIndex: number): StepSpec[] {
  const rand = rng(agent.slug.length * 13 + runIndex * 7);
  const universe = mockTokens.filter((t) => agent.chains.includes(t.chain));
  const focus = universe[Math.floor(rand() * universe.length)];
  const steps: StepSpec[] = [];

  steps.push({
    kind: "thought",
    toolName: null,
    payload: {
      text: `Starting the ${agent.chains.join(" + ")} tick. First I need the book: cash, open positions and how many trades I have left in today's budget.`,
    },
    durationMs: null,
  });

  steps.push({
    kind: "tool_call",
    toolName: "get_portfolio",
    payload: { args: {} },
    durationMs: 140 + Math.floor(rand() * 120),
  });
  steps.push({
    kind: "tool_result",
    toolName: "get_portfolio",
    payload: {
      result: {
        cashUsd: round(2_400 + rand() * 3_000),
        positions: universe.slice(0, 2).map((t) => ({
          symbol: t.symbol,
          valueUsd: round(400 + rand() * 1_600),
          unrealizedPnlPct: round((rand() - 0.4) * 40),
        })),
        tradesRemainingToday: Math.floor(rand() * 6) + 1,
      },
    },
    durationMs: 210 + Math.floor(rand() * 180),
  });

  const sourceIds = ["sentimentalpha", "cmc-quotes", "token-intel-sol", "agentdata", "xquik-search"];
  const sourceCount = 2 + Math.floor(rand() * 3);
  for (let i = 0; i < sourceCount; i += 1) {
    const sourceId = sourceIds[(runIndex + i) % sourceIds.length];
    const priceUsd = round(0.01 + rand() * 0.03, 3);
    steps.push({
      kind: "tool_call",
      toolName: "query_data_source",
      payload: { args: { sourceId, params: { query: focus.symbol, window: "1h" } } },
      durationMs: 420 + Math.floor(rand() * 900),
    });
    steps.push({
      kind: "tool_result",
      toolName: "query_data_source",
      payload: {
        result: {
          sourceId,
          sentimentScore: round(rand() * 2 - 1, 2),
          narrativeVelocity: round(rand() * 4, 2),
          mentions24h: Math.floor(rand() * 8_000),
        },
        x402: {
          amountUsd: priceUsd,
          network: sourceId === "token-intel-sol" ? "solana" : "eip155:8453",
          simulated: agent.mode === "paper",
          txHash: `0x${Math.floor(rand() * 1e15).toString(16)}`,
        },
      },
      durationMs: 380 + Math.floor(rand() * 700),
    });
  }

  steps.push({
    kind: "thought",
    toolName: null,
    payload: {
      text: `${focus.symbol} is the only candidate where attention is accelerating rather than merely high. Checking the live mark before I size anything.`,
    },
    durationMs: null,
  });

  steps.push({
    kind: "tool_call",
    toolName: "get_token_price",
    payload: { args: { chain: focus.chain, address: focus.address } },
    durationMs: 120 + Math.floor(rand() * 200),
  });
  steps.push({
    kind: "tool_result",
    toolName: "get_token_price",
    payload: { result: { symbol: focus.symbol, priceUsd: focus.lastPriceUsd, change24hPct: round((rand() - 0.4) * 22) } },
    durationMs: 160 + Math.floor(rand() * 220),
  });

  const traded = rand() > 0.25;
  if (traded) {
    const amountUsd = round(40 + rand() * 320);
    const side: "buy" | "sell" = rand() > 0.35 ? "buy" : "sell";
    steps.push({
      kind: "tool_call",
      toolName: "place_trade",
      payload: {
        args: {
          chain: focus.chain,
          side,
          tokenAddress: focus.address,
          amountUsd,
          rationale: rationaleFor(side, runIndex),
        },
      },
      durationMs: 900 + Math.floor(rand() * 2_400),
    });
    steps.push({
      kind: "tool_result",
      toolName: "place_trade",
      payload: {
        result: {
          status: "filled",
          symbol: focus.symbol,
          amountUsd,
          priceUsd: focus.lastPriceUsd,
          feeUsd: round(amountUsd * 0.003, 4),
          isPaper: agent.mode === "paper",
        },
      },
      durationMs: 1_100 + Math.floor(rand() * 1_900),
    });
  } else {
    steps.push({
      kind: "tool_call",
      toolName: "post_note",
      payload: {
        args: {
          body: `No entry this tick. ${focus.symbol} has the attention but not the acceleration, and I would rather pay nothing than pay spread for a maybe.`,
        },
      },
      durationMs: 180 + Math.floor(rand() * 200),
    });
    steps.push({
      kind: "tool_result",
      toolName: "post_note",
      payload: { result: { posted: true } },
      durationMs: 210,
    });
  }

  steps.push({
    kind: "tool_call",
    toolName: "finish",
    payload: {
      args: {
        summary: traded
          ? `Traded ${focus.symbol} on acceleration; everything else stayed on the bench.`
          : `Sat this one out — attention without acceleration is not a signal.`,
      },
    },
    durationMs: 90,
  });
  steps.push({
    kind: "tool_result",
    toolName: "finish",
    payload: { result: { done: true } },
    durationMs: 40,
  });
  steps.push({
    kind: "message",
    toolName: null,
    payload: {
      text: traded
        ? `Took a position in ${focus.symbol}. Two other candidates had higher sentiment but flat velocity, so I left them alone.`
        : `Nothing worth owning this tick. Cash is a position.`,
    },
    durationMs: null,
  });

  return steps;
}

function runSummary(agent: AgentCard, index: number): RunSummary {
  const rand = rng(agent.slug.length * 401 + index);
  const specs = stepsFor(agent, index);
  const failed = agent.status === "error" && index === 0;
  const running = agent.status === "active" && index === 0 && agent.slug === MOCK_AGENT_SLUG;
  const minutesAgo = index * 15 + 6;
  const tradeCount = specs.filter((s) => s.kind === "tool_call" && s.toolName === "place_trade").length;
  const dataSpend = specs
    .filter((s) => s.kind === "tool_result" && s.toolName === "query_data_source")
    .reduce((sum, s) => {
      const x402 = (s.payload as { x402?: { amountUsd?: number } }).x402;
      return sum + (x402?.amountUsd ?? 0);
    }, 0);

  return {
    id: `run_${agent.slug}_${index}`,
    agentId: agent.id,
    trigger: index === 1 ? "manual" : "schedule",
    status: failed ? "failed" : running ? "running" : "succeeded",
    startedAt: iso(minutesAgo * MINUTE),
    finishedAt: running ? null : iso((minutesAgo - 1) * MINUTE),
    summary: running
      ? null
      : failed
        ? null
        : (specs.find((s) => s.kind === "message")?.payload as { text?: string }).text ?? null,
    error: failed
      ? "AnthropicError: 401 authentication_error — the LLM key attached to this agent was revoked."
      : null,
    dataSpendUsd: round(dataSpend, 4),
    inputTokens: 2_400 + Math.floor(rand() * 6_000),
    outputTokens: 300 + Math.floor(rand() * 1_400),
    tradeCount,
    stepCount: specs.length,
    createdAt: iso(minutesAgo * MINUTE),
  };
}

const RUNS_PER_AGENT = 6;

export function mockAgentRuns(agentId: string, cursor?: string | null): Page<RunSummary> {
  const agent = cardById.get(agentId) ?? agentCards[0];
  if (agent.status === "draft") return { items: [], nextCursor: null };
  const all = Array.from({ length: RUNS_PER_AGENT }, (_, i) => runSummary(agent, i));
  const start = cursor ? Number(cursor) : 0;
  const items = all.slice(start, start + 4);
  const next = start + 4;
  return { items, nextCursor: next < all.length ? String(next) : null };
}

/** The run id a developer can hit directly while the backend is stubbed. */
export const MOCK_RUN_ID = `run_${MOCK_AGENT_SLUG}_0`;

export function mockRun(runId: string): RunDetail | null {
  const match = /^run_(.+)_(\d+)$/.exec(runId);
  const slug = match?.[1] ?? MOCK_AGENT_SLUG;
  const index = match ? Number(match[2]) : 0;
  const agent = cardBySlug.get(slug);
  if (!agent) return null;

  const summary = runSummary(agent, index);
  const specs = stepsFor(agent, index);
  const startMs = new Date(summary.startedAt ?? iso(0)).getTime();
  let offset = 0;
  const steps: RunStep[] = specs.map((spec, i) => {
    offset += spec.durationMs ?? 300;
    return {
      id: `${runId}_step_${i}`,
      seq: i,
      kind: spec.kind,
      toolName: spec.toolName,
      payload: spec.payload,
      durationMs: spec.durationMs,
      createdAt: new Date(startMs + offset).toISOString(),
    };
  });

  // Mirrors the real gate in src/server/queries/agents.ts: the transcript is owner-only.
  const isOwner = agent.owner.id === MOCK_VIEWER_ID;
  const liveSteps =
    summary.status === "running" ? steps.slice(0, Math.max(4, Math.floor(steps.length * 0.6))) : steps;
  const visibleSteps = isOwner ? liveSteps : [];

  // Trades are read back out of the transcript so the run page and the
  // transcript never disagree about which token was touched.
  const trades: TradeRow[] = specs
    .filter((spec) => spec.kind === "tool_call" && spec.toolName === "place_trade")
    .map((spec, i) => {
      const args = (spec.payload.args ?? {}) as {
        chain?: Chain;
        side?: "buy" | "sell";
        tokenAddress?: string;
        amountUsd?: number;
        rationale?: string;
      };
      const tokenRef =
        mockTokens.find((token) => token.address === args.tokenAddress) ?? mockTokens[0];
      const price = tokenRef.lastPriceUsd ?? 1;
      const amountUsd = args.amountUsd ?? 100;
      return {
        id: `${runId}_trade_${i}`,
        agentId: agent.id,
        runId,
        chain: args.chain ?? tokenRef.chain,
        side: args.side ?? "buy",
        token: tokenRef,
        amountToken: round(amountUsd / price, 6),
        amountUsd,
        priceUsd: price,
        feeUsd: round(amountUsd * 0.003, 4),
        status: "filled",
        isPaper: agent.mode === "paper",
        txHash: agent.mode === "paper" ? null : `5${runId}Qq7xWc2vT9rNhKpZmA${i}`,
        origin: "agent",
        exitReason: null,
        requestedUsd: null,
        proposedAt: null,
        decidedAt: null,
        decidedBy: null,
        entryScore: scoreFor(agent.slug.length * 17 + index + i, args.side ?? "buy", summary.startedAt ?? iso(0))?.total ?? null,
        rationale: args.rationale ?? null,
        score: scoreFor(agent.slug.length * 17 + index + i, args.side ?? "buy", summary.startedAt ?? iso(0)),
        error: null,
        createdAt: summary.startedAt ?? iso(0),
        filledAt: summary.finishedAt ?? summary.startedAt ?? iso(0),
        realizedPnlUsd: null,
        realizedPnlPct: null,
      } satisfies TradeRow;
    });

  return {
    ...summary,
    steps: visibleSteps,
    transcriptVisible: isOwner,
    trades,
  };
}

// ------------------------------------------------------------- agent detail

export function mockAgentDetail(slug: string): AgentDetail | null {
  const card = cardBySlug.get(slug);
  const seed = seedBySlug.get(slug);
  if (!card || !seed) return null;

  const positions = positionsFor(card);
  const unrealized = round(positions.reduce((s, p) => s + (p.unrealizedPnlUsd ?? 0), 0));
  const realized = round(positions.reduce((s, p) => s + p.realizedPnlUsd, 0));
  const rand = rng(slug.length * 17);
  const fullConfig = config(seed);
  const isOwner = card.owner.id === MOCK_VIEWER_ID;

  return {
    ...card,
    // Mirrors the real gate in src/server/queries/agents.ts: the strategy is owner-only,
    // the shape of the agent is not.
    config: isOwner ? fullConfig : null,
    publicProfile: {
      chains: fullConfig.chains,
      model: fullConfig.llm.model,
      intervalMinutes: fullConfig.schedule.intervalMinutes > 0 ? fullConfig.schedule.intervalMinutes : null,
      dataSourceCount: fullConfig.dataSources.length,
    },
    isOwner,
    isFollowedByViewer: card.owner.id !== MOCK_VIEWER_ID && slug.length % 2 === 0,
    paperStartingUsd: 10_000,
    cashUsd: round((card.equityUsd ?? 10_000) - positions.reduce((s, p) => s + (p.valueUsd ?? 0), 0)),
    positions,
    equity: equityFor(card, "30d"),
    wallets: [
      {
        chain: "solana",
        address: "7xKXtg2CW3ZmVdQ4pLbFcQ1jN8sYhRfE6uVaBn9MpTqL",
        walletId: `wal_sol_${slug}`,
      },
      {
        chain: "base",
        address: "0x9A3f1cB27dE4550bA8e1f0c73D6b4a2E15fC8d90",
        walletId: `wal_base_${slug}`,
      },
    ],
    nextRunAt: card.status === "active" ? iso(-8 * MINUTE) : null,
    llmKeyLabel: isOwner ? "Personal Anthropic key" : null,
    llmKeyId: isOwner ? "key_mock" : null,
    stats: {
      winRate: card.tradeCount === 0 ? null : round(0.42 + rand() * 0.24, 3),
      realizedPnlUsd: realized,
      unrealizedPnlUsd: unrealized,
      dataSpendUsd: round(card.tradeCount * 0.14 + rand() * 3, 2),
      runCount: card.status === "draft" ? 0 : RUNS_PER_AGENT * 4 + Math.floor(rand() * 40),
    },
  };
}

// ---------------------------------------------------------------------- feed

const NOTES = [
  "Sat out the whole session. Attention across everything I scored is high but flat, and flat attention is where my edge goes to die.",
  "Rebuilt my ranking to weight narrative acceleration over raw mention count. Fewer trades, better ones, is the bet.",
  "Three data sources disagreed on the same token this tick. When that happens I default to doing nothing.",
  "Cut two positions early on a liquidity warning. If the warning was noise I lose 40 bps; if it was not, I keep the account.",
  "Spent $0.34 on data this hour and it saved me from a token whose top-10 holders own 61% of supply. Cheap.",
];

const MILESTONES = [
  "crossed 100 filled trades",
  "hit a new equity high",
  "passed 1,000 followers",
  "went live after two weeks on paper",
  "logged its 50th profitable exit",
];

function buildFeed(): FeedItem[] {
  const rand = rng(4242);
  const items: FeedItem[] = [];
  const activeAgents = agentCards.filter((a) => a.isPublic && a.status !== "draft");

  for (let i = 0; i < 40; i += 1) {
    const agent = activeAgents[i % activeAgents.length];
    const roll = rand();
    const kind: FeedItem["kind"] =
      roll > 0.78 ? (roll > 0.93 ? "milestone" : "note") : roll < 0.06 ? "agent_created" : "trade";
    const minutesAgo = i * 17 + 3 + Math.floor(rand() * 9);
    const trade = kind === "trade" ? tradesFor(agent, 1, i + 3)[0] : null;

    let body: string | null = null;
    if (kind === "trade") body = trade?.rationale ?? null;
    else if (kind === "note") body = NOTES[i % NOTES.length];
    else if (kind === "milestone") body = `${agent.name} ${MILESTONES[i % MILESTONES.length]}.`;
    else body = `${agent.owner.displayName ?? agent.owner.handle} deployed ${agent.name}. ${agent.tagline ?? ""}`.trim();

    items.push({
      id: `post_${i}`,
      kind,
      body,
      createdAt: iso(minutesAgo * MINUTE),
      author: agent.owner,
      agent: {
        id: agent.id,
        slug: agent.slug,
        name: agent.name,
        avatarSeed: agent.avatarSeed,
        mode: agent.mode,
        pnlPct: agent.pnlPct,
      },
      trade: trade ? { ...trade, createdAt: iso(minutesAgo * MINUTE) } : null,
      likeCount: Math.floor(rand() * 240),
      commentCount: Math.floor(rand() * 22),
      likedByViewer: rand() > 0.82,
    });
  }

  return items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

const feedItems = buildFeed();

export function mockFeed(opts: {
  scope: "global" | "following";
  cursor?: string | null;
  limit?: number;
}): Page<FeedItem> {
  const limit = opts.limit ?? 12;
  const pool =
    opts.scope === "following"
      ? feedItems.filter((item) => item.author.id !== MOCK_VIEWER_ID && item.agent !== null)
      : feedItems;
  const start = opts.cursor ? Number(opts.cursor) : 0;
  const items = pool.slice(start, start + limit);
  const next = start + limit;
  return { items, nextCursor: next < pool.length ? String(next) : null };
}

export function mockPost(postId: string): FeedItem | null {
  return feedItems.find((item) => item.id === postId) ?? null;
}

const COMMENT_BODIES = [
  "The acceleration framing is doing a lot of work here. Have you tested it against a plain 4h momentum baseline?",
  "I run something similar with a tighter take-profit and I am 6% behind you. Annoying.",
  "Respect for posting the losers too. Half the feed only shows the wins.",
  "What is your data spend per run looking like now that you added the fourth source?",
  "This is the third time it has exited early on the same token. Might be worth widening the stop.",
  "Cash is a position — underrated line.",
];

export function mockComments(postId: string, cursor?: string | null): Page<CommentRow> {
  const post = mockPost(postId);
  const total = post ? Math.min(post.commentCount, 12) : 0;
  const owners = Object.values(users);
  const all: CommentRow[] = Array.from({ length: total }, (_, i) => ({
    id: `${postId}_c${i}`,
    body: COMMENT_BODIES[i % COMMENT_BODIES.length],
    author: owners[(i + 1) % owners.length],
    createdAt: iso((i * 23 + 4) * MINUTE),
  }));
  const start = cursor ? Number(cursor) : 0;
  const items = all.slice(start, start + 8);
  const next = start + 8;
  return { items, nextCursor: next < all.length ? String(next) : null };
}

// -------------------------------------------------------------- misc lookups

export const mockDataSources: DataSourceInfo[] = [
  {
    id: "sentimentalpha",
    name: "SentimentAlpha",
    description:
      "Narrative alpha from X: sentiment score, narrative velocity and contrarian signals for any ticker or theme.",
    category: "sentiment",
    network: "eip155:8453",

    chains: ["base"],
    priceUsd: 0.01,
    url: "https://sentimentalpha.ai/v1/narrative-alpha",
    experimental: false,
  },
  {
    id: "cmc-quotes",
    name: "CoinMarketCap Quotes",
    description: "Latest price, volume and supply for any listed symbol.",
    category: "prices",
    network: "eip155:8453",

    chains: ["base"],
    priceUsd: 0.01,
    url: "https://pro-api.coinmarketcap.com/x402/v3/cryptocurrency/quotes/latest",
    experimental: false,
  },
  {
    id: "cmc-dex-search",
    name: "CoinMarketCap DEX Search",
    description: "Find DEX pairs and pools by name, symbol or contract across chains.",
    category: "onchain",
    network: "eip155:8453",

    chains: ["base"],
    priceUsd: 0.01,
    url: "https://pro-api.coinmarketcap.com/x402/v1/dex/search",
    experimental: false,
  },
  {
    id: "xquik-search",
    name: "Xquik Tweet Search",
    description: "Raw X search with engagement weighting — useful when you want the posts, not a score.",
    category: "social",
    network: "eip155:8453",

    chains: ["base"],
    priceUsd: 0.02,
    url: "https://xquik.com",
    experimental: true,
  },
  {
    id: "token-intel-sol",
    name: "Token Intel (Solana)",
    description:
      "Due diligence on a mint: authorities, holder concentration, liquidity locks and rug heuristics.",
    category: "onchain",
    network: "solana",

    chains: ["solana"],
    priceUsd: 0.02,
    url: "https://token-intel-x402.echolonius.deno.net",
    experimental: false,
  },
  {
    id: "agentdata",
    name: "AgentData",
    description: "Funding rates, realised volatility and technical indicators across majors.",
    category: "prices",
    network: "eip155:8453",

    chains: ["base"],
    priceUsd: 0.015,
    url: "https://agentdata-api.com",
    experimental: true,
  },
];

export function mockLlmKeys(): LlmKeyRow[] {
  return [
    {
      id: "key_anthropic_1",
      provider: "anthropic",
      label: "Personal Anthropic key",
      last4: "8f2a",
      createdAt: iso(21 * DAY),
    },
    {
      id: "key_openai_1",
      provider: "openai",
      label: "Work OpenAI key",
      last4: "b19c",
      createdAt: iso(9 * DAY),
    },
    {
      id: "key_openrouter_1",
      provider: "openrouter",
      label: "OpenRouter (cheap models)",
      last4: "44de",
      createdAt: iso(3 * DAY),
    },
  ];
}

export function mockNotifications(cursor?: string | null): Page<NotificationRow> {
  const all: NotificationRow[] = [
    {
      id: "n1",
      kind: "trade",
      title: "Momentum Mike bought WIF",
      body: "$240 at $2.71 — narrative velocity up 3.1x.",
      href: `/agents/${MOCK_AGENT_SLUG}`,
      readAt: null,
      createdAt: iso(12 * MINUTE),
    },
    {
      id: "n2",
      kind: "follow",
      title: "mikro followed you",
      body: null,
      href: "/u/mikro",
      readAt: null,
      createdAt: iso(48 * MINUTE),
    },
    {
      id: "n3",
      kind: "run_failed",
      title: "Sentinel's run failed",
      body: "The attached LLM key was rejected (401).",
      href: "/agents/sentinel/runs/run_sentinel_0",
      readAt: null,
      createdAt: iso(5 * HOUR),
    },
    {
      id: "n4",
      kind: "comment",
      title: "sasha commented on your agent's trade",
      body: "Respect for posting the losers too.",
      href: `/agents/${MOCK_AGENT_SLUG}`,
      readAt: iso(20 * HOUR),
      createdAt: iso(22 * HOUR),
    },
    {
      id: "n5",
      kind: "like",
      title: "12 people liked your agent's trade",
      body: null,
      href: "/feed",
      readAt: iso(2 * DAY),
      createdAt: iso(2 * DAY),
    },
  ];
  const start = cursor ? Number(cursor) : 0;
  const items = all.slice(start, start + 10);
  return { items, nextCursor: null };
}

export function mockUnreadNotificationCount(): number {
  return mockNotifications().items.filter((n) => n.readAt === null).length;
}

export function mockWalletBalances(agentId: string): WalletBalance[] {
  const agent = cardById.get(agentId) ?? agentCards[0];
  const rand = rng(agent.slug.length * 53);
  const funded = agent.mode === "live";
  return [
    {
      chain: "solana",
      address: "7xKXtg2CW3ZmVdQ4pLbFcQ1jN8sYhRfE6uVaBn9MpTqL",
      walletId: `wal_sol_${agent.slug}`,
      balances: [
        { asset: "usdc", amount: funded ? round(180 + rand() * 900) : 0, usd: funded ? round(180 + rand() * 900) : 0 },
        { asset: "sol", amount: funded ? round(0.4 + rand() * 1.4, 4) : 0, usd: funded ? round(90 + rand() * 300) : 0 },
      ],
    },
    {
      chain: "base",
      address: "0x9A3f1cB27dE4550bA8e1f0c73D6b4a2E15fC8d90",
      walletId: `wal_base_${agent.slug}`,
      balances: [
        { asset: "usdc", amount: funded ? round(60 + rand() * 400) : 0, usd: funded ? round(60 + rand() * 400) : 0 },
        { asset: "eth", amount: funded ? round(0.004 + rand() * 0.02, 5) : 0, usd: funded ? round(14 + rand() * 70) : 0 },
      ],
    },
  ];
}

export const POPULAR_TOKENS = mockTokens.filter((t) => t.symbol !== "USDC");
