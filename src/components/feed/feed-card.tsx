"use client";

import { memo, useSyncExternalStore } from "react";
import Link from "next/link";
import { ArrowUpRight, Link2, MessageCircle, Rocket, Share, Sparkles, Trophy } from "lucide-react";
import { LikeButton } from "@/components/spectrumui/like-button";
import { ShareButton } from "@/components/spectrumui/share-button";
import { copyLink } from "@/components/common/copy-link";
import { AgentAvatar } from "@/components/common/agent-avatar";
import { UserAvatar } from "@/components/common/user-avatar";
import { ChainBadge } from "@/components/common/chain-badge";
import { ModeBadge } from "@/components/common/mode-badge";
import { PnlText } from "@/components/common/pnl-text";
import { RelativeTime } from "@/components/common/relative-time";
import { TokenIcon } from "@/components/common/token-icon";
import { formatPriceUsd, formatSignedPct, formatUsd } from "@/components/common/format";
import { ScoreBadge } from "@/components/tokens/score-badge";
import { TradeReceiptRow } from "@/components/trading";
import { cn } from "@/lib/utils";
// The client-safe half of the receipt module. Importing the type from `@/db/schema`
// would work (types are erased) but this is the boundary the split exists to make
// obvious, so a later value import cannot quietly pull `postgres` into the bundle.
import type { TradeReceiptData } from "@/lib/trading/receipt-format";
import type { AgentMode, FeedItem, TradeRow } from "@/server/types";
import { txExplorerUrl } from "@/lib/tokens/links";
import { formatFeedTokenAmount } from "./trade-amount";

function explorerUrl(trade: TradeRow): string | null {
  return txExplorerUrl(trade.chain, trade.txHash);
}

/**
 * What a sell booked, when the query attached it. Declared here as optional so the card
 * renders today's rows unchanged; the fields are meant to land on `TradeRow` itself,
 * computed by `closedSells()` so the number cannot drift from /money.
 */
type TradeWithOutcome = TradeRow & {
  realizedPnlUsd?: number | null;
  realizedPnlPct?: number | null;
};

function SideChip({ side }: { side: "buy" | "sell" }) {
  // The chip is a colour and an abbreviation; the sr-only verb is what gets read, as its
  // own phrase, so it does not run into the header's return ("+8.32% sell").
  return (
    <>
      <span
        aria-hidden
        className={cn(
          "inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wider",
          side === "buy"
            ? "bg-positive/15 text-positive"
            : "bg-negative/15 text-negative",
        )}
      >
        {side}
      </span>
      <span className="sr-only">{side === "buy" ? "Bought" : "Sold"}</span>
    </>
  );
}

