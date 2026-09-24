import { describe, expect, it } from "vitest";
import { NOTIFICATION_PREF_GROUPS, groupEnabled, mutedKinds, sanitizePrefs, withGroup } from "./prefs";

const social = NOTIFICATION_PREF_GROUPS.find((group) => group.id === "social")!;

describe("sanitizePrefs", () => {
  it("keeps only muteable kinds with boolean values", () => {
    expect(sanitizePrefs({ like: false, follow: "no", nonsense: false, comment: true })).toEqual({
      like: false,
      comment: true,
    });
  });

  it("refuses anything that is not a plain object", () => {
    expect(sanitizePrefs(null)).toEqual({});
    expect(sanitizePrefs(["like"])).toEqual({});
    expect(sanitizePrefs("like")).toEqual({});
  });

  it("drops always-delivered kinds, so they cannot be muted even by a crafted request", () => {
    expect(sanitizePrefs({ proposal: false, exit_failed: false })).toEqual({});
  });
});

describe("mutedKinds", () => {
  it("lists the kinds switched off", () => {
    expect(mutedKinds({ like: false, follow: false, comment: true }).sort()).toEqual(["follow", "like"]);
  });

  it("never mutes a proposal or a failed exit", () => {
    expect(mutedKinds({ proposal: false, exit_failed: false, trade_unsettled: false })).toEqual([]);
  });

  it("mutes nothing by default", () => {
    expect(mutedKinds({})).toEqual([]);
    expect(mutedKinds(undefined)).toEqual([]);
  });
});

describe("groups", () => {
  it("switch every kind in a group together", () => {
    const off = withGroup({}, social, false);
    expect(off).toEqual({ follow: false, like: false });
    expect(groupEnabled(off, social)).toBe(false);
    expect(groupEnabled(withGroup(off, social, true), social)).toBe(true);
  });

  it("reads a group as off when any one of its kinds is muted", () => {
    expect(groupEnabled({ like: false }, social)).toBe(false);
  });

  it("offers no milestones switch, because nothing writes that kind", () => {
    expect(NOTIFICATION_PREF_GROUPS.flatMap((group) => group.kinds)).not.toContain("milestone");
  });
});
