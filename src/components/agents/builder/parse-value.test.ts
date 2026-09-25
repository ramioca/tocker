import { describe, expect, it } from "vitest";
import { parseBps, parseMagnitude, parseTypedNumber } from "./parse-value";

describe("parseTypedNumber", () => {
  it("reads the shapes the box displays", () => {
    expect(parseTypedNumber("$1,250.50")).toBe(1250.5);
    expect(parseTypedNumber("15%")).toBe(15);
    expect(parseTypedNumber(" 0.5 ")).toBe(0.5);
    expect(parseTypedNumber(".5")).toBe(0.5);
    expect(parseTypedNumber("−15%")).toBe(-15);
  });

  it("refuses anything that is not a plain decimal", () => {
    expect(parseTypedNumber("abc")).toBeNull();
    expect(parseTypedNumber("1e3")).toBeNull();
    expect(parseTypedNumber("")).toBeNull();
    expect(parseTypedNumber("1.2.3")).toBeNull();
    expect(parseTypedNumber("300 bps")).toBeNull();
  });
});

describe("parseMagnitude", () => {
  it("drops the sign a drop threshold is shown with", () => {
    expect(parseMagnitude("-20")).toBe(20);
    expect(parseMagnitude("−20%")).toBe(20);
    expect(parseMagnitude("x")).toBeNull();
  });
});

describe("parseBps", () => {
  it("treats a trailing percent as percent", () => {
    expect(parseBps("1.5%")).toBe(150);
    expect(parseBps("300")).toBe(300);
    expect(parseBps("300 bps")).toBe(300);
  });
});
