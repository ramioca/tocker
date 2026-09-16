/**
 * Database client.
 *
 * - `DATABASE_URL=postgres://...`  → postgres-js (docker compose / Neon / Supabase)
 * - `DATABASE_URL=pglite://./.pglite` or unset in dev → embedded PGlite (zero infra).
 *
 * Both return a drizzle instance with the same schema, so app code never cares.
 */
import * as schema from "./schema";
import { databaseUrl } from "./url";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

const g = globalThis as unknown as { __tockerDb?: Db; __tockerDbPromise?: Promise<Db> };

function resolveUrl(): string {
  const url = databaseUrl("app");
  if (url) return url;
  if (process.env.NODE_ENV === "production") throw new Error("DATABASE_URL is required in production");
  return "pglite://./.pglite";
}

async function create(): Promise<Db> {
  const url = resolveUrl();
  if (url.startsWith("pglite://")) {
    const { PGlite } = await import("@electric-sql/pglite");
    const { drizzle } = await import("drizzle-orm/pglite");
    const dir = url.replace("pglite://", "") || "./.pglite";
    // In-memory databases (tests) cannot be shared, so only on-disk ones are locked.
    if (!dir.startsWith("memory://")) {
      const { acquirePgliteLock } = await import("./pglite-lock");
      acquirePgliteLock(dir);
    }
    const client = new PGlite(dir);
    return drizzle(client, { schema }) as unknown as Db;
  }
  const { default: postgres } = await import("postgres");
  const { drizzle } = await import("drizzle-orm/postgres-js");
  const client = postgres(url, { max: 10, prepare: false });
  return drizzle(client, { schema }) as unknown as Db;
}

/** Get the shared drizzle instance. Cached per process (survives HMR in dev). */
export async function getDb(): Promise<Db> {
  if (g.__tockerDb) return g.__tockerDb;
  if (!g.__tockerDbPromise) {
    g.__tockerDbPromise = create().then((db) => {
      g.__tockerDb = db;
      return db;
    });
  }
  return g.__tockerDbPromise;
}

/**
 * Whether the database is the embedded PGlite file rather than a real Postgres.
 *
 * A predicate, so it must never throw: `/api/health` calls it *after* catching a
 * connection failure, and an unset `DATABASE_URL` in production made `resolveUrl`
 * throw straight through the handler — turning the one endpoint whose job is to
 * report "there is no database" into a bare 500 with an empty body.
 */
export function isPglite(): boolean {
  const url = databaseUrl("app");
  if (url) return url.startsWith("pglite://");
  // Unset means the dev fallback to an on-disk file. Production has no fallback —
  // `resolveUrl` refuses to invent one — so there is no embedded database to report.
  return process.env.NODE_ENV !== "production";
}

export * from "./schema";
