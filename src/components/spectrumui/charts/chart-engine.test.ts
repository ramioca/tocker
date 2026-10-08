import { describe, expect, it } from "vitest";
import { chartClock, formatAxisPrice, intradayPoints, niceTicks, sampleRows, timeTickLabels } from "./chart-engine";

describe("formatAxisPrice", () => {
  it("compacts a whole axis once any tick reaches $1,000", () => {
    const ticks = [9_000, 9_500, 10_000, 10_500, 11_000];
    const scale = Math.max(...ticks);
    expect(ticks.map((t) => formatAxisPrice(t, scale))).toEqual(["$9K", "$9.5K", "$10K", "$10.5K", "$11K"]);
  });

  it("keeps the low ticks of a compact axis in the same format", () => {
    expect([800, 900, 1_000, 1_100].map((t) => formatAxisPrice(t, 1_100))).toEqual(["$800", "$900", "$1K", "$1.1K"]);
  });

  it("keeps cents on a small axis", () => {
    expect([90, 100, 110].map((t) => formatAxisPrice(t, 110))).toEqual(["$90.00", "$100.00", "$110.00"]);
  });

  it("judges a lone label on its own value", () => {
    expect(formatAxisPrice(10_200)).toBe("$10.2K");
    expect(formatAxisPrice(950)).toBe("$950.00");
  });

  it("formats the ticks niceTicks produces for a $9-11k book without mixing styles", () => {
    const ticks = niceTicks(8_800, 11_200, 4);
    const scale = Math.max(...ticks.map(Math.abs));
    const labels = ticks.map((t) => formatAxisPrice(t, scale, ticks[1] - ticks[0]));
    expect(labels).toEqual(["$9K", "$9.5K", "$10K", "$10.5K", "$11K"]);
  });

  /** An axis's labels as PortfolioChart prints them: compact once it reaches $1,000, with the tick gap. */
  const axis = (lo: number, hi: number) => {
    const ticks = niceTicks(lo, hi, 4);
    const scale = Math.max(...ticks.map(Math.abs));
    return ticks.map((t) => formatAxisPrice(t, scale, ticks[1] - ticks[0]));
  };

  it("never prints the same label twice on a tight axis", () => {
    for (const [lo, hi] of [
      [9_993.8, 10_006.2],
      [998.6, 1_013.4],
      [9_400, 10_600],
      [41_000, 47_500],
      [1_499_000, 1_503_000],
    ]) {
      const labels = axis(lo, hi);
      expect(new Set(labels).size, labels.join(" ")).toBe(labels.length);
      for (const label of labels) expect(label.length, label).toBeLessThanOrEqual(9);
    }
    expect(axis(9_993.8, 10_006.2)).toEqual(["$9.995K", "$9.998K", "$10K", "$10.003K", "$10.005K"]);
    expect(axis(998.6, 1_013.4)).toEqual(["$1K", "$1.005K", "$1.01K"]);
  });
});

describe("sampleRows", () => {
  it("keeps every row without a cap, or when the view already fits", () => {
    expect(sampleRows(5)).toEqual({ stride: 1, indices: [0, 1, 2, 3, 4] });
    expect(sampleRows(7, 15).indices).toHaveLength(7);
  });

  it("samples a 90-day view to at most the cap, ending on the latest point", () => {
    const { stride, indices } = sampleRows(90, 15);
    expect(stride).toBe(6);
    expect(indices).toHaveLength(15);
    expect(indices.at(-1)).toBe(89);
    expect(indices.every((i, k) => k === 0 || i - indices[k - 1] === 6)).toBe(true);
  });

  it("handles an empty view", () => {
    expect(sampleRows(0, 15)).toEqual({ stride: 1, indices: [] });
  });
});

describe("the chart clock", () => {
  const HOUR = 3_600_000;
  // 2026-10-08 09:12 UTC
  const t0 = Date.UTC(2026, 9, 8, 9, 12);

  it("prints dates and 24-hour times in its zone", () => {
    const utc = chartClock();
    expect([utc.day(t0), utc.date(t0), utc.time(t0), utc.zone(t0)]).toEqual(["Oct 8", "Oct 8, 2026", "09:12", "UTC"]);
    const berlin = chartClock("Europe/Berlin");
    expect([berlin.time(t0), berlin.zone(t0)]).toEqual(["11:12", "UTC+2"]);
    const kolkata = chartClock("Asia/Kolkata");
    expect([kolkata.time(t0), kolkata.zone(t0)]).toEqual(["14:42", "UTC+5:30"]);
    const newYork = chartClock("America/New_York");
    expect([newYork.day(Date.UTC(2026, 9, 8, 2)), newYork.zone(t0)]).toEqual(["Oct 7", "UTC−4"]);
  });

  it("falls back to UTC for a zone it does not know", () => {
    expect(chartClock("Mars/Olympus_Mons").zone(t0)).toBe("UTC");
  });

  it("marks the hourly stretch of a series and leaves the daily part alone", () => {
    const daily = [0, 1, 2].map((d) => t0 - (10 - d) * 24 * HOUR);
    const hourly = [0, 1, 2].map((h) => t0 + h * HOUR);
    expect(intradayPoints([...daily, ...hourly])).toEqual([false, false, false, true, true, true]);
    expect(intradayPoints([t0])).toEqual([false]);
  });

  it("prints the time of every point in a window of two days or less, as its axis does", () => {
    expect(intradayPoints([t0 - 30 * HOUR, t0])).toEqual([true, true]);
    expect(timeTickLabels([t0 - 30 * HOUR, t0], [0, 1], chartClock())).toEqual(["Oct 7 03:12", "Oct 8 09:12"]);
  });

  it("switches a few days of hourly points to times rather than repeat a date", () => {
    const ts = Array.from({ length: 73 }, (_, h) => t0 + h * HOUR);
    expect(timeTickLabels(ts, [0, 14, 28, 42, 56, 72], chartClock())).toEqual([
      "Oct 8 09:12",
      "23:12",
      "Oct 9 13:12",
      "Oct 10 03:12",
      "17:12",
      "Oct 11 09:12",
    ]);
  });

  it("labels a short window by the time of day, dating the first tick and each new day", () => {
    const ts = Array.from({ length: 25 }, (_, h) => t0 + h * HOUR);
    expect(timeTickLabels(ts, [0, 6, 12, 18, 24], chartClock())).toEqual([
      "Oct 8 09:12",
      "15:12",
      "21:12",
      "Oct 9 03:12",
      "09:12",
    ]);
  });

  it("labels a long window by the date alone", () => {
    const ts = Array.from({ length: 30 }, (_, d) => t0 + d * 24 * HOUR);
    expect(timeTickLabels(ts, [0, 29], chartClock())).toEqual(["Oct 8", "Nov 6"]);
  });
});
