/**
 * 30-day agent flow: buys, sells, and the net dollars that moved.
 *
 * Net flow is the only number on a token page that describes the crowd rather
 * than the token, which is why it is stated in dollars and not as a ratio: "nine
 * buys" is meaningless when eight of them were $20 and the sell was $4,000.
 *
 * Green and red are reserved for PnL, so flow direction is spelled out in words.
 */
import { formatUsd } from "@/components/common/format";
import type { TokenPage } from "@/server/types";
import { cn } from "@/lib/utils";

export function FlowStats({ stats, className }: { stats: TokenPage["stats"]; className?: string }) {
  // No agent fills in the window: three zeros and "flat" say nothing the empty trade
  // list below does not already say.
  if (stats.agentBuys30d + stats.agentSells30d === 0) return null;

  const net = stats.netFlowUsd30d;
  const direction = net > 0 ? "accumulating" : net < 0 ? "distributing" : "flat";

  // Three, not four: a "Fills" card was only buys plus sells, restated.
  return (
    <dl className={cn("grid grid-cols-2 gap-2.5 sm:grid-cols-3", className)}>
      <Card label="Agent buys" value={String(stats.agentBuys30d)} hint="last 30 days" />
      <Card label="Agent sells" value={String(stats.agentSells30d)} hint="last 30 days" />
      {/* Full width on a phone, so two-up leaves no hole beside it. */}
      <Card
        label="Net flow"
        value={formatUsd(net, { compact: true })}
        hint={direction}
        className="max-sm:col-span-2"
      />
    </dl>
  );
}

function Card({ label, value, hint, className }: { label: string; value: string; hint: string; className?: string }) {
  return (
    <div className={cn("rounded-xl border border-border/70 bg-card/40 px-3 py-2.5", className)}>
      <dt className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">{label}</dt>
      <dd className="mt-1">
        <span className="tnum block text-lg leading-none font-semibold">{value}</span>
        <span className="mt-1 block text-[10px] font-normal text-muted-foreground">{hint}</span>
      </dd>
    </div>
  );
}