function TradeBlock({
  trade,
  receipt,
  agentMode,
}: {
  trade: TradeWithOutcome;
  receipt: TradeReceiptData | null;
  /** The posting agent's mode, already badged in the card header. */
  agentMode?: AgentMode;
}) {
  const url = explorerUrl(trade);
  const failed = trade.status === "failed" || trade.status === "rejected";
  // Frozen on the row that filled: the entry score on a buy, the exit score on a sell.
  const scoreAtFill = trade.entryScore ?? trade.score?.total ?? null;
  // Only a filled sell has an outcome; a buy, or a sell that never filled, has none.
  const realized =
    trade.side === "sell" && trade.status === "filled" && typeof trade.realizedPnlUsd === "number"
      ? { usd: trade.realizedPnlUsd, pct: trade.realizedPnlPct ?? null }
      : null;
  // The header already says PAPER or LIVE for the agent. The fill only repeats it when
  // it disagrees — a paper fill from an agent that has since gone live, say.
  const showMode = agentMode === undefined || trade.isPaper !== (agentMode === "paper");

  return (
    <div
      className={cn(
        "glass-inset mt-3 rounded-xl px-3 py-2.5",
        failed && "border-destructive/30",
      )}
    >
      {/* Two rows, not one wrapping row: what was traded where, then the numbers.
          A single flex-wrap line broke at arbitrary points on a phone and left the
          chain badge stranded on a line of its own. */}
      <div className="flex items-center gap-2">
        <SideChip side={trade.side} />
        <TokenIcon token={trade.token} size="sm" />
        {/* The symbol is the way into the token's own record: score, history, who else holds it. */}
        <Link
          href={`/tokens/${trade.token.chain}/${trade.token.address}`}
          className="focus-ring min-w-0 truncate rounded text-sm font-semibold hover:underline"
        >
          {trade.token.symbol}
        </Link>
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <ChainBadge chain={trade.chain} />
          {showMode ? <ModeBadge mode={trade.isPaper ? "paper" : "live"} size="xs" /> : null}
        </div>
      </div>

      {/* Each item after the first draws its own dot, so a wrapped line starts with
          one instead of the previous line ending on a dangling separator. */}
      <p className="tnum mt-1.5 flex flex-wrap items-baseline gap-x-2 text-sm">
        <span className="font-medium">{formatUsd(trade.amountUsd)}</span>
        <span className="text-muted-foreground before:mr-2 before:text-muted-foreground/50 before:content-['·']">
          {formatFeedTokenAmount(trade.amountToken)} {trade.token.symbol}
        </span>
        <span className="text-xs text-muted-foreground before:mr-2 before:text-muted-foreground/50 before:content-['·']">
          @ {formatPriceUsd(trade.priceUsd)}
        </span>
        {realized ? (
          <span className="whitespace-nowrap before:mr-2 before:text-muted-foreground/50 before:content-['·']">
            <span className="sr-only">Realised </span>
            <PnlText usd={realized.usd} pct={realized.pct} size="sm" dp={1} />
          </span>
        ) : null}
      </p>

      {/*
        The frozen score, not today's. A trade's record is what the agent knew when it
        pulled the trigger — re-scoring later must never rewrite it.
      */}
      {scoreAtFill !== null ? (
        <p className="mt-2 flex flex-wrap items-center gap-1.5">
          <ScoreBadge
            total={scoreAtFill}
            verdict={trade.score?.verdict}
            blockers={trade.score?.blockers}
            size="xs"
          />
          <span className="text-[11px] text-muted-foreground">
            {trade.side === "buy" ? "at entry" : "at exit"}
          </span>
          {trade.exitReason ? (
            <span className="rounded border border-border/70 px-1.5 py-px text-[10px] text-muted-foreground">
              {trade.exitReason.replace(/_/g, " ")}
            </span>
          ) : null}
        </p>
      ) : null}

      {failed && trade.error ? (
        <p className="mt-2 text-xs text-destructive">{trade.error}</p>
      ) : null}

      {/*
        The execution receipt owns this line when there is one: venue, quote → fill,
        slippage against the tolerance the agent was configured with, fees, and the
        explorer link — the numbers you screenshot when a fill looks wrong. A trade
        that predates receipts falls back to the hash on its own.
      */}
      {receipt ? (
        <TradeReceiptRow receipt={receipt} className="mt-2" />
      ) : url ? (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 inline-flex items-center gap-1 rounded font-mono text-[11px] text-muted-foreground transition-colors duration-150 hover:text-foreground focus-ring"
        >
          {trade.txHash?.slice(0, 10)}…{trade.txHash?.slice(-6)}
          <ArrowUpRight aria-hidden className="size-3" />
        </a>
      ) : (
        <p className="mt-2 whitespace-nowrap font-mono text-[11px] text-muted-foreground">
          Simulated fill
        </p>
      )}
    </div>
  );
}

// Whether the browser has a native share sheet. Read after hydration, never during
// server render, so the fan's action list cannot differ between the two.
const noSubscribe = () => () => {};
function useCanNativeShare(): boolean {
  return useSyncExternalStore(
    noSubscribe,
    () => typeof navigator !== "undefined" && typeof navigator.share === "function",
    () => false,
  );
}

const KIND_ICON = {
  note: Sparkles,
  agent_created: Rocket,
  milestone: Trophy,
} as const;

// The icon is decorative, so the kind is said in words too; without it a launch
// post reads as the agent's tagline posted out of nowhere.
const KIND_LABEL: Partial<Record<FeedItem["kind"], string>> = {
  agent_created: "Launched a new agent",
  milestone: "Milestone",
};

