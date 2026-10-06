CREATE TABLE "inference_budget_days" (
	"scope" text NOT NULL,
	"scope_id" text NOT NULL,
	"day" text NOT NULL,
	"usd" numeric(18, 6) DEFAULT '0' NOT NULL,
	"requests" integer DEFAULT 0 NOT NULL,
	"manual_runs" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inference_budget_days_scope_scope_id_day_pk" PRIMARY KEY("scope","scope_id","day")
);
--> statement-breakpoint
CREATE TABLE "inference_control" (
	"id" text PRIMARY KEY NOT NULL,
	"halted" boolean DEFAULT false NOT NULL,
	"halt_reason" text,
	"paused_until" timestamp with time zone,
	"pause_reason" text,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inference_payments" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"agent_id" text,
	"run_id" text,
	"seq" integer NOT NULL,
	"request_hash" text NOT NULL,
	"chain" text NOT NULL,
	"network" text NOT NULL,
	"host" text NOT NULL,
	"model" text NOT NULL,
	"served_model" text,
	"payer_wallet_id" text NOT NULL,
	"payer_address" text NOT NULL,
	"pay_to" text NOT NULL,
	"asset" text NOT NULL,
	"quoted_usd" numeric(18, 6) NOT NULL,
	"settled_usd" numeric(18, 6),
	"status" text NOT NULL,
	"answered" boolean,
	"http_status" integer,
	"memo" text,
	"blockhash" text,
	"payer_signature" text,
	"tx_hash" text,
	"gateway_request_id" text,
	"input_tokens" integer,
	"output_tokens" integer,
	"budget_day" text NOT NULL,
	"detail" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"signed_at" timestamp with time zone,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "llm_source" text;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "model" text;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "inference_spend_usd" numeric(18, 6) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "stop_reason" text;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "inference_hold" text;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "inference_hold_since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "inference_hold_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "inference_strikes" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "inference_notified_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "inference_payments_run_seq_idx" ON "inference_payments" USING btree ("run_id","seq");--> statement-breakpoint
CREATE INDEX "inference_payments_owner_idx" ON "inference_payments" USING btree ("owner_id","created_at");--> statement-breakpoint
CREATE INDEX "inference_payments_agent_idx" ON "inference_payments" USING btree ("agent_id","created_at");--> statement-breakpoint
CREATE INDEX "inference_payments_status_idx" ON "inference_payments" USING btree ("status","created_at");