/**
 * The ledger's caps under real concurrency.
 *
 * PGlite is one connection, so the twenty reserves in `inference-ledger.test.ts` run one
 * after another there: that proves the arithmetic, not the row locking. This file runs
 * the same scenarios through postgres-js with ten connections against a real Postgres,
 * where the conditional UPDATEs genuinely race.
 *
 * It is skipped unless `INFERENCE_CONCURRENCY_DATABASE_URL` names a Postgres to use:
 *
 *   INFERENCE_CONCURRENCY_DATABASE_URL=<postgres url> pnpm vitest run src/lib/x402/inference-ledger.concurrency.test.ts
 *
 * WHICH DATABASE. A throwaway one (the docker compose database is fine), reached by a
 * DIRECT connection. Not the production database, and never a pooled URL (Neon's
 * `-pooler` host, PgBouncer): this file empties the ledger's tables between scenarios,
 * and the only thing that points those statements at its own tables instead of the real
 * ledger is the connection's `search_path`, which a pooler may drop.
 *
 * What it does to stay out of everything else: it creates a schema with a random name,
 * builds the three ledger tables in it from the migration's own SQL, and drops the
 * schema when it is done. It does not take the `search_path` on trust:
 *
 *  - before anything is written, every one of the ten connections is asked, at the same
 *    moment, which schema the ledger's table names resolve to. If any answers anything
 *    but the private schema, the run stops there with nothing deleted and nothing written;
 *  - every emptying of the tables is one transaction that asks the same question first,
 *    on the connection the deletes are about to run on, and deletes nothing unless the
 *    answer is the private schema (`emptyLedger`, proven below on PGlite in both directions).
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@/db";
import * as schema from "@/db/schema";
import { inferenceBudgetDays, inferenceControl, inferencePayments } from "@/db/schema";
import { createInferenceLedger, resolveInferencePayment } from "./inference-ledger";
import { INFERENCE_GATEWAY, type InferenceCaps, type InferenceReserveInput } from "./inference-types";

const url = process.env.INFERENCE_CONCURRENCY_DATABASE_URL?.trim();

const NOON = new Date("2031-03-10T12:00:00.000Z");
const DAY = "2031-03-10";
const CAPS: InferenceCaps = {
  stepUsd: 0.25,
  runUsd: 5,
  agentDayUsd: 50,
  ownerDayUsd: 50,
  platformDayUsd: 100,
  agentDayRequests: 600,
  maxRequestsPerRun: 400,
};
/** How many times each race is run. A race that is lost one time in fifty still shows. */
const ROUNDS = 25;

interface DbGlobal {
  __tockerDb?: Db;
  __tockerDbPromise?: Promise<Db>;
}

/** What a query for one row hands back, from either driver: postgres-js gives the rows, PGlite an object holding them. */
function firstRow(result: unknown): Record<string, unknown> | undefined {
  const rows = Array.isArray(result) ? result : (result as { rows?: unknown } | null)?.rows;
  return Array.isArray(rows) ? (rows[0] as Record<string, unknown> | undefined) : undefined;
}

/**
 * Where the ledger's table names lead on the connection this runs on: the schema at the
 * head of its search path, and the schema the name `inference_payments` actually
 * resolves to. Both are asked because both must be the private one.
 */
const WHERE_TABLES_RESOLVE =
  "select current_schema() as head, (select n.nspname from pg_class c join pg_namespace n on n.oid = c.relnamespace where c.oid = to_regclass('inference_payments')) as home";

type Resolved = { head: unknown; home: unknown } | undefined;

function isPrivate(found: Resolved, privateSchema: string): boolean {
  return found !== undefined && found.head === privateSchema && found.home === privateSchema;
}

/** The sentence a refusal carries. No row has been deleted when it is thrown. */
function wrongSchema(expected: string, found: Resolved): Error {
  return new Error(
    `Refusing to touch the ledger tables: on this connection they resolve to schema "${String(found?.home ?? "none")}" (search path head "${String(found?.head ?? "none")}"), ` +
      `not to this test's own schema "${expected}". The connection did not keep its search_path, which is what a pooled URL does. ` +
      "Nothing was deleted. Use a direct (unpooled) connection to a throwaway database.",
  );
}

/**
 * Empty the ledger's tables, and only this file's own. The question and the deletes are
 * ONE transaction, so they run on one connection even behind a pooler that hands every
 * transaction a different one: an answer of "the private schema" is an answer about the
 * very statements that follow it. Anything else throws before a single row is deleted.
 */
