import { describe, expect, it } from "vitest";
import { formatAxisPrice, niceTicks, sampleRows } from "./chart-engine";

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
    const labels = ticks.map((t) => formatAxisPrice(t, scale));
    expect(labels.every((label) => label.endsWith("K"))).toBe(true);
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
