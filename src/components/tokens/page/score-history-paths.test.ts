import { describe, expect, it } from "vitest";
import { isNoDataReading, scorePaths } from "./score-history-paths";

const pt = (cx: number, cy: number, gap = false) => ({ cx, cy, gap });

describe("isNoDataReading", () => {
  it("is a reading with no price, no liquidity and no holders", () => {
    expect(isNoDataReading({ priceUsd: null, liquidityUsd: null, holderCount: null })).toBe(true);
    expect(isNoDataReading({ priceUsd: 2.34, liquidityUsd: null, holderCount: null })).toBe(false);
    expect(isNoDataReading({ priceUsd: null, liquidityUsd: null, holderCount: 1200 })).toBe(false);
  });
});

describe("scorePaths", () => {
  it("draws one segment when nothing is missing", () => {
    const { line, area, lone } = scorePaths([pt(0, 10), pt(10, 20), pt(20, 15)], 100);
    expect(line).toBe("M0.00,10.00 L10.00,20.00 L20.00,15.00");
    expect(area).toBe("M0.00,10.00 L10.00,20.00 L20.00,15.00 L20.00,100.00 L0.00,100.00 Z");
    expect(lone).toEqual([]);
  });

  it("starts a new segment after a gap instead of dropping to the floor", () => {
    const { line, area } = scorePaths([pt(0, 10), pt(10, 20), pt(20, 100, true), pt(30, 30), pt(40, 25)], 100);
    expect(line).toBe("M0.00,10.00 L10.00,20.00 M30.00,30.00 L40.00,25.00");
    expect(area.match(/Z/g)).toHaveLength(2);
    expect(line).not.toContain("20.00,100.00");
  });

  it("returns a reading stranded between gaps as a dot", () => {
    const { line, lone } = scorePaths([pt(0, 10, true), pt(10, 20), pt(20, 0, true)], 100);
    expect(line).toBe("");
    expect(lone).toEqual([{ cx: 10, cy: 20 }]);
  });
});
