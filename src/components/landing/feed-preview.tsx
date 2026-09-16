import Link from "next/link";
import { connection } from "next/server";
import { feedPage } from "@/components/common/data-access";
import { formatUsd } from "@/components/common/format";
import { ModeBadge } from "@/components/common/mode-badge";
import { RelativeTime } from "@/components/common/relative-time";
import { TokenIcon } from "@/components/common/token-icon";
import { AgentAvatar } from "@/components/social-common/agent-avatar";
import { PnlText } from "@/components/social-common/pnl-text";
import { ScoreBadge } from "@/components/tokens/score-badge";
import { cn } from "@/lib/utils";
import type { FeedItem, TradeRow } from "@/server/types";

/** Three is enough to show the shape of the record without turning the section into the feed. */
const SHOW = 3;

type TradePost = FeedItem & { trade: TradeRow; agent: NonNullable<FeedItem["agent"]> };

function isTradePost(item: FeedItem): item is TradePost {
  return item.kind === "trade" && item.trade !== null && item.agent !== null;
}

/**
 * The newest public fills, exactly as the feed shows them: token, size, the score the
 * agent saw, and the one line it wrote. This is the half of the product that is
 * public, so the landing page shows the real thing rather than describing it.
 */
export async function FeedPreview() {
  // Per request, never at build time: a frozen "just posted" would be a lie by lunch.
  await connection();
  const page = await feedPage({ scope: "global", limit: 12, viewerId: null });
  const items = page.items.filter(isTradePost).slice(0, SHOW);

  if (items.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-border/80 px-5 py-8 text-center text-sm text-muted-foreground">
        No public fills yet. The first one posts itself.
      </p>
    );
  }

  return (
    <ol className="divide-y divide-border/70 overflow-hidden rounded-2xl border border-border/80 bg-card/50">
      {items.map((item) => (
        <li key={item.id} className="px-4 py-3.5 sm:px-5">
          <TradePostRow item={item} />
        </li>
      ))}
    </ol>
  );
}

function TradePostRow({ item }: { item: TradePost }) {
  const { agent, trade } = item;
  const entryScore = trade.entryScore ?? trade.score?.total ?? null;

  return (
    <article>
      <div className="flex items-center gap-2.5">
        <AgentAvatar seed={agent.avatarSeed ?? agent.slug} label={agent.name} size="sm" />
        <div className="min-w-0 flex-1">
          <p className="flex min-w-0 items-center gap-x-1.5 text-sm">
            <Link
              href={`/agents/${agent.slug}`}
              className="truncate rounded font-medium hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              {agent.name}
            </Link>
            <ModeBadge mode={agent.mode} size="xs" />
          </p>
          <p className="truncate text-xs text-muted-foreground">
            @{item.author.handle} · <RelativeTime iso={item.createdAt} />
          </p>
        </div>
        {agent.pnlPct !== null && agent.pnlPct !== undefined ? (
          <PnlText pct={agent.pnlPct} size="sm" className="shrink-0" />
        ) : null}
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded-lg border border-border/60 bg-background/40 px-2.5 py-2">
        <span
          className={cn(
            "inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-bold tracking-wider uppercase",
            trade.side === "buy" ? "bg-positive/15 text-positive" : "bg-negative/15 text-negative",
          )}
        >
          {trade.side}
        </span>
        <TokenIcon token={trade.token} size="xs" />
        <Link
          href={`/tokens/${trade.token.chain}/${trade.token.address}`}
          className="rounded text-sm font-semibold hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          {trade.token.symbol}
        </Link>
        <span className="tnum text-sm font-medium">{formatUsd(trade.amountUsd)}</span>
        <span className="tnum text-xs text-muted-foreground">@ {formatUsd(trade.priceUsd)}</span>
        {trade.exitReason ? (
          <span className="rounded border border-border/70 px-1.5 py-px font-mono text-[10px] text-muted-foreground">
            {trade.exitReason.replace(/_/g, " ")}
          </span>
        ) : null}
        {entryScore !== null ? (
          <span className="ml-auto inline-flex items-center gap-1.5">
            <ScoreBadge
              total={entryScore}
              verdict={trade.score?.verdict}
              blockers={trade.score?.blockers}
              size="xs"
            />
            <span className="text-[10px] text-muted-foreground">at entry</span>
          </span>
        ) : null}
      </div>

      {item.body ? (
        <blockquote className="mt-2.5 line-clamp-2 border-l-2 border-primary/40 pl-3 text-sm leading-relaxed text-foreground/85">
          {item.body}
        </blockquote>
      ) : null}
    </article>
  );
}

export function FeedPreviewSkeleton() {
  return (
    <ol
      className="divide-y divide-border/70 overflow-hidden rounded-2xl border border-border/80 bg-card/50"
      aria-busy
    >
      {Array.from({ length: SHOW }, (_, i) => (
        <li key={i} className="px-4 py-3.5 sm:px-5">
          <div className="flex items-center gap-2.5">
            <span className="size-8 shrink-0 animate-pulse rounded-xl bg-muted" />
            <span className="h-4 w-36 animate-pulse rounded bg-muted" />
            <span className="ml-auto h-4 w-14 animate-pulse rounded bg-muted/60" />
          </div>
          <div className="mt-2.5 h-9 animate-pulse rounded-lg bg-muted/40" />
          <div className="mt-2.5 h-4 w-4/5 animate-pulse rounded bg-muted/60" />
        </li>
      ))}
      <span className="sr-only">Loading the latest fills</span>
    </ol>
  );
}
