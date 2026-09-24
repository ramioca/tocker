/**
 * Who the token is and what it is worth right now. Server-rendered: it is the
 * first thing read and must not wait on hydration.
 *
 * The facts come from the public score when there is one — that is where liquidity,
 * holders and age are measured. Without one, they fall back to the cached market
 * facts from whichever universe scored it last (the same under any agent's rules;
 * never a verdict or a blocker), then to the newest score-history point, then to the
 * token row's last mark, so an unscored token still shows a price rather than a page
 * of dashes.
 */
import { GeckoTerminalLink } from "@/components/common/chart-link";
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
  const facts = score ?? page.marketFacts;
  const price =
    score?.priceUsd ?? lastKnown(page.history, "priceUsd") ?? page.marketFacts?.priceUsd ?? token.lastPriceUsd;
  const change24h = facts?.priceChange24hPct ?? null;

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
            <span className="mt-1 flex flex-wrap items-center gap-3">
              <Address address={token.address} label="token address" />
              <GeckoTerminalLink chain={token.chain} address={token.address} symbol={token.symbol} label="GeckoTerminal" />
            </span>
          </div>

          <div className="flex flex-col items-end gap-1.5">
            <p className="tnum text-2xl font-semibold">{formatUsd(price)}</p>
            {change24h === null ? null : (
              <p className={cn("tnum text-xs font-medium", pnlTone(change24h, 1))}>
                {formatSignedPct(change24h, 1)} <span className="text-muted-foreground">24h</span>
              </p>
            )}
            {action}
          </div>
        </div>

        <dl className="tnum mt-4 grid grid-cols-2 gap-x-5 gap-y-2.5 font-mono text-xs sm:grid-cols-5">
          <Fact label="Market cap" value={formatCompactUsd(facts?.marketCapUsd ?? null)} />
          <Fact
            label="Liquidity"
            value={formatCompactUsd(score?.liquidityUsd ?? lastKnown(page.history, "liquidityUsd") ?? facts?.liquidityUsd ?? null)}
          />
          <Fact label="24h volume" value={formatCompactUsd(facts?.volume24hUsd ?? null)} />
          <Fact
            label="Holders"
            value={formatHolders(score?.holderCount ?? lastKnown(page.history, "holderCount") ?? facts?.holderCount ?? null)}
          />
          <Fact label="Age" value={formatAge(facts?.ageHours ?? null)} />
        </dl>
      </div>
    </header>
  );
}

/** The newest history reading of one fact. A failed read lands as a point with nulls. */
function lastKnown(
  history: TokenPage["history"],
  key: "priceUsd" | "liquidityUsd" | "holderCount",
): number | null {
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const value = history[i][key];
    // The price chart drops non-positive prices; skip them too, so both end on one number.
    if (value !== null && !(key === "priceUsd" && value <= 0)) return value;
  }
  return null;
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 sm:block">
      <dt className="font-sans text-[10px] tracking-wide text-muted-foreground uppercase">{label}</dt>
      <dd className="sm:mt-0.5">{value}</dd>
    </div>
  );
}
