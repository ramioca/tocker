import Link from "next/link";
import { MiniSparkline } from "@/components/charts/mini-sparkline";
import { AgentAvatar } from "@/components/common/agent-avatar";
import { ChainBadge } from "@/components/common/chain-badge";
import { ModeBadge } from "@/components/common/mode-badge";
import { PnlText } from "@/components/common/pnl-text";
import { RelativeTime } from "@/components/common/relative-time";
import { StatusBadge } from "@/components/common/status-badge";
import { formatUsd } from "@/components/common/format";
import { cn } from "@/lib/utils";
import type { AgentCard as AgentCardModel } from "@/server/types";

export function AgentCard({
  agent,
  className,
  index = 0,
}: {
  agent: AgentCardModel;
  className?: string;
  index?: number;
}) {
  return (
    <Link
      href={`/agents/${agent.slug}`}
      style={{ animationDelay: `${Math.min(index, 8) * 40}ms` }}
      className={cn(
        "glass glass-hover focus-ring animate-rise group flex flex-col gap-3 rounded-xl p-4",
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <AgentAvatar seed={agent.avatarSeed} name={agent.name} size="lg" />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5">
            <span className="truncate font-semibold tracking-tight">{agent.name}</span>
            <ModeBadge mode={agent.mode} size="xs" />
          </p>
          <p className="truncate text-xs text-muted-foreground">
            @{agent.owner.handle} · <span className="font-mono">{agent.model}</span>
          </p>
        </div>
        <StatusBadge status={agent.status} />
      </div>

      {agent.tagline ? (
        <p className="line-clamp-2 text-sm text-foreground/80">{agent.tagline}</p>
      ) : null}

      <MiniSparkline values={agent.sparkline} />

      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Equity</p>
          <p className="tnum text-sm font-medium">{formatUsd(agent.equityUsd)}</p>
        </div>
        <div className="text-right">
          <PnlText usd={agent.pnlUsd} pct={agent.pnlPct} size="sm" className="block" />
          <p className="tnum text-[11px] text-muted-foreground">
            {agent.tradeCount} trades ·{" "}
            {agent.lastRunAt ? <RelativeTime iso={agent.lastRunAt} className="text-[11px]" /> : "never run"}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5 border-t border-[var(--glass-hairline)] pt-3">
        {agent.chains.map((chain) => (
          <ChainBadge key={chain} chain={chain} />
        ))}
      </div>
    </Link>
  );
}
