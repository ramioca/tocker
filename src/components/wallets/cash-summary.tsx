"use client";

import Link from "next/link";
import { ChainBadge } from "@/components/common/chain-badge";
import { formatUsd } from "@/components/common/format";
import { agentSettingsHref } from "@/components/agents/settings/settings-href";
import { chainLabelFor, type UnifiedCash } from "@/lib/wallets/funding";
import { cn } from "@/lib/utils";
import type { Chain } from "@/server/types";
import { BALANCE_UNAVAILABLE, cashLegendLead, cashUnavailable, shownCashTotal, shownUsdc } from "./cash-display";

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
  /** "own": the user's wallets (what they can fund with). "all": plus what their agents hold. */
  scope?: "own" | "all";
  className?: string;
}) {
  const type =
    size === "lg" ? "text-3xl font-semibold" : size === "md" ? "text-xl font-semibold" : "text-sm font-medium";

  if (!cash) {
    return (
      <span
        className={cn("block motion-safe:animate-pulse rounded bg-muted/60", className)}
        style={{ width: size === "lg" ? "6rem" : size === "sm" ? "2.5rem" : "4rem", height: size === "lg" ? "1.9rem" : "1.1rem" }}
        aria-label="Loading your balance"
      />
    );
  }

  // A wallet (or, on the all-in figure, an agent) that could not be read: the sum in
  // hand is missing it, so there is no balance to print. A dash, never "$0.00".
  if (cashUnavailable(cash, scope)) {
    return (
      <span className={cn("tracking-tight text-muted-foreground", type, className)} title={BALANCE_UNAVAILABLE}>
        <span aria-hidden>—</span>
        <span className="sr-only">{BALANCE_UNAVAILABLE}</span>
      </span>
    );
  }

  return (
    <span className={cn("tnum tracking-tight", type, className)}>
      {formatUsd(shownCashTotal(cash, scope))}
    </span>
  );
}

/**
 * Where that number actually sits. One row per chain, USDC only: a leftover bit of
 * SOL or ETH in a wallet is not cash, and it is not something the user needs either,
 * so it is not shown here at all.
 */
export function ChainBreakdown({
  cash,
  onDeposit,
  onNavigate,
  className,
}: {
  cash: UnifiedCash;
  onDeposit?: (chain: Chain) => void;
  /**
   * Closes the surface this list sits in when an agent's Withdraw link is followed. A
   * route change closes it anyway; from that agent's own settings page only the step and
   * the hash change, and the panel would stay open over the card it just opened.
   */
  onNavigate?: () => void;
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
            {chainCash.readFailed ? (
              // Not "$0.00": the read failed, which says nothing about what is there.
              <p className="text-sm font-medium text-muted-foreground">Unavailable</p>
            ) : (
              <p className="tnum text-sm font-medium">{formatUsd(shownUsdc(chainCash.usdcUsd))}</p>
            )}
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
              {agent.parked
                ? "funded, not live yet"
                : agent.positionsUsd > 0
                  ? `${formatUsd(agent.cashUsd)} cash · ${formatUsd(agent.positionsUsd)} in positions`
                  : "agent equity — all cash"}
            </p>
          </div>
          <div className="shrink-0 text-right">
            <p className="tnum text-sm font-medium">{formatUsd(agent.equityUsd)}</p>
            {/* Straight to the agent's Withdraw card: this money cannot be sent from the
                cash Withdraw, and the agent's name above only leads to its page. */}
            <Link
              href={agentSettingsHref(agent.slug, "withdraw")}
              onClick={onNavigate}
              className="mt-0.5 inline-block rounded text-[11px] text-muted-foreground transition-colors duration-150 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Withdraw
            </Link>
          </div>
        </li>
      ))}
    </ul>
  );
}

/**
 * What the figure above it adds up, and who pays the fees, said once in the words the
 * rest of the product uses. It is "Cash" while it is only the user's own USDC, and
 * "Total" once it also counts what their agents hold (`cashLegendLead`).
 *
 * W7 M2 made it say *who* pays — "gas is sponsored" left the reader wondering whether
 * that was them. W8 made the answer the same everywhere: Tocker covers every network
 * fee, on both chains, for what the user signs and for everything their agents sign.
 * The sentence says that and nothing about SOL or ETH, which the user never needs.
 */
export function CashLegend({ cash }: { cash: UnifiedCash }) {
  return (
    <p className="text-[11px] leading-relaxed text-muted-foreground">
      {cashLegendLead(cash)}, shown as one balance. Network fees are covered by Tocker — on your transfers and
      on every trade your agents make.
    </p>
  );
}
