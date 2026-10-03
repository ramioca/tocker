import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MIN_PRICE_AXIS_PAD_LEFT, priceAxisPadLeft, priceAxisRange, pricePointsFrom } from "./price-points";
import type { ScoreHistoryPoint } from "@/server/types";

const here = join(process.cwd(), "src", "components", "trading");

function point(at: string, priceUsd: number | null): ScoreHistoryPoint {
  return { at, total: 50, verdict: "watch", priceUsd } as ScoreHistoryPoint;
}

describe("pricePointsFrom", () => {
  it("keeps only finite positive prices, in the order given", () => {
    expect(
      pricePointsFrom([
        point("2026-01-01T00:00:00.000Z", 1.5),
        point("2026-01-02T00:00:00.000Z", null),
        point("2026-01-03T00:00:00.000Z", 0),
        point("2026-01-04T00:00:00.000Z", Number.NaN),
        point("2026-01-05T00:00:00.000Z", 2.25),
      ]),
    ).toEqual([
      { at: "2026-01-01T00:00:00.000Z", priceUsd: 1.5 },
      { at: "2026-01-05T00:00:00.000Z", priceUsd: 2.25 },
    ]);
  });

  it("is empty for empty history", () => {
    expect(pricePointsFrom([])).toEqual([]);
  });
});

/**
 * The RSC boundary regression. `/tokens/[chain]/[address]/page.tsx` is a server component
 * that calls `pricePointsFrom`; when that helper lived in the `"use client"` chart module
 * the production build handed the page a client *reference* instead of a function and the
 * page 500'd on every token — with `typecheck` and `build` both green, because the
 * boundary is a runtime fact. These assertions are the cheap guard that catches a
 * re-introduction in review rather than in production.
 */
describe("the server/client boundary around the helper", () => {
  it("price-points.ts carries no 'use client' directive and imports no React", () => {
    const source = readFileSync(join(here, "price-points.ts"), "utf8");
    // A directive only counts at the very top of the module — that is the only place
    // the bundler reads it, and the only place we need to keep clear.
    expect(source.trimStart()).not.toMatch(/^["']use client["']/);
    expect(source).not.toMatch(/from ["']react["']/);
  });

  it("the client barrel does not re-export the helper", () => {
    const barrel = readFileSync(join(here, "index.ts"), "utf8");
    // A bare mention in the explanatory comment is fine; an `export` of it is not.
    const exportLines = barrel
      .split("\n")
      .filter((line) => /^\s*export\b/.test(line) || /^\s{2}\w+,\s*$/.test(line));
    expect(exportLines.join("\n")).not.toMatch(/pricePointsFrom/);
  });

  it("the token page imports the helpers from the server-safe module", () => {
    const page = readFileSync(
      join(process.cwd(), "src", "app", "(client)", "(app)", "tokens", "[chain]", "[address]", "page.tsx"),
      "utf8",
    );
    for (const helper of ["pricePointsFrom", "priceAxisPadLeft"]) {
      expect(page).toMatch(
        new RegExp(`import \\{[^}]*\\b${helper}\\b[^}]*\\} from "@/components/trading/price-points"`),
      );
      expect(page).not.toMatch(new RegExp(`import \\{[^}]*\\b${helper}\\b[^}]*\\} from "@/components/trading"`));
    }
  });
});

describe("priceAxisRange", () => {
  it("pads the plotted range by 8% and never goes below zero", () => {
    expect(priceAxisRange([1, 2])).toEqual({ yLo: 1 - 0.08, yHi: 2 + 0.08 });
    expect(priceAxisRange([0.01, 1])?.yLo).toBe(0);
  });

  it("is null with nothing to plot", () => {
    expect(priceAxisRange([])).toBeNull();
    expect(priceAxisRange([0, Number.NaN])).toBeNull();
  });
});

describe("priceAxisPadLeft", () => {
  it("keeps the old 44px for ordinary prices, so the charts still line up", () => {
    expect(priceAxisPadLeft([{ priceUsd: 1.2 }, { priceUsd: 1.5 }])).toBe(MIN_PRICE_AXIS_PAD_LEFT);
    expect(priceAxisPadLeft([])).toBe(MIN_PRICE_AXIS_PAD_LEFT);
  });

  it("widens for a micro-cap's long labels", () => {
    // "$0.0000334"-style labels are ten characters and more; 44px holds about six.
    const pad = priceAxisPadLeft([{ priceUsd: 0.0000313 }, { priceUsd: 0.0000318 }]);
    expect(pad).toBeGreaterThanOrEqual(10 * 5.4 + 6);
  });

  it("counts the markers, which can sit outside the sampled prices", () => {
    const withoutMarker = priceAxisPadLeft([{ priceUsd: 1.2 }, { priceUsd: 1.5 }]);
    // A fill far above every sampled price stretches the top label to "$1,333,333.33".
    const withMarker = priceAxisPadLeft([{ priceUsd: 1.2 }, { priceUsd: 1.5 }], [{ priceUsd: 1_234_567 }]);
    expect(withMarker).toBeGreaterThan(withoutMarker);
  });
});
