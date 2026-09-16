import Link from "next/link";
import { Activity, Users } from "lucide-react";
import type { AgentCard as AgentCardType } from "@/server/types";
import { AgentAvatar } from "@/components/social-common/agent-avatar";
import { ChainBadges, ModeBadge, ModelChip } from "@/components/social-common/chain-badge";
import { PnlText } from "@/components/social-common/pnl-text";
import { Sparkline } from "@/components/social-common/sparkline";
import { formatCount, formatUsd } from "@/components/social-common/format";

/**
 * `h-full` plus `mt-auto` on the footer: a one-line tagline and a two-line one
 * still produce a grid with a single baseline across the row.
 */
export function AgentGridCard({ agent }: { agent: AgentCardType }) {
  return (
    <article className="glass-card glass-hover group relative flex h-full flex-col rounded-2xl p-4">
      <div className="flex items-start gap-3">
        <AgentAvatar seed={agent.avatarSeed ?? agent.slug} label={agent.name} />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-medium">
            <Link
              href={`/agents/${agent.slug}`}
              className="rounded before:absolute before:inset-0 focus-ring"
            >
              {agent.name}
            </Link>
          </h3>
          <p className="truncate text-xs text-muted-foreground">
            by{" "}
            <span className="relative z-10 hover:text-foreground">@{agent.owner.handle}</span>
          </p>
        </div>
        <ModeBadge mode={agent.mode} />
      </div>

      {agent.tagline ? (
        <p className="mt-3 line-clamp-2 text-sm leading-6 text-muted-foreground">{agent.tagline}</p>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-1">
        <ChainBadges chains={agent.chains} />
        <ModelChip model={agent.model} />
      </div>

      <div className="mt-auto flex items-end justify-between gap-3 border-t border-[var(--glass-hairline)] pt-4">
        <div>
          <p className="font-mono text-[10px] tracking-wide text-muted-foreground uppercase">
            All-time
          </p>
          <PnlText pct={agent.pnlPct} size="lg" />
          <p className="font-mono text-[11px] tabular-nums text-muted-foreground">
            {formatUsd(agent.equityUsd, { compact: true })} equity ·{" "}
            {formatCount(agent.tradeCount)} trades
          </p>
        </div>
        <Sparkline
          id={`grid-${agent.id}`}
          points={agent.sparkline}
          pnl={agent.pnlPct}
          width={84}
          height={34}
          className="shrink-0"
        />
      </div>

      <div className="mt-3 flex items-center gap-3 font-mono text-[11px] tabular-nums text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <Users className="size-3" aria-hidden />
          {formatCount(agent.followerCount)}
        </span>
        <span className="inline-flex items-center gap-1">
          <Activity className="size-3" aria-hidden />
          {formatCount(agent.tradeCount)}
        </span>
        <span className="ml-auto relative z-10 text-primary opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100">
          Open →
        </span>
      </div>
    </article>
  );
}
