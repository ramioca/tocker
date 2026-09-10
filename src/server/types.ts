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
  isForkable: boolean;
  owner: UserCard;
  chains: Chain[];
  model: string;
  /** all-time PnL in USD and percent (null until first snapshot) */
  pnlUsd: number | null;
  pnlPct: number | null;
  equityUsd: number | null;
  tradeCount: number;
  followerCount: number;
  forkCount: number;
  /** last ~30 equity points for a sparkline */
  sparkline: number[];
  lastRunAt: string | null; // ISO
  createdAt: string;
}

export interface Position {
  token: TokenRef;
  amountToken: number;
  avgCostUsd: number;
  markPriceUsd: number | null;
  valueUsd: number | null;
  unrealizedPnlUsd: number | null;
  unrealizedPnlPct: number | null;
  realizedPnlUsd: number;
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
  status: "pending" | "submitted" | "filled" | "failed" | "rejected";
  isPaper: boolean;
  txHash: string | null;
  rationale: string | null;
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
  config: AgentConfig;
  forkedFrom: { id: string; slug: string; name: string; owner: UserCard } | null;
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
  steps: RunStep[];
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
