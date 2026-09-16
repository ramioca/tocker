CREATE TABLE "waitlist_signups" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"volume" text NOT NULL,
	"chains" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"style" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
