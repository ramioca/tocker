/**
 * View-model types shared by server queries (producers) and UI components (consumers).
 * Foundation implements the queries; UI workstreams render these shapes. Extend freely,
 * but keep existing fields stable.
 */
import type { AgentConfig } from "@/db/schema";

export type Chain = "solana" | "base";
export type AgentMode = "paper" | "live";
export type AgentStatus = "draft" | "active" | "paused" | "error";
export type LeaderboardWindow = "7d" | "30d" | "all";

export interface Session {
  userId: string; // Privy DID
  handle: string;
  displayName: string | null;
  avatarUrl: string | null;
  email: string | null;
}

export interface UserCard {
  id: string;
  handle: string;
  displayName: string | null;
  avatarUrl: string | null;
}

export interface TokenRef {
  id: string; // `${chain}:${address}`
  chain: Chain;
  address: string;
  symbol: string;
  name: string | null;
  logoUrl: string | null;
  decimals: number;
  lastPriceUsd: number | null;
}

export interface AgentCard {
  id: string;
  slug: string;
  name: string;
  tagline: string | null;
  avatarSeed: string | null;
  mode: AgentMode;
  status: AgentStatus;
  isPublic: boolean;
  owner: UserCard;
  chains: Chain[];
  model: string;
  /** all-time PnL in USD and percent (null until first snapshot) */
  pnlUsd: number | null;
  pnlPct: number | null;
  equityUsd: number | null;
  tradeCount: number;
  followerCount: number;
  /** last ~30 equity points for a sparkline */
  sparkline: number[];
  lastRunAt: string | null; // ISO
  createdAt: string;
}

export type TradeOrigin = "agent" | "guardian" | "manual" | "mirror";
export type ExitReason =
  | "stop_loss"
  | "take_profit"
  | "trailing_stop"
  | "max_hold"
  | "score_collapse"
  | "liquidity_collapse";
export type TradeStatus = "proposed" | "pending" | "submitted" | "filled" | "failed" | "rejected" | "expired";

export interface Position {
  token: TokenRef;
  amountToken: number;
  avgCostUsd: number;
  markPriceUsd: number | null;
  valueUsd: number | null;
  unrealizedPnlUsd: number | null;
  unrealizedPnlPct: number | null;
  realizedPnlUsd: number;
  openedAt: string | null;
  peakPriceUsd: number | null;
  entryScore: number | null;
  entryLiquidityUsd: number | null;
  /** Current score for the held token, when one is cached. */
  currentScore: number | null;
  /** Distance to the configured stop / take-profit in %, negative = below. Null when off. */
  stopDistancePct: number | null;
  takeProfitDistancePct: number | null;
}

export interface TradeRow {
  id: string;
  agentId: string;
  chain: Chain;
  side: "buy" | "sell";
  token: TokenRef;
  amountToken: number;
  amountUsd: number;
  priceUsd: number;
  feeUsd: number;
  status: TradeStatus;
  origin: TradeOrigin;
  exitReason: ExitReason | null;
  /** Approval mode: what was asked for, before any fill. */
  requestedUsd: number | null;
  proposedAt: string | null;
  decidedAt: string | null;
  decidedBy: string | null;
  /** Score total at the time of the trade, from `scoreSnapshot`. */
  entryScore: number | null;
  isPaper: boolean;
  txHash: string | null;
  rationale: string | null;
  /** The token's score when the agent pulled the trigger. Null for legacy rows. */
  score: TradeScore | null;
  error: string | null;
  createdAt: string;
  filledAt: string | null;
}

export interface EquityPoint {
  at: string; // ISO
  equityUsd: number;
  cashUsd: number;
}

