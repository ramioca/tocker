/**
 * Migration step for `vercel-build`.
 *
 * A first deploy often has no database yet — the point is to see the site stand up.
 * So a missing `DATABASE_URL` is a loud skip, not a failed build; `/api/health` will
 * report the database as unreachable until it is set. A migration that *fails* with a
 * URL present is a real error and stops the build, because shipping code against an
 * un-migrated schema is worse than not shipping.
 */
import { execFileSync } from "node:child_process";

import { databaseUrl } from "../src/db/url";

const url = databaseUrl("migrate");

if (!url) {
  console.warn("[migrate] DATABASE_URL is not set — skipping migrations.");
  console.warn("[migrate] The app will build and serve, but every database-backed route will fail.");
  console.warn("[migrate] Set DATABASE_URL in the Vercel project and redeploy.");
  process.exit(0);
}

if (url.startsWith("pglite://")) {
  console.warn("[migrate] DATABASE_URL points at embedded PGlite — skipping migrations.");
  console.warn("[migrate] PGlite is a local file and cannot persist on serverless. Use Postgres.");
  process.exit(0);
}

console.log("[migrate] running drizzle-kit migrate…");
execFileSync("pnpm", ["exec", "drizzle-kit", "migrate"], { stdio: "inherit", env: { ...process.env, DATABASE_URL: url } });
console.log("[migrate] done.");
