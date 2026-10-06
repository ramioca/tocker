/**
 * The admin matcher is the whole access control for the dashboard, so it is tested
 * against the ways an env var actually arrives: unset, blank, padded with spaces,
 * differently cased, and with a trailing comma from a careless edit.
 *
 * The case that matters most is the empty one. A matcher that treated "no list" as
 * "everyone" — or that let a null email match a blank entry — would hand every
 * signed-in user every other user's balances, and it would look like it worked.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { adminEmails, isAdminEmail } from "./admin";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("adminEmails", () => {
  it("is empty when ADMIN_EMAILS is unset", () => {
    vi.stubEnv("ADMIN_EMAILS", undefined);
    expect(adminEmails()).toEqual([]);
  });

  it("is empty for a blank or comma-only value", () => {
    vi.stubEnv("ADMIN_EMAILS", "   ");
    expect(adminEmails()).toEqual([]);
    vi.stubEnv("ADMIN_EMAILS", ",,, ,");
    expect(adminEmails()).toEqual([]);
  });

  it("trims, lowercases and drops blank entries", () => {
    vi.stubEnv("ADMIN_EMAILS", " Owner@Example.com , ops@tocker.app ,, ");
    expect(adminEmails()).toEqual(["owner@example.com", "ops@tocker.app"]);
  });
});

describe("isAdminEmail", () => {
  it("lets nobody in when the list is empty", () => {
    vi.stubEnv("ADMIN_EMAILS", undefined);
    expect(isAdminEmail("owner@example.com")).toBe(false);
    vi.stubEnv("ADMIN_EMAILS", "");
    expect(isAdminEmail("owner@example.com")).toBe(false);
  });

  it("matches regardless of case and surrounding whitespace on either side", () => {
    vi.stubEnv("ADMIN_EMAILS", "  OWNER@example.COM ");
    expect(isAdminEmail("owner@example.com")).toBe(true);
    expect(isAdminEmail("Owner@Example.com")).toBe(true);
    expect(isAdminEmail("  owner@example.com  ")).toBe(true);
  });

  it("does not match a different address, a prefix or a suffix", () => {
    vi.stubEnv("ADMIN_EMAILS", "owner@example.com");
    expect(isAdminEmail("owne@example.com")).toBe(false);
    expect(isAdminEmail("owner@example.com.evil.com")).toBe(false);
    expect(isAdminEmail("xowner@example.com")).toBe(false);
  });

  it("refuses a null, undefined or blank email even with a populated list", () => {
    vi.stubEnv("ADMIN_EMAILS", "owner@example.com, ops@tocker.app");
    expect(isAdminEmail(null)).toBe(false);
    expect(isAdminEmail(undefined)).toBe(false);
    expect(isAdminEmail("")).toBe(false);
    expect(isAdminEmail("   ")).toBe(false);
  });

  it("matches any entry in a multi-address list", () => {
    vi.stubEnv("ADMIN_EMAILS", "a@x.com,b@y.com,c@z.com");
    expect(isAdminEmail("b@y.com")).toBe(true);
    expect(isAdminEmail("c@z.com")).toBe(true);
    expect(isAdminEmail("d@w.com")).toBe(false);
  });
});
