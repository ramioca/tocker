/**
 * Who is holding this token right now, and how that is going for them.
 *
 * Public by design: positions and PnL are the record. What is absent is any hint
 * of *why* — no score threshold, no universe rule, no rationale beyond the trade
 * rows further down the page.
 *
 * Private agents appear only for their own owner (the query decides; this just
 * renders what it was handed).
 *
 * The name gets the row's width. It used to share one line with the mode badge, the
 * value and a fixed-width PnL, and in the 22rem desktop column that left
 * "Narrative Vel…". The count lives in the section heading, not in an avatar stack
 * restating the rows under it.
 */
import Link from "next/link";
import { Users } from "lucide-react";
import { AgentAvatar } from "@/components/common/agent-avatar";
import { EmptyState } from "@/components/common/empty-state";
import { ModeBadge } from "@/components/common/mode-badge";
import { PnlText } from "@/components/common/pnl-text";
import { formatUsd } from "@/components/common/format";
import type { AgentMode, TokenPage } from "@/server/types";

type Holder = TokenPage["holders"][number];

/** The one mode every holder shares, or null when they differ (or there are none). */
export function sharedHolderMode(holders: readonly Holder[]): AgentMode | null {
  const first = holders[0]?.agent.mode;
  if (!first) return null;
  return holders.every((holder) => holder.agent.mode === first) ? first : null;
}

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

  // Shared by all of them → the heading carries one badge (page.tsx) instead of a row each.
  const perRowMode = sharedHolderMode(holders) === null;

  return (
    <div className="overflow-hidden rounded-2xl border border-border/80 bg-card/40">
      <ul className="divide-y divide-border/60">
        {holders.map((holder) => (
          <li key={holder.agent.id}>
            <Link
              href={`/agents/${holder.agent.slug}`}
              className="flex items-center gap-3 px-3 py-2.5 transition-colors duration-150 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset sm:px-4"
            >
              <AgentAvatar seed={holder.agent.avatarSeed} name={holder.agent.name} size="sm" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{holder.agent.name}</span>
                {perRowMode ? (
                  <span className="mt-0.5 flex">
                    <ModeBadge mode={holder.agent.mode} size="xs" />
                  </span>
                ) : null}
              </span>
              <span className="flex shrink-0 flex-col items-end">
                <span className="tnum text-xs text-muted-foreground">
                  {formatUsd(holder.valueUsd, { compact: true })}
                </span>
                <PnlText pct={holder.unrealizedPnlPct} dp={1} size="xs" />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
