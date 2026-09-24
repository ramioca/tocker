import { describe, expect, it } from "vitest";
import { floorCents, sliceText } from "./sell-amount";

describe("floorCents", () => {
  it("rounds down, never up, so a figure never exceeds the mark", () => {
    expect(floorCents(3528.146)).toBe(3528.14);
    expect(floorCents(2140.649)).toBe(2140.64);
    expect(floorCents(573.4299)).toBe(573.42);
  });

  it("keeps a value that is already whole cents despite float noise", () => {
    expect(floorCents(3528.15)).toBe(3528.15);
    expect(floorCents(0.29)).toBe(0.29);
    expect(floorCents(1.005)).toBe(1);
  });

  it("is never more than the value it was given", () => {
    for (const value of [0.01, 0.1, 3528.15, 3528.146, 12345.6789, 99.999]) {
      expect(floorCents(value)).toBeLessThanOrEqual(value + 1e-9);
    }
  });

  it("treats nothing as nothing", () => {
    expect(floorCents(0)).toBe(0);
    expect(floorCents(-5)).toBe(0);
    expect(floorCents(Number.NaN)).toBe(0);
  });
});

describe("sliceText", () => {
  it("prints a slice of the position in whole cents, rounded down", () => {
    expect(sliceText(3528.146, 100)).toBe("3528.14");
    expect(sliceText(3528.146, 50)).toBe("1764.07");
    expect(sliceText(573.42, 25)).toBe("143.35");
  });
});
