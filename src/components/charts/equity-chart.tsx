import { PortfolioChart } from "@/components/spectrumui/charts/portfolio-chart";
import { EmptyState } from "@/components/common/empty-state";
import type { EquityPoint } from "@/server/types";
import { equityRanges } from "./equity-ranges";

/**
 * Equity against the capital that was put in, with drawdown from the running
 * peak shaded underneath — the two numbers that decide whether an agent is
 * worth following.
 *
 * The ranges (24H, 7D, 30D, ALL) come from the series' own timestamps; see
 * equityRanges. Times are printed in `timeZone`, the viewer's when the page has their
 * zone cookie, and in the browser's own zone once the chart has hydrated.
 */
export function EquityChart({
  points,
  startingUsd,
  label = "Equity",
  height = 320,
  timeZone,
}: {
  points: EquityPoint[];
  startingUsd: number;
  label?: string;
  height?: number;
  timeZone?: string;
}) {
  if (points.length < 2) {
    return (
      <EmptyState
        title="No equity history yet"
        description="The chart fills in after the agent's first run takes a snapshot."
      />
    );
  }

  const data = points.map((point) => ({
    t: new Date(point.at).getTime(),
    value: point.equityUsd,
    basis: startingUsd,
  }));

  const { ranges, defaultRange } = equityRanges(data.map((point) => point.t));

  return (
    <PortfolioChart
      data={data}
      ranges={ranges}
      defaultRange={defaultRange}
      label={label}
      height={height}
      showDrawdown
      timeZone={timeZone}
      followViewer
    />
  );
}