async function emptyLedger(db: Db, privateSchema: string, options: { control?: boolean } = {}): Promise<void> {
  await db.transaction(async (tx) => {
    const found = firstRow(await tx.execute(sql.raw(WHERE_TABLES_RESOLVE))) as Resolved;
    if (!isPrivate(found, privateSchema)) throw wrongSchema(privateSchema, found);
    await tx.delete(inferencePayments);
    await tx.delete(inferenceBudgetDays);
    if (options.control) await tx.delete(inferenceControl);
  });
}

/** The ledger tables' own DDL, taken from the migration so this test cannot drift from it. */
function ledgerDdl(): string[] {
  const dir = path.join(process.cwd(), "drizzle");
  const file = readdirSync(dir)
    .filter((name) => name.endsWith(".sql"))
    .map((name) => readFileSync(path.join(dir, name), "utf8"))
    .find((text) => text.includes('CREATE TABLE "inference_payments"'));
  if (!file) throw new Error("no migration creates inference_payments");
  return file
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter((statement) => /^CREATE (TABLE|UNIQUE INDEX|INDEX)/.test(statement) && /"inference_(payments|budget_days|control)"/.test(statement));
}

describe("the tables this file builds from the migration", () => {
  // Always runs, on PGlite: the real-Postgres block below builds its tables with the
  // migration's own statements rather than by pushing the drizzle schema, so this proves
  // those statements make tables the ledger's queries actually work against. It is also
  // the one test that runs the ledger on the migration as written, not on the schema file.
  it("are enough for a reserve, a release and a verdict", async () => {
    const { PGlite } = await import("@electric-sql/pglite");
    const { drizzle } = await import("drizzle-orm/pglite");
    const statements = ledgerDdl();
    expect(statements.filter((statement) => statement.startsWith("CREATE TABLE"))).toHaveLength(3);
    expect(statements.some((statement) => statement.includes("inference_payments_run_seq_idx") && statement.startsWith("CREATE UNIQUE INDEX"))).toBe(true);

    const client = new PGlite();
    await client.exec('create schema "ledger_only"; set search_path to "ledger_only";');
    for (const statement of statements) await client.exec(statement);
    const g = globalThis as unknown as DbGlobal;
    const previous = { __tockerDb: g.__tockerDb, __tockerDbPromise: g.__tockerDbPromise };
    const db = drizzle(client, { schema }) as unknown as Db;
    g.__tockerDb = db;
    g.__tockerDbPromise = Promise.resolve(db);
    try {
      const ledger = createInferenceLedger();
      const input: InferenceReserveInput = {
        ownerId: "owner-1",
        agentId: "agent-1",
        runId: "run-ddl",
        seq: 0,
        requestHash: "ab".repeat(32),
        chain: "solana",
        network: INFERENCE_GATEWAY.solana.network,
        host: INFERENCE_GATEWAY.solana.host,
        model: "google/gemini-2.5-flash",
        payerWalletId: "wallet-1",
        payerAddress: "PayerAddress1111111111111111111111111111111",
        payTo: INFERENCE_GATEWAY.solana.payTo[0],
        asset: INFERENCE_GATEWAY.solana.asset,
        quotedUsd: 0.01,
        caps: { ...CAPS, agentDayUsd: 0.02 },
        runSpentUsd: 0,
        now: NOON,
      };
      const first = await ledger.reserve(input);
      const second = await ledger.reserve({ ...input, seq: 1 });
      expect(first.ok && second.ok).toBe(true);
      expect(await ledger.reserve({ ...input, seq: 2 })).toEqual({ ok: false, reason: "agent_day_cap" });
      expect(await ledger.reserve({ ...input, seq: 1, caps: CAPS })).toEqual({ ok: false, reason: "step_limit" });
      if (!first.ok || !second.ok) return;

      await ledger.release(first.paymentId, "gave up");
      await ledger.markSigned(second.paymentId, { memo: "0f".repeat(16), blockhash: "Blockhash", payerSignature: "Sig" });
      expect(await resolveInferencePayment(second.paymentId, { charged: false, detail: "never landed" }, NOON)).toBe(true);
      const counters = await db.select().from(inferenceBudgetDays);
      expect(counters).toHaveLength(3);
      expect(counters.every((row) => Number(row.usd) === 0 && row.requests === 0)).toBe(true);
    } finally {
      g.__tockerDb = previous.__tockerDb;
      g.__tockerDbPromise = previous.__tockerDbPromise;
      await client.close();
    }
  });
});

