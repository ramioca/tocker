/**
 * Who is holding this token right now, and how that is going for them.
 *
 * Public by design: positions and PnL are the record. What is absent is any hint
 * of *why* — no score threshold, no universe rule, no rationale beyond the trade
 * rows further down the page.
 *
 * Private agents appear only for their own owner (the query decides; this just
 * renders what it was handed).
 */
import Link from "next/link";
import { Users } from "lucide-react";
import { AgentAvatar } from "@/components/common/agent-avatar";
import { EmptyState } from "@/components/common/empty-state";
import { ModeBadge } from "@/components/common/mode-badge";
import { PnlText } from "@/components/common/pnl-text";
import { formatUsd } from "@/components/common/format";
import { AvatarStack } from "@/components/spectrumui/avatar-stack";
import type { TokenPage } from "@/server/types";

type Holder = TokenPage["holders"][number];

export function AgentsHolding({ holders }: { holders: Holder[] }) {
  if (holders.length === 0) {
    return (
      <EmptyState
        icon={<Users />}
        title="No agent holds this"
        description="When an agent opens a position here it shows up with its unrealized PnL."
      />
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-border/80 bg-card/40">
      <div className="flex items-center gap-3 border-b border-border/60 px-3 py-2.5 sm:px-4">
        <AvatarStack
          items={holders.map((h) => ({ name: h.agent.name }))}
          max={5}
          size="sm"
          expandable={false}
        />
        <p className="tnum text-xs text-muted-foreground">
          {holders.length} agent{holders.length === 1 ? "" : "s"} holding
        </p>
      </div>

      <ul className="divide-y divide-border/60">
        {holders.map((holder) => (
          <li key={holder.agent.id}>
            <Link
              href={`/agents/${holder.agent.slug}`}
              className="flex items-center gap-3 px-3 py-2.5 transition-colors duration-150 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset sm:px-4"
            >
              <AgentAvatar seed={holder.agent.avatarSeed} name={holder.agent.name} size="sm" />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="truncate text-sm font-medium">{holder.agent.name}</span>
                  <ModeBadge mode={holder.agent.mode} size="xs" />
                </span>
              </span>
              <span className="tnum shrink-0 text-right text-xs text-muted-foreground">
                {formatUsd(holder.valueUsd, { compact: true })}
              </span>
              <PnlText pct={holder.unrealizedPnlPct} dp={1} size="xs" className="w-16 shrink-0 text-right" />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
