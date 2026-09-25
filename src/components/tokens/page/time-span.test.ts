import { describe, expect, it } from "vitest";
import { axisLabels, recentWindowLabel } from "./time-span";

const at = (iso: string) => Date.parse(iso);

describe("recentWindowLabel", () => {
  const now = at("2026-09-25T12:00:00Z");

  it("says hours for anything under two days", () => {
    expect(recentWindowLabel(at("2026-09-25T11:30:00Z"), now)).toBe("last hour");
    expect(recentWindowLabel(at("2026-09-25T06:00:00Z"), now)).toBe("last 6 hours");
    expect(recentWindowLabel(at("2026-09-24T08:00:00Z"), now)).toBe("last 28 hours");
  });

  it("says days beyond that, capped at the 30-day window", () => {
    expect(recentWindowLabel(at("2026-09-13T12:00:00Z"), now)).toBe("last 12 days");
    expect(recentWindowLabel(at("2026-07-01T00:00:00Z"), now)).toBe("last 30 days");
  });
});

describe("axisLabels", () => {
  it("labels a same-day span with times, the date on the first", () => {
    expect(axisLabels(at("2026-09-24T08:10:00Z"), at("2026-09-24T14:05:00Z"), "UTC")).toEqual([
      "Sep 24 08:10",
      "14:05",
    ]);
  });

  it("dates the last label too when a short span crosses midnight", () => {
    expect(axisLabels(at("2026-09-24T22:00:00Z"), at("2026-09-25T09:00:00Z"), "UTC")).toEqual([
      "Sep 24 22:00",
      "Sep 25 09:00",
    ]);
  });

  it("keeps plain dates from 36 hours up", () => {
    expect(axisLabels(at("2026-09-01T00:00:00Z"), at("2026-09-24T00:00:00Z"), "UTC")).toEqual(["Sep 1", "Sep 24"]);
  });
});
