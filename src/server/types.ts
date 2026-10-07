/**
 * View-model types shared by server queries (producers) and UI components (consumers).
 * Foundation implements the queries; UI workstreams render these shapes. Extend freely,
 * but keep existing fields stable.
 */
import type { AgentConfig } from "@/db/schema";
import type { LlmProvider } from "@/lib/agent/providers";

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
  /**
   * The latest score for the held token that this viewer may see: produced under the
   * agent's own universe for its owner, the public default's for everyone else. Null
   * when there is none, never another operator's verdict.
   */
  currentScore: number | null;
  /**
   * Owner-only: the hard gates that reading failed, so an "Avoid" can say why. Absent
   * for everyone else and when the score came from history (which keeps no universe).
   */
  currentBlockers?: string[] | null;
  /** Distance to the configured stop / take-profit in %, negative = below. Null when off. */
  stopDistancePct: number | null;
  takeProfitDistancePct: number | null;
}

export interface TradeRow {
  id: string;
  agentId: string;
  /** The run that placed it. Null for manual trades and exits outside a run. */
  runId: string | null;
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
  /**
   * What a filled sell booked on the average-cost basis (`closedSells`), and that as a
   * percent of the cost it closed. Null on buys and on unfilled, failed or rejected rows,
   * and wherever the query did not compute it.
   */
  realizedPnlUsd: number | null;
  realizedPnlPct: number | null;
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
  /** The attached key's id, so settings can switch it. Owner only. */
  llmKeyId: string | null;
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
  /** Filled trades only. A proposal, or one that was rejected or expired, is not a trade. */
  tradeCount: number;
  /**
   * Orders the risk guard or the venue turned down in this run. Owner-only (the reasons
   * quote the owner's caps, and even the count says the guard is binding): `null` or
   * absent for everyone else.
   */
  refusedCount?: number | null;
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
export type DiscoveryFeed =
  | "new_launches"
  | "trending"
  | "top_organic"
  | "momentum"
  /**
   * GeckoTerminal's new + trending pools on either chain, kept only when
   * GeckoTerminal's own GT Score rates the token well. Free, but rate limited.
   */
  | "gecko_launches"
  /** The only feed that costs money: paid launch radars (SolEnrich on Solana, gate402 on Base). */
  | "paid_launches"
  | "manual";

/**
 * Sub-scores, each 0-100. `sentiment` and `smartMoney` are null unless the agent paid
 * an x402 source for them — scoring must stay free by default so an agent can sweep
 * hundreds of tokens. `gecko` is free but still nullable, because GeckoTerminal has
 * no GT Score for a token it has not assessed. All three *reweight* the five core
 * components rather than adding to them, so the total stays 0-100 however many are
 * present.
 */
export interface ScoreComponents {
  safety: number;
  liquidity: number;
  momentum: number;
  /** Real demand versus wash trading. */
  organic: number;
  /** How evenly the supply is held. */
  distribution: number;
  /** GeckoTerminal's own GT Score (0-100). Free, but absent for unrated tokens. */
  gecko: number | null;
  sentiment: number | null;
  /** Tracked smart-money net flow, weighed against the token's own liquidity. */
  smartMoney: number | null;
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
  /**
   * Distinct buying wallets in the last five minutes, when the feed knows. The only
   * "is anyone here" number that means anything for a launch minutes old — every
   * hourly counter is the same figure copied forward. Absent for feeds that do not
   * report it.
   */
  buyers5m?: number | null;
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
  /**
   * Equity over this row's window, from the same baseline as `pnlPct`. Draw this, not
   * `agent.sparkline` (the card's last month), beside the window's PnL.
   */
  sparkline: number[];
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
  // No total PnL: one figure summed across paper and live agents adds imaginary money
  // to real. A surface that needs a total splits by mode (`profile/pnl-by-mode.ts`).
}

export interface LlmKeyRow {
  id: string;
  provider: LlmProvider;
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
  /**
   * True when the balance could not be read just now. `balances` then holds zeros that
   * mean "unknown", never "empty": show it as unavailable, and never act on it as if
   * the wallet held nothing.
   */
  readFailed?: boolean;
}

/**
 * Sponsored Solana funding (`prepareSponsoredFunding` / `submitSponsoredFunding`).
 *
 * The user's embedded Solana wallet holds USDC and no SOL, so Tocker's platform Solana
 * wallet is the fee payer on the funding transfer: the server builds it, the browser
 * signs it, the server co-signs and broadcasts it. These shapes live here rather than
 * in the action module so a `"use client"` hook can import the types without importing
 * anything that is `server-only`.
 */
export interface SponsoredFundingPlan {
  sponsored: true;
  /** Unsigned v0 transaction, base64. The user signs it; they never broadcast it. */
  transaction: string;
  /** The platform Solana wallet, which is its fee payer. */
  feePayer: string;
  /** The user's embedded Solana wallet, as recorded — the client must sign with this. */
  from: string;
  /** Echoed back so the client submits the amount the transaction was built for. */
  expectedAmount: number;
}

/**
 * The honest "we cannot pay for this" answer. Not an error: the user may still be able
 * to pay for themselves, and the message names the wallet the operator has to fund.
 */
export interface SponsoredFundingUnavailable {
  sponsored: false;
  blocker: "platform_cannot_pay";
  message: string;
}

export type PreparedSponsoredFunding = SponsoredFundingPlan | SponsoredFundingUnavailable;

export interface DataSourceInfo {
  id: string;
  name: string;
  /**
   * One plain sentence for the owner, shown in the data-source picker. `description` is
   * written for the model (modes, per-call prices, vendor quirks) and is not UI copy.
   * Absent on resources discovered at runtime, whose description is the vendor's own.
   */
  summary?: string;
  description: string;
  category: "sentiment" | "prices" | "onchain" | "news" | "social" | "other";
  network: string; // CAIP-2, the network the registry prefers to pay on
  /**
   * Every chain the platform can pay this source on, derived from all the networks
   * its 402 accepts (W7). The builder only offers a source when one of these is a
   * chain the agent trades, so a Solana-only agent never depends on the Base wallet.
   */
  chains: Chain[];
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

/**
 * What the market says about a token, the same under any agent's rules: no verdict,
 * no blockers, no components, no sources. Safe to show from a row scored under a
 * private universe, because none of these numbers depend on the universe.
 */
export interface TokenMarketFacts {
  priceUsd: number | null;
  liquidityUsd: number | null;
  volume24hUsd: number | null;
  marketCapUsd: number | null;
  holderCount: number | null;
  ageHours: number | null;
  priceChange24hPct: number | null;
  measuredAt: string;
}

export interface TokenPage {
  token: TokenRef;
  score: TokenScore | null;
  /** The latest cached market facts, from whichever universe last scored it. Null when never scored. */
  marketFacts: TokenMarketFacts | null;
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
  /** Realised PnL of `bestTrade` / `worstTrade` (average cost). Null when there is no such trade. */
  bestTradePnlUsd: number | null;
  worstTradePnlUsd: number | null;
  byChain: Array<{ chain: Chain; trades: number; pnlUsd: number }>;
  byOrigin: Array<{ origin: TradeOrigin; trades: number; pnlUsd: number }>;
  exits: Array<{ reason: ExitReason; count: number; pnlUsd: number }>;
  /** Realized return bucketed by the score the token had at entry. */
  calibration: ScoreBandStat[];
  dataSpendUsd: number;
}

/**
 * The safety read on a proposal, derived from the score snapshot the agent pulled the
 * trigger on — never from a fresh lookup, because the operator is judging the decision
 * the agent actually made. Every field is allowed to be absent: a token nobody has
 * assessed must read as "unknown" and never as "clean".
 */
export interface ProposalSafety {
  /** True only when a safety provider answered *and* no authority gate failed. */
  authoritiesRevoked: boolean | null;
  /** Percent of supply held by the top 10 wallets. */
  top10Pct: number | null;
  /** Hard gates the token failed, as machine codes. Empty is the good case. */
  blockers: string[];
  /** Worth showing, not disqualifying. */
  warnings: string[];
  /** Sub-scores, 0 when the snapshot carried none. */
  safety: number;
  organic: number;
  distribution: number;
}

/**
 * What a launch-day proposal looks like *right now*, next to the frozen score it was
 * proposed on. Every field is null-safe on purpose: these come from free providers
 * behind a rate limiter, and a refused call must cost a dash, never the card.
 */
export interface ProposalStats {
  /** Age of the token itself, from its earliest pool. */
  ageMinutes: number | null;
  /** Distinct buying wallets in the last five minutes, from the deepest pool. */
  buyers5m: number | null;
  buyersH1: number | null;
  /** The deepest pool's liquidity. */
  reserveUsd: number | null;
  /**
   * Five-minute price change. `GeckoPool` does not carry `m5` today (the payload has
   * it, `parseGeckoPools` maps h1/h6/h24 only), so this is null until that lands and
   * the card falls back to {@link ProposalStats.priceChangeH1Pct}.
   */
  priceChangeM5Pct: number | null;
  priceChangeH1Pct: number | null;
  /** GeckoTerminal's own 0-100, from the snapshot when it has one. */
  gtScore: number | null;
  /** Up to 24 recorded prices, oldest first. Fewer than two means no line. */
  sparkline: number[];
  safety: ProposalSafety;
}

export interface ProposalRow extends TradeRow, ProposalStats {
  expiresAt: string;
  /** Live re-check at read time: would the risk guard still allow it? */
  stillValid: boolean;
  /** Why not, in the guard's own words. Null when `stillValid` is true. */
  invalidReason: string | null;
  /** Which agent this is waiting on — the notifications page shows proposals across agents. */
  agentSlug: string;
  agentName: string;
  agentAvatarSeed: string | null;
}

/** What the Dynamic Island polls: how many decisions are waiting, and the newest one. */
export interface PendingProposalsSummary {
  count: number;
  latest: {
    tradeId: string;
    agentId: string;
    agentSlug: string;
    agentName: string;
    side: "buy" | "sell";
    symbol: string;
    requestedUsd: number;
    expiresAt: string;
  } | null;
  /** Unread notifications, so the bell can update between navigations. The poll route always sends it. */
  unreadNotifications?: number;
}

/** `previewTrade`: what a manual order would do, without doing it. */
export interface TradePreview {
  token: TokenRef;
  score: TokenScore | null;
  /** The risk guard's answer for this exact size, right now. */
  allowed: boolean;
  reason: string | null;
  priceUsd: number | null;
  estimatedToken: number | null;
  cashUsd: number;
  equityUsd: number;
  /** Position value in this token today, for the concentration sentence. */
  positionValueUsd: number | null;
  isPaper: boolean;
  /** True when this agent would turn the order into a proposal instead of a fill. */
  requiresApproval: boolean;
  /**
   * What this fill would cost, so the preview shows it before the receipt does.
   * `tockerUsd` is 0 when the platform fee is off; `venueUsd` is null when the venue
   * did not quote one.
   */
  fees: { tockerUsd: number; venueUsd: number | null };
  /**
   * True when `priceUsd` and the figures below came from the venue's own quote for this
   * size. False when the venue did not quote and `priceUsd` is only the last mark.
   */
  quoted?: boolean;
  /** Why there is no live quote, in the owner's words. Null when there is one. */
  quoteNote?: string | null;
  /**
   * This agent's own Slippage tolerance, in basis points: what an order runs under
   * unless the owner widens it for one manual sell. Owner-only, like the whole preview.
   */
  slippageLimitBps?: number;
  /**
   * Sells only: what the order would send and bring back. `amountToken` is sized from
   * the position exactly as the order will be; `proceedsUsd` is the venue's quote for
   * it and `minProceedsUsd` the least it can pay before the order cancels instead. Both
   * are null without a live quote, and `minProceedsUsd` also when the venue applies no
   * slippage bound (the paper simulator).
   */
  sell?: {
    amountToken: number | null;
    proceedsUsd: number | null;
    minProceedsUsd: number | null;
    /** The order empties the position: "everything", or a slice within the dust rule of it. */
    fullExit: boolean;
  } | null;
}
