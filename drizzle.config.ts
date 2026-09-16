import { defineConfig } from "drizzle-kit";
import { databaseUrl } from "./src/db/url";

const url = databaseUrl("migrate") || "pglite://./.pglite";
const pglite = url.startsWith("pglite://");

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  ...(pglite ? { driver: "pglite" as const, dbCredentials: { url: url.replace("pglite://", "") } } : { dbCredentials: { url } }),
});