describe("emptying the ledger between scenarios", () => {
  // Always runs, on PGlite. The real-Postgres block below deletes every row of the three
  // ledger tables many times over; this proves it cannot do that to any tables but its own.
  async function twoLedgers() {
    const { PGlite } = await import("@electric-sql/pglite");
    const { drizzle } = await import("drizzle-orm/pglite");
    const client = new PGlite();
    // The "real" ledger in `public`, and the test's own in a private schema, each holding rows.
    for (const name of ["public", "private_test"]) {
      await client.exec(`create schema if not exists "${name}"; set search_path to "${name}";`);
      for (const statement of ledgerDdl()) await client.exec(statement);
      await client.exec(`insert into inference_control (id, halted, halt_reason) values ('global', true, 'the ${name} halt')`);
      await client.exec(`insert into inference_budget_days (scope, scope_id, day, usd, requests) values ('platform', 'all', '2031-03-10', 1.5, 3)`);
    }
    const rows = async (schemaName: string) => {
      const control = await client.query<{ halt_reason: string }>(`select halt_reason from "${schemaName}".inference_control`);
      const days = await client.query(`select 1 from "${schemaName}".inference_budget_days`);
      return { control: control.rows.map((row) => row.halt_reason), days: days.rows.length };
    };
    return { client, db: drizzle(client, { schema }) as unknown as Db, rows };
  }

  it("refuses, and deletes nothing, when the connection's table names lead anywhere but the private schema", async () => {
    const { client, db, rows } = await twoLedgers();
    try {
      // A connection that lost its search_path: unqualified names mean the real ledger.
      await client.exec('set search_path to "public"');
      await expect(emptyLedger(db, "private_test", { control: true })).rejects.toThrow(/Refusing to touch the ledger tables.*"public".*Nothing was deleted/);
      // The private schema second on the path is no better: the real tables are still found first.
      await client.exec('set search_path to "public", "private_test"');
      await expect(emptyLedger(db, "private_test", { control: true })).rejects.toThrow(/Refusing to touch the ledger tables/);
      // A path that leads to no ledger tables at all.
      await client.exec('create schema "empty_one"; set search_path to "empty_one"');
      await expect(emptyLedger(db, "private_test", { control: true })).rejects.toThrow(/resolve to schema "none"/);

      expect(await rows("public")).toEqual({ control: ["the public halt"], days: 1 });
      expect(await rows("private_test")).toEqual({ control: ["the private_test halt"], days: 1 });
    } finally {
      await client.close();
    }
  });

  it("empties its own tables, and only those, when the connection does lead to the private schema", async () => {
    const { client, db, rows } = await twoLedgers();
    try {
      await client.exec('set search_path to "private_test", "public"');
      // Between rounds the switches are kept; before each scenario they are cleared too.
      await emptyLedger(db, "private_test");
      expect(await rows("private_test")).toEqual({ control: ["the private_test halt"], days: 0 });
      await emptyLedger(db, "private_test", { control: true });
      expect(await rows("private_test")).toEqual({ control: [], days: 0 });
      expect(await rows("public")).toEqual({ control: ["the public halt"], days: 1 });
    } finally {
      await client.close();
    }
  });
});

