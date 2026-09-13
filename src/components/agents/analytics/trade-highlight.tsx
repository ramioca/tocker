/**
 * The best and worst exit of the window, side by side.
 *
 * Both link to the token page, because the follow-up question is always "what was
 * that thing, and what did it score" — and the entry-score chip answers half of it
 * before the click.
 */
import Link from "next/link";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { RelativeTime } from "@/components/common/relative-time";
import { TokenIcon } from "@/components/common/token-icon";
import { formatUsd } from "@/components/common/format";
import { ScoreBadge } from "@/components/tokens/score-badge";
import type { TradeRow } from "@/server/types";
import { cn } from "@/lib/utils";

export function TradeHighlights({
  best,
  worst,
}: {
  best: TradeRow | null;
  worst: TradeRow | null;
}) {
  if (!best && !worst) return null;
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {best ? <Highlight trade={best} tone="best" /> : null}
      {worst ? <Highlight trade={worst} tone="worst" /> : null}
    </div>
  );
}

function Highlight({ trade, tone }: { trade: TradeRow; tone: "best" | "worst" }) {
  const Icon = tone === "best" ? ArrowUpRight : ArrowDownRight;
  return (
    <Link
      href={`/tokens/${trade.token.chain}/${trade.token.address}`}
      className={cn(
        "group block rounded-xl border bg-card/40 p-3 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:p-4",
        tone === "best"
          ? "border-positive/25 hover:bg-positive/5"
          : "border-negative/25 hover:bg-negative/5",
      )}
    >
      <div className="flex items-center gap-1.5">
        <Icon
          aria-hidden
          className={cn("size-3.5", tone === "best" ? "text-positive" : "text-negative")}
        />
        <p className="text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
          {tone === "best" ? "Best exit" : "Worst exit"}
        </p>
        <RelativeTime iso={trade.filledAt ?? trade.createdAt} className="ml-auto text-[10px]" />
      </div>

      <div className="mt-2 flex items-center gap-2">
        <TokenIcon token={trade.token} size="sm" />
        <span className="text-sm font-semibold group-hover:underline">{trade.token.symbol}</span>
        {trade.entryScore === null ? null : (
          <ScoreBadge total={trade.entryScore} verdict={trade.score?.verdict} size="xs" />
        )}
        <span className="tnum ml-auto text-sm font-medium">{formatUsd(trade.amountUsd)}</span>
      </div>

      {trade.rationale ? (
        <p className="mt-2 line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">
          {trade.rationale}
        </p>
      ) : null}
    </Link>
  );
}
