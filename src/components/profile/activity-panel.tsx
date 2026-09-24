import { CalendarRange } from "lucide-react";
import { CalendarHeatmap } from "@/components/spectrumui/charts/calendar-heatmap";
import { EmptyState } from "@/components/common/empty-state";

/**
 * Trades per day for the last year, over the same agents the profile header counts.
 *
 * The empty state has to agree with the header above it. It used to say "hasn't run
 * an agent yet" directly under "2 agents · 72 trades", so it only claims that when the
 * header shows no agents — and a visitor never sees private agents, so it says
 * "published", not "run".
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
  const activeDays = data.filter((day) => day.value > 0).length;

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
        <p className="font-mono text-xs tabular-nums text-muted-foreground">
          {total.toLocaleString("en-US")} trades across {activeDays} active days
        </p>
      </div>
      <div className="mt-4 overflow-x-auto">
        <CalendarHeatmap data={data} label="trades" hue="var(--primary)" cell={12} />
      </div>
    </div>
  );
}
