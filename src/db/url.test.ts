import { describe, expect, it } from "vitest";
import { databaseUrl } from "./url";

describe("databaseUrl", () => {
  it("prefers an explicit DATABASE_URL", () => {
    expect(databaseUrl("app", { DATABASE_URL: "postgres://x", TOCKER_STORAGE_DATABASE_URL: "postgres://y" })).toBe("postgres://x");
  });
  it("honours the Vercel Storage prefix for the app (pooled)", () => {
    expect(databaseUrl("app", { TOCKER_STORAGE_DATABASE_URL: "postgres://pooled", TOCKER_STORAGE_DATABASE_URL_UNPOOLED: "postgres://direct" })).toBe("postgres://pooled");
  });
  it("gives migrations the direct connection when one exists", () => {
    expect(databaseUrl("migrate", { TOCKER_STORAGE_DATABASE_URL: "postgres://pooled", TOCKER_STORAGE_DATABASE_URL_UNPOOLED: "postgres://direct" })).toBe("postgres://direct");
    expect(databaseUrl("migrate", { TOCKER_STORAGE_DATABASE_URL: "postgres://pooled" })).toBe("postgres://pooled");
  });
  it("is undefined when nothing is set", () => {
    expect(databaseUrl("app", {})).toBeUndefined();
  });
});
