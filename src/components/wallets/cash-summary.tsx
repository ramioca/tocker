"use client";

import { Fuel } from "lucide-react";
import { ChainBadge } from "@/components/common/chain-badge";
import { formatTokenAmount, formatUsd } from "@/components/common/format";
import { NATIVE_SYMBOL, chainLabelFor, type UnifiedCash } from "@/lib/wallets/funding";
import { cn } from "@/lib/utils";
import { GLASS_ROW } from "./surfaces";
import type { Chain } from "@/server/types";

/**
 * The one number. Everything else on these screens is context for it, so it is
 * the only thing set at display size and the only thing that never abbreviates.
 */
export function CashTotal({
  cash,
  size = "md",
  className,
}: {
  cash: UnifiedCash | undefined;
  size?: "sm" | "md" | "lg";
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
    <span className={cn("tnum tracking-tight", type, className)}>{formatUsd(cash.totalUsd)}</span>
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
          className={cn(GLASS_ROW, "flex items-center justify-between gap-3 px-3 py-2.5")}
        >
          <div className="min-w-0">
            <ChainBadge chain={chainCash.chain} />
            <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <Fuel aria-hidden className="size-3" />
              <span className="tnum">
                {formatTokenAmount(chainCash.native)} {NATIVE_SYMBOL[chainCash.chain]}
              </span>
              <span>gas</span>
            </p>
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
    </ul>
  );
}

/** "Cash" and "gas" said once, in the words the rest of the product uses. */
export function CashLegend({ cash }: { cash: UnifiedCash }) {
  return (
    <p className="text-[11px] leading-relaxed text-muted-foreground">
      Cash is USDC across your wallets on Base and Solana, shown as one balance. The{" "}
      <span className="tnum">{formatUsd(cash.gasUsd)}</span> of ETH and SOL is gas — it pays for
      transactions and is never traded.
    </p>
  );
}
