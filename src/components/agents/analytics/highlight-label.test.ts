import { describe, expect, it } from "vitest";
import { highlightLabel } from "./highlight-label";

describe("highlightLabel", () => {
  it("keeps the slot's label and tone when the sign agrees", () => {
    expect(highlightLabel("best", 42)).toEqual({ label: "Best exit", tone: "positive" });
    expect(highlightLabel("worst", -323.78)).toEqual({ label: "Worst exit", tone: "negative" });
  });

  it("never paints a loss as the best exit", () => {
    expect(highlightLabel("best", -11.22)).toEqual({ label: "Smallest loss", tone: "neutral" });
  });

  it("never paints a win as the worst exit", () => {
    expect(highlightLabel("worst", 3)).toEqual({ label: "Smallest win", tone: "neutral" });
  });

  it("keeps break-even and unknown PnL quiet", () => {
    expect(highlightLabel("best", 0)).toEqual({ label: "Best exit", tone: "neutral" });
    expect(highlightLabel("worst", null)).toEqual({ label: "Worst exit", tone: "neutral" });
  });

  it("tones a lone exit by its own sign", () => {
    expect(highlightLabel("only", 5).tone).toBe("positive");
    expect(highlightLabel("only", -5).tone).toBe("negative");
    expect(highlightLabel("only", null)).toEqual({ label: "Only exit", tone: "neutral" });
  });
});
