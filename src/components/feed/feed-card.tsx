"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowUpRight, MessageCircle, Rocket, Sparkles, Trophy } from "lucide-react";
import { LikeButton } from "@/components/spectrumui/like-button";
import { ShareButton } from "@/components/spectrumui/share-button";
import { AgentAvatar } from "@/components/common/agent-avatar";
import { ChainBadge } from "@/components/common/chain-badge";
import { ModeBadge } from "@/components/common/mode-badge";
import { PnlText } from "@/components/common/pnl-text";
import { RelativeTime } from "@/components/common/relative-time";
import { TokenIcon } from "@/components/common/token-icon";
import { formatTokenAmount, formatUsd } from "@/components/common/format";
import { ScoreBadge } from "@/components/tokens/score-badge";
import { cn } from "@/lib/utils";
import type { FeedItem, TradeRow } from "@/server/types";

function explorerUrl(trade: TradeRow): string | null {
  if (!trade.txHash) return null;
  return trade.chain === "solana"
    ? `https://solscan.io/tx/${trade.txHash}`
    : `https://basescan.org/tx/${trade.txHash}`;
}

function SideChip({ side }: { side: "buy" | "sell" }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wider",
        side === "buy"
          ? "bg-positive/15 text-positive"
          : "bg-negative/15 text-negative",
      )}
    >
      {side}
    </span>
  );
}

function TradeBlock({ trade }: { trade: TradeRow }) {
  const url = explorerUrl(trade);
  const failed = trade.status === "failed" || trade.status === "rejected";
  const entryScore = trade.entryScore ?? trade.score?.total ?? null;

  return (
    <div
      className={cn(
        "glass-inset mt-3 rounded-xl px-3 py-2.5",
        failed && "border-destructive/30",
      )}
    >
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
        <SideChip side={trade.side} />
        <TokenIcon token={trade.token} size="sm" />
        {/* The symbol is the way into the token's own record: score, history, who else holds it. */}
        <Link
          href={`/tokens/${trade.token.chain}/${trade.token.address}`}
          className="focus-ring rounded text-sm font-semibold hover:underline"
        >
          {trade.token.symbol}
        </Link>
        <span className="tnum text-sm text-muted-foreground">
          {formatTokenAmount(trade.amountToken)}
        </span>
        <span className="text-muted-foreground/50">·</span>
        <span className="tnum text-sm font-medium">{formatUsd(trade.amountUsd)}</span>
        <span className="tnum text-xs text-muted-foreground">@ {formatUsd(trade.priceUsd)}</span>
        <div className="ml-auto flex items-center gap-1.5">
          <ChainBadge chain={trade.chain} />
          <ModeBadge mode={trade.isPaper ? "paper" : "live"} size="xs" />
        </div>
      </div>

      {/*
        The frozen score, not today's. A trade's record is what the agent knew when it
        pulled the trigger — re-scoring later must never rewrite it.
      */}
      {entryScore !== null ? (
        <p className="mt-2 flex flex-wrap items-center gap-1.5">
          <ScoreBadge
            total={entryScore}
            verdict={trade.score?.verdict}
            blockers={trade.score?.blockers}
            size="xs"
          />
          <span className="text-[11px] text-muted-foreground">at entry</span>
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

      {url ? (
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
        <p className="mt-2 font-mono text-[11px] text-muted-foreground">
          Simulated fill · no on-chain transaction
        </p>
      )}
    </div>
  );
}

const KIND_ICON = {
  note: Sparkles,
  agent_created: Rocket,
  milestone: Trophy,
} as const;

export function FeedCard({
  item,
  onLike,
  onOpenComments,
}: {
  item: FeedItem;
  onLike: (postId: string, liked: boolean) => void;
  onOpenComments: (item: FeedItem) => void;
}) {
  const [liked, setLiked] = useState(item.likedByViewer);
  const [likeCount, setLikeCount] = useState(item.likeCount);

  const agent = item.agent;
  const shareUrl =
    typeof window === "undefined"
      ? `/feed#${item.id}`
      : `${window.location.origin}/feed#${item.id}`;

  const handleLike = (next: boolean) => {
    setLiked(next);
    setLikeCount((count) => Math.max(0, count + (next ? 1 : -1)));
    onLike(item.id, next);
  };

  const Icon = item.kind === "trade" ? null : KIND_ICON[item.kind];

  return (
    <article
      id={item.id}
      className="glass-card glass-hover scroll-mt-24 rounded-2xl px-4 py-4 sm:px-5"
    >
      <div className="flex gap-3">
        {agent ? (
          <Link
            href={`/agents/${agent.slug}`}
            className="focus-ring shrink-0 rounded-lg"
            aria-label={agent.name}
          >
            <AgentAvatar seed={agent.avatarSeed} name={agent.name} size="md" />
          </Link>
        ) : (
          <AgentAvatar seed={item.author.handle} name={item.author.handle} size="md" />
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
            <RelativeTime iso={item.createdAt} className="text-xs" />
            {agent?.pnlPct !== null && agent?.pnlPct !== undefined ? (
              <PnlText pct={agent.pnlPct} size="xs" className="ml-auto" />
            ) : null}
          </div>

          {item.kind === "trade" && item.trade ? <TradeBlock trade={item.trade} /> : null}

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
                <span>{item.body}</span>
              </p>
            )
          ) : null}

          <div className="mt-2.5 flex items-center gap-1 border-t border-[var(--glass-hairline)] pt-2">
            <LikeButton
              liked={liked}
              // LikeButton adds +1 for the viewer's own like, so pass the count excluding it.
              count={Math.max(0, likeCount - (liked ? 1 : 0))}
              size="sm"
              onLikedChange={handleLike}
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
              copyValue={shareUrl}
              direction="right"
              label="Share this post"
              actions={[]}
            />
          </div>
        </div>
      </div>
    </article>
  );
}
