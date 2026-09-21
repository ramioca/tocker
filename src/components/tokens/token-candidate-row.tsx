"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import type { DiscoveryFeed, TokenCandidate, TokenScore } from "@/server/types";
import { ChainBadge } from "@/components/common/chain-badge";
import { TokenIcon } from "@/components/common/token-icon";
import { formatSignedPct } from "@/components/common/format";
import { pnlTone } from "@/components/common/pnl-text";
import { cn } from "@/lib/utils";
import { ScoreBadge } from "./score-badge";
import { ScoreBreakdown } from "./score-breakdown";
import { BlockerList, describeBlocker } from "./blocker-list";
import { formatAge, formatCompactUsd, formatHolders } from "./format";

/** Same warm amber the blocker list uses — never the PnL red. */
const BLOCKER_COLOR = "oklch(0.7 0.16 45)";

export const FEED_LABEL: Record<DiscoveryFeed, string> = {
  new_launches: "New launch",
  trending: "Trending",
  top_organic: "Top organic",
  momentum: "Momentum",
  gecko_launches: "Gecko-rated launch",
  paid_launches: "Paid launch radar",
  manual: "Named by the agent",
};

/**
 * One token in a discovery list. Rows are a hot path, so nothing animates on
 * scroll or hover beyond a colour change — the disclosure is the only motion,
 * and it is a height the browser handles.
 */
export function TokenScoreRow({
  score,
  origin,
  defaultOpen = false,
  /** Surface the first hard-gate failure in the collapsed row, not just on open. */
  showTopBlocker = false,
  className,
}: {
  score: TokenScore;
  origin?: DiscoveryFeed;
  defaultOpen?: boolean;
  showTopBlocker?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const failing = score.blockers.length;

  return (
    <div className={cn("group", className)}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          "flex w-full items-center gap-3 px-3 py-2.5 text-left sm:px-4",
          "transition-colors duration-150 hover:bg-muted/40",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
        )}
      >
        <TokenIcon
          token={{ id: score.tokenId, symbol: score.symbol, logoUrl: null }}
          size="md"
        />

        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate text-sm font-medium">{score.symbol}</span>
            <ChainBadge chain={score.chain} className="hidden sm:inline-flex" />
            {origin ? (
              <span className="hidden rounded border border-border/70 px-1.5 py-px text-[10px] text-muted-foreground md:inline">
                {FEED_LABEL[origin]}
              </span>
            ) : null}
          </span>
          <span className="tnum mt-0.5 flex items-center gap-2 font-mono text-[11px] text-muted-foreground">
            <span>{formatAge(score.ageHours)} old</span>
            <span aria-hidden>·</span>
            <span>{formatCompactUsd(score.liquidityUsd)} liq</span>
            <span aria-hidden className="hidden sm:inline">·</span>
            <span className="hidden sm:inline">{formatHolders(score.holderCount)} holders</span>
          </span>
          {showTopBlocker && score.blockers.length > 0 ? (
            <span className="mt-1 block truncate text-[11px] leading-relaxed" style={{ color: BLOCKER_COLOR }}>
              {describeBlocker(score.blockers[0]).title}
              {score.blockers.length > 1 ? ` +${score.blockers.length - 1} more` : ""}
            </span>
          ) : null}
        </span>

        <span
          className={cn("tnum hidden w-16 text-right font-mono text-xs sm:block", pnlTone(score.priceChange24hPct))}
        >
          {formatSignedPct(score.priceChange24hPct, 1)}
        </span>

        {failing > 0 ? (
          <span className="hidden rounded-md border border-border/70 px-1.5 py-0.5 text-[10px] text-muted-foreground md:inline">
            {failing} gate{failing === 1 ? "" : "s"} failed
          </span>
        ) : null}

        <ScoreBadge total={score.total} verdict={score.verdict} size="sm" />

        <ChevronDown
          aria-hidden
          className={cn(
            "size-4 shrink-0 text-muted-foreground",
            "transition-transform duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none",
            open && "rotate-180",
          )}
        />
      </button>

      {open ? (
        <div className="animate-rise space-y-3 border-t border-border/50 bg-muted/20 px-3 py-3 sm:px-4">
          <dl className="tnum grid grid-cols-2 gap-x-4 gap-y-1.5 font-mono text-[11px] sm:grid-cols-4">
            <Fact label="Liquidity" value={formatCompactUsd(score.liquidityUsd)} />
            <Fact label="24h volume" value={formatCompactUsd(score.volume24hUsd)} />
            <Fact label="Market cap" value={formatCompactUsd(score.marketCapUsd)} />
            <Fact label="Holders" value={formatHolders(score.holderCount)} />
          </dl>

          <ScoreBreakdown components={score.components} dense />

          <BlockerList blockers={score.blockers} warnings={score.warnings} />

          <p className="text-[11px] text-muted-foreground">
            Scored from {score.sources.join(", ")}.
          </p>
        </div>
      ) : null}
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 sm:block">
      <dt className="font-sans text-[10px] tracking-wide text-muted-foreground uppercase">
        {label}
      </dt>
      <dd className="sm:mt-0.5">{value}</dd>
    </div>
  );
}

/**
 * A token a feed surfaced, possibly before scoring. Renders the same row when a
 * score exists and an honest "not scored yet" when it does not — a `quickScore`
 * is a pre-rank from the discovery payload, not a verdict, so it never wears a
 * verdict badge.
 */
export function TokenCandidateRow({
  candidate,
  score = null,
  className,
}: {
  candidate: TokenCandidate;
  score?: TokenScore | null;
  className?: string;
}) {
  if (score) {
    return <TokenScoreRow score={score} origin={candidate.origin} className={className} />;
  }

  return (
    <div className={cn("flex items-center gap-3 px-3 py-2.5 sm:px-4", className)}>
      <TokenIcon token={candidate.token} size="md" />
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{candidate.token.symbol}</span>
          <ChainBadge chain={candidate.token.chain} className="hidden sm:inline-flex" />
          <span className="rounded border border-border/70 px-1.5 py-px text-[10px] text-muted-foreground">
            {FEED_LABEL[candidate.origin]}
          </span>
        </p>
        <p className="tnum mt-0.5 font-mono text-[11px] text-muted-foreground">
          {formatAge(candidate.ageHours)} old · {formatCompactUsd(candidate.liquidityUsd)} liq
        </p>
      </div>
      <span className="rounded-md border border-dashed border-border px-2 py-1 text-[11px] text-muted-foreground">
        Not scored yet
      </span>
    </div>
  );
}
