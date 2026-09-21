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
