/**
 * The best and worst exit of the window, side by side.
 *
 * Both link to the token page, because the follow-up question is always "what was
 * that thing, and what did it score" — and the entry-score chip answers half of it
 * before the click.
 *
 * The headline number is what the exit *made*, because that is what picked it. The
 * sale proceeds sit under it, labelled: printed alone, "$777" on the worst exit reads
 * as a profit.
 */
import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { PnlText } from "@/components/common/pnl-text";
import { RelativeTime } from "@/components/common/relative-time";
import { TokenIcon } from "@/components/common/token-icon";
import { formatUsd } from "@/components/common/format";
import { ScoreBadge } from "@/components/tokens/score-badge";
import type { TradeRow } from "@/server/types";
import { cn } from "@/lib/utils";
import { highlightLabel, type HighlightSlot, type HighlightTone } from "./highlight-label";

const TONE: Record<HighlightTone, { card: string; icon: string }> = {
  positive: { card: "border-positive/25 hover:bg-positive/5", icon: "text-positive" },
  negative: { card: "border-negative/25 hover:bg-negative/5", icon: "text-negative" },
  neutral: { card: "border-border hover:bg-muted/40", icon: "text-muted-foreground" },
};

export function TradeHighlights({
  best,
  worst,
  bestPnlUsd = null,
  worstPnlUsd = null,
}: {
  best: TradeRow | null;
  worst: TradeRow | null;
  /** Realized PnL of each exit, the number that ranked it. */
  bestPnlUsd?: number | null;
  worstPnlUsd?: number | null;
}) {
  if (!best && !worst) return null;
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {/* One closed exit is both ends of the ranking; the query drops the second card. */}
      {best ? <Highlight trade={best} pnlUsd={bestPnlUsd} slot={worst ? "best" : "only"} /> : null}
      {worst ? <Highlight trade={worst} pnlUsd={worstPnlUsd} slot="worst" /> : null}
    </div>
  );
}

function Highlight({
  trade,
  pnlUsd,
  slot,
}: {
  trade: TradeRow;
  pnlUsd: number | null;
  slot: HighlightSlot;
}) {
  const { label, tone } = highlightLabel(slot, pnlUsd);
  // The arrow follows what the exit made, not which end of the ranking it sits at.
  const Icon = pnlUsd === null || pnlUsd === 0 ? Minus : pnlUsd > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <Link
      href={`/tokens/${trade.token.chain}/${trade.token.address}`}
      className={cn(
        "group block rounded-xl border bg-card/40 p-3 transition-colors duration-150 focus-ring sm:p-4",
        TONE[tone].card,
      )}
    >
      <div className="flex items-center gap-1.5">
        <Icon aria-hidden className={cn("size-3.5", TONE[tone].icon)} />
        <p className="text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">{label}</p>
        <RelativeTime iso={trade.filledAt ?? trade.createdAt} className="ml-auto text-[10px]" />
      </div>

      <div className="mt-2 flex items-center gap-2">
        <TokenIcon token={trade.token} size="sm" />
        <span className="text-sm font-semibold group-hover:underline">{trade.token.symbol}</span>
        {trade.entryScore === null ? null : (
          <ScoreBadge total={trade.entryScore} verdict={trade.score?.verdict} size="xs" />
        )}
        <span className="ml-auto text-right">
          {pnlUsd === null ? null : <PnlText usd={pnlUsd} size="sm" className="block" />}
          <span className="tnum block text-[11px] text-muted-foreground">
            sold {formatUsd(trade.amountUsd)}
          </span>
        </span>
      </div>

      {trade.rationale ? (
        <p className="mt-2 line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">
          {trade.rationale}
        </p>
      ) : null}
    </Link>
  );
}
