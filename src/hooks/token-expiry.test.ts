import { describe, expect, it } from "vitest";
import { msUntilRenewal } from "./token-expiry";

const NOW = 1_800_000_000_000;

/** An unsigned JWT with the given claims: only the payload is ever read. */
function tokenWith(claims: Record<string, unknown>): string {
  const segment = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${segment({ alg: "ES256", typ: "JWT" })}.${segment(claims)}.signature`;
}

function expiringIn(ms: number): string {
  return tokenWith({ sub: "did:privy:test", exp: Math.floor((NOW + ms) / 1000) });
}

describe("msUntilRenewal", () => {
  /** An hour-long token would be 59m40s away; the cap brings the next look forward. */
  it("caps a fresh hour-long token at fifteen minutes", () => {
    expect(msUntilRenewal(expiringIn(60 * 60_000), NOW)).toBe(900_000);
  });

  it("wakes twenty seconds before expiry once that is inside the cap", () => {
    expect(msUntilRenewal(expiringIn(10 * 60_000), NOW)).toBe(580_000);
    expect(msUntilRenewal(expiringIn(60_000), NOW)).toBe(40_000);
  });

  /** Already inside the renewal window: ask again soon, but never in a tight loop. */
  it("waits five seconds for a token about to expire or already expired", () => {
    expect(msUntilRenewal(expiringIn(10_000), NOW)).toBe(5_000);
    expect(msUntilRenewal(expiringIn(25_000), NOW)).toBe(5_000);
    expect(msUntilRenewal(expiringIn(-60 * 60_000), NOW)).toBe(5_000);
  });

  it("looks again in a minute when there is no token", () => {
    expect(msUntilRenewal(null, NOW)).toBe(60_000);
    expect(msUntilRenewal(undefined, NOW)).toBe(60_000);
    expect(msUntilRenewal("", NOW)).toBe(60_000);
  });

  it("looks again in a minute when the token cannot be read", () => {
    expect(msUntilRenewal("garbage", NOW)).toBe(60_000);
    expect(msUntilRenewal("a.b.c", NOW)).toBe(60_000);
    expect(msUntilRenewal("a.%%%.c", NOW)).toBe(60_000);
    expect(msUntilRenewal(`a.${Buffer.from("not json").toString("base64url")}.c`, NOW)).toBe(60_000);
    expect(msUntilRenewal(`a.${Buffer.from("null").toString("base64url")}.c`, NOW)).toBe(60_000);
  });

  it("looks again in a minute when the token carries no usable expiry", () => {
    expect(msUntilRenewal(tokenWith({ sub: "did:privy:test" }), NOW)).toBe(60_000);
    expect(msUntilRenewal(tokenWith({ exp: "soon" }), NOW)).toBe(60_000);
    expect(msUntilRenewal(tokenWith({ exp: null }), NOW)).toBe(60_000);
  });

  /** Real tokens are base64url: `-` and `_` in the payload, and no padding. */
  it("reads a payload that needs the url-safe alphabet and padding restored", () => {
    // A run of `?` and `>` lands on the two characters that differ between base64 and
    // base64url, and this length leaves the segment one short of a multiple of four.
    const token = tokenWith({ sub: "a???b>>>", exp: Math.floor((NOW + 600_000) / 1000) });
    const payload = token.split(".")[1];
    expect(payload).toContain("-");
    expect(payload).toContain("_");
    expect(payload.length % 4).not.toBe(0);
    expect(msUntilRenewal(token, NOW)).toBe(580_000);
  });
});
