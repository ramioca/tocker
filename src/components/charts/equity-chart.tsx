import { PortfolioChart } from "@/components/spectrumui/charts/portfolio-chart";
import { EmptyState } from "@/components/common/empty-state";
import type { MarketRange } from "@/components/spectrumui/charts/chart-engine";
import type { EquityPoint } from "@/server/types";

const DAY = 86_400_000;

/**
 * Equity against the capital that was put in, with drawdown from the running
 * peak shaded underneath — the two numbers that decide whether an agent is
 * worth following.
 *
 * The range selector lives inside the Spectrum chart and slices by point count,
 * so the windows are derived from the timestamps rather than guessed. The series is
 * hourly for its last week (getEquitySeries), so 24H is a day hour by hour; times are
 * printed in `timeZone`, the viewer's when the page knows it.
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

  const latest = data[data.length - 1].t;
  const countWithin = (ms: number) => data.filter((point) => point.t >= latest - ms).length;

  const ranges: MarketRange[] = [
    { label: "24H", bars: Math.max(2, countWithin(DAY)) },
    { label: "7D", bars: Math.max(2, countWithin(7 * DAY)) },
    { label: "30D", bars: Math.max(2, countWithin(30 * DAY)) },
    { label: "ALL", bars: null },
  ];

  return (
    <PortfolioChart
      data={data}
      ranges={ranges}
      defaultRange="30D"
      label={label}
      height={height}
      showDrawdown
      timeZone={timeZone}
    />
  );
}
