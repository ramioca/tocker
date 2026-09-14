CREATE TYPE "public"."agent_mode" AS ENUM('paper', 'live');--> statement-breakpoint
CREATE TYPE "public"."agent_status" AS ENUM('draft', 'active', 'paused', 'error');--> statement-breakpoint
CREATE TYPE "public"."chain" AS ENUM('solana', 'base');--> statement-breakpoint
CREATE TYPE "public"."follow_target" AS ENUM('user', 'agent');--> statement-breakpoint
CREATE TYPE "public"."llm_provider" AS ENUM('anthropic', 'openai', 'openrouter');--> statement-breakpoint
CREATE TYPE "public"."post_kind" AS ENUM('trade', 'note', 'agent_created', 'milestone');--> statement-breakpoint
CREATE TYPE "public"."run_status" AS ENUM('queued', 'running', 'succeeded', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."run_trigger" AS ENUM('schedule', 'manual', 'webhook');--> statement-breakpoint
CREATE TYPE "public"."score_verdict" AS ENUM('avoid', 'watch', 'candidate', 'strong');--> statement-breakpoint
CREATE TYPE "public"."step_kind" AS ENUM('thought', 'tool_call', 'tool_result', 'message', 'error');--> statement-breakpoint
CREATE TYPE "public"."trade_origin" AS ENUM('agent', 'guardian', 'manual', 'mirror');--> statement-breakpoint
CREATE TYPE "public"."trade_side" AS ENUM('buy', 'sell');--> statement-breakpoint
CREATE TYPE "public"."trade_status" AS ENUM('proposed', 'pending', 'submitted', 'filled', 'failed', 'rejected', 'expired');--> statement-breakpoint
CREATE TYPE "public"."wallet_kind" AS ENUM('user_embedded', 'agent_server');--> statement-breakpoint
CREATE TABLE "agent_run_steps" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"seq" integer NOT NULL,
	"kind" "step_kind" NOT NULL,
	"tool_name" text,
	"payload" jsonb NOT NULL,
	"duration_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"trigger" "run_trigger" NOT NULL,
	"status" "run_status" DEFAULT 'queued' NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"summary" text,
	"error" text,
	"data_spend_usd" numeric(18, 6) DEFAULT '0' NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agents" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"tagline" text,
	"avatar_seed" text,
	"mode" "agent_mode" DEFAULT 'paper' NOT NULL,
	"status" "agent_status" DEFAULT 'draft' NOT NULL,
	"is_public" boolean DEFAULT true NOT NULL,
	"llm_key_id" text,
	"config" jsonb NOT NULL,
	"paper_starting_usd" numeric(18, 2) DEFAULT '10000' NOT NULL,
	"next_run_at" timestamp with time zone,
	"last_run_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "comments" (
	"id" text PRIMARY KEY NOT NULL,
	"post_id" text NOT NULL,
	"author_id" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "equity_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"equity_usd" numeric(18, 6) NOT NULL,
	"cash_usd" numeric(18, 6) NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "follows" (
	"follower_id" text NOT NULL,
	"target_type" "follow_target" NOT NULL,
	"target_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "follows_follower_id_target_type_target_id_pk" PRIMARY KEY("follower_id","target_type","target_id")
);
--> statement-breakpoint
CREATE TABLE "likes" (
	"user_id" text NOT NULL,
	"post_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "likes_user_id_post_id_pk" PRIMARY KEY("user_id","post_id")
);
--> statement-breakpoint
CREATE TABLE "llm_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"provider" "llm_provider" NOT NULL,
	"label" text,
	"encrypted_key" text NOT NULL,
	"last4" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"href" text,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "positions" (
	"agent_id" text NOT NULL,
	"token_id" text NOT NULL,
	"amount_token" numeric(30, 12) NOT NULL,
	"avg_cost_usd" numeric(30, 12) NOT NULL,
	"realized_pnl_usd" numeric(18, 6) DEFAULT '0' NOT NULL,
	"opened_at" timestamp with time zone,
	"peak_price_usd" numeric(30, 12),
	"entry_score" numeric(6, 2),
	"entry_liquidity_usd" numeric(20, 2),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "positions_agent_id_token_id_pk" PRIMARY KEY("agent_id","token_id")
);
--> statement-breakpoint
CREATE TABLE "posts" (
	"id" text PRIMARY KEY NOT NULL,
	"author_id" text NOT NULL,
	"agent_id" text,
	"trade_id" text,
	"kind" "post_kind" NOT NULL,
	"body" text,
	"like_count" integer DEFAULT 0 NOT NULL,
	"comment_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "token_score_history" (
	"id" text PRIMARY KEY NOT NULL,
	"token_id" text NOT NULL,
	"total" numeric(6, 2) NOT NULL,
	"verdict" "score_verdict" NOT NULL,
	"components" jsonb NOT NULL,
	"blockers" jsonb NOT NULL,
	"price_usd" numeric(30, 12),
	"liquidity_usd" numeric(20, 2),
	"holder_count" integer,
	"scored_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "token_scores" (
	"id" text PRIMARY KEY NOT NULL,
	"chain" "chain" NOT NULL,
	"address" text NOT NULL,
	"symbol" text NOT NULL,
	"total" numeric(6, 2) NOT NULL,
	"verdict" "score_verdict" NOT NULL,
	"components" jsonb NOT NULL,
	"blockers" jsonb NOT NULL,
	"warnings" jsonb NOT NULL,
	"price_usd" numeric(30, 12),
	"liquidity_usd" numeric(20, 2),
	"volume_24h_usd" numeric(20, 2),
	"market_cap_usd" numeric(24, 2),
	"holder_count" integer,
	"age_hours" numeric(14, 2),
	"price_change_24h_pct" numeric(12, 4),
	"sources" jsonb NOT NULL,
	"universe_key" text,
	"scored_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"chain" "chain" NOT NULL,
	"address" text NOT NULL,
	"symbol" text NOT NULL,
	"name" text,
	"decimals" integer NOT NULL,
	"logo_url" text,
	"last_price_usd" numeric(30, 12),
	"price_updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "trades" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"run_id" text,
	"owner_id" text NOT NULL,
	"chain" "chain" NOT NULL,
	"side" "trade_side" NOT NULL,
	"token_id" text NOT NULL,
	"quote_token_id" text NOT NULL,
	"amount_token" numeric(30, 12) NOT NULL,
	"amount_usd" numeric(18, 6) NOT NULL,
	"price_usd" numeric(30, 12) NOT NULL,
	"fee_usd" numeric(18, 6) DEFAULT '0' NOT NULL,
	"status" "trade_status" DEFAULT 'pending' NOT NULL,
	"is_paper" boolean NOT NULL,
	"tx_hash" text,
	"rationale" text,
	"score_snapshot" jsonb,
	"origin" "trade_origin" DEFAULT 'agent' NOT NULL,
	"exit_reason" text,
	"requested_usd" numeric(18, 6),
	"proposed_at" timestamp with time zone,
	"decided_at" timestamp with time zone,
	"decided_by" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"filled_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"handle" text NOT NULL,
	"display_name" text,
	"bio" text,
	"avatar_url" text,
	"email" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wallets" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" "wallet_kind" NOT NULL,
	"chain" "chain" NOT NULL,
	"address" text NOT NULL,
	"user_id" text NOT NULL,
	"agent_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "x402_payments" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"run_id" text,
	"source_id" text NOT NULL,
	"url" text NOT NULL,
	"network" text NOT NULL,
	"amount_usd" numeric(18, 6) NOT NULL,
	"tx_hash" text,
	"settled" boolean DEFAULT false NOT NULL,
	"simulated" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_run_steps" ADD CONSTRAINT "agent_run_steps_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_llm_key_id_llm_keys_id_fk" FOREIGN KEY ("llm_key_id") REFERENCES "public"."llm_keys"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equity_snapshots" ADD CONSTRAINT "equity_snapshots_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follows" ADD CONSTRAINT "follows_follower_id_users_id_fk" FOREIGN KEY ("follower_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "likes" ADD CONSTRAINT "likes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "likes" ADD CONSTRAINT "likes_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_keys" ADD CONSTRAINT "llm_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_token_id_tokens_id_fk" FOREIGN KEY ("token_id") REFERENCES "public"."tokens"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_trade_id_trades_id_fk" FOREIGN KEY ("trade_id") REFERENCES "public"."trades"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_token_id_tokens_id_fk" FOREIGN KEY ("token_id") REFERENCES "public"."tokens"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_quote_token_id_tokens_id_fk" FOREIGN KEY ("quote_token_id") REFERENCES "public"."tokens"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "x402_payments" ADD CONSTRAINT "x402_payments_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "x402_payments" ADD CONSTRAINT "x402_payments_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_run_steps_run_idx" ON "agent_run_steps" USING btree ("run_id","seq");--> statement-breakpoint
CREATE INDEX "agent_runs_agent_idx" ON "agent_runs" USING btree ("agent_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "agents_slug_idx" ON "agents" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "agents_next_run_idx" ON "agents" USING btree ("next_run_at");--> statement-breakpoint
CREATE INDEX "agents_public_idx" ON "agents" USING btree ("is_public","status");--> statement-breakpoint
CREATE INDEX "comments_post_idx" ON "comments" USING btree ("post_id","created_at");--> statement-breakpoint
CREATE INDEX "equity_snapshots_agent_idx" ON "equity_snapshots" USING btree ("agent_id","at");--> statement-breakpoint
CREATE INDEX "follows_target_idx" ON "follows" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "llm_keys_user_idx" ON "llm_keys" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "posts_created_idx" ON "posts" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "posts_agent_idx" ON "posts" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "token_score_history_token_idx" ON "token_score_history" USING btree ("token_id","scored_at");--> statement-breakpoint
CREATE INDEX "token_scores_verdict_idx" ON "token_scores" USING btree ("verdict","total");--> statement-breakpoint
CREATE INDEX "token_scores_scored_idx" ON "token_scores" USING btree ("scored_at");--> statement-breakpoint
CREATE UNIQUE INDEX "tokens_chain_addr_idx" ON "tokens" USING btree ("chain","address");--> statement-breakpoint
CREATE INDEX "trades_agent_idx" ON "trades" USING btree ("agent_id","created_at");--> statement-breakpoint
CREATE INDEX "trades_created_idx" ON "trades" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_handle_idx" ON "users" USING btree ("handle");--> statement-breakpoint
CREATE INDEX "wallets_user_idx" ON "wallets" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "wallets_agent_idx" ON "wallets" USING btree ("agent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "wallets_addr_idx" ON "wallets" USING btree ("chain","address");--> statement-breakpoint
CREATE INDEX "x402_payments_agent_idx" ON "x402_payments" USING btree ("agent_id","created_at");