/**
 * Where the money came from: by chain, and by who pulled the trigger.
 *
 * `byOrigin` only becomes interesting once something other than the agent itself
 * can trade — the exit engine (`guardian`) and the owner (`manual`). Until then it
 * is one row saying "agent", which is honest and cheap, so it is shown rather than
 * hidden behind a feature flag.
 */
import { formatSignedUsd } from "@/components/common/format";
import { chainLabel } from "@/components/common/chain-badge";
import type { AgentAnalytics, TradeOrigin } from "@/server/types";
import { cn } from "@/lib/utils";

const ORIGIN_LABEL: Record<TradeOrigin, string> = {
  agent: "The agent",
  guardian: "Exit engine",
  manual: "You, by hand",
  mirror: "Mirrored",
};

export function SplitTables({ analytics }: { analytics: AgentAnalytics }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Split
        heading="By chain"
        empty="Nothing closed yet."
        rows={analytics.byChain.map((row) => ({
          key: row.chain,
          label: chainLabel(row.chain),
          trades: row.trades,
          pnlUsd: row.pnlUsd,
        }))}
      />
      <Split
        heading="By who traded"
        empty="Nothing closed yet."
        rows={analytics.byOrigin.map((row) => ({
          key: row.origin,
          label: ORIGIN_LABEL[row.origin],
          trades: row.trades,
          pnlUsd: row.pnlUsd,
        }))}
      />
    </div>
  );
}

function Split({
  heading,
  rows,
  empty,
}: {
  heading: string;
  rows: Array<{ key: string; label: string; trades: number; pnlUsd: number }>;
  empty: string;
}) {
  return (
    <section className="glass-panel rounded-2xl p-3 sm:p-4">
      <h3 className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{heading}</h3>
      {rows.length === 0 ? (
        <p className="mt-3 text-xs text-muted-foreground">{empty}</p>
      ) : (
        <ul className="mt-2.5 divide-y divide-border/50">
          {rows.map((row) => (
            <li key={row.key} className="flex items-baseline gap-2 py-1.5">
              <span className="min-w-0 flex-1 truncate text-xs">{row.label}</span>
              <span className="tnum w-16 shrink-0 text-right font-mono text-[11px] text-muted-foreground">
                {row.trades} exit{row.trades === 1 ? "" : "s"}
              </span>
              <span
                className={cn(
                  "tnum w-20 shrink-0 text-right font-mono text-xs",
                  row.pnlUsd > 0 ? "text-positive" : row.pnlUsd < 0 ? "text-negative" : "text-muted-foreground",
                )}
              >
                {formatSignedUsd(row.pnlUsd)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
