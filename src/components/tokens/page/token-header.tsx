/**
 * Who the token is and what it is worth right now. Server-rendered: it is the
 * first thing read and must not wait on hydration.
 *
 * The facts come from the score when there is one — that is where liquidity,
 * holders and age are measured — and fall back to the token row's last mark when
 * there is not, so an unscored token still shows a price rather than a page of
 * dashes.
 */
import type { ReactNode } from "react";
import { Address } from "@/components/common/address";
import { ChainBadge } from "@/components/common/chain-badge";
import { TokenIcon } from "@/components/common/token-icon";
import { formatSignedPct, formatUsd } from "@/components/common/format";
import { pnlTone } from "@/components/common/pnl-text";
import { formatAge, formatCompactUsd, formatHolders } from "@/components/tokens/format";
import type { TokenPage } from "@/server/types";
import { cn } from "@/lib/utils";

export function TokenHeader({
  page,
  action,
}: {
  page: TokenPage;
  action?: ReactNode;
}) {
  const { token, score } = page;
  const price = score?.priceUsd ?? token.lastPriceUsd;

  return (
    <header className="border-b border-border/70 px-4 pt-6 pb-5 sm:px-6">
      <div className="mx-auto w-full max-w-5xl">
        <div className="flex flex-wrap items-start gap-3">
          <TokenIcon token={token} size="md" className="mt-0.5" />

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold tracking-tight">{token.symbol}</h1>
              {token.name && token.name !== token.symbol ? (
                <span className="truncate text-sm text-muted-foreground">{token.name}</span>
              ) : null}
              <ChainBadge chain={token.chain} />
            </div>
            <Address address={token.address} label="token address" className="mt-1" />
          </div>

          <div className="flex flex-col items-end gap-1.5">
            <p className="tnum text-2xl font-semibold">{formatUsd(price)}</p>
            {score?.priceChange24hPct === null || score === null ? null : (
              <p className={cn("tnum text-xs font-medium", pnlTone(score.priceChange24hPct))}>
                {formatSignedPct(score.priceChange24hPct, 1)} <span className="text-muted-foreground">24h</span>
              </p>
            )}
            {action}
          </div>
        </div>

        <dl className="tnum mt-4 grid grid-cols-2 gap-x-5 gap-y-2.5 font-mono text-xs sm:grid-cols-5">
          <Fact label="Market cap" value={formatCompactUsd(score?.marketCapUsd ?? null)} />
          <Fact label="Liquidity" value={formatCompactUsd(score?.liquidityUsd ?? null)} />
          <Fact label="24h volume" value={formatCompactUsd(score?.volume24hUsd ?? null)} />
          <Fact label="Holders" value={formatHolders(score?.holderCount ?? null)} />
          <Fact label="Age" value={formatAge(score?.ageHours ?? null)} />
        </dl>
      </div>
    </header>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 sm:block">
      <dt className="font-sans text-[10px] tracking-wide text-muted-foreground uppercase">{label}</dt>
      <dd className="sm:mt-0.5">{value}</dd>
    </div>
  );
}
