import { CalendarRange } from "lucide-react";
import { CalendarHeatmap } from "@/components/spectrumui/charts/calendar-heatmap";
import { EmptyState } from "@/components/common/empty-state";

/** 26 weeks: 27 week-columns at most, which fit a 320px phone at 8px cells. */
const PHONE_DAYS = 26 * 7;

/**
 * Trades per day for the last year, over the same agents the profile header counts.
 *
 * The empty state has to agree with the header above it. It used to say "hasn't run
 * an agent yet" directly under "2 agents · 72 trades", so it only claims that when the
 * header shows no agents — and a visitor never sees private agents, so it says
 * "published", not "run".
 *
 * Two copies of the grid, one per breakpoint. A year of weeks is 53 columns, which at
 * the heatmap's 6px minimum cell is ~450px: on a phone that scrolled sideways from the
 * year-old end, so the recent fills sat off-screen and the grid looked empty under a
 * header counting 72 trades. The phone gets the last 26 weeks, which fit at 8px cells
 * from a 320px screen up. The copy hidden with `display: none` measures zero and draws
 * nothing until its breakpoint shows it.
 */
export function ActivityPanel({
  data,
  handle,
  isSelf = false,
  agentCount,
  tradeCount,
}: {
  data: Array<{ t: number; value: number }>;
  handle: string;
  isSelf?: boolean;
  agentCount: number;
  tradeCount: number;
}) {
  const total = data.reduce((sum, day) => sum + day.value, 0);
  const recent = data.slice(-PHONE_DAYS);
  // Never an empty grid on a phone: with no fills in the last six months it keeps the
  // whole year and scrolls, rather than drawing 26 weeks of nothing.
  const phoneData = recent.some((day) => day.value > 0) ? recent : data;

  if (total === 0) {
    return (
      <EmptyState
        icon={<CalendarRange />}
        title={tradeCount > 0 ? "No fills in the last year" : "No trading days yet"}
        description={
          tradeCount > 0
            ? "Every trade on record is older than a year. The heatmap fills in one square per day of fills."
            : agentCount > 0
              ? `${isSelf ? "Your agents haven't" : `@${handle}'s agents haven't`} filled a trade yet. The heatmap fills in one square per day of fills.`
              : `${isSelf ? "You haven't built an agent" : `@${handle} hasn't published an agent`} yet, so there is nothing to plot.`
        }
      />
    );
  }

  return (
    <div className="glass-panel rounded-2xl p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-medium">Trading activity</h3>
        {/* The range, not the total: the grid prints the total and the streaks itself. */}
        <p className="text-xs text-muted-foreground">
          <span className="sm:hidden">{phoneData === data ? "Last 12 months" : "Last 6 months"}</span>
          <span className="max-sm:hidden">Last 12 months</span>
        </p>
      </div>
      <div className="mt-4">
        <div className="sm:hidden">
          <CalendarHeatmap
            data={phoneData}
            label="trades"
            rangeLabel={phoneData === data ? "over the last year" : "over the last 6 months"}
            hue="var(--primary)"
            cell={12}
          />
        </div>
        {/* `cell` is a ceiling: the heatmap sizes cells from its measured width up to it.
            At 12 a year of weeks stopped at three-quarters of a desktop card; at 16 it
            fills the card at 1440 and still shrinks to fit a tablet. */}
        <div className="max-sm:hidden">
          <CalendarHeatmap data={data} label="trades" hue="var(--primary)" cell={16} />
        </div>
      </div>
    </div>
  );
}
