/**
 * Tocker — database schema (Drizzle + Postgres).
 *
 * THIS FILE IS THE SHARED CONTRACT between workstreams. Do not rename tables or
 * columns without updating SPEC.md and telling the reviewer. Adding columns and
 * tables is fine.
 *
 * Money conventions:
 *  - `*_usd` numeric columns are decimal USD (string in JS via drizzle numeric).
 *  - Token amounts are stored as `numeric` in *human* units (e.g. 1.5 SOL), plus
 *    the token decimals on the token row so raw base units can be reconstructed.
 *  - Chain ids are CAIP-2 strings: "eip155:8453" (Base), "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp" (Solana mainnet).
 */
import {
  pgTable,
  text,
  timestamp,
  boolean,
  integer,
  numeric,
  jsonb,
  pgEnum,
  primaryKey,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
// A type only, by relative path: drizzle-kit reads this file outside the app's bundler,
// and the registry it comes from imports nothing.
import type { LlmProvider } from "../lib/agent/providers";

// ---------- enums ----------
export const chainEnum = pgEnum("chain", ["solana", "base"]);
export const agentModeEnum = pgEnum("agent_mode", ["paper", "live"]);
export const agentStatusEnum = pgEnum("agent_status", ["draft", "active", "paused", "error"]);
export const runStatusEnum = pgEnum("run_status", ["queued", "running", "succeeded", "failed", "cancelled"]);
export const runTriggerEnum = pgEnum("run_trigger", ["schedule", "manual", "webhook"]);
export const stepKindEnum = pgEnum("step_kind", ["thought", "tool_call", "tool_result", "message", "error"]);
export const tradeSideEnum = pgEnum("trade_side", ["buy", "sell"]);
export const tradeStatusEnum = pgEnum("trade_status", [
  "proposed", // approval mode: waiting for the owner's decision
  "pending",
  "submitted",
  "filled",
  "failed",
  "rejected", // risk guard, or the owner declined a proposal
  "expired", // a proposal nobody decided on before its TTL
]);
/** Who initiated a trade. */
export const tradeOriginEnum = pgEnum("trade_origin", ["agent", "guardian", "manual", "mirror"]);
export const postKindEnum = pgEnum("post_kind", ["trade", "note", "agent_created", "milestone"]);
export const followTargetEnum = pgEnum("follow_target", ["user", "agent"]);
export const walletKindEnum = pgEnum("wallet_kind", ["user_embedded", "agent_server"]);
export const scoreVerdictEnum = pgEnum("score_verdict", ["avoid", "watch", "candidate", "strong"]);

// ---------- users ----------
export const users = pgTable(
  "users",
  {
    id: text("id").primaryKey(), // Privy DID e.g. "did:privy:abc"
    handle: text("handle").notNull(),
    displayName: text("display_name"),
    bio: text("bio"),
    avatarUrl: text("avatar_url"),
    email: text("email"),
    /**
     * Muted notification kinds, as `{ [kind]: false }` (src/lib/notifications/prefs.ts).
     * A read-side filter on the list and the unread count; proposal, exit_failed and
     * trade_unsettled are always delivered whatever this says.
     */
    notificationPrefs: jsonb("notification_prefs").$type<Record<string, boolean>>().default({}).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("users_handle_idx").on(t.handle)],
);

/** User-supplied LLM API keys, encrypted at rest (AES-256-GCM, see src/lib/crypto.ts). */
export const llmKeys = pgTable(
  "llm_keys",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    /**
     * A provider id from `src/lib/agent/providers.ts`, which is the only list of them.
     * Text, not a Postgres enum (it was one until migration 0011): a provider is added
     * or retired in code, with no migration. Nothing in the database checks the value,
     * so every reader asks `isProvider` before using a row and refuses one it does not know.
     */
    provider: text("provider").$type<LlmProvider>().notNull(),
    label: text("label"),
    encryptedKey: text("encrypted_key").notNull(), // base64(iv|tag|ciphertext)
    last4: text("last4").notNull(),
    /**
     * W7: Anthropic organization-level keys are not scoped to a workspace and must send
     * `anthropic-workspace-id` on every request; a key created inside a workspace needs
     * nothing. Null for every other provider and for workspace-scoped Anthropic keys.
     */
    workspaceId: text("workspace_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("llm_keys_user_idx").on(t.userId)],
);

/**
 * A hard, wallet-layer budget. `perTxUsd` caps every outbound USDC transfer at the
 * Privy policy engine — enforced when the wallet signs, regardless of what the app
 * or the model asks for. `policyIds` are the Privy policy objects per chain.
 */
export interface WalletBudget {
  perTxUsd: number;
  policyIds: { base?: string; solana?: string };
}

// ---------- wallets ----------
/**
 * Every wallet we know about. User embedded wallets (created client-side by Privy on login)
 * and agent server wallets (created server-side via @privy-io/node, one per chain per agent).
 */
export const wallets = pgTable(
  "wallets",
  {
    id: text("id").primaryKey(), // Privy wallet id
    kind: walletKindEnum("kind").notNull(),
    chain: chainEnum("chain").notNull(),
    address: text("address").notNull(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    agentId: text("agent_id"), // set for agent_server wallets (FK added in relations to avoid cycle)
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("wallets_user_idx").on(t.userId), index("wallets_agent_idx").on(t.agentId), uniqueIndex("wallets_addr_idx").on(t.chain, t.address)],
);

// ---------- agents ----------
/** Strongly-typed agent configuration stored as JSON. Validated with zod in src/lib/agent/config.ts. */
export type AgentConfig = {
  /** Free-form persona / strategy prompt written by the user. */
  strategyPrompt: string;
  /** Data sources the agent may pay for (ids from src/lib/data-sources/registry.ts). */
  dataSources: string[];
  /** Chains the agent may trade on. */
  chains: Array<"solana" | "base">;
  /**
   * The universe rules. There is no allowlist: the agent may trade anything it
   * discovers, including a token minted minutes ago, provided that token clears
   * these gates and scores well enough. See src/lib/tokens/score.ts.
   */
  universe: {
    /**
     * Which candidate feeds run each tick. Every one is free except `paid_launches`,
     * which buys a launch radar per chain per sweep out of the run's data budget, and
     * `smart_money`, which buys Nansen's smart money board once per chain per tick and
     * only for an agent that also has the `nansen-smart-money` source enabled.
     */
    discovery: Array<
      | "new_launches"
      | "trending"
      | "top_organic"
      | "momentum"
      | "gecko_launches"
      | "paid_launches"
      | "smart_money"
    >;
    /** Composite score (0-100) a token must reach before the agent may buy it. */
    minScore: number;
    minLiquidityUsd: number;
    minHolderCount: number;
    /** Refuse tokens younger than this. The first minutes of a launch are the rug window. */
    minAgeMinutes: number;
    /** null = no ceiling. Set it low (e.g. 168) to hunt only fresh launches. */
    maxAgeHours: number | null;
    maxTop10HolderPct: number;
    /** EVM only; Solana has no transfer tax. */
    maxBuyTaxPct: number;
    requireMintRevoked: boolean;
    requireFreezeRevoked: boolean;
    /** Never trade these, whatever they score. The inverse of an allowlist. */
    blocklist: Array<{ chain: "solana" | "base"; address: string; symbol: string }>;
  };
  risk: {
    maxTradeUsd: number;
    maxDailyTrades: number;
    maxPositionPct: number; // % of agent wallet equity in one token
    maxDataSpendUsdPerRun: number; // cap on x402 spend per run
    stopLossPct: number | null;
    takeProfitPct: number | null;
    slippageBps: number;
    /** Exit engine (deterministic, no LLM). null = off. */
    trailingStopPct: number | null; // exit when price falls this % from the peak since entry
    maxHoldHours: number | null; // exit a position older than this
    exitScoreBelow: number | null; // rescore holdings each tick; exit if total drops under this
    exitOnLiquidityDropPct: number | null; // exit if pooled liquidity fell this % since entry
    /**
     * The most tokens the agent may hold at once, 1 to 50. Null or absent = no limit,
     * which is every config written before the field existed. Buys only: a sell is never
     * refused by it. Read through `readMaxOpenPositions` (src/lib/trading/risk.ts).
     */
    maxOpenPositions?: number | null;
    /**
     * USD the agent always keeps in cash: a buy that would leave less after its fee is
     * refused. 0 or absent = no reserve. Buys only. Read through `readCashReserveUsd`.
     */
    cashReserveUsd?: number;
  };
  /** How trades leave the agent. `approve` = the agent proposes, the owner decides. */
  execution: {
    mode: "auto" | "approve";
    proposalTtlMinutes: number;
  };
  schedule: {
    intervalMinutes: number; // 0 = manual only
    /**
     * Do not start a scheduled run while the agent has no room to buy (`roomToBuy` in
     * src/lib/trading/risk.ts). Absent = false. Run now is never skipped, and the exit
     * engine runs on its own clock either way.
     */
    skipWhenFull?: boolean;
  };
  llm: {
    provider: LlmProvider;
    model: string; // e.g. "claude-sonnet-5"
    temperature: number;
    maxSteps: number;
    /**
     * Where the thinking comes from. Absent or `"key"`: the owner's own LLM key, with
     * `provider` and `model` above. `"usdc"`: no key; each model step is bought over x402
     * and paid by the agent's own wallet (see src/lib/x402/inference-types.ts), with the
     * model and limits in `usdc`. The mode is always this field, never inferred from a
     * missing key.
     */
    source?: "key" | "usdc";
    usdc?: {
      /** The gateway's model id, one of `PAY_PER_USE_MODELS`. */
      model: string;
      /** The most one run may spend on thinking, USD. */
      maxUsdPerRun: number;
      /** The most this agent may spend on thinking in a UTC day, USD. */
      maxUsdPerDay: number;
    };
  };
};

export const agents = pgTable(
  "agents",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    tagline: text("tagline"),
    avatarSeed: text("avatar_seed"),
    mode: agentModeEnum("mode").default("paper").notNull(),
    status: agentStatusEnum("status").default("draft").notNull(),
    isPublic: boolean("is_public").default(true).notNull(),
    llmKeyId: text("llm_key_id").references(() => llmKeys.id, { onDelete: "set null" }),
    config: jsonb("config").$type<AgentConfig>().notNull(),
    /** Paper-mode starting balance in USD; live mode uses real wallet balances. */
    paperStartingUsd: numeric("paper_starting_usd", { precision: 18, scale: 2 }).default("10000").notNull(),
    /** Wallet-layer spend cap (Privy policy). Null until the first policy is applied. */
    walletBudget: jsonb("wallet_budget").$type<WalletBudget | null>(),
    nextRunAt: timestamp("next_run_at", { withTimezone: true }),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    /**
     * Pay-per-use thinking only. Why this agent is not being run (an
     * `InferenceStopReason`), since when, and when to look again. A held agent is not
     * failing: no run row is written and its owner is told once, not on every tick.
     */
    inferenceHold: text("inference_hold"),
    /** Also set while `inference_hold` is null, as the note of a first unreadable balance: only a second one in a row becomes a hold. */
    inferenceHoldSince: timestamp("inference_hold_since", { withTimezone: true }),
    inferenceHoldUntil: timestamp("inference_hold_until", { withTimezone: true }),
    /** Consecutive holds that were the agent's or the gateway's doing; drives the back-off. Holds that are nobody's fault (a halt, a pause, the switch off, the platform's daily limit) do not count. */
    inferenceStrikes: integer("inference_strikes").default(0).notNull(),
    /** When the owner was last told about the current hold. */
    inferenceNotifiedAt: timestamp("inference_notified_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("agents_slug_idx").on(t.slug), index("agents_next_run_idx").on(t.nextRunAt), index("agents_public_idx").on(t.isPublic, t.status)],
);

// ---------- runs & steps ----------
export const agentRuns = pgTable(
  "agent_runs",
  {
    id: text("id").primaryKey(),
    agentId: text("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
    trigger: runTriggerEnum("trigger").notNull(),
    status: runStatusEnum("status").default("queued").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    /** Final assistant summary for the feed / run detail. */
    summary: text("summary"),
    error: text("error"),
    dataSpendUsd: numeric("data_spend_usd", { precision: 18, scale: 6 }).default("0").notNull(),
    inputTokens: integer("input_tokens").default(0).notNull(),
    outputTokens: integer("output_tokens").default(0).notNull(),
    /** `"key"` or `"usdc"`. Null on rows written before the column existed (all key runs). */
    llmSource: text("llm_source"),
    /** The model id the run thought on. Null on older rows. */
    model: text("model"),
    /** What a pay-per-use run was charged for thinking. Zero for key runs. */
    inferenceSpendUsd: numeric("inference_spend_usd", { precision: 18, scale: 6 }).default("0").notNull(),
    /** Why a pay-per-use run ended before the model finished (an `InferenceStopReason`). */
    stopReason: text("stop_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("agent_runs_agent_idx").on(t.agentId, t.createdAt)],
);

// ---------- pay-per-use thinking ----------
/**
 * One row per model step an agent paid for itself (src/lib/x402/inference-types.ts).
 *
 * Written before anything is signed and never deleted: there are no foreign keys here on
 * purpose, so the record of what a wallet paid outlives the agent, the run and the
 * account. `x402_payments` (paid data, platform wallet) is a different ledger and is not
 * touched by this feature.
 */
export const inferencePayments = pgTable(
  "inference_payments",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    agentId: text("agent_id"),
    runId: text("run_id"),
    /** The request's place in its run, from 0. */
    seq: integer("seq").notNull(),
    /** sha256 of the request body, hex. Never the body: prompts are not stored here. */
    requestHash: text("request_hash").notNull(),
    chain: text("chain").notNull(),
    network: text("network").notNull(),
    host: text("host").notNull(),
    model: text("model").notNull(),
    /** The model the gateway says answered, when it says. */
    servedModel: text("served_model"),
    payerWalletId: text("payer_wallet_id").notNull(),
    payerAddress: text("payer_address").notNull(),
    payTo: text("pay_to").notNull(),
    asset: text("asset").notNull(),
    quotedUsd: numeric("quoted_usd", { precision: 18, scale: 6 }).notNull(),
    settledUsd: numeric("settled_usd", { precision: 18, scale: 6 }),
    /** An `InferencePaymentStatus`. */
    status: text("status").notNull(),
    answered: boolean("answered"),
    httpStatus: integer("http_status"),
    /** The memo the payment carried: how the reconciler finds it on chain. */
    memo: text("memo"),
    blockhash: text("blockhash"),
    payerSignature: text("payer_signature"),
    txHash: text("tx_hash"),
    gatewayRequestId: text("gateway_request_id"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    /** The UTC day (`YYYY-MM-DD`) whose counters hold this amount, so a release returns it to the right day. */
    budgetDay: text("budget_day").notNull(),
    /** Why a payment ended anywhere but `settled`. Redacted text, never a prompt. */
    detail: text("detail"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    signedAt: timestamp("signed_at", { withTimezone: true }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("inference_payments_run_seq_idx").on(t.runId, t.seq),
    index("inference_payments_owner_idx").on(t.ownerId, t.createdAt),
    index("inference_payments_agent_idx").on(t.agentId, t.createdAt),
    index("inference_payments_status_idx").on(t.status, t.createdAt),
  ],
);

/**
 * What has been reserved or spent on pay-per-use thinking per UTC day, for the platform
 * (`scope_id` "all"), each owner and each agent. Caps are conditional updates on these
 * rows inside one transaction, which is what makes them exact across server instances.
 */
export const inferenceBudgetDays = pgTable(
  "inference_budget_days",
  {
    scope: text("scope").notNull(), // "platform" | "owner" | "agent"
    scopeId: text("scope_id").notNull(),
    day: text("day").notNull(), // YYYY-MM-DD, UTC
    usd: numeric("usd", { precision: 18, scale: 6 }).default("0").notNull(),
    requests: integer("requests").default(0).notNull(),
    /** Owner scope only: pay-per-use runs started by hand that day. */
    manualRuns: integer("manual_runs").default(0).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.scope, t.scopeId, t.day] })],
);

/**
 * The switches an admin can throw without a deploy. One row, id "global". `halted` stops
 * every signature until an admin clears it; `paused_until` is set by the circuit
 * breakers and clears itself.
 */
export const inferenceControl = pgTable("inference_control", {
  id: text("id").primaryKey(),
  halted: boolean("halted").default(false).notNull(),
  haltReason: text("halt_reason"),
  pausedUntil: timestamp("paused_until", { withTimezone: true }),
  pauseReason: text("pause_reason"),
  updatedBy: text("updated_by"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const agentRunSteps = pgTable(
  "agent_run_steps",
  {
    id: text("id").primaryKey(),
    runId: text("run_id").notNull().references(() => agentRuns.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    kind: stepKindEnum("kind").notNull(),
    toolName: text("tool_name"),
    /** tool args, tool result, message text, or error — shape depends on kind */
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    durationMs: integer("duration_ms"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("agent_run_steps_run_idx").on(t.runId, t.seq)],
);

/** Every x402 payment an agent makes for data. */
export const x402Payments = pgTable(
  "x402_payments",
  {
    id: text("id").primaryKey(),
    agentId: text("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
    runId: text("run_id").references(() => agentRuns.id, { onDelete: "set null" }),
    sourceId: text("source_id").notNull(), // data-source registry id
    url: text("url").notNull(),
    network: text("network").notNull(), // CAIP-2
    amountUsd: numeric("amount_usd", { precision: 18, scale: 6 }).notNull(),
    txHash: text("tx_hash"),
    settled: boolean("settled").default(false).notNull(),
    simulated: boolean("simulated").default(false).notNull(), // true in paper/mock mode
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("x402_payments_agent_idx").on(t.agentId, t.createdAt)],
);

// ---------- tokens, trades, positions ----------
export const tokens = pgTable(
  "tokens",
  {
    id: text("id").primaryKey(), // `${chain}:${address}`
    chain: chainEnum("chain").notNull(),
    address: text("address").notNull(), // mint (solana) or contract (base); "native" for SOL/ETH
    symbol: text("symbol").notNull(),
    name: text("name"),
    decimals: integer("decimals").notNull(),
    logoUrl: text("logo_url"),
    lastPriceUsd: numeric("last_price_usd", { precision: 30, scale: 12 }),
    priceUpdatedAt: timestamp("price_updated_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("tokens_chain_addr_idx").on(t.chain, t.address)],
);

export const trades = pgTable(
  "trades",
  {
    id: text("id").primaryKey(),
    agentId: text("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
    runId: text("run_id").references(() => agentRuns.id, { onDelete: "set null" }),
    ownerId: text("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    chain: chainEnum("chain").notNull(),
    side: tradeSideEnum("side").notNull(),
    tokenId: text("token_id").notNull().references(() => tokens.id),
    /** the quote asset (USDC on both chains for v1) */
    quoteTokenId: text("quote_token_id").notNull().references(() => tokens.id),
    amountToken: numeric("amount_token", { precision: 30, scale: 12 }).notNull(),
    amountUsd: numeric("amount_usd", { precision: 18, scale: 6 }).notNull(),
    priceUsd: numeric("price_usd", { precision: 30, scale: 12 }).notNull(),
    feeUsd: numeric("fee_usd", { precision: 18, scale: 6 }).default("0").notNull(),
    status: tradeStatusEnum("status").default("pending").notNull(),
    isPaper: boolean("is_paper").notNull(),
    txHash: text("tx_hash"),
    /** The agent's one-line reasoning shown in the feed ("why I bought"). */
    rationale: text("rationale"),
    /** The token's score at the moment of the trade, so the record survives re-scoring. */
    scoreSnapshot: jsonb("score_snapshot").$type<TradeScoreSnapshot | null>(),
    origin: tradeOriginEnum("origin").default("agent").notNull(),
    /** Set by the exit engine: stop_loss | take_profit | trailing_stop | max_hold | score_collapse | liquidity_collapse */
    exitReason: text("exit_reason"),
    /** Approval mode: the notional the agent asked for; `amountUsd` is what actually filled. */
    requestedUsd: numeric("requested_usd", { precision: 18, scale: 6 }),
    proposedAt: timestamp("proposed_at", { withTimezone: true }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    /** owner | expiry | guard — who settled a proposal */
    decidedBy: text("decided_by"),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    filledAt: timestamp("filled_at", { withTimezone: true }),
  },
  (t) => [index("trades_agent_idx").on(t.agentId, t.createdAt), index("trades_created_idx").on(t.createdAt)],
);

export const positions = pgTable(
  "positions",
  {
    agentId: text("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
    tokenId: text("token_id").notNull().references(() => tokens.id),
    amountToken: numeric("amount_token", { precision: 30, scale: 12 }).notNull(),
    avgCostUsd: numeric("avg_cost_usd", { precision: 30, scale: 12 }).notNull(),
    realizedPnlUsd: numeric("realized_pnl_usd", { precision: 18, scale: 6 }).default("0").notNull(),
    /** When the position went from flat to held; reset when it is fully closed. */
    openedAt: timestamp("opened_at", { withTimezone: true }),
    /** Highest mark seen since `openedAt` — the trailing stop's reference. */
    peakPriceUsd: numeric("peak_price_usd", { precision: 30, scale: 12 }),
    /** Score total and pooled liquidity at first entry, for collapse detection and calibration. */
    entryScore: numeric("entry_score", { precision: 6, scale: 2 }),
    entryLiquidityUsd: numeric("entry_liquidity_usd", { precision: 20, scale: 2 }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.agentId, t.tokenId] })],
);

/** Periodic equity snapshots for portfolio charts + leaderboard windows. */
export const equitySnapshots = pgTable(
  "equity_snapshots",
  {
    id: text("id").primaryKey(),
    agentId: text("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
    equityUsd: numeric("equity_usd", { precision: 18, scale: 6 }).notNull(),
    cashUsd: numeric("cash_usd", { precision: 18, scale: 6 }).notNull(),
    at: timestamp("at", { withTimezone: true }).defaultNow().notNull(),
    /**
     * W7: the agent's mode when the point was taken. A paper book starts at
     * `paperStartingUsd` (10,000 by default) and a live book at whatever was deposited,
     * so a series that mixes the two reads as a −99.9% crash the moment an agent goes
     * live. Writers stamp the current mode; readers (equity curve, leaderboard windows,
     * home) only use points whose mode matches the agent's current mode. Null on rows
     * written before this column existed — treated as the agent's current mode.
     */
    mode: agentModeEnum("mode"),
  },
  (t) => [index("equity_snapshots_agent_idx").on(t.agentId, t.at)],
);

/** Compact score record stored on a trade. Mirrors TokenScore in src/server/types.ts. */
export type TradeScoreSnapshot = {
  total: number;
  verdict: "avoid" | "watch" | "candidate" | "strong";
  components: Record<string, number | null>;
  blockers: string[];
  warnings: string[];
  liquidityUsd: number | null;
  ageHours: number | null;
  scoredAt: string;
};

/**
 * Score cache. Scoring a token costs several upstream calls, and many agents look at
 * the same tokens, so scores are shared and refreshed on a TTL rather than per agent.
 */
export const tokenScores = pgTable(
  "token_scores",
  {
    id: text("id").primaryKey(), // `${chain}:${address}`
    chain: chainEnum("chain").notNull(),
    address: text("address").notNull(),
    symbol: text("symbol").notNull(),
    total: numeric("total", { precision: 6, scale: 2 }).notNull(),
    verdict: scoreVerdictEnum("verdict").notNull(),
    components: jsonb("components").$type<Record<string, number | null>>().notNull(),
    blockers: jsonb("blockers").$type<string[]>().notNull(),
    warnings: jsonb("warnings").$type<string[]>().notNull(),
    priceUsd: numeric("price_usd", { precision: 30, scale: 12 }),
    liquidityUsd: numeric("liquidity_usd", { precision: 20, scale: 2 }),
    volume24hUsd: numeric("volume_24h_usd", { precision: 20, scale: 2 }),
    marketCapUsd: numeric("market_cap_usd", { precision: 24, scale: 2 }),
    holderCount: integer("holder_count"),
    ageHours: numeric("age_hours", { precision: 14, scale: 2 }),
    priceChange24hPct: numeric("price_change_24h_pct", { precision: 12, scale: 4 }),
    sources: jsonb("sources").$type<string[]>().notNull(),
    /**
     * Fingerprint of the `universe` rules this row was scored under. The gates are
     * per-agent, so a cached verdict is only reusable by an agent whose thresholds
     * match — otherwise a permissive agent's row would let a strict one buy.
     * Null on legacy rows, which are treated as a cache miss.
     */
    universeKey: text("universe_key"),
    scoredAt: timestamp("scored_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("token_scores_verdict_idx").on(t.verdict, t.total), index("token_scores_scored_idx").on(t.scoredAt)],
);

/**
 * The public score: one row per token, scored under the platform's default universe
 * with no paid signals and the default clip size — what `/discover` and the token page
 * show everyone. Its own table because `token_scores` holds whichever reading came last,
 * and an agent rescoring a token under its own rules would otherwise evict the public
 * one (the radar said "70 Avoid" while the token page said the score was out of date).
 * Written by `getTokenScore` alongside the cache row; never read to authorise a buy.
 */
export const publicTokenScores = pgTable("public_token_scores", {
  id: text("id").primaryKey(), // `${chain}:${address}`
  chain: chainEnum("chain").notNull(),
  address: text("address").notNull(),
  symbol: text("symbol").notNull(),
  total: numeric("total", { precision: 6, scale: 2 }).notNull(),
  verdict: scoreVerdictEnum("verdict").notNull(),
  components: jsonb("components").$type<Record<string, number | null>>().notNull(),
  blockers: jsonb("blockers").$type<string[]>().notNull(),
  warnings: jsonb("warnings").$type<string[]>().notNull(),
  priceUsd: numeric("price_usd", { precision: 30, scale: 12 }),
  liquidityUsd: numeric("liquidity_usd", { precision: 20, scale: 2 }),
  volume24hUsd: numeric("volume_24h_usd", { precision: 20, scale: 2 }),
  marketCapUsd: numeric("market_cap_usd", { precision: 24, scale: 2 }),
  holderCount: integer("holder_count"),
  ageHours: numeric("age_hours", { precision: 14, scale: 2 }),
  priceChange24hPct: numeric("price_change_24h_pct", { precision: 12, scale: 4 }),
  sources: jsonb("sources").$type<string[]>().notNull(),
  scoredAt: timestamp("scored_at", { withTimezone: true }).defaultNow().notNull(),
});

/** Append-only score history, one row per fresh scoring. Drives token pages and drift detection. */
export const tokenScoreHistory = pgTable(
  "token_score_history",
  {
    id: text("id").primaryKey(),
    tokenId: text("token_id").notNull(), // `${chain}:${address}`
    total: numeric("total", { precision: 6, scale: 2 }).notNull(),
    verdict: scoreVerdictEnum("verdict").notNull(),
    components: jsonb("components").$type<Record<string, number | null>>().notNull(),
    blockers: jsonb("blockers").$type<string[]>().notNull(),
    priceUsd: numeric("price_usd", { precision: 30, scale: 12 }),
    liquidityUsd: numeric("liquidity_usd", { precision: 20, scale: 2 }),
    holderCount: integer("holder_count"),
    /**
     * The universe a reading's total and verdict belong to: the public default's key
     * for a public reading (see `publicTokenScores`), an agent's own key otherwise, and
     * null for a legacy row or a default-universe reading taken with private inputs
     * (paid signals, another clip size). Only public-key rows may chart a total or a
     * verdict on a public page; the rest feed market facts at most.
     */
    universeKey: text("universe_key"),
    scoredAt: timestamp("scored_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("token_score_history_token_idx").on(t.tokenId, t.scoredAt)],
);

// ---------- social ----------
export const posts = pgTable(
  "posts",
  {
    id: text("id").primaryKey(),
    authorId: text("author_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    agentId: text("agent_id").references(() => agents.id, { onDelete: "cascade" }),
    tradeId: text("trade_id").references(() => trades.id, { onDelete: "cascade" }),
    kind: postKindEnum("kind").notNull(),
    body: text("body"),
    likeCount: integer("like_count").default(0).notNull(),
    commentCount: integer("comment_count").default(0).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("posts_created_idx").on(t.createdAt), index("posts_agent_idx").on(t.agentId)],
);

export const likes = pgTable(
  "likes",
  {
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    postId: text("post_id").notNull().references(() => posts.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.postId] })],
);

export const comments = pgTable(
  "comments",
  {
    id: text("id").primaryKey(),
    postId: text("post_id").notNull().references(() => posts.id, { onDelete: "cascade" }),
    authorId: text("author_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("comments_post_idx").on(t.postId, t.createdAt)],
);

export const follows = pgTable(
  "follows",
  {
    followerId: text("follower_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    targetType: followTargetEnum("target_type").notNull(),
    targetId: text("target_id").notNull(), // user id or agent id
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.followerId, t.targetType, t.targetId] }), index("follows_target_idx").on(t.targetType, t.targetId)],
);

export const notifications = pgTable(
  "notifications",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    // "trade" | "exit" | "proposal" | "run_failed" | "follow" | "like" | "comment",
    // plus (W7) "exit_failed" (a stop/target fired and the sell did not fill) and
    // "trade_unsettled" (a transaction confirmed on chain but its fill was never recorded).
    // "exit" is the owner-only notification the exit engine writes when a rule closed a
    // position (src/lib/trading/guardian.ts); followers get the usual "trade".
    // "proposal" goes to the owner and is actionable: its href is
    // `/agents/<slug>?proposal=<tradeId>` and the notifications page renders an
    // approve/reject card inline for it. There is no "fork" kind: forking does not exist.
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    href: text("href"),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("notifications_user_idx").on(t.userId, t.createdAt)],
);

// ---- W3: security ----
/**
 * Everything in this block is owned by the "premium security" workstream. It is
 * additive: nothing above it changed.
 */

/** What an audit row can describe. Append new kinds; never reuse an old one for a new meaning. */
export const auditKindEnum = pgEnum("audit_kind", [
  "withdraw",
  "budget_change",
  "go_live",
  "go_paper",
  "agent_paused",
  "agent_resumed",
  "llm_key_added",
  "llm_key_rotated",
  "llm_key_removed",
  "kill_switch_on",
  "kill_switch_off",
  "mfa_enrolled",
  "mfa_unenrolled",
  "first_trade_preset",
  "manual_run",
]);

/**
 * Append-only audit trail. Written by every action that can move money, change how
 * much money can move, or change who is allowed to move it.
 *
 * It is deliberately *not* a general event log: it records the operator's own
 * sensitive actions so that "did I do that, and when?" has an answer. It is never
 * updated and never deleted except by cascade when the user is deleted.
 *
 * `ip` and `userAgent` are best-effort request metadata, null when unavailable
 * (a cron-triggered write, or a proxy that strips the header).
 */
export const auditEvents = pgTable(
  "audit_events",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: auditKindEnum("kind").notNull(),
    /** The agent the action was about, when there is one. Not a FK: the row outlives the agent. */
    agentId: text("agent_id"),
    /** Denormalised so the log still reads correctly after the agent is deleted. */
    agentName: text("agent_name"),
    /** One human sentence: what happened, in the past tense. */
    summary: text("summary").notNull(),
    /** Structured detail — amounts, addresses, before/after values. Never a secret. */
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    ip: text("ip"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("audit_events_user_idx").on(t.userId, t.createdAt), index("audit_events_agent_idx").on(t.agentId)],
);

/**
 * Per-user security state. One row per user, created on first write.
 *
 * `tradingPaused` is the kill switch: while it is true the scheduler skips every
 * agent this user owns, so no new position is ever opened. The exit engine
 * (`/api/cron/marks` → `runGuardian`) is deliberately *not* filtered by it — a
 * kill switch that also stopped stop-losses would trap the operator in a position,
 * which is the opposite of what the control is for.
 */
export const userSecurity = pgTable("user_security", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  tradingPaused: boolean("trading_paused").default(false).notNull(),
  tradingPausedAt: timestamp("trading_paused_at", { withTimezone: true }),
  /** Mirror of Privy's enrolment, refreshed whenever we ask Privy. Advisory only: the gate re-reads Privy. */
  mfaMethods: jsonb("mfa_methods").$type<string[]>(),
  mfaCheckedAt: timestamp("mfa_checked_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const auditEventsRelations = relations(auditEvents, ({ one }) => ({
  user: one(users, { fields: [auditEvents.userId], references: [users.id] }),
}));

export const userSecurityRelations = relations(userSecurity, ({ one }) => ({
  user: one(users, { fields: [userSecurity.userId], references: [users.id] }),
}));
// ---- /W3 ----

// ---------- relations ----------
export const usersRelations = relations(users, ({ many }) => ({
  agents: many(agents),
  wallets: many(wallets),
  llmKeys: many(llmKeys),
  posts: many(posts),
}));

export const agentsRelations = relations(agents, ({ one, many }) => ({
  owner: one(users, { fields: [agents.ownerId], references: [users.id] }),
  llmKey: one(llmKeys, { fields: [agents.llmKeyId], references: [llmKeys.id] }),
  wallets: many(wallets),
  runs: many(agentRuns),
  trades: many(trades),
  positions: many(positions),
  posts: many(posts),
}));

export const walletsRelations = relations(wallets, ({ one }) => ({
  user: one(users, { fields: [wallets.userId], references: [users.id] }),
  agent: one(agents, { fields: [wallets.agentId], references: [agents.id] }),
}));

export const agentRunsRelations = relations(agentRuns, ({ one, many }) => ({
  agent: one(agents, { fields: [agentRuns.agentId], references: [agents.id] }),
  steps: many(agentRunSteps),
  trades: many(trades),
}));

export const agentRunStepsRelations = relations(agentRunSteps, ({ one }) => ({
  run: one(agentRuns, { fields: [agentRunSteps.runId], references: [agentRuns.id] }),
}));

export const tradesRelations = relations(trades, ({ one }) => ({
  agent: one(agents, { fields: [trades.agentId], references: [agents.id] }),
  run: one(agentRuns, { fields: [trades.runId], references: [agentRuns.id] }),
  token: one(tokens, { fields: [trades.tokenId], references: [tokens.id] }),
  quoteToken: one(tokens, { fields: [trades.quoteTokenId], references: [tokens.id] }),
  owner: one(users, { fields: [trades.ownerId], references: [users.id] }),
}));

export const positionsRelations = relations(positions, ({ one }) => ({
  agent: one(agents, { fields: [positions.agentId], references: [agents.id] }),
  token: one(tokens, { fields: [positions.tokenId], references: [tokens.id] }),
}));

export const postsRelations = relations(posts, ({ one, many }) => ({
  author: one(users, { fields: [posts.authorId], references: [users.id] }),
  agent: one(agents, { fields: [posts.agentId], references: [agents.id] }),
  trade: one(trades, { fields: [posts.tradeId], references: [trades.id] }),
  likes: many(likes),
  comments: many(comments),
}));

export const likesRelations = relations(likes, ({ one }) => ({
  post: one(posts, { fields: [likes.postId], references: [posts.id] }),
  user: one(users, { fields: [likes.userId], references: [users.id] }),
}));

export const commentsRelations = relations(comments, ({ one }) => ({
  post: one(posts, { fields: [comments.postId], references: [posts.id] }),
  author: one(users, { fields: [comments.authorId], references: [users.id] }),
}));

// keep `sql` import used for future defaults
void sql;

// ---- W4: trading ----

/**
 * What one executed trade actually cost and where it went.
 *
 * `trades` is the ledger: side, size, price, status. It is deliberately thin, because
 * every workstream reads it. A **receipt** is the document behind one row — the venue
 * it routed through, the quoted price against the filled price, the slippage that
 * opened up between them, network and venue fees in USD, the explorer link, and the
 * score the token carried at entry with the reasons behind it.
 *
 * Why its own table rather than columns on `trades`:
 *  - a receipt exists only for a trade that actually executed (`filled`), so half the
 *    ledger would carry fifteen null columns;
 *  - it is a *document*: read whole, rendered whole, never filtered on. The shape
 *    belongs in one jsonb blob (`data`) with only the handful of fields anyone would
 *    ever aggregate lifted out as real columns;
 *  - `trades` is the shared contract; receipts are W4's and can evolve without a
 *    migration landing in everyone's way.
 *
 * **Privacy.** A receipt is as public as the trade it documents, so it carries nothing
 * from the strategy: no prompt, no universe thresholds, no data-source list, no
 * transcript. The score total, verdict and component names are already public on the
 * token page; the gates that produced them are not, and are not written here.
 */
export type TradeReceiptVenue = "jupiter" | "privy-base" | "paper";

/** One reason a token scored the way it did, in plain words. Public by construction. */
export interface ReceiptScoreReason {
  /** Component key: safety | liquidity | organic | distribution | momentum | gecko | sentiment | smartMoney. */
  key: string;
  label: string;
  value: number;
}

export interface TradeReceiptData {
  chain: "solana" | "base";
  side: "buy" | "sell";
  venue: TradeReceiptVenue;
  /** Human venue name: "Jupiter Ultra", "Privy swap (Base)", "Paper simulator". */
  venueLabel: string;
  /** True for a paper fill. The UI must then say "Simulated fill · no on-chain transaction". */
  simulated: boolean;
  /** Transaction hash, or the literal "simulated" for a paper fill. */
  txHash: string;
  /** Explorer link for a live fill; null when simulated. */
  explorerUrl: string | null;
  symbol: string;
  tokenAddress: string;
  /** Price per whole token the venue quoted before execution. */
  quotedPriceUsd: number;
  /** Price per whole token actually paid or received. */
  filledPriceUsd: number;
  /**
   * Signed slippage in basis points, from the *trader's* point of view: positive means
   * the fill was worse than the quote (paid more on a buy, received less on a sell).
   */
  slippageBps: number;
  /** The agent's configured tolerance, for comparison. */
  slippageToleranceBps: number;
  amountToken: number;
  /** Gross USD notional of the fill. */
  amountUsd: number;
  /** Chain fee (gas / priority) in USD. Null when the venue does not report one. */
  networkFeeUsd: number | null;
  /** Venue or route fee in USD, including the paper simulator's 0.3%. */
  venueFeeUsd: number;
  /**
   * The Tocker fee charged on this fill (W5), in USD, as recorded. `0` when the fee is off;
   * absent on receipts written before the fee existed. Public on purpose — what the
   * platform charged is a fact about the trade, not about the strategy.
   */
  platformFeeUsd?: number;
  /** networkFeeUsd + venueFeeUsd + platformFeeUsd. */
  totalFeeUsd: number;
  /** Composite score at entry, frozen. Null when the trade carried no score (legacy sells). */
  scoreTotal: number | null;
  scoreVerdict: "avoid" | "watch" | "candidate" | "strong" | null;
  /** The two or three components that carried the score. Never the thresholds. */
  scoreReasons: ReceiptScoreReason[];
  /** ISO timestamps: when the quote was taken, and when the fill came back. */
  quotedAt: string;
  filledAt: string;
  /** Milliseconds between the two, the honest measure of execution latency. */
  latencyMs: number;
}

export const tradeReceipts = pgTable(
  "trade_receipts",
  {
    tradeId: text("trade_id")
      .primaryKey()
      .references(() => trades.id, { onDelete: "cascade" }),
    agentId: text("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
    venue: text("venue").notNull(),
    simulated: boolean("simulated").notNull(),
    txHash: text("tx_hash"),
    /** Lifted out of `data` because "how bad was our execution" is a real question. */
    slippageBps: numeric("slippage_bps", { precision: 12, scale: 2 }).notNull(),
    totalFeeUsd: numeric("total_fee_usd", { precision: 18, scale: 6 }).notNull(),
    data: jsonb("data").$type<TradeReceiptData>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("trade_receipts_agent_idx").on(t.agentId, t.createdAt)],
);

export const tradeReceiptsRelations = relations(tradeReceipts, ({ one }) => ({
  trade: one(trades, { fields: [tradeReceipts.tradeId], references: [trades.id] }),
  agent: one(agents, { fields: [tradeReceipts.agentId], references: [agents.id] }),
}));

/**
 * Position sizing. `fixed_usd` is what every agent did before this existed, and is
 * still the default, so a config with no `sizing` block behaves exactly as it did.
 *
 * `maxTradeUsd` stays the hard ceiling over every mode — a percent-of-equity agent
 * that 10×s does not quietly start writing $1,000 tickets.
 *
 * See `src/lib/trading/sizing.ts` for the pure functions and the one-sentence
 * explanation of each mode.
 */
export type PositionSizingMode = "fixed_usd" | "percent_equity" | "volatility_scaled";

export interface PositionSizingConfig {
  mode: PositionSizingMode;
  /** `percent_equity` and `volatility_scaled`: the share of equity a full-size clip is. */
  percentOfEquity: number;
  /**
   * `volatility_scaled`: the recent range (high-to-low as a % of price) a *full*-size
   * clip assumes. A token ranging wider than this is sized down proportionally; one
   * ranging tighter is never sized *up* — the mode only ever shrinks.
   */
  referenceRangePct: number;
  /** Never write a ticket smaller than this; below it, skip the trade instead. */
  minTradeUsd: number;
}

/**
 * `AgentConfig["risk"]` plus the additive W4 sizing block. The `risk` object in the
 * database is the same object; this type is how code that cares reads the extra field
 * without the shared `AgentConfig` contract changing shape for everyone else.
 */
export type AgentRiskWithSizing = AgentConfig["risk"] & { sizing?: PositionSizingConfig };
export type AgentConfigWithSizing = Omit<AgentConfig, "risk"> & { risk: AgentRiskWithSizing };

/**
 * Notification kinds this workstream writes, on top of the ones in `notifications`
 * above (`trade`, `exit`, `proposal`, `run_failed`, `follow`, `like`, `comment`):
 *
 *  - `fill`   — owner-only, one per executed trade, carrying the receipt summary. Its
 *               href is `/tokens/<chain>/<address>?trade=<tradeId>`.
 *  - `digest` — owner-only, at most one per agent per UTC day: trades, PnL and what the
 *               exit engine did. Its href is `/agents/<slug>`.
 *
 * Still no `fork` kind. Forking does not exist.
 */
export const W4_NOTIFICATION_KINDS = ["fill", "digest"] as const;

// ---- /W4 ----

// ---- W1: unified cash ----
/**
 * A transfer the user asked for while funding an agent.
 *
 * Funding is signed client-side by the user's own embedded wallet, so the server
 * cannot make it happen — it can only record what was asked for and what came
 * back. That record is the whole point: an agent created with a funding plan
 * whose second transfer was rejected must be able to say so on its settings
 * page rather than silently looking funded.
 *
 * `status` moves pending → sent | failed | cancelled, once, from the client that
 * signed it.
 */
export const fundingIntentStatusEnum = pgEnum("funding_intent_status", [
  "pending",
  "sent",
  "failed",
  "cancelled",
]);

export const agentFundingIntents = pgTable(
  "agent_funding_intents",
  {
    id: text("id").primaryKey(),
    agentId: text("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    chain: chainEnum("chain").notNull(),
    /** "usdc" is the agent's trading cash; "native" is the gas it signs with. */
    asset: text("asset").notNull(),
    /** Human units (12.5 USDC, 0.006667 SOL), per the money conventions above. */
    amount: numeric("amount", { precision: 38, scale: 18 }).notNull(),
    /** What that was worth when the user agreed to it. Display only. */
    amountUsd: numeric("amount_usd", { precision: 18, scale: 6 }),
    status: fundingIntentStatusEnum("status").default("pending").notNull(),
    /** Where the money was going — the agent's server wallet at the time. */
    toAddress: text("to_address").notNull(),
    txHash: text("tx_hash"),
    /** The user-facing reason a transfer did not happen. Never a raw stack. */
    error: text("error"),
    /** True when the plan was made during agent creation rather than later. */
    onCreate: boolean("on_create").default(false).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    settledAt: timestamp("settled_at", { withTimezone: true }),
  },
  (t) => [
    index("agent_funding_intents_agent_idx").on(t.agentId, t.createdAt),
    index("agent_funding_intents_user_idx").on(t.userId, t.createdAt),
  ],
);

export const agentFundingIntentsRelations = relations(agentFundingIntents, ({ one }) => ({
  agent: one(agents, { fields: [agentFundingIntents.agentId], references: [agents.id] }),
  user: one(users, { fields: [agentFundingIntents.userId], references: [users.id] }),
}));
// ---- /W1 ----

// ---- waitlist ----
/**
 * Signups from the landing page's waitlist form. The form and its endpoint are gone
 * (sign-up is open); the rows stay so the admin page can list who asked.
 */
export const waitlistSignups = pgTable("waitlist_signups", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  volume: text("volume").notNull(),
  chains: jsonb("chains").$type<string[]>().notNull().default([]),
  style: text("style"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
// ---- /waitlist ----

// ---- W5: platform ----
/**
 * The platform's own wallets, and its ledger of per-trade fees.
 *
 * Two facts about the business live here and nowhere else:
 *
 *  1. **The platform pays for data.** Every x402 micropayment is signed by an
 *     app-owned Privy server wallet (`platform_wallets`), not by the agent's. An
 *     operator funds their agent to *trade*; sentiment and safety data is the
 *     platform's cost of goods. The per-run budget, the per-payment cap and the
 *     per-agent/per-run `x402_payments` record are unchanged — only the signer moved.
 *  2. **A percentage fee per executed fill.** `PLATFORM_FEE_BPS` (default 50, which
 *     is 0.5% of the fill's USD size; `0` disables) is charged on every fill — buy or
 *     sell, agent, approved proposal, guardian exit or manual — and recorded here at
 *     fill time. A row keeps the amount it was written with. It never touches the
 *     trade path: a live agent's accrued fees are swept to the platform wallet in
 *     batches by the guardian once they clear `PLATFORM_FEE_SETTLE_MIN_USD`
 *     (default $1.00). Paper agents write rows too, already `settled` with
 *     `tx_hash: "simulated"`, because paper cash must feel the same drag as live
 *     cash or paper is quietly lying about the strategy.
 */

/** One app-owned Privy server wallet per chain. Unique on `chain` — see the index. */
export const platformWallets = pgTable(
  "platform_wallets",
  {
    /** Privy wallet id. Never a `paper_` placeholder: a platform wallet is real or absent. */
    id: text("id").primaryKey(),
    chain: chainEnum("chain").notNull(),
    address: text("address").notNull(),
    /** Free-form note shown on the operator card ("data + fees"). */
    label: text("label"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  // One wallet per chain, enforced by the database: two concurrent first calls race to
  // insert and exactly one wins, which is what makes lazy creation safe.
  (t) => [uniqueIndex("platform_wallets_chain_idx").on(t.chain)],
);

export const platformFeeStatusEnum = pgEnum("platform_fee_status", ["accrued", "settled"]);

export const platformFees = pgTable(
  "platform_fees",
  {
    id: text("id").primaryKey(),
    agentId: text("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    /** Unique: exactly one fee per fill, so a retried write can never double-charge. */
    tradeId: text("trade_id")
      .notNull()
      .references(() => trades.id, { onDelete: "cascade" }),
    chain: chainEnum("chain").notNull(),
    amountUsd: numeric("amount_usd", { precision: 18, scale: 6 }).notNull(),
    status: platformFeeStatusEnum("status").default("accrued").notNull(),
    /** The settlement transfer's hash, or the literal "simulated" for a paper agent. */
    txHash: text("tx_hash"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    settledAt: timestamp("settled_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("platform_fees_trade_idx").on(t.tradeId),
    index("platform_fees_agent_idx").on(t.agentId, t.status),
    index("platform_fees_created_idx").on(t.createdAt),
  ],
);

export const platformFeesRelations = relations(platformFees, ({ one }) => ({
  agent: one(agents, { fields: [platformFees.agentId], references: [agents.id] }),
  trade: one(trades, { fields: [platformFees.tradeId], references: [trades.id] }),
}));
// ---- /W5 ----

// ---- W8: web push ----
/**
 * One row per browser (or installed PWA) that asked to be told about a proposal.
 *
 * A proposal on a five-minute TTL cannot wait for the operator to have a tab open, so
 * the decision has to reach a phone that is in a pocket. The Web Push endpoint IS the
 * identity of a subscription — the browser mints it, it is unguessable, and re-calling
 * `pushManager.subscribe()` on the same device returns the same one — so `endpoint` is
 * the unique key and a re-subscribe is an upsert, not a duplicate.
 *
 * `p256dh` and `auth` are the subscriber's public key material: they encrypt the
 * payload so the push *service* (Apple, Google, Mozilla) relays ciphertext it cannot
 * read. They are not secrets of ours and they are useless without the endpoint, but
 * they are still per-user data and never leave the server.
 *
 * `disabledAt` rather than a delete: a push service answers 404/410 for an endpoint it
 * has dropped (app uninstalled, permission revoked, subscription rotated), and keeping
 * the tombstone means a device that vanished stops costing a request per proposal
 * without erasing the fact that it was once there. A fresh subscribe on the same
 * endpoint clears it.
 */
export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** The push service URL the browser handed us. Unique: it is the device's identity. */
    endpoint: text("endpoint").notNull(),
    /** Subscriber public key (base64url), from `subscription.keys.p256dh`. */
    p256dh: text("p256dh").notNull(),
    /** Subscriber auth secret (base64url), from `subscription.keys.auth`. */
    auth: text("auth").notNull(),
    /** For the operator's own "which device is this?" list. Never parsed. */
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    /** Bumped on every successful send, so a stale device is visible without a delete. */
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    /** Set when the push service answered 404/410. Null means active. */
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("push_subscriptions_endpoint_idx").on(t.endpoint),
    index("push_subscriptions_user_idx").on(t.userId, t.disabledAt),
  ],
);

export const pushSubscriptionsRelations = relations(pushSubscriptions, ({ one }) => ({
  user: one(users, { fields: [pushSubscriptions.userId], references: [users.id] }),
}));
// ---- /W8 ----