describe.skipIf(!url)("the ledger on a real Postgres, ten connections", () => {
  const ledger = createInferenceLedger();
  const schemaName = `inference_test_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;
  let db: Db;
  let close: () => Promise<void> = async () => {};
  let previous: DbGlobal = {};
  let run = 0;

  function reserveInput(overrides: Partial<InferenceReserveInput> = {}): InferenceReserveInput {
    run += 1;
    return {
      ownerId: "owner-1",
      agentId: "agent-1",
      runId: `run-${run}`,
      seq: 0,
      requestHash: "ab".repeat(32),
      chain: "solana",
      network: INFERENCE_GATEWAY.solana.network,
      host: INFERENCE_GATEWAY.solana.host,
      model: "google/gemini-2.5-flash",
      payerWalletId: "wallet-1",
      payerAddress: "PayerAddress1111111111111111111111111111111",
      payTo: INFERENCE_GATEWAY.solana.payTo[0],
      asset: INFERENCE_GATEWAY.solana.asset,
      quotedUsd: 0.01,
      caps: CAPS,
      runSpentUsd: 0,
      now: NOON,
      ...overrides,
    };
  }

  async function counterUsd(scope: string, scopeId: string): Promise<number> {
    const [row] = await db
      .select({ usd: inferenceBudgetDays.usd })
      .from(inferenceBudgetDays)
      .where(and(eq(inferenceBudgetDays.scope, scope), eq(inferenceBudgetDays.scopeId, scopeId), eq(inferenceBudgetDays.day, DAY)));
    return Number(row?.usd ?? 0);
  }

  /** What the rows say is held, which the counters must always equal. */
  async function heldByRows(): Promise<number> {
    const [row] = await db
      .select({ usd: sql<string>`coalesce(sum(${inferencePayments.quotedUsd}), 0)` })
      .from(inferencePayments)
      .where(inArray(inferencePayments.status, ["reserved", "signed", "settled", "paid_no_answer", "unconfirmed", "simulated"]));
    return Number(row?.usd ?? 0);
  }

  beforeAll(async () => {
    const g = globalThis as unknown as DbGlobal;
    previous = { __tockerDb: g.__tockerDb, __tockerDbPromise: g.__tockerDbPromise };
    const { default: postgres } = await import("postgres");
    const { drizzle } = await import("drizzle-orm/postgres-js");
    const setup = postgres(url!, { max: 1, prepare: false, onnotice: () => {} });
    // The schema and its tables in one transaction, with the search path set for that
    // transaction only: the statements that build the tables carry no schema name, and
    // must not depend on a session setting surviving from one statement to the next.
    await setup.begin(async (tx) => {
      await tx.unsafe(`create schema "${schemaName}"`);
      await tx.unsafe(`set local search_path to "${schemaName}"`);
      for (const statement of ledgerDdl()) await tx.unsafe(statement);
    });

    // The same options the app connects with (src/db/index.ts), plus the private schema.
    const client = postgres(url!, { max: 10, prepare: false, onnotice: () => {}, connection: { search_path: `"${schemaName}", public` } });
    close = async () => {
      await client.end({ timeout: 5 });
      // By name: this statement does not depend on any connection's search path.
      await setup.unsafe(`drop schema if exists "${schemaName}" cascade`);
      await setup.end({ timeout: 5 });
    };

    // Before a single row is written or deleted through the ten connections: each of
    // them, held open at the same moment so that they are ten different ones, says where
    // the ledger's table names lead. A pooler that dropped the search path shows here.
    const answers = await Promise.all(
      Array.from({ length: 10 }, () =>
        client.begin(async (tx) => {
          await tx`select pg_sleep(0.15)`;
          return firstRow(await tx.unsafe(WHERE_TABLES_RESOLVE)) as Resolved;
        }),
      ),
    );
    if (!answers.every((answer) => isPrivate(answer, schemaName))) {
      await close();
      close = async () => {};
      throw wrongSchema(schemaName, answers.find((answer) => !isPrivate(answer, schemaName)));
    }

    db = drizzle(client, { schema }) as unknown as Db;
    g.__tockerDb = db;
    g.__tockerDbPromise = Promise.resolve(db);
  });

  afterAll(async () => {
    const g = globalThis as unknown as DbGlobal;
    g.__tockerDb = previous.__tockerDb;
    g.__tockerDbPromise = previous.__tockerDbPromise;
    await close();
  });

  beforeEach(async () => {
    await emptyLedger(db, schemaName, { control: true });
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("is really running transactions side by side", async () => {
    // Two transactions that each hold a lock the other never needs both sleep at once:
    // on one connection this would take twice as long.
    const started = Date.now();
    await Promise.all([1, 2, 3, 4].map(() => db.transaction(async (tx) => tx.execute(sql`select pg_sleep(0.4)`))));
    expect(Date.now() - started).toBeLessThan(1200);
  });

  it("20 reserves at once never pass the agent's day", async () => {
    const caps = { ...CAPS, agentDayUsd: 0.07 };
    for (let round = 0; round < ROUNDS; round += 1) {
      await emptyLedger(db, schemaName);
      const results = await Promise.all(Array.from({ length: 20 }, () => ledger.reserve(reserveInput({ caps }))));
      expect(results.filter((result) => result.ok)).toHaveLength(7);
      expect(results.filter((result) => !result.ok).every((result) => !result.ok && result.reason === "agent_day_cap")).toBe(true);
      expect(await counterUsd("agent", "agent-1")).toBe(0.07);
      expect(await counterUsd("owner", "owner-1")).toBe(0.07);
      expect(await counterUsd("platform", "all")).toBe(0.07);
      expect(await heldByRows()).toBeCloseTo(0.07, 9);
    }
  });

  it("20 reserves at once from many owners never pass the platform's day", async () => {
    const caps = { ...CAPS, platformDayUsd: 0.05 };
    for (let round = 0; round < ROUNDS; round += 1) {
      await emptyLedger(db, schemaName);
      const results = await Promise.all(
        Array.from({ length: 20 }, (_, n) => ledger.reserve(reserveInput({ caps, ownerId: `owner-${n % 5}`, agentId: `agent-${n}` }))),
      );
      expect(results.filter((result) => result.ok)).toHaveLength(5);
      expect(await counterUsd("platform", "all")).toBe(0.05);
      expect(await heldByRows()).toBeCloseTo(0.05, 9);
    }
  });

  it("20 steps of one run reserved at once never pass the run's cap", async () => {
    const caps = { ...CAPS, runUsd: 0.03 };
    for (let round = 0; round < ROUNDS; round += 1) {
      const runId = `run-together-${round}`;
      await emptyLedger(db, schemaName);
      const results = await Promise.all(Array.from({ length: 20 }, (_, seq) => ledger.reserve(reserveInput({ caps, runId, seq }))));
      expect(results.filter((result) => result.ok)).toHaveLength(3);
      expect(await heldByRows()).toBeCloseTo(0.03, 9);
      expect(await counterUsd("agent", "agent-1")).toBe(0.03);
    }
  });

  it("20 reserves of the same step give one row and count once", async () => {
    for (let round = 0; round < ROUNDS; round += 1) {
      const runId = `run-same-${round}`;
      await emptyLedger(db, schemaName);
      const results = await Promise.all(Array.from({ length: 20 }, () => ledger.reserve(reserveInput({ runId, seq: 0 }))));
      expect(results.filter((result) => result.ok)).toHaveLength(1);
      expect(await db.select().from(inferencePayments)).toHaveLength(1);
      expect(await counterUsd("platform", "all")).toBe(0.01);
    }
  });

  it("20 releases of one row at once give its amount back once", async () => {
    for (let round = 0; round < ROUNDS; round += 1) {
      await emptyLedger(db, schemaName);
      const kept = await ledger.reserve(reserveInput({ quotedUsd: 0.05 }));
      const freed = await ledger.reserve(reserveInput({ quotedUsd: 0.02 }));
      if (!kept.ok || !freed.ok) throw new Error("reserve refused");
      await Promise.all(Array.from({ length: 20 }, () => ledger.release(freed.paymentId, "gave up")));
      expect(await counterUsd("platform", "all")).toBe(0.05);
      expect(await counterUsd("owner", "owner-1")).toBe(0.05);
      expect(await counterUsd("agent", "agent-1")).toBe(0.05);
    }
  });

  it("opposite verdicts on one row at once apply exactly one", async () => {
    for (let round = 0; round < ROUNDS; round += 1) {
      await emptyLedger(db, schemaName);
      const reserved = await ledger.reserve(reserveInput({ quotedUsd: 0.02 }));
      if (!reserved.ok) throw new Error("reserve refused");
      await ledger.markSigned(reserved.paymentId, { memo: "0f".repeat(16), blockhash: "Blockhash", payerSignature: "Sig" });
      const verdicts = await Promise.all(
        Array.from({ length: 10 }, (_, n) =>
          resolveInferencePayment(
            reserved.paymentId,
            n % 2 === 0 ? { charged: true, txHash: "Tx", detail: "found" } : { charged: false, detail: "not found" },
            NOON,
          ),
        ),
      );
      expect(verdicts.filter(Boolean)).toHaveLength(1);
      const [row] = await db.select().from(inferencePayments).where(eq(inferencePayments.id, reserved.paymentId));
      expect(await counterUsd("agent", "agent-1")).toBe(row.status === "paid_no_answer" ? 0.02 : 0);
    }
  });

  it("reserves and releases mixed together leave the counters equal to the rows", async () => {
    const caps = { ...CAPS, agentDayUsd: 0.2, ownerDayUsd: 0.5, platformDayUsd: 0.8 };
    for (let round = 0; round < ROUNDS; round += 1) {
      await emptyLedger(db, schemaName);
      const work = Array.from({ length: 40 }, async (_, n) => {
        const result = await ledger.reserve(reserveInput({ caps, ownerId: `owner-${n % 3}`, agentId: `agent-${n % 6}`, quotedUsd: 0.01 + (n % 4) * 0.005 }));
        // Every other winner gives up straight away, while others are still reserving.
        if (result.ok && n % 2 === 0) await ledger.release(result.paymentId, "gave up");
      });
      await Promise.all(work);
      const held = await heldByRows();
      expect(await counterUsd("platform", "all")).toBeCloseTo(held, 9);
      expect(held).toBeLessThanOrEqual(0.8 + 1e-9);
      for (let agent = 0; agent < 6; agent += 1) expect(await counterUsd("agent", `agent-${agent}`)).toBeLessThanOrEqual(0.2 + 1e-9);
      for (let owner = 0; owner < 3; owner += 1) expect(await counterUsd("owner", `owner-${owner}`)).toBeLessThanOrEqual(0.5 + 1e-9);
    }
  });
});
