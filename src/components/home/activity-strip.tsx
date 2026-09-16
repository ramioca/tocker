import Link from "next/link";
import { Activity, ArrowDownRight, ArrowUpRight, Gavel, ShieldCheck } from "lucide-react";
import { AgentAvatar } from "@/components/common/agent-avatar";
import { ModeBadge } from "@/components/common/mode-badge";
import { RelativeTime } from "@/components/common/relative-time";
import { TokenIcon } from "@/components/common/token-icon";
import { EmptyState } from "@/components/common/empty-state";
import { formatUsd } from "@/components/common/format";
import { cn } from "@/lib/utils";
import type { HomeActivityItem, HomeActivityKind } from "@/server/queries/home";

const KIND: Record<
  HomeActivityKind,
  { icon: React.ElementType; label: string; tone: string; ring: string }
> = {
  buy: { icon: ArrowUpRight, label: "Bought", tone: "text-positive", ring: "bg-positive/12" },
  sell: { icon: ArrowDownRight, label: "Sold", tone: "text-negative", ring: "bg-negative/12" },
  exit: { icon: ShieldCheck, label: "Exit", tone: "text-foreground", ring: "bg-muted" },
  proposal: { icon: Gavel, label: "Awaiting you", tone: "text-primary", ring: "bg-primary/15" },
};

function Row({ item }: { item: HomeActivityItem }) {
  const meta = KIND[item.kind];
  const Icon = meta.icon;
  const { trade, agent } = item;
  const usd = item.kind === "proposal" ? (trade.requestedUsd ?? trade.amountUsd) : trade.amountUsd;
  const href =
    item.kind === "proposal"
      ? `/agents/${agent.slug}?proposal=${trade.id}`
      : `/tokens/${trade.token.chain}/${trade.token.address}`;

  return (
    <li className="relative">
      <Link
        href={href}
        className={cn(
          "focus-ring-inset flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3 sm:px-5",
          "transition-colors duration-150",
          item.kind === "proposal" ? "bg-primary/[0.06] hover:bg-primary/10" : "hover:bg-muted/40",
        )}
      >
        <span
          aria-hidden
          className={cn("grid size-7 shrink-0 place-items-center rounded-lg", meta.ring, meta.tone)}
        >
          <Icon className="size-3.5" />
        </span>

        <span className="flex min-w-0 flex-1 items-center gap-2 sm:flex-none">
          <AgentAvatar seed={agent.avatarSeed} name={agent.name} size="sm" />
          <span className="truncate text-sm font-medium">{agent.name}</span>
          <ModeBadge mode={agent.mode} size="xs" />
        </span>

        {/*
          Below `sm` the fill wraps onto its own line under the agent (`w-full`,
          indented to the avatar), because five things — agent, verb, token, size
          and time — do not fit across 390px without colliding. From `sm` up the
          order flips back so it reads as one dense line.
        */}
        <span className="tnum ml-auto shrink-0 text-[11px] text-muted-foreground sm:order-3">
          {item.kind === "proposal" && item.expiresAt ? (
            <span className="text-primary">
              expires <RelativeTime iso={item.expiresAt} className="text-[11px]" />
            </span>
          ) : (
            <RelativeTime iso={item.at} className="text-[11px]" />
          )}
        </span>

        <span className="flex w-full min-w-0 items-center gap-1.5 pl-10 text-sm sm:order-2 sm:w-auto sm:flex-1 sm:pl-0">
          <span className={cn("shrink-0 font-medium", meta.tone)}>{meta.label}</span>
          <TokenIcon token={trade.token} size="xs" />
          <span className="truncate font-medium">{trade.token.symbol}</span>
          <span className="tnum shrink-0 text-muted-foreground">{formatUsd(usd)}</span>
        </span>
      </Link>

      {trade.exitReason || trade.rationale ? (
        <p className="px-4 pb-3 pl-[4.25rem] text-xs leading-5 text-muted-foreground sm:px-5 sm:pl-[4.75rem]">
          {trade.exitReason ? (
            <span className="mr-1.5 rounded border border-border/70 px-1.5 py-px text-[10px] uppercase tracking-wide">
              {trade.exitReason.replace(/_/g, " ")}
            </span>
          ) : null}
          {trade.rationale}
        </p>
      ) : null}
    </li>
  );
}

/**
 * What happened while you were away: your own fills, the exits the guardian took
 * for you, and anything still waiting on a decision.
 *
 * Proposals are lifted to the top and tinted, because they are the only rows with
 * a clock on them — everything else is a receipt.
 *
 * This is your own activity only. The feed next door is everyone's.
 */
export function ActivityStrip({
  items,
  pendingCount,
}: {
  items: HomeActivityItem[];
  pendingCount: number;
}) {
  return (
    <section aria-labelledby="home-activity-heading" id="activity" className="scroll-mt-20">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div>
          <h2
            id="home-activity-heading"
            className="flex items-center gap-2 text-lg font-medium tracking-tight"
          >
            <Activity aria-hidden className="size-4.5 text-primary" />
            Recent activity
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {pendingCount > 0
              ? `${pendingCount} trade${pendingCount === 1 ? "" : "s"} waiting on your decision.`
              : "Your own fills and exits. The feed is everyone else's."}
          </p>
        </div>
        <Link
          href="/feed"
          className="focus-ring inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-medium transition-[background-color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-muted active:scale-[0.97]"
        >
          Open the feed
          <ArrowUpRight aria-hidden className="size-3.5" />
        </Link>
      </div>

      {items.length === 0 ? (
        <EmptyState
          className="mt-5"
          icon={<Activity />}
          title="Nothing has happened yet"
          description="Trigger a run from an agent's page, or give one a schedule and it will start on its own. Every fill, exit and proposal lands here."
        />
      ) : (
        <ul className="glass-panel mt-5 divide-y divide-[var(--glass-hairline)] overflow-hidden rounded-2xl">
          {items.map((item) => (
            <Row key={item.id} item={item} />
          ))}
        </ul>
      )}
    </section>
  );
}