export interface AgentDetail extends AgentCard {
  /**
   * Owner-only. The strategy prompt and universe rules are the operator's edge —
   * publishing them would let anyone run the same agent. `null` for everyone else.
   */
  config: AgentConfig | null;
  /** Safe for anyone: what it trades, never how it decides. */
  publicProfile: {
    chains: Chain[];
    model: string;
    intervalMinutes: number | null;
    /** How many paid sources it buys from, not which ones. */
    dataSourceCount: number;
  };
  isOwner: boolean;
  isFollowedByViewer: boolean;
  paperStartingUsd: number;
  cashUsd: number | null;
  positions: Position[];
  equity: EquityPoint[]; // last 30d
  wallets: Array<{ chain: Chain; address: string; walletId: string }>;
  nextRunAt: string | null;
  llmKeyLabel: string | null; // owner only
  stats: {
    winRate: number | null; // 0..1
    realizedPnlUsd: number;
    unrealizedPnlUsd: number;
    dataSpendUsd: number; // lifetime x402 spend
    runCount: number;
  };
}

export interface RunStep {
  id: string;
  seq: number;
  kind: "thought" | "tool_call" | "tool_result" | "message" | "error";
  toolName: string | null;
  payload: Record<string, unknown>;
  durationMs: number | null;
  createdAt: string;
}

export interface RunSummary {
  id: string;
  agentId: string;
  trigger: "schedule" | "manual" | "webhook";
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  startedAt: string | null;
  finishedAt: string | null;
  summary: string | null;
  error: string | null;
  dataSpendUsd: number;
  inputTokens: number;
  outputTokens: number;
  tradeCount: number;
  stepCount: number;
  createdAt: string;
}

export interface RunDetail extends RunSummary {
  /**
   * The step-by-step transcript reveals which sources the agent paid for and how it
   * reasoned, so it is owner-only. Empty for everyone else.
   */
  steps: RunStep[];
  /** Whether the viewer is allowed to see `steps`. */
  transcriptVisible: boolean;
  trades: TradeRow[];
}

export interface FeedItem {
  id: string;
  kind: "trade" | "note" | "agent_created" | "milestone";
  body: string | null;
  createdAt: string;
  author: UserCard;
  agent: Pick<AgentCard, "id" | "slug" | "name" | "avatarSeed" | "mode" | "pnlPct"> | null;
  trade: TradeRow | null;
  likeCount: number;
  commentCount: number;
  likedByViewer: boolean;
}

export interface CommentRow {
  id: string;
  body: string;
  author: UserCard;
  createdAt: string;
}

// ---------- token discovery & scoring ----------

export type ScoreVerdict = "avoid" | "watch" | "candidate" | "strong";
export type DiscoveryFeed = "new_launches" | "trending" | "top_organic" | "momentum" | "manual";

/**
 * Sub-scores, each 0-100. `sentiment` is null unless the agent paid an x402 source
 * for it — scoring must stay free by default so an agent can sweep hundreds of tokens.
 */
export interface ScoreComponents {
  safety: number;
  liquidity: number;
  momentum: number;
  /** Real demand versus wash trading. */
  organic: number;
  /** How evenly the supply is held. */
  distribution: number;
  sentiment: number | null;
}

export interface TokenScore {
  tokenId: string;
  chain: Chain;
  address: string;
  symbol: string;
  name: string | null;
  /** 0-100 composite. */
  total: number;
  verdict: ScoreVerdict;
  components: ScoreComponents;
  /** Hard-gate failures. Non-empty always means verdict "avoid", whatever the total. */
  blockers: string[];
  /** Worth showing, not disqualifying. */
  warnings: string[];
  priceUsd: number | null;
  liquidityUsd: number | null;
  volume24hUsd: number | null;
  marketCapUsd: number | null;
  holderCount: number | null;
  ageHours: number | null;
  priceChange24hPct: number | null;
  /** Providers that contributed, e.g. ["jupiter", "rugcheck"]. */
  sources: string[];
  scoredAt: string;
}

