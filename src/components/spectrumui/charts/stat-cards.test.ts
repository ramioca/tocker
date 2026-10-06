import { describe, expect, it } from "vitest";
import { deltaPercentText } from "./stat-cards";

describe("deltaPercentText", () => {
  it("does not round a move under half a percent to nothing", () => {
    // $121 down on $25,000: the Equity card read "↓ 0% vs start".
    expect(deltaPercentText(-0.4855)).toBe("0.49");
    expect(deltaPercentText(0.05)).toBe("0.05");
  });

  it("keeps two decimals under ten percent, as the chart beside it does", () => {
    expect(deltaPercentText(8.83)).toBe("8.83");
    expect(deltaPercentText(-3.2)).toBe("3.20");
  });

  it("is a whole percent from ten up", () => {
    expect(deltaPercentText(12.4)).toBe("12");
    expect(deltaPercentText(-250.6)).toBe("251");
    // Rounds to ten, so it is printed as ten.
    expect(deltaPercentText(9.996)).toBe("10");
  });

  it("carries no sign: the arrow beside it says which way", () => {
    expect(deltaPercentText(-0.49)).toBe(deltaPercentText(0.49));
    expect(deltaPercentText(0)).toBe("0.00");
  });
});
