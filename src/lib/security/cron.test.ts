import { describe, expect, it } from "vitest";
import { authorizeCron, timingSafeEqual } from "./cron";

const SECRET = "a".repeat(64);

describe("timingSafeEqual", () => {
  it("matches identical strings and rejects everything else", () => {
    expect(timingSafeEqual("abc", "abc")).toBe(true);
    expect(timingSafeEqual("abc", "abd")).toBe(false);
    expect(timingSafeEqual("abc", "ab")).toBe(false);
    expect(timingSafeEqual("", "")).toBe(true);
    expect(timingSafeEqual("abc", "")).toBe(false);
  });
});

describe("authorizeCron", () => {
  it("accepts the right bearer token", () => {
    expect(authorizeCron(`Bearer ${SECRET}`, SECRET)).toEqual({ ok: true });
  });

  it("is case-insensitive about the scheme but not the secret", () => {
    expect(authorizeCron(`bearer ${SECRET}`, SECRET).ok).toBe(true);
    expect(authorizeCron(`Bearer ${SECRET.toUpperCase()}`, SECRET).ok).toBe(false);
  });

  it("rejects a missing or malformed header with 401", () => {
    expect(authorizeCron(null, SECRET)).toMatchObject({ ok: false, status: 401 });
    expect(authorizeCron(SECRET, SECRET)).toMatchObject({ ok: false, status: 401 });
    expect(authorizeCron("Basic xyz", SECRET)).toMatchObject({ ok: false, status: 401 });
  });

  /**
   * A deployment with no secret must not look like a deployment with a wrong token —
   * the first is a broken deploy, the second is someone knocking.
   */
  it("reports an unset secret as 503, not 401", () => {
    expect(authorizeCron(`Bearer ${SECRET}`, undefined)).toMatchObject({ ok: false, status: 503 });
    expect(authorizeCron(`Bearer ${SECRET}`, "   ")).toMatchObject({ ok: false, status: 503 });
  });

  /** `CRON_SECRET=test` protects nothing; refuse rather than pretend. */
  it("refuses a secret that is too short to be one", () => {
    const result = authorizeCron("Bearer test", "test");
    expect(result).toMatchObject({ ok: false, status: 503 });
    if (!result.ok) expect(result.error).toMatch(/too short/);
  });

  it("never authorizes an empty bearer against an unset secret", () => {
    expect(authorizeCron("Bearer ", "").ok).toBe(false);
  });
});
