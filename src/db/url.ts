/**
 * Where the database connection string comes from.
 *
 * `DATABASE_URL` wins when set. Otherwise the Vercel Storage / Neon integration is
 * honoured: it injects variables under a prefix chosen at connect time
 * (`TOCKER_STORAGE_DATABASE_URL`, `…_POSTGRES_URL`, `…_DATABASE_URL_UNPOOLED`, …), so
 * this scans by suffix rather than hard-coding a prefix. Migrations get the direct
 * (unpooled) connection when one exists — Neon's pooler is transaction-mode PgBouncer,
 * which is wrong for DDL and advisory locks — and the app gets the pooled one.
 *
 * Pure: no imports, safe in drizzle.config.ts, scripts, and the server.
 */
export type DatabaseUrlKind = "app" | "migrate";

function firstMatching(env: NodeJS.ProcessEnv, suffixes: string[]): string | undefined {
  for (const suffix of suffixes) {
    for (const [key, value] of Object.entries(env)) {
      if (!value?.trim()) continue;
      if (key === suffix || key.endsWith(`_${suffix}`)) return value.trim();
    }
  }
  return undefined;
}

export function databaseUrl(kind: DatabaseUrlKind = "app", env: NodeJS.ProcessEnv = process.env): string | undefined {
  const explicit = env.DATABASE_URL?.trim();
  if (explicit) return explicit;
  if (kind === "migrate") {
    const direct = firstMatching(env, ["DATABASE_URL_UNPOOLED", "POSTGRES_URL_NON_POOLING"]);
    if (direct) return direct;
  }
  return firstMatching(env, ["DATABASE_URL", "POSTGRES_URL"]);
}
