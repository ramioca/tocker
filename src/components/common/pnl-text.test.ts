import { describe, expect, it } from "vitest";
import { pnlTone } from "./pnl-text";

describe("pnlTone", () => {
  it("colours what is printed when given the precision", () => {
    expect(pnlTone(-0.03, 1)).toBe("text-muted-foreground");
    expect(pnlTone(-0.06, 1)).toBe("text-negative");
    expect(pnlTone(0.4, 0)).toBe("text-muted-foreground");
  });

  it("keeps the raw sign without one", () => {
    expect(pnlTone(-0.03)).toBe("text-negative");
    expect(pnlTone(2)).toBe("text-positive");
    expect(pnlTone(0)).toBe("text-muted-foreground");
    expect(pnlTone(null)).toBe("text-muted-foreground");
  });
});
