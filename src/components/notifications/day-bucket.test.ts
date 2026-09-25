import { describe, expect, it } from "vitest";
import { dayBucket, resolveTimeZone } from "./day-bucket";

// Fri Sep 25 2026, 01:10 UTC — Thursday 18:10 in Los Angeles.
const NOW = Date.parse("2026-09-25T01:10:00Z");

describe("dayBucket", () => {
  it("groups by UTC days without a zone, as before", () => {
    expect(dayBucket("2026-09-25T00:30:00Z", NOW)).toBe("Today");
    expect(dayBucket("2026-09-24T12:00:00Z", NOW)).toBe("Yesterday");
    expect(dayBucket("2026-09-23T15:06:00Z", NOW)).toBe("Wednesday, Sep 23");
  });

  it("groups by the viewer's calendar", () => {
    const zone = "America/Los_Angeles";
    // Thu 17:30 local — the evening that UTC had already moved to "yesterday".
    expect(dayBucket("2026-09-25T00:30:00Z", NOW, zone)).toBe("Today");
    expect(dayBucket("2026-09-24T12:00:00Z", NOW, zone)).toBe("Today");
    // Wed 08:06 local: a "1d" row reads Yesterday, not a date two days back.
    expect(dayBucket("2026-09-23T15:06:00Z", NOW, zone)).toBe("Yesterday");
    expect(dayBucket("2026-09-23T04:06:00Z", NOW, zone)).toBe("Tuesday, Sep 22");
  });

  it("steps back one calendar day across a clock change", () => {
    const zone = "America/New_York";
    // 00:30 on Mon Mar 9 2026, the morning after the 23-hour Sunday.
    const afterSpringForward = Date.parse("2026-03-09T04:30:00Z");
    expect(dayBucket("2026-03-08T15:00:00Z", afterSpringForward, zone)).toBe("Yesterday");
    expect(dayBucket("2026-03-08T04:30:00Z", afterSpringForward, zone)).toBe("Saturday, Mar 7");
  });
});

describe("resolveTimeZone", () => {
  it("keeps a real zone and falls back to UTC otherwise", () => {
    expect(resolveTimeZone("America/Los_Angeles")).toBe("America/Los_Angeles");
    expect(resolveTimeZone(undefined)).toBe("UTC");
    expect(resolveTimeZone("")).toBe("UTC");
    expect(resolveTimeZone("Mars/Olympus_Mons")).toBe("UTC");
    expect(resolveTimeZone("'; drop table")).toBe("UTC");
  });
});
