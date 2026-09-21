"use client";

import Link from "next/link";
import { ChainBadge } from "@/components/common/chain-badge";
import { formatUsd } from "@/components/common/format";
import { chainLabelFor, type UnifiedCash } from "@/lib/wallets/funding";
import { cn } from "@/lib/utils";
import type { Chain } from "@/server/types";

/**
 * The one number. Everything else on these screens is context for it, so it is
 * the only thing set at display size and the only thing that never abbreviates.
 */
export function CashTotal({
  cash,
  size = "md",
  scope = "own",
  className,
}: {
  cash: UnifiedCash | undefined;
  size?: "sm" | "md" | "lg";
  /** "own": the user's wallets (what they can fund with). "all": plus what their live agents hold. */
  scope?: "own" | "all";
  className?: string;
}) {
  const type =
    size === "lg" ? "text-3xl font-semibold" : size === "md" ? "text-xl font-semibold" : "text-sm font-medium";

  if (!cash) {
    return (
      <span
        className={cn("block animate-pulse rounded bg-muted/60", className)}
        style={{ width: size === "lg" ? "6rem" : "4rem", height: size === "lg" ? "1.9rem" : "1.1rem" }}
        aria-label="Loading your balance"
      />
    );
  }

  return (
    <span className={cn("tnum tracking-tight", type, className)}>
      {formatUsd(scope === "all" ? cash.allUsd : cash.totalUsd)}
    </span>
  );
}

/**
 * Where that number actually sits. One row per chain: USDC as cash, native as
 * gas underneath in small type, because they are not the same kind of thing and
 * a user who confuses them funds an agent that cannot trade.
 */
export function ChainBreakdown({
  cash,
  onDeposit,
  className,
}: {
  cash: UnifiedCash;
  onDeposit?: (chain: Chain) => void;
  className?: string;
}) {
  return (
    <ul className={cn("space-y-2", className)}>
      {cash.perChain.map((chainCash) => (
        <li
          key={chainCash.chain}
          className="flex items-center justify-between gap-3 rounded-xl border border-border/50 bg-background/40 px-3 py-2.5"
        >
          <div className="min-w-0">
            <ChainBadge chain={chainCash.chain} />
          </div>

          <div className="text-right">
            <p className="tnum text-sm font-medium">{formatUsd(chainCash.usdcUsd)}</p>
            {onDeposit ? (
              <button
                type="button"
                onClick={() => onDeposit(chainCash.chain)}
                className="mt-0.5 rounded text-[11px] text-muted-foreground transition-colors duration-150 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Deposit on {chainLabelFor(chainCash.chain)}
              </button>
            ) : (
              <p className="text-[11px] text-muted-foreground">USDC</p>
            )}
          </div>
        </li>
      ))}
      {cash.agents.map((agent) => (
        <li
          key={agent.id}
          className="flex items-center justify-between gap-3 rounded-xl border border-dashed border-border/50 bg-background/20 px-3 py-2.5"
        >
          <div className="min-w-0">
            <Link
              href={`/agents/${agent.slug}`}
              className="block truncate text-sm font-medium underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {agent.name}
            </Link>
            <p className="tnum text-[11px] text-muted-foreground">
              {agent.positionsUsd > 0
                ? `${formatUsd(agent.cashUsd)} cash · ${formatUsd(agent.positionsUsd)} in positions`
                : "agent equity — all cash"}
            </p>
          </div>
          <p className="tnum text-sm font-medium">{formatUsd(agent.equityUsd)}</p>
        </li>
      ))}
    </ul>
  );
}

/**
 * "Cash" and "gas" said once, in the words the rest of the product uses.
 *
 * W7 M2: it now says *who* pays. "Gas is sponsored" left the reader with no idea
 * whether that was them.
 *
 * W7 B1: and on Solana the answer changed. Tocker's platform wallet is the fee payer on
 * the transfers you sign there, not Privy's sponsor — which is why the sentence names
 * Tocker for both halves now instead of splitting them between two parties.
 */
export function CashLegend({ cash }: { cash: UnifiedCash }) {
  return (
    <p className="text-[11px] leading-relaxed text-muted-foreground">
      Cash is USDC across your wallets on Base and Solana{cash.agents.length > 0 ? ", plus your live agents' equity (their cash and open positions at today's marks)" : ""}, shown as one balance. Network
      fees are not yours to hold: Tocker&rsquo;s own wallet pays them, both for what you
      sign and for what your agents sign.
    </p>
  );
}
