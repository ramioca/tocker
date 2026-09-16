CREATE TYPE "public"."audit_kind" AS ENUM('withdraw', 'budget_change', 'go_live', 'go_paper', 'agent_paused', 'agent_resumed', 'llm_key_added', 'llm_key_rotated', 'llm_key_removed', 'kill_switch_on', 'kill_switch_off', 'mfa_enrolled', 'mfa_unenrolled', 'first_trade_preset', 'manual_run');--> statement-breakpoint
CREATE TYPE "public"."funding_intent_status" AS ENUM('pending', 'sent', 'failed', 'cancelled');--> statement-breakpoint
CREATE TABLE "agent_funding_intents" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"user_id" text NOT NULL,
	"chain" "chain" NOT NULL,
	"asset" text NOT NULL,
	"amount" numeric(38, 18) NOT NULL,
	"amount_usd" numeric(18, 6),
	"status" "funding_intent_status" DEFAULT 'pending' NOT NULL,
	"to_address" text NOT NULL,
	"tx_hash" text,
	"error" text,
	"on_create" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"settled_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"kind" "audit_kind" NOT NULL,
	"agent_id" text,
	"agent_name" text,
	"summary" text NOT NULL,
	"metadata" jsonb,
	"ip" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trade_receipts" (
	"trade_id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"venue" text NOT NULL,
	"simulated" boolean NOT NULL,
	"tx_hash" text,
	"slippage_bps" numeric(12, 2) NOT NULL,
	"total_fee_usd" numeric(18, 6) NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_security" (
	"user_id" text PRIMARY KEY NOT NULL,
	"trading_paused" boolean DEFAULT false NOT NULL,
	"trading_paused_at" timestamp with time zone,
	"mfa_methods" jsonb,
	"mfa_checked_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_funding_intents" ADD CONSTRAINT "agent_funding_intents_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_funding_intents" ADD CONSTRAINT "agent_funding_intents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_receipts" ADD CONSTRAINT "trade_receipts_trade_id_trades_id_fk" FOREIGN KEY ("trade_id") REFERENCES "public"."trades"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_receipts" ADD CONSTRAINT "trade_receipts_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_security" ADD CONSTRAINT "user_security_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_funding_intents_agent_idx" ON "agent_funding_intents" USING btree ("agent_id","created_at");--> statement-breakpoint
CREATE INDEX "agent_funding_intents_user_idx" ON "agent_funding_intents" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_events_user_idx" ON "audit_events" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_events_agent_idx" ON "audit_events" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "trade_receipts_agent_idx" ON "trade_receipts" USING btree ("agent_id","created_at");