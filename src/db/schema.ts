/**
 * Petri — database schema (Drizzle + Postgres).
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

// ---------- enums ----------
export const chainEnum = pgEnum("chain", ["solana", "base"]);
export const agentModeEnum = pgEnum("agent_mode", ["paper", "live"]);
export const agentStatusEnum = pgEnum("agent_status", ["draft", "active", "paused", "error"]);
export const llmProviderEnum = pgEnum("llm_provider", ["anthropic", "openai", "openrouter"]);
export const runStatusEnum = pgEnum("run_status", ["queued", "running", "succeeded", "failed", "cancelled"]);
export const runTriggerEnum = pgEnum("run_trigger", ["schedule", "manual", "webhook"]);
export const stepKindEnum = pgEnum("step_kind", ["thought", "tool_call", "tool_result", "message", "error"]);
export const tradeSideEnum = pgEnum("trade_side", ["buy", "sell"]);
export const tradeStatusEnum = pgEnum("trade_status", ["pending", "submitted", "filled", "failed", "rejected"]);
export const postKindEnum = pgEnum("post_kind", ["trade", "note", "agent_created", "milestone"]);
export const followTargetEnum = pgEnum("follow_target", ["user", "agent"]);
export const walletKindEnum = pgEnum("wallet_kind", ["user_embedded", "agent_server"]);

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
    provider: llmProviderEnum("provider").notNull(),
    label: text("label"),
    encryptedKey: text("encrypted_key").notNull(), // base64(iv|tag|ciphertext)
    last4: text("last4").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("llm_keys_user_idx").on(t.userId)],
);

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
  /** Token allowlist per chain: mint/contract addresses. Empty = any token the data sources surface. */
  tokenAllowlist: Array<{ chain: "solana" | "base"; address: string; symbol: string }>;
  risk: {
    maxTradeUsd: number;
    maxDailyTrades: number;
    maxPositionPct: number; // % of agent wallet equity in one token
    maxDataSpendUsdPerRun: number; // cap on x402 spend per run
    stopLossPct: number | null;
    takeProfitPct: number | null;
    slippageBps: number;
  };
  schedule: {
    intervalMinutes: number; // 0 = manual only
  };
  llm: {
    provider: "anthropic" | "openai" | "openrouter";
    model: string; // e.g. "claude-sonnet-5"
    temperature: number;
    maxSteps: number;
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
    isForkable: boolean("is_forkable").default(true).notNull(),
    forkedFromId: text("forked_from_id"),
    llmKeyId: text("llm_key_id").references(() => llmKeys.id, { onDelete: "set null" }),
    config: jsonb("config").$type<AgentConfig>().notNull(),
    /** Paper-mode starting balance in USD; live mode uses real wallet balances. */
    paperStartingUsd: numeric("paper_starting_usd", { precision: 18, scale: 2 }).default("10000").notNull(),
    nextRunAt: timestamp("next_run_at", { withTimezone: true }),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
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
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("agent_runs_agent_idx").on(t.agentId, t.createdAt)],
);

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
  },
  (t) => [index("equity_snapshots_agent_idx").on(t.agentId, t.at)],
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
    kind: text("kind").notNull(), // "trade" | "run_failed" | "follow" | "like" | "comment" | "fork"
    title: text("title").notNull(),
    body: text("body"),
    href: text("href"),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("notifications_user_idx").on(t.userId, t.createdAt)],
);

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
  forkedFrom: one(agents, { fields: [agents.forkedFromId], references: [agents.id], relationName: "forks" }),
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
