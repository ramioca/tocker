CREATE TYPE "public"."platform_fee_status" AS ENUM('accrued', 'settled');--> statement-breakpoint
CREATE TABLE "platform_fees" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"trade_id" text NOT NULL,
	"chain" "chain" NOT NULL,
	"amount_usd" numeric(18, 6) NOT NULL,
	"status" "platform_fee_status" DEFAULT 'accrued' NOT NULL,
	"tx_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"settled_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "platform_wallets" (
	"id" text PRIMARY KEY NOT NULL,
	"chain" "chain" NOT NULL,
	"address" text NOT NULL,
	"label" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "platform_fees" ADD CONSTRAINT "platform_fees_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_fees" ADD CONSTRAINT "platform_fees_trade_id_trades_id_fk" FOREIGN KEY ("trade_id") REFERENCES "public"."trades"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "platform_fees_trade_idx" ON "platform_fees" USING btree ("trade_id");--> statement-breakpoint
CREATE INDEX "platform_fees_agent_idx" ON "platform_fees" USING btree ("agent_id","status");--> statement-breakpoint
CREATE INDEX "platform_fees_created_idx" ON "platform_fees" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "platform_wallets_chain_idx" ON "platform_wallets" USING btree ("chain");