/** The compact form stored on a trade and rendered in the feed. */
export interface TradeScore {
  total: number;
  verdict: ScoreVerdict;
  components: Partial<ScoreComponents>;
  blockers: string[];
  warnings: string[];
  liquidityUsd: number | null;
  ageHours: number | null;
  scoredAt: string;
}

/** A token surfaced by a discovery feed, before the expensive scoring pass. */
export interface TokenCandidate {
  token: TokenRef;
  origin: DiscoveryFeed;
  liquidityUsd: number | null;
  volume24hUsd: number | null;
  marketCapUsd: number | null;
  holderCount: number | null;
  ageHours: number | null;
  priceChange24hPct: number | null;
  /** Cheap pre-rank from the discovery payload alone; null until scored. */
  quickScore: number | null;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface LeaderboardRow {
  rank: number;
  agent: AgentCard;
  pnlPct: number;
  pnlUsd: number;
  tradeCount: number;
}

export interface TrendingToken {
  token: TokenRef;
  agentBuys: number;
  agentSells: number;
  netFlowUsd: number;
  change24hPct: number | null;
}

export interface UserProfile extends UserCard {
  bio: string | null;
  createdAt: string;
  followerCount: number;
  followingCount: number;
  isFollowedByViewer: boolean;
  isSelf: boolean;
  agents: AgentCard[];
  totalPnlUsd: number;
}

export interface LlmKeyRow {
  id: string;
  provider: "anthropic" | "openai" | "openrouter";
  label: string | null;
  last4: string;
  createdAt: string;
}

export interface NotificationRow {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  href: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface WalletBalance {
  chain: Chain;
  address: string;
  walletId: string;
  balances: Array<{ asset: string; amount: number; usd: number | null }>;
}

export interface DataSourceInfo {
  id: string;
  name: string;
  description: string;
  category: "sentiment" | "prices" | "onchain" | "news" | "social" | "other";
  network: string; // CAIP-2
  priceUsd: number | null;
  url: string;
  experimental: boolean;
}

export type ActionResult<T = void> = { ok: true; data: T } | { ok: false; error: string };

// ---------- token pages & analytics (owner: TOKENS-UI workstream) ----------

export interface ScoreHistoryPoint {
  at: string; // ISO
  total: number;
  verdict: ScoreVerdict;
  priceUsd: number | null;
  liquidityUsd: number | null;
  holderCount: number | null;
}

export interface TokenPage {
  token: TokenRef;
  score: TokenScore | null;
  history: ScoreHistoryPoint[];
  /** Public agents currently holding it, with their unrealized PnL on it. */
  holders: Array<{ agent: Pick<AgentCard, "id" | "slug" | "name" | "avatarSeed" | "mode">; valueUsd: number | null; unrealizedPnlPct: number | null }>;
  recentTrades: TradeRow[];
  stats: { agentBuys30d: number; agentSells30d: number; netFlowUsd30d: number };
}

export interface ScoreBandStat {
  band: "0-39" | "40-59" | "60-79" | "80-100";
  trades: number;
  winRate: number | null;
  avgReturnPct: number | null;
  totalPnlUsd: number;
}

export interface AgentAnalytics {
  agentId: string;
  window: LeaderboardWindow;
  realizedPnlUsd: number;
  unrealizedPnlUsd: number;
  winRate: number | null;
  avgHoldHours: number | null;
  maxDrawdownPct: number | null;
  bestTrade: TradeRow | null;
  worstTrade: TradeRow | null;
  byChain: Array<{ chain: Chain; trades: number; pnlUsd: number }>;
  byOrigin: Array<{ origin: TradeOrigin; trades: number; pnlUsd: number }>;
  exits: Array<{ reason: ExitReason; count: number; pnlUsd: number }>;
  /** Realized return bucketed by the score the token had at entry. */
  calibration: ScoreBandStat[];
  dataSpendUsd: number;
}

export interface ProposalRow extends TradeRow {
  expiresAt: string;
  /** Live re-check at read time: would the risk guard still allow it? */
  stillValid: boolean;
}
