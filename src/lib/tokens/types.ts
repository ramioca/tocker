/**
 * Internal provider shapes for the token-intelligence subsystem.
 *
 * Every provider module normalises its vendor payload into one of these before
 * anything else sees it: strings become numbers, percentages become percentages
 * (GoPlus hands back fractions), absent fields become `null` rather than `undefined`
 * or `NaN`. `score.ts` therefore never parses a vendor response, which is what makes
 * it a pure, synchronous, fully testable function.
 *
 * The public types (`TokenScore`, `TokenCandidate`, `ScoreComponents`, …) live in
 * `@/server/types` and are re-exported here so consumers only need one import.
 */
import type { Chain } from "@/server/types";

export type {
  Chain,
  DiscoveryFeed,
  ScoreComponents,
  ScoreVerdict,
  TokenCandidate,
  TokenRef,
  TokenScore,
  TradeScore,
} from "@/server/types";

// ---------- Jupiter Token API v2 ----------

/**
 * One `statsN` block. Every field is optional: a token minted four minutes ago comes
 * back with `{ buyVolume, numBuys }` and nothing else.
 */
export interface JupiterStats {
  priceChange: number | null;
  holderChange: number | null;
  liquidityChange: number | null;
  volumeChange: number | null;
  buyVolume: number | null;
  sellVolume: number | null;
  buyOrganicVolume: number | null;
  sellOrganicVolume: number | null;
  numBuys: number | null;
  numSells: number | null;
  numTraders: number | null;
  numOrganicBuyers: number | null;
  numNetBuyers: number | null;
}

export interface JupiterAudit {
  mintAuthorityDisabled: boolean | null;
  freezeAuthorityDisabled: boolean | null;
  /** Percent (0-100) of supply held by the top 10 holders. */
  topHoldersPercentage: number | null;
  /** Percent (0-100) of supply still held by the deployer. */
  devBalancePercentage: number | null;
  devMints: number | null;
  isSus: boolean | null;
}

export interface JupiterToken {
  id: string;
  name: string | null;
  symbol: string | null;
  icon: string | null;
  decimals: number | null;
  dev: string | null;
  circSupply: number | null;
  totalSupply: number | null;
  tokenProgram: string | null;
  holderCount: number | null;
  fdv: number | null;
  mcap: number | null;
  usdPrice: number | null;
  liquidity: number | null;
  stats5m: JupiterStats | null;
  stats1h: JupiterStats | null;
  stats6h: JupiterStats | null;
  stats24h: JupiterStats | null;
  /** Epoch ms of the first pool — the token's tradeable age. */
  firstPoolCreatedAtMs: number | null;
  createdAtMs: number | null;
  audit: JupiterAudit | null;
  /** 0-100, Jupiter's own manufactured-volume detector. */
  organicScore: number | null;
  organicScoreLabel: string | null;
  isVerified: boolean | null;
  tags: string[];
}

// ---------- RugCheck (Solana) ----------

export interface RugcheckRisk {
  name: string;
  description: string | null;
  score: number | null;
  /** "danger" | "warn" | "info" — anything else is treated as "info". */
  level: "danger" | "warn" | "info";
}

export interface RugcheckSummary {
  mint: string;
  risks: RugcheckRisk[];
  /** Raw additive risk score. */
  score: number | null;
  /** 0-100 where **lower is safer** (BONK returns 7). */
  scoreNormalised: number | null;
  lpLockedPct: number | null;
}

// ---------- DexScreener (Base) ----------

export interface DexTxnCounts {
  buys: number | null;
  sells: number | null;
}

/** Every pair for one token, collapsed into the deepest-liquidity view of it. */
export interface DexScreenerToken {
  address: string;
  symbol: string | null;
  name: string | null;
  imageUrl: string | null;
  priceUsd: number | null;
  /** Summed across every pair. */
  liquidityUsd: number | null;
  volume24hUsd: number | null;
  volume6hUsd: number | null;
  volume1hUsd: number | null;
  priceChange5mPct: number | null;
  priceChange1hPct: number | null;
  priceChange6hPct: number | null;
  priceChange24hPct: number | null;
  txns5m: DexTxnCounts | null;
  txns1h: DexTxnCounts | null;
  txns6h: DexTxnCounts | null;
  txns24h: DexTxnCounts | null;
  fdv: number | null;
  marketCap: number | null;
  /** Epoch ms of the oldest pair we saw. */
  pairCreatedAtMs: number | null;
  pairCount: number;
  dexIds: string[];
}

