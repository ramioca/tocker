CREATE TABLE "public_token_scores" (
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
	"scored_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "token_score_history" ADD COLUMN "universe_key" text;