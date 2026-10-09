/**
 * Migration 0012 adds what the first-run screen needs: `users.avatar_seed`,
 * `users.onboarded_at` and the `retired_handles` table. Its last statement, written by
 * hand, decides which existing accounts are asked to choose a username: the ones whose
 * handle sign-up assigned. An account that already chose one is marked as onboarded at
 * the time it was created.
 *
 * Checked against a real Postgres (PGlite, in memory): the statements are the ones they
 * should be and only the last touches a row; the backfill gets every handle shape
 * sign-up has ever produced right; and a database built the way the tests build one
 * (a schema push, no migrations) has the same columns and table.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { setupTestDb } from "@/lib/agent/test-support";

const DRIZZLE = path.join(process.cwd(), "drizzle");

interface JournalEntry {
  idx: number;
  tag: string;
  when: number;
}

const journal = (JSON.parse(readFileSync(path.join(DRIZZLE, "meta", "_journal.json"), "utf8")) as { entries: JournalEntry[] }).entries;

/** One migration's statements, split where drizzle's own migrator splits them. */
function statements(tag: string): string[] {
  return readFileSync(path.join(DRIZZLE, `${tag}.sql`), "utf8")
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

/** A statement without its `--` comment lines, on one line. */
function bare(statement: string): string {
  return statement
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

const entry = journal.find((item) => item.idx === 12);

/**
 * One account per handle shape. `asked` is whether the first-run screen should open for
 * it, which is `onboarded_at` staying null.
 */
const FIXTURES: Array<{ id: string; handle: string; email: string | null; asked: boolean; why: string }> = [
  { id: "chosen", handle: "momentum_mila", email: "mila.k@example.com", asked: false, why: "a name typed in Settings" },
  { id: "x-name", handle: "dex_trades", email: null, asked: false, why: "an X username, which has an underscore no wallet has" },
  { id: "x-with-email", handle: "novacapital", email: "someone@example.com", asked: false, why: "an X username on an account with an email" },
  { id: "chosen-short", handle: "you", email: "builder@example.com", asked: false, why: "a short chosen name" },
  { id: "assigned", handle: "user5a5ppx", email: "jane@example.com", asked: true, why: "`user` and six characters" },
  { id: "assigned-suffix", handle: "user5a5ppx3", email: null, asked: true, why: "the same, made unique" },
  { id: "trader", handle: "trader", email: "support@example.com", asked: true, why: "the stand-in for a reserved name" },
  { id: "trader-suffix", handle: "trader12", email: null, asked: true, why: "the stand-in, made unique" },
  { id: "email-local", handle: "janedoe1987", email: "Jane.Doe1987@example.com", asked: true, why: "the front of the email address" },
  { id: "email-suffix", handle: "janedoe19874", email: "jane.doe1987@example.org", asked: true, why: "the front of the email, made unique" },
  {
    id: "email-cut",
    handle: "averyveryverylong12",
    email: "a.very.very.very.long.address@example.com",
    asked: true,
    why: "the front of the email cut to 17 for its suffix",
  },
  {
    id: "email-long",
    handle: "averyveryverylongadd",
    email: "a.very.very.very.long.address@example.com",
    asked: true,
    why: "the front of the email cut to 20",
  },
  { id: "wallet", handle: "8f3c2a4b5c", email: null, asked: true, why: "six and four characters of a wallet address" },
  { id: "wallet-suffix", handle: "dezxazb26312", email: null, asked: true, why: "a wallet-derived name, made unique" },
  // The accepted cost: nothing tells this X username from a wallet's ten characters. It is asked once.
  { id: "x-like-wallet", handle: "novacap123", email: null, asked: true, why: "an X username of ten letters and digits on an account with no email" },
  // The rule's edges: what must not be mistaken for an assigned name.
  { id: "traderjoe", handle: "traderjoe", email: null, asked: false, why: "starts with the stand-in but is a name" },
  { id: "username", handle: "username_fan", email: null, asked: false, why: "starts with `user` but is a name" },
  { id: "ten-with-email", handle: "abcdefghij", email: "other@example.com", asked: false, why: "ten letters on an account with an email is not a wallet's" },
  { id: "one-letter-email", handle: "j7", email: "j@example.com", asked: false, why: "a one-letter local part was never used as a handle" },
  { id: "email-three-digits", handle: "janedoe1987123", email: "jane.doe1987@example.net", asked: false, why: "sign-up never added three digits" },
];

describe("migration 0012", () => {
  it("is in the journal, after 0011", () => {
    expect(entry?.tag).toMatch(/^0012_/);
    const before = journal.find((item) => item.idx === 11);
    // The migrator runs what is newer than the last one applied, by this timestamp.
    expect(entry?.when ?? 0).toBeGreaterThan(before?.when ?? Number.MAX_SAFE_INTEGER);
    // One migration for this change, and none after it.
    expect(journal.filter((item) => item.idx >= 12)).toHaveLength(1);
  });

  it("adds a table and two nullable columns, then backfills, and touches no row before that", () => {
    const all = statements(entry?.tag ?? "").map(bare);
    expect(all.slice(0, -1)).toEqual([
      'CREATE TABLE "retired_handles" ( "handle" text PRIMARY KEY NOT NULL, "user_id" text NOT NULL, "retired_at" timestamp with time zone DEFAULT now() NOT NULL );',
      'ALTER TABLE "users" ADD COLUMN "avatar_seed" text;',
      'ALTER TABLE "users" ADD COLUMN "onboarded_at" timestamp with time zone;',
      'ALTER TABLE "retired_handles" ADD CONSTRAINT "retired_handles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;',
    ]);
    const last = all[all.length - 1] ?? "";
    expect(last).toMatch(/^UPDATE "users" u SET "onboarded_at" = u\."created_at" WHERE /);
    // Additive: every statement creates, adds or backfills, and only the last writes a row.
    expect(all.map((statement) => statement.split(" ")[0])).toEqual(["CREATE", "ALTER", "ALTER", "ALTER", "UPDATE"]);
    for (const statement of all) expect(statement).not.toMatch(/\b(DROP|RENAME|TRUNCATE)\b|\bDELETE FROM\b/i);
  });

  it("marks the accounts that chose a username and leaves the assigned ones to be asked", async () => {
    const { PGlite } = await import("@electric-sql/pglite");
    const db = new PGlite();
    const run = async (tag: string) => {
      for (const statement of statements(tag)) await db.exec(statement);
    };

    for (const item of journal.filter((migration) => migration.idx < 12)) await run(item.tag);
    for (const [index, fixture] of FIXTURES.entries()) {
      await db.query("insert into users (id, handle, email, created_at) values ($1, $2, $3, $4)", [
        `did:privy:${fixture.id}`,
        fixture.handle,
        fixture.email,
        // Distinct, and in the past: `onboarded_at` must be this, not the migration's clock.
        new Date(Date.UTC(2026, 8, 1 + index, 9)).toISOString(),
      ]);
    }

    await run(entry?.tag ?? "");

    const rows = await db.query<{ id: string; onboarded: boolean; same: boolean; avatar_seed: string | null }>(
      "select id, onboarded_at is not null as onboarded, onboarded_at = created_at as same, avatar_seed from users",
    );
    const byId = new Map(rows.rows.map((row) => [row.id, row]));
    for (const fixture of FIXTURES) {
      const row = byId.get(`did:privy:${fixture.id}`);
      expect(row?.onboarded, `@${fixture.handle}: ${fixture.why}`).toBe(!fixture.asked);
      if (!fixture.asked) expect(row?.same, `@${fixture.handle}`).toBe(true);
      // Nobody is given an avatar: the photo, or the face made from the handle, stays.
      expect(row?.avatar_seed, `@${fixture.handle}`).toBeNull();
    }

    // Nothing is held until somebody renames.
    const held = await db.query<{ n: number }>("select count(*)::int as n from retired_handles");
    expect(held.rows[0]?.n).toBe(0);

    // The deployment still running during the migration inserts without the new columns.
    await db.query("insert into users (id, handle) values ($1, $2)", ["did:privy:during", "userab12cd"]);
    const during = await db.query<{ onboarded_at: string | null }>("select onboarded_at from users where id = 'did:privy:during'");
    expect(during.rows[0]?.onboarded_at).toBeNull();

    // A held name goes with its account.
    await db.query("insert into retired_handles (handle, user_id) values ($1, $2)", ["old_name", "did:privy:chosen"]);
    await db.query("delete from users where id = 'did:privy:chosen'");
    const after = await db.query<{ n: number }>("select count(*)::int as n from retired_handles");
    expect(after.rows[0]?.n).toBe(0);
    await db.close();
  }, 120_000);
});

describe("a database built by pushing the schema", () => {
  it("has both columns, nullable, and the table of held names", async () => {
    const db = await setupTestDb();
    // The driver-neutral `Db` type does not say what a raw query returns; PGlite's has `rows`.
    const columns = (await db.execute(
      sql`select column_name, data_type, is_nullable from information_schema.columns
          where table_name = 'users' and column_name in ('avatar_seed', 'onboarded_at') order by column_name`,
    )) as unknown as { rows: Array<{ column_name: string; data_type: string; is_nullable: string }> };
    expect(columns.rows).toEqual([
      { column_name: "avatar_seed", data_type: "text", is_nullable: "YES" },
      { column_name: "onboarded_at", data_type: "timestamp with time zone", is_nullable: "YES" },
    ]);

    const held = (await db.execute(
      sql`select column_name, is_nullable from information_schema.columns where table_name = 'retired_handles' order by column_name`,
    )) as unknown as { rows: Array<{ column_name: string; is_nullable: string }> };
    expect(held.rows).toEqual([
      { column_name: "handle", is_nullable: "NO" },
      { column_name: "retired_at", is_nullable: "NO" },
      { column_name: "user_id", is_nullable: "NO" },
    ]);
  });
});
