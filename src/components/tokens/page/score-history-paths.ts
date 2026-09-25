import type { ScoreHistoryPoint } from "@/server/types";

/**
 * A reading where no provider answered: no price, no liquidity, no holder count. Its
 * total is whatever the scorer makes of nothing — usually 0 — so drawn as a point it is
 * a vertical crash to the floor that never happened. It is a gap in the record.
 */
export function isNoDataReading(point: Pick<ScoreHistoryPoint, "priceUsd" | "liquidityUsd" | "holderCount">): boolean {
  return point.priceUsd === null && point.liquidityUsd === null && point.holderCount === null;
}

interface Coord {
  cx: number;
  cy: number;
  gap: boolean;
}

/**
 * SVG paths for a line broken at gaps: each run of real readings is its own `M…L…`
 * segment and its own closed area down to `baseline`. A run of one point has no line to
 * draw, so it comes back in `lone` to be drawn as a dot instead of vanishing.
 */
export function scorePaths(coords: readonly Coord[], baseline: number): {
  line: string;
  area: string;
  lone: Array<{ cx: number; cy: number }>;
} {
  const runs: Coord[][] = [];
  let run: Coord[] = [];
  for (const coord of coords) {
    if (coord.gap) {
      if (run.length > 0) runs.push(run);
      run = [];
    } else {
      run.push(coord);
    }
  }
  if (run.length > 0) runs.push(run);

  const n = (value: number) => value.toFixed(2);
  const drawn = runs.filter((r) => r.length > 1);
  const segments = drawn.map((r) => r.map((p, i) => `${i === 0 ? "M" : "L"}${n(p.cx)},${n(p.cy)}`).join(" "));
  return {
    line: segments.join(" "),
    area: drawn
      .map((r, i) => `${segments[i]} L${n(r[r.length - 1].cx)},${n(baseline)} L${n(r[0].cx)},${n(baseline)} Z`)
      .join(" "),
    lone: runs.filter((r) => r.length === 1).map(([p]) => ({ cx: p.cx, cy: p.cy })),
  };
}
