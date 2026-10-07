/**
 * `llm_keys.provider` stopped being a Postgres enum in migration 0011 and became text,
 * so that the provider registry (`src/lib/agent/providers.ts`) is the only list.
 *
 * Two things have to hold and are checked here against a real Postgres (PGlite, in
 * memory): the migration is exactly the two statements it should be and leaves every
 * saved key under the provider it had, and a database built the way the tests build one
 * (a schema push, no migrations) has the same text column.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { llmKeys } from "@/db/schema";
import { CATALOGUE_IDS, isProvider, type LlmProvider } from "@/lib/agent/providers";
import { attachLlmKey, seedAgent, setupTestDb } from "@/lib/agent/test-support";

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

const entry = journal.find((item) => item.idx === 11);

describe("migration 0011", () => {
  it("is in the journal, after 0010", () => {
    expect(entry?.tag).toMatch(/^0011_/);
    const before = journal.find((item) => item.idx === 10);
    // The migrator runs what is newer than the last one applied, by this timestamp.
    expect(entry?.when ?? 0).toBeGreaterThan(before?.when ?? Number.MAX_SAFE_INTEGER);
  });

  /** A table rewrite and a dropped type, and nothing that touches another table or a row. */
  it("is exactly a change of column type and the drop of the enum", () => {
    expect(statements(entry?.tag ?? "")).toEqual([
      'ALTER TABLE "llm_keys" ALTER COLUMN "provider" SET DATA TYPE text;',
      'DROP TYPE "public"."llm_provider";',
    ]);
  });

  it("leaves every saved key under the provider it had, and then takes any provider id", async () => {
    const { PGlite } = await import("@electric-sql/pglite");
    const db = new PGlite();
    const run = async (tag: string) => {
      for (const statement of statements(tag)) await db.exec(statement);
    };
    const addKey = (id: string, provider: string) =>
      // The provider as an untyped parameter, which is how the app's driver sends it.
      db.query("insert into llm_keys (id, user_id, provider, encrypted_key, last4) values ($1, $2, $3, $4, $5)", [
        id,
        "did:privy:owner",
        provider,
        "not-a-real-ciphertext",
        "0000",
      ]);

    for (const item of journal.filter((migration) => migration.idx < 11)) await run(item.tag);
    await db.query("insert into users (id, handle) values ($1, $2)", ["did:privy:owner", "owner"]);
    await addKey("key_a", "anthropic");
    await addKey("key_b", "openai");
    await addKey("key_c", "openrouter");
    // Before the migration the enum is the list, and it does not know a new provider.
    await expect(addKey("key_d", "groq")).rejects.toThrow();

    await run(entry?.tag ?? "");

    const rows = await db.query<{ id: string; provider: string; type: string }>(
      "select id, provider, pg_typeof(provider)::text as type from llm_keys order by id",
    );
    expect(rows.rows).toEqual([
      { id: "key_a", provider: "anthropic", type: "text" },
      { id: "key_b", provider: "openai", type: "text" },
      { id: "key_c", provider: "openrouter", type: "text" },
    ]);
    const enums = await db.query<{ n: number }>("select count(*)::int as n from pg_type where typname = 'llm_provider'");
    expect(enums.rows[0]?.n).toBe(0);

    // What the deployment still running during the migration sends keeps working.
    await addKey("key_e", "openai");
    // And a provider is now added in code alone.
    await addKey("key_d", "groq");
    const after = await db.query<{ provider: string }>("select provider from llm_keys where id in ('key_d', 'key_e') order by id");
    expect(after.rows.map((row) => row.provider)).toEqual(["groq", "openai"]);
    await db.close();
  });
});

describe("a database built by pushing the schema", () => {
  it("has a text provider column and no provider enum, and the test helpers still seed a key", async () => {
    const db = await setupTestDb();
    const agent = await seedAgent(db);
    const keyId = await attachLlmKey(db, agent);

    const stored = await db.select({ provider: llmKeys.provider }).from(llmKeys).where(eq(llmKeys.id, keyId));
    expect(stored).toEqual([{ provider: "anthropic" }]);

    // The driver-neutral `Db` type does not say what a raw query returns; PGlite's has `rows`.
    const column = (await db.execute(
      sql`select data_type from information_schema.columns where table_name = 'llm_keys' and column_name = 'provider'`,
    )) as unknown as { rows: Array<{ data_type: string }> };
    expect(column.rows[0]?.data_type).toBe("text");
    const enums = (await db.execute(sql`select count(*)::int as n from pg_type where typname = 'llm_provider'`)) as unknown as {
      rows: Array<{ n: number }>;
    };
    expect(enums.rows[0]?.n).toBe(0);
  });

  /**
   * Nothing in the database checks the value any more. Every registry id is storable,
   * which is the point, and so is a value the registry has never heard of, which is why
   * a reader asks `isProvider` before it uses a row.
   */
  it("stores any registry id, and does not itself refuse one that is not in the registry", async () => {
    const db = await setupTestDb();
    const agent = await seedAgent(db);
    const values = [...CATALOGUE_IDS, "retired-provider"].map((provider, index) => ({
      id: `key_${index}`,
      userId: agent.userId,
      provider: provider as LlmProvider,
      encryptedKey: "not-a-real-ciphertext",
      last4: "0000",
    }));
    await db.insert(llmKeys).values(values);

    const stored = await db.select({ provider: llmKeys.provider }).from(llmKeys).where(eq(llmKeys.userId, agent.userId));
    expect(stored.map((row) => row.provider).sort()).toEqual([...CATALOGUE_IDS, "retired-provider"].sort());
    expect(isProvider("retired-provider")).toBe(false);
    expect(stored.filter((row) => !isProvider(row.provider)).length).toBeGreaterThan(0);
  });
});
