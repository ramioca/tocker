import { describe, expect, it } from "vitest";
import { equityRanges } from "./equity-ranges";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const now = Date.UTC(2026, 9, 8, 12, 41);
const hourly = (hours: number) => Array.from({ length: hours + 1 }, (_, i) => now - (hours - i) * HOUR);
const labels = (ts: number[]) => equityRanges(ts).ranges.map((r) => r.label);

describe("the equity chart's ranges", () => {
  it("opens a day-old agent on 24H, hour by hour", () => {
    const ts = hourly(20);
    expect(equityRanges(ts).defaultRange).toBe("24H");
    expect(equityRanges(ts).ranges[0]).toEqual({ label: "24H", bars: 21 });
  });

  it("opens a few days of history on the shortest window that holds all of it", () => {
    expect(equityRanges(hourly(3 * 24)).defaultRange).toBe("7D");
    const month = [...Array.from({ length: 20 }, (_, d) => now - (27 - d) * DAY), ...hourly(7 * 24)];
    expect(equityRanges(month).defaultRange).toBe("30D");
  });

  it("opens a long history on 30D, as before", () => {
    const year = [...Array.from({ length: 300 }, (_, d) => now - (307 - d) * DAY), ...hourly(7 * 24)];
    const { ranges, defaultRange } = equityRanges(year);
    expect(defaultRange).toBe("30D");
    expect(ranges.map((r) => r.label)).toEqual(["24H", "7D", "30D", "ALL"]);
    expect(ranges[0].bars).toBe(25);
  });

  it("leaves out a window with fewer than two points instead of stretching it", () => {
    // A stopped agent: daily closes that ended ten days ago, then the live point.
    const stopped = [...Array.from({ length: 30 }, (_, d) => now - (40 - d) * DAY), now];
    expect(labels(stopped)).toEqual(["30D", "ALL"]);
    expect(equityRanges(stopped).defaultRange).toBe("30D");
    expect(labels([now - 90 * DAY, now - 89 * DAY, now])).toEqual(["ALL"]);
    expect(equityRanges([now - 90 * DAY, now - 89 * DAY, now]).defaultRange).toBe("ALL");
  });
});
