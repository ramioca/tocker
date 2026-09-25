import { describe, expect, it } from "vitest";
import { sanitizeUsdInput } from "./usd-input";

describe("sanitizeUsdInput", () => {
  it("keeps plain amounts as typed", () => {
    expect(sanitizeUsdInput("")).toBe("");
    expect(sanitizeUsdInput("12")).toBe("12");
    expect(sanitizeUsdInput("12.")).toBe("12.");
    expect(sanitizeUsdInput(".5")).toBe(".5");
    expect(sanitizeUsdInput("12.34")).toBe("12.34");
  });

  it("caps at cents, so the amount shown is the amount sent", () => {
    expect(sanitizeUsdInput("12.3456789")).toBe("12.34");
  });

  it("ignores a second decimal point and whatever follows it", () => {
    expect(sanitizeUsdInput("1.2.")).toBe("1.2");
    expect(sanitizeUsdInput("1.2.3")).toBe("1.2");
    expect(sanitizeUsdInput("1..5")).toBe("1.");
  });

  it("drops currency symbols, separators and letters from a paste", () => {
    expect(sanitizeUsdInput("$1,234.50")).toBe("1234.50");
    expect(sanitizeUsdInput(" 20 USDC")).toBe("20");
    expect(sanitizeUsdInput("-5")).toBe("5");
  });
});
