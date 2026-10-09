CREATE TABLE "retired_handles" (
	"handle" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"retired_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "avatar_seed" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "onboarded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "retired_handles" ADD CONSTRAINT "retired_handles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Written by hand. An account whose username was assigned at sign-up is asked to choose
-- one, once; an account that already chose is marked as having done so, at the time it
-- was created. Assigned means: `user` and six characters, or `trader`; and the two shapes
-- sign-up used before 2026-10-06, part of a wallet address (ten letters or digits, on an
-- account with no email) and the front of the email address. Each may end in the digits
-- that made it unique.
UPDATE "users" u SET "onboarded_at" = u."created_at"
WHERE u."handle" !~ '^(user[a-z0-9]{6}|trader)[0-9]*$'
  AND NOT (u."email" IS NULL AND u."handle" ~ '^[a-z0-9]{10}[0-9]{0,2}$')
  AND NOT EXISTS (
    SELECT 1 FROM (SELECT regexp_replace(lower(split_part(u."email", '@', 1)), '[^a-z0-9_]+', '', 'g') AS l) e
    WHERE length(e.l) >= 2 AND (u."handle" = left(e.l, 20) OR u."handle" ~ ('^' || left(e.l, 17) || '[0-9]{1,2}$')));
