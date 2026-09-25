import { describe, expect, it } from "vitest";
import { NAV_ITEMS, isActivePath } from "./nav-items";

describe("NAV_ITEMS", () => {
  it("marks only pages that open without an account as public", () => {
    // Home, My agents, Money, Notifications and Settings all redirect to sign-in.
    expect(NAV_ITEMS.filter((item) => item.public).map((item) => item.href)).toEqual(["/feed", "/discover"]);
  });
});

describe("isActivePath", () => {
  it("treats / as home", () => {
    expect(isActivePath("/", "/home")).toBe(true);
    expect(isActivePath("/home", "/home")).toBe(true);
    expect(isActivePath("/homework", "/home")).toBe(false);
  });

  it("matches a section and its children, not a lookalike prefix", () => {
    expect(isActivePath("/money", "/money")).toBe(true);
    expect(isActivePath("/money/fees", "/money")).toBe(true);
    expect(isActivePath("/moneyball", "/money")).toBe(false);
  });

  it("falls back to the prefix for /agents when owned slugs are unknown", () => {
    expect(isActivePath("/agents/bonk-maxi", "/agents")).toBe(true);
  });

  describe("with the viewer's agents", () => {
    const owned = new Set(["momentum-mike", "base-camp"]);

    it("lights the list, the builder and owned agents, including their subpages", () => {
      expect(isActivePath("/agents", "/agents", owned)).toBe(true);
      expect(isActivePath("/agents/new", "/agents", owned)).toBe(true);
      expect(isActivePath("/agents/momentum-mike", "/agents", owned)).toBe(true);
      expect(isActivePath("/agents/base-camp/runs/r1", "/agents", owned)).toBe(true);
    });

    it("does not claim someone else's agent", () => {
      expect(isActivePath("/agents/bonk-maxi", "/agents", owned)).toBe(false);
      expect(isActivePath("/agents/bonk-maxi/runs/r1", "/agents", owned)).toBe(false);
    });

    it("leaves other sections alone", () => {
      expect(isActivePath("/agentsx", "/agents", owned)).toBe(false);
      expect(isActivePath("/feed", "/agents", owned)).toBe(false);
    });
  });
});
