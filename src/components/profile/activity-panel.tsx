import { CalendarRange } from "lucide-react";
import { CalendarHeatmap } from "@/components/spectrumui/charts/calendar-heatmap";
import { EmptyState } from "@/components/common/empty-state";

/**
 * Trades per day for the last year.
 *
 * There is no query for this yet — the page passes mock data. See the report:
 * `getUserTradeActivity(handle, days)` → `Array<{ t: number; value: number }>`.
 */
export function ActivityPanel({
  data,
  handle,
}: {
  data: Array<{ t: number; value: number }>;
  handle: string;
}) {
  const total = data.reduce((sum, day) => sum + day.value, 0);
  const activeDays = data.filter((day) => day.value > 0).length;

  if (total === 0) {
    return (
      <EmptyState
        icon={<CalendarRange />}
        title="No trading days yet"
        description={`@${handle} hasn't run an agent yet, so there is nothing to plot. The heatmap fills in one square per day of fills.`}
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
