/**
 * The six numbers that describe a record. Static, tabular, no motion — this is a
 * row people scan, and a value that animates every time a window switches is a
 * value you cannot read.
 *
 * Max drawdown is stated as a positive percentage and deliberately not coloured:
 * every strategy has one, and painting it red would say "loss" when it says
 * "volatility".
 */
import { formatPct, formatSignedUsd, formatUsd } from "@/components/common/format";
import { formatHours } from "@/components/tokens/format";
import type { AgentAnalytics } from "@/server/types";
import { cn } from "@/lib/utils";

export function AnalyticsStats({ analytics }: { analytics: AgentAnalytics }) {
  const cards: Array<{ label: string; value: string; hint: string; tone?: number | null }> = [
    {
      label: "Realized",
      value: formatSignedUsd(analytics.realizedPnlUsd),
      hint: "booked on exits",
      tone: analytics.realizedPnlUsd,
    },
    {
      label: "Unrealized",
      value: formatSignedUsd(analytics.unrealizedPnlUsd),
      hint: "open positions, marked now",
      tone: analytics.unrealizedPnlUsd,
    },
    {
      label: "Win rate",
      value: analytics.winRate === null ? "—" : formatPct(analytics.winRate * 100, 0),
      hint: "of closed exits",
    },
    {
      label: "Avg hold",
      value: analytics.avgHoldHours === null ? "—" : formatHours(Math.round(analytics.avgHoldHours)),
      hint: "entry to exit, FIFO",
    },
    {
      label: "Max drawdown",
      value: analytics.maxDrawdownPct === null ? "—" : formatPct(analytics.maxDrawdownPct, 1),
      hint: "peak to trough equity",
    },
    {
      label: "Data spend",
      value: formatUsd(analytics.dataSpendUsd),
      hint: "x402, this window",
    },
  ];

  return (
    <dl className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
      {cards.map((card) => (
        <div key={card.label} className="glass-inset rounded-xl px-3 py-2.5">
          <dt className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
            {card.label}
          </dt>
          <dd
            className={cn(
              "tnum mt-1 text-base leading-none font-semibold",
              card.tone === undefined || card.tone === null || card.tone === 0
                ? undefined
                : card.tone > 0
                  ? "text-positive"
                  : "text-negative",
            )}
          >
            {card.value}
          </dd>
          <p className="mt-1 text-[10px] leading-tight text-muted-foreground">{card.hint}</p>
        </div>
      ))}
    </dl>
  );
}
