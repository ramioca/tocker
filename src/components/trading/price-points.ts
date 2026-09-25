import { formatUsd } from "@/components/common/format";
import type { ScoreHistoryPoint } from "@/server/types";

/**
 * The price series a chart draws, and the one function that derives it.
 *
 * ## Why this is its own module
 *
 * `price-chart.tsx` is a `"use client"` module. A server component that imports *any*
 * export from a client module — even a pure function with no hooks — pulls the client
 * reference proxy, not the function: in a production build the import resolves to a
 * module-reference object and calling it throws at render time. `/tokens/[chain]/[address]`
 * did exactly that (server page → barrel → `price-chart.tsx` → `pricePointsFrom`) and
 * 500'd on every token, with `typecheck` and `build` both clean, because the boundary is
 * a runtime fact and not a type.
 *
 * So the helper lives here, with no `"use client"` and no React, and both sides import it
 * from this file. It is deliberately **not** re-exported from `@/components/trading`: the
 * barrel's other exports are client components, so a server importer that reaches for the
 * helper through the barrel would be right back in the trap. `price-points.test.ts` asserts
 * both halves of that — this module is directive-free, and the barrel does not name it.
 */
export interface PricePoint {
  at: string;
  priceUsd: number;
}

/** Price points from score history — the series we already store for every token. */
export function pricePointsFrom(history: readonly ScoreHistoryPoint[]): PricePoint[] {
  return history.flatMap((p) =>
    p.priceUsd !== null && Number.isFinite(p.priceUsd) && p.priceUsd > 0
      ? [{ at: p.at, priceUsd: p.priceUsd }]
      : [],
  );
}

/**
 * The price range the chart plots and labels: every price it draws, padded 8% so the
 * line never touches the top or bottom edge. Null when there is nothing to plot.
 */
export function priceAxisRange(prices: readonly number[]): { yLo: number; yHi: number } | null {
  const valid = prices.filter((price) => Number.isFinite(price) && price > 0);
  if (valid.length === 0) return null;
  const lo = Math.min(...valid);
  const hi = Math.max(...valid);
  const pad = (hi - lo) * 0.08 || hi * 0.08 || 1;
  return { yLo: Math.max(0, lo - pad), yHi: hi + pad };
}

/** The floor: what the axis always had, and what the score chart under it uses. */
export const MIN_PRICE_AXIS_PAD_LEFT = 44;
/** A 9px mono glyph is about 5.4px wide; a little over, so a label never touches the edge. */
const AXIS_CHAR_PX = 5.6;
/** The labels sit 6px left of the plot; the rest is breathing room from the card edge. */
const AXIS_GAP_PX = 10;

/**
 * How much room the price axis needs on the left for its two labels.
 *
 * A fixed 44px fits "$1.23" but not a micro-cap's "$0.00000065", which ran past the card
 * edge on a phone and lost its "$". Pass the same points and markers the chart gets; a
 * page that draws a second chart under it passes the result to both, so the two plots
 * keep one x range.
 */
export function priceAxisPadLeft(
  points: readonly { priceUsd: number }[],
  markers: readonly { priceUsd: number }[] = [],
): number {
  const range = priceAxisRange([...points, ...markers].map((point) => point.priceUsd));
  if (!range) return MIN_PRICE_AXIS_PAD_LEFT;
  const longest = Math.max(formatUsd(range.yHi).length, formatUsd(range.yLo).length);
  return Math.max(MIN_PRICE_AXIS_PAD_LEFT, Math.ceil(longest * AXIS_CHAR_PX) + AXIS_GAP_PX);
}
