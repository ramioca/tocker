import type { MarketRange } from "@/components/spectrumui/charts/chart-engine";

const DAY = 86_400_000;

/** The equity chart's windows, shortest first; ALL follows them. */
const WINDOWS: ReadonlyArray<readonly [label: string, ms: number]> = [
  ["24H", DAY],
  ["7D", 7 * DAY],
  ["30D", 30 * DAY],
];

/**
 * The equity chart's range selector, from the series' own timestamps (sorted, oldest
 * first). The Spectrum chart slices by point count, so each window is counted, not
 * guessed, back from the latest point.
 *
 * A window that holds fewer than two points is left out rather than stretched: a
 * stopped agent's "24H" would otherwise be its last two points, however many days
 * apart. The chart opens on the shortest window that holds the whole history, so a
 * day-old agent opens on 24H rather than on a "30D" that shows one day; a longer
 * history opens on 30D, as it always has.
 */
export function equityRanges(ts: readonly number[]): { ranges: MarketRange[]; defaultRange: string } {
  const latest = ts[ts.length - 1] ?? 0;
  const ranges: MarketRange[] = [];
  for (const [label, ms] of WINDOWS) {
    const bars = ts.filter((t) => t >= latest - ms).length;
    if (bars >= 2) ranges.push({ label, bars });
  }
  ranges.push({ label: "ALL", bars: null });
  const whole = ranges.find((range) => range.bars !== null && range.bars >= ts.length);
  const defaultRange = whole?.label ?? (ranges.some((range) => range.label === "30D") ? "30D" : "ALL");
  return { ranges, defaultRange };
}
