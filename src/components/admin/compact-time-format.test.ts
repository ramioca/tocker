import { describe, expect, it } from "vitest";
import { formatCompactTime } from "./compact-time-format";

describe("formatCompactTime", () => {
  it("keeps the day and a zero-padded 24-hour minute", () => {
    expect(formatCompactTime("2026-09-25T06:38:41Z", "UTC")).toBe("Sep 25, 06:38");
    expect(formatCompactTime("2026-09-25T18:05:00Z", "UTC")).toBe("Sep 25, 18:05");
  });

  it("reads midnight as 00, not 24", () => {
    expect(formatCompactTime("2026-09-25T00:07:00Z", "UTC")).toBe("Sep 25, 00:07");
  });

  it("says a bad timestamp is missing rather than Invalid Date", () => {
    expect(formatCompactTime("nope")).toBe("—");
  });
});
