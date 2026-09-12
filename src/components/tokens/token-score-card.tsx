"use client";

import type { ReactNode } from "react";
import type { TokenScore, TradeScore } from "@/server/types";
import { ChainBadge } from "@/components/common/chain-badge";
import { TokenIcon } from "@/components/common/token-icon";
import { formatRelative, formatSignedPct, truncateAddress } from "@/components/common/format";
import { pnlTone } from "@/components/common/pnl-text";
import { cn } from "@/lib/utils";
import { ScoreDial } from "./score-dial";
import { ScoreBreakdown } from "./score-breakdown";
import { BlockerList } from "./blocker-list";
import { VERDICT_META, effectiveVerdict } from "./verdict";
import { formatAge, formatCompactUsd, formatHolders } from "./format";

/**
 * The full read on one token: the dial, the facts, where the number came from
 * and what it failed. Opened deliberately — a trade, a token page — which is
 * why it is the one place the dial animates.
 */
export function TokenScoreCard({
  score,
  footer,
  className,
}: {
  score: TokenScore;
  footer?: ReactNode;
  className?: string;
}) {
  const verdict = score.verdict ?? effectiveVerdict(score.total, score.blockers);

  return (
    <div className={cn("rounded-2xl border border-border/80 bg-card/50 p-4 sm:p-5", className)}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-5">
        <ScoreDial
          total={score.total}
          verdict={verdict}
          blockers={score.blockers}
          size={112}
          className="self-center sm:self-start"
        />

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <TokenIcon
              token={{ id: score.tokenId, symbol: score.symbol, logoUrl: null }}
              size="sm"
            />
            <h3 className="text-base font-semibold tracking-tight">{score.symbol}</h3>
            {score.name ? (
              <span className="truncate text-sm text-muted-foreground">{score.name}</span>
            ) : null}
            <ChainBadge chain={score.chain} />
          </div>

          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {VERDICT_META[verdict].meaning}
          </p>

          <dl className="tnum mt-3 grid grid-cols-2 gap-x-4 gap-y-2 font-mono text-xs sm:grid-cols-3">
            <Fact label="Liquidity" value={formatCompactUsd(score.liquidityUsd)} />
            <Fact label="24h volume" value={formatCompactUsd(score.volume24hUsd)} />
            <Fact label="Market cap" value={formatCompactUsd(score.marketCapUsd)} />
            <Fact label="Holders" value={formatHolders(score.holderCount)} />
            <Fact label="Age" value={formatAge(score.ageHours)} />
            <Fact
              label="24h"
              value={formatSignedPct(score.priceChange24hPct, 1)}
              className={pnlTone(score.priceChange24hPct)}
            />
          </dl>
        </div>
      </div>

      <div className="mt-4 border-t border-border/60 pt-4">
        <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
          How the number was built
        </p>
        <ScoreBreakdown components={score.components} className="mt-2" />
      </div>

      {score.blockers.length > 0 || score.warnings.length > 0 ? (
        <div className="mt-4 border-t border-border/60 pt-4">
          <BlockerList blockers={score.blockers} warnings={score.warnings} />
        </div>
      ) : null}

      <p className="tnum mt-4 font-mono text-[11px] text-muted-foreground">
        {truncateAddress(score.address, 6, 6)} · {score.sources.join(" + ")} ·{" "}
        {formatRelative(score.scoredAt)}
      </p>

      {footer ? <div className="mt-3">{footer}</div> : null}
    </div>
  );
}

function Fact({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div>
      <dt className="font-sans text-[10px] tracking-wide text-muted-foreground uppercase">
        {label}
      </dt>
      <dd className={cn("mt-0.5", className)}>{value}</dd>
    </div>
  );
}

/**
 * The frozen score on a trade, compact enough for a feed card.
 *
 * The feed is owned by the PRIVACY workstream, so this is built here and wired
 * there: render it next to a trade's rationale with `trade.score`.
 */
export function TradeScoreChip({
  score,
  className,
}: {
  score: TradeScore;
  className?: string;
}) {
  const verdict = score.verdict ?? effectiveVerdict(score.total, score.blockers);
  const meta = VERDICT_META[verdict];

  return (
    <span
      className={cn(
        "tnum inline-flex items-center gap-1.5 rounded-md border border-border/70 bg-muted/30 px-2 py-0.5 font-mono text-[11px] text-muted-foreground",
        className,
      )}
      title={`Scored ${Math.round(score.total)}/100 (${meta.label}) when the agent pulled the trigger.`}
    >
      <span
        aria-hidden
        className="size-1.5 rounded-full"
        style={{ backgroundColor: meta.color }}
      />
      <span style={{ color: meta.color }}>{Math.round(score.total)}</span>
      <span className="font-sans">at entry</span>
      {score.liquidityUsd !== null ? (
        <>
          <span aria-hidden>·</span>
          <span>{formatCompactUsd(score.liquidityUsd)} liq</span>
        </>
      ) : null}
      {score.ageHours !== null ? (
        <>
          <span aria-hidden>·</span>
          <span>{formatAge(score.ageHours)} old</span>
        </>
      ) : null}
    </span>
  );
}
