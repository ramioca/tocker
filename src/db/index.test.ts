import { afterEach, describe, expect, it, vi } from "vitest";
import { isPglite } from "./index";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("isPglite", () => {
  it("reads the scheme off an explicit DATABASE_URL", () => {
    vi.stubEnv("DATABASE_URL", "pglite://./.pglite");
    expect(isPglite()).toBe(true);

    vi.stubEnv("DATABASE_URL", "postgres://user:pw@localhost:5433/tocker");
    expect(isPglite()).toBe(false);
  });

  it("falls back to the embedded file when unset outside production", () => {
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("NODE_ENV", "development");
    expect(isPglite()).toBe(true);
  });

  /**
   * The bug this guards: `isPglite` used to route through `resolveUrl`, which throws
   * "DATABASE_URL is required in production". `/api/health` calls it after catching a
   * connection failure, so the throw escaped the handler and Vercel served a bare 500
   * with an empty body — the health check could not report its own headline finding.
   */
  it("does not throw in production with no DATABASE_URL", () => {
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("NODE_ENV", "production");
    expect(() => isPglite()).not.toThrow();
    // There is no embedded database in production, only the absence of one.
    expect(isPglite()).toBe(false);
  });
});
