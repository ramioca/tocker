import { describe, expect, it } from "vitest";
import { safeNext } from "./safe-next";

const ORIGIN = "https://tocker.xyz";
const HOME = "/home";

describe("safeNext", () => {
  it("keeps a same-origin path, with its query and hash", () => {
    expect(safeNext("/agents/foo/settings", ORIGIN, HOME)).toBe("/agents/foo/settings");
    expect(safeNext("/agents?tab=runs#risk", ORIGIN, HOME)).toBe("/agents?tab=runs#risk");
  });

  it("keeps an absolute URL on our own origin, reduced to its path", () => {
    expect(safeNext(`${ORIGIN}/notifications`, ORIGIN, HOME)).toBe("/notifications");
  });

  /**
   * The finding. Every one of these passed the old "starts with / and not with //" check
   * and every one of them lands the visitor on another site, because the browser's URL
   * parser treats `\` as `/` for http(s) and ignores the control characters and
   * whitespace some of these hide in the authority.
   */
  it.each([
    ["/\\evil.com", "backslash reads as the authority separator"],
    ["/\\\\evil.com", "two backslashes"],
    ["/\\/evil.com", "mixed slash and backslash"],
    ["//evil.com", "protocol-relative"],
    ["https://evil.com/steal", "absolute, other origin"],
    ["http://tocker.xyz.evil.com/", "suffix that looks like us"],
    ["//tocker.xyz@evil.com/", "userinfo trick"],
    ["javascript:alert(1)", "not http at all"],
    ["", "empty"],
    // Same origin on the first parse, another site once the dot segments are gone.
    ["/.//evil.example", "dot segment in front of a double slash"],
    ["/home/..//evil.example", "parent segment in front of a double slash"],
    ["/%2e//evil.example", "encoded dot segment"],
    ["/./\\evil.example", "dot segment in front of a backslash"],
    ["https://tocker.xyz//evil.example", "our origin, then a double slash"],
    ["/login/..//evil.example", "through the sign-in path"],
  ])("refuses %s (%s)", (value) => {
    expect(safeNext(value, ORIGIN, HOME)).toBe(HOME);
  });

  it("keeps a double slash that is not at the front", () => {
    expect(safeNext("/a//b", ORIGIN, HOME)).toBe("/a//b");
    expect(safeNext("/?x=//evil.example", ORIGIN, HOME)).toBe("/?x=//evil.example");
  });

  it("refuses to bounce back to /login, which would loop", () => {
    expect(safeNext("/login", ORIGIN, HOME)).toBe(HOME);
    expect(safeNext("/login?next=/home", ORIGIN, HOME)).toBe(HOME);
  });

  it("falls back when there is no value or no origin (the prerender pass)", () => {
    expect(safeNext(null, ORIGIN, HOME)).toBe(HOME);
    expect(safeNext(undefined, ORIGIN, HOME)).toBe(HOME);
    expect(safeNext("/agents", null, HOME)).toBe(HOME);
  });

  it("never returns something that could carry an origin", () => {
    for (const value of ["/\\evil.com", "//evil.com", "https://evil.com", "/ok"]) {
      const out = safeNext(value, ORIGIN, HOME);
      expect(out.startsWith("/")).toBe(true);
      expect(out.startsWith("//")).toBe(false);
      expect(out).not.toContain("evil.com");
    }
  });
});