// Memoized: a like patches one post in the cache, and without this every loaded card
// (and its motion buttons) re-rendered with it, so a like got slower the deeper you
// had scrolled. The list keeps `item`, `receipt` and both callbacks referentially stable.
export const FeedCard = memo(function FeedCard({
  item,
  receipt = null,
  onLike,
  onOpenComments,
}: {
  item: FeedItem;
  /** The fill's execution receipt, when the trade has one. */
  receipt?: TradeReceiptData | null;
  onLike: (postId: string, liked: boolean) => void;
  onOpenComments: (item: FeedItem) => void;
}) {
  // No local copy of the heart: the owner of `item` saves it optimistically and rolls
  // it back, and a card that kept its own state would keep a like the server refused.
  const liked = item.likedByViewer;
  const likeCount = item.likeCount;
  const canNativeShare = useCanNativeShare();

  const agent = item.agent;
  // The post's own page, not an anchor in the feed: the feed is newest-first and
  // paginated, so `/feed#id` stopped resolving as soon as the post left page one.
  const sharePath = `/feed/${item.id}`;
  const shareUrl =
    typeof window === "undefined" ? sharePath : `${window.location.origin}${sharePath}`;
  // Our own "Copy link" rather than the share button's built-in one, which swallows a
  // refused clipboard and confirms only in an aria-hidden tooltip.
  const shareActions = [
    {
      icon: <Link2 aria-hidden className="size-3.5" />,
      label: "Copy link",
      onSelect: () => copyLink(shareUrl),
    },
    ...(canNativeShare
      ? [
          {
            icon: <Share aria-hidden className="size-3.5" />,
            label: "Share via…",
            onSelect: () => {
              const title = agent ? `${agent.name} on Tocker` : "A post on Tocker";
              // AbortError is the user closing the sheet; nothing to report.
              navigator.share({ title, url: shareUrl }).catch(() => {});
            },
          },
        ]
      : []),
  ];

  const Icon = item.kind === "trade" ? null : KIND_ICON[item.kind];

  return (
    <article
      id={item.id}
      className="glass-card isolate scroll-mt-24 rounded-2xl px-4 py-4 sm:px-5"
    >
      <div className="flex gap-3">
        {agent ? (
          // A pointer shortcut only: the name link right after it goes to the same
          // place, so keyboard and screen-reader users get one stop, not two.
          <Link
            href={`/agents/${agent.slug}`}
            className="shrink-0 self-start rounded-lg"
            tabIndex={-1}
            aria-hidden
          >
            <AgentAvatar seed={agent.avatarSeed} name={agent.name} size="md" />
          </Link>
        ) : (
          // A person's own note. Round, where an agent's mark is a rounded square.
          <UserAvatar user={item.author} px={36} className="size-9" />
        )}

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm">
            {agent ? (
              <Link
                href={`/agents/${agent.slug}`}
                className="rounded font-semibold tracking-tight hover:underline focus-ring"
              >
                {agent.name}
              </Link>
            ) : (
              <span className="font-semibold">{item.author.displayName ?? item.author.handle}</span>
            )}
            <Link
              href={`/u/${item.author.handle}`}
              className="rounded text-muted-foreground hover:underline focus-ring"
            >
              @{item.author.handle}
            </Link>
            {agent ? <ModeBadge mode={agent.mode} size="xs" /> : null}
            <span aria-hidden className="text-muted-foreground/40">
              ·
            </span>
            {/* The permalink. Only the time, not the whole card: the card is full of its
                own links and buttons, and a stretched overlay would fight all of them. */}
            <Link
              href={sharePath}
              className="focus-ring rounded text-muted-foreground hover:underline"
            >
              <span className="sr-only">Open post, </span>
              <RelativeTime iso={item.createdAt} className="text-xs" />
            </Link>
            {/* The agent's record, not this trade's result — labelled, or a green
                number beside "Stop hit, small loss" reads as a contradiction. */}
            {agent?.pnlPct !== null && agent?.pnlPct !== undefined ? (
              <span
                className="ml-auto inline-flex items-baseline gap-1 whitespace-nowrap text-[11px] text-muted-foreground"
                title="Agent all-time return"
              >
                <span aria-hidden className="inline-flex items-baseline gap-1">
                  <PnlText pct={agent.pnlPct} size="xs" />
                  all-time
                </span>
                <span className="sr-only">
                  Agent all-time return {formatSignedPct(agent.pnlPct, 2)}
                </span>
              </span>
            ) : null}
          </div>

          {item.kind === "trade" && item.trade ? (
            <TradeBlock trade={item.trade} receipt={receipt} agentMode={agent?.mode} />
          ) : null}

          {item.body ? (
            item.kind === "trade" ? (
              <blockquote className="mt-2.5 border-l-2 border-primary/40 pl-3 text-sm leading-relaxed text-foreground/85">
                {item.body}
              </blockquote>
            ) : (
              <p className="mt-2 flex gap-2 text-sm leading-relaxed text-foreground/85">
                {Icon ? (
                  <Icon aria-hidden className="mt-0.5 size-4 shrink-0 text-primary" />
                ) : null}
                <span>
                  {KIND_LABEL[item.kind] ? (
                    <span className="block text-xs font-medium text-muted-foreground">
                      {KIND_LABEL[item.kind]}
                    </span>
                  ) : null}
                  {item.body}
                </span>
              </p>
            )
          ) : null}

          <div className="mt-2.5 flex items-center gap-1 border-t border-[var(--glass-hairline)] pt-2">
            <LikeButton
              liked={liked}
              // LikeButton adds +1 for the viewer's own like, so pass the count excluding it.
              count={Math.max(0, likeCount - (liked ? 1 : 0))}
              size="sm"
              onLikedChange={(next) => onLike(item.id, next)}
              label="Like"
              className="!px-2"
            />

            <button
              type="button"
              onClick={() => onOpenComments(item)}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-xs text-muted-foreground transition-[color,background-color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-muted/60 hover:text-foreground active:scale-[0.97] focus-ring"
            >
              <MessageCircle aria-hidden className="size-4" />
              <span className="tnum">{item.commentCount || ""}</span>
              <span className="sr-only">Comments</span>
            </button>

            <ShareButton
              size="sm"
              direction="right"
              label="Share this post"
              actions={shareActions}
            />
          </div>
        </div>
      </div>
    </article>
  );
});
