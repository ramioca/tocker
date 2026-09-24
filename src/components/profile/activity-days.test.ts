import { describe, expect, it } from "vitest";
import { DAY_MS, fillActivityDays } from "./activity-days";

describe("fillActivityDays", () => {
  // 2026-09-24T15:30Z: mid-afternoon, so "today" is the UTC day, not the local one.
  const now = Date.UTC(2026, 8, 24, 15, 30);
  const today = Math.floor(now / DAY_MS);

  it("returns every day of the window, oldest first, ending today", () => {
    const series = fillActivityDays([], 7, now);
    expect(series).toHaveLength(7);
    expect(series[6].t).toBe(Date.UTC(2026, 8, 24));
    expect(series[0].t).toBe(Date.UTC(2026, 8, 18));
    expect(series.every((d) => d.value === 0)).toBe(true);
  });

  it("places counts on their UTC day and zero-fills the rest", () => {
    const series = fillActivityDays(
      [
        { day: today, n: 3 },
        { day: today - 2, n: 5 },
      ],
      4,
      now,
    );
    expect(series.map((d) => d.value)).toEqual([0, 5, 0, 3]);
  });

  it("drops days outside the window and sums duplicate rows", () => {
    const series = fillActivityDays(
      [
        { day: today - 10, n: 9 },
        { day: today, n: 1 },
        { day: today, n: 2 },
      ],
      3,
      now,
    );
    expect(series.map((d) => d.value)).toEqual([0, 0, 3]);
  });
});