export interface DexScreenerProfile {
  chainId: string;
  tokenAddress: string;
  icon: string | null;
  url: string | null;
}

// ---------- GoPlus (Base) ----------

export interface GoPlusSecurity {
  address: string;
  symbol: string | null;
  name: string | null;
  isHoneypot: boolean | null;
  /** Percent, 0-100. GoPlus reports fractions ("0.05" = 5%). */
  buyTaxPct: number | null;
  sellTaxPct: number | null;
  isOpenSource: boolean | null;
  isMintable: boolean | null;
  isProxy: boolean | null;
  canTakeBackOwnership: boolean | null;
  /**
   * True when `owner_address` is empty, the zero address, or the dead address.
   * A mint function behind a renounced owner cannot be called by the owner — though
   * a separate minter role could still exist, which GoPlus cannot see.
   */
  ownerRenounced: boolean | null;
  hiddenOwner: boolean | null;
  transferPausable: boolean | null;
  cannotSellAll: boolean | null;
  tradingCooldown: boolean | null;
  slippageModifiable: boolean | null;
  isBlacklisted: boolean | null;
  selfdestruct: boolean | null;
  /** Percent, 0-100. */
  ownerPercent: number | null;
  creatorPercent: number | null;
  top10HolderPct: number | null;
  lpLockedPct: number | null;
  holderCount: number | null;
  lpHolderCount: number | null;
  totalSupply: number | null;
}

// ---------- the bundle `scoreToken` consumes ----------

/** A sentiment reading bought over x402. Only present when the agent paid for it. */
export interface SentimentInput {
  /** -1 (max bearish) .. 1 (max bullish). */
  sentiment: number | null;
  /** Rate of change of attention, roughly -1..1. */
  velocity: number | null;
  source: string;
}

/**
 * Everything the scorer needs. Assembled by `index.ts` from the providers, or by
 * hand in tests. Every provider slot is nullable: a provider that was down, rate
 * limited or simply does not cover this chain contributes `null` and lowers the
 * result's confidence instead of throwing.
 */
export interface ScoreInput {
  chain: Chain;
  address: string;
  /** Best-known symbol; providers override it when they know better. */
  symbol: string;
  name?: string | null;
  jupiter?: JupiterToken | null;
  rugcheck?: RugcheckSummary | null;
  dexscreener?: DexScreenerToken | null;
  goplus?: GoPlusSecurity | null;
  sentiment?: SentimentInput | null;
  /**
   * The agent's per-trade ceiling, used to judge depth *relative to the size it
   * actually trades*. $40k of liquidity is deep for a $100 clip and thin for $25k.
   */
  maxTradeUsd?: number;
  /** Injected in tests so age maths is deterministic. Defaults to `Date.now()`. */
  now?: number;
}

/**
 * The normalised, chain-agnostic facts the scorer actually reasons about. Exported
 * because `discover.ts` pre-ranks on the same numbers and `index.ts` caches them.
 */
export interface TokenFacts {
  chain: Chain;
  address: string;
  symbol: string;
  name: string | null;
  decimals: number | null;
  logoUrl: string | null;
  priceUsd: number | null;
  liquidityUsd: number | null;
  volume24hUsd: number | null;
  marketCapUsd: number | null;
  holderCount: number | null;
  ageHours: number | null;
  priceChange1hPct: number | null;
  priceChange6hPct: number | null;
  priceChange24hPct: number | null;
  mintAuthorityDisabled: boolean | null;
  freezeAuthorityDisabled: boolean | null;
  top10HolderPct: number | null;
  devBalancePct: number | null;
  buyTaxPct: number | null;
  sellTaxPct: number | null;
  isHoneypot: boolean | null;
}
