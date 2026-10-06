"use client";

import Link from "next/link";
import { ArrowDownToLine, Wallet, Zap } from "lucide-react";
import { ModeBadge } from "@/components/common/mode-badge";
import { formatUsd } from "@/components/common/format";
import { useWalletBalances } from "./wallets-card";
import { FundAgentDrawer } from "./fund-agent-drawer";
import { cn } from "@/lib/utils";
import type { AgentDetail, WalletBalance } from "@/server/types";

/**
 * Money first.
 *
 * Settings opened on the strategy editor — status, identity, prompt, universe,
 * execution, schedule, risk, exits — and only then, eight cards down, the three things
 * an operator actually comes to this page to do: put money in, go live, take money out.
 * Funding a new agent meant scrolling past the entire editor to find out where the
 * button was, which is the single most-reported piece of "I could not find it" in the
 * review.
 *
 * So the money lives at the top, in one strip: the balance, the mode, and the three
 * actions. The strip is not a replacement for the cards below — Wallets, Budget, Mode
 * and Withdraw keep their full detail, and the strip's own controls either open the same
 * sheet (Fund) or jump to the same card (Withdraw), so there is exactly one of each
 * behaviour in the product.
 *
 * It is the same balance number as the Wallets card because it is the same query key
 * (`useWalletBalances`), hydrated from the server on first paint, so the two can never
 * disagree.
 */
export function MoneyStrip({
  agent,
  initialBalances,
  isAdmin = false,
}: {
  agent: AgentDetail;
  initialBalances: WalletBalance[];
  isAdmin?: boolean;
}) {
  const { data: wallets = [] } = useWalletBalances(agent.id, initialBalances);

  const usdc = wallets
    .filter((wallet) => agent.chains.includes(wallet.chain))
    .flatMap((wallet) => wallet.balances)
    .filter((balance) => balance.asset === "usdc")
    .reduce((sum, balance) => sum + balance.amount, 0);

  // A wallet that could not be read contributed a zero that means "unknown". The strip
  // says so instead of "$0.00", and leaves Withdraw reachable: there may be money there.
  const unread = wallets.some((wallet) => agent.chains.includes(wallet.chain) && wallet.readFailed);

  const live = agent.mode === "live";
  const canWithdraw = usdc > 0 || unread;

  return (
    <section
      aria-labelledby="money-strip-heading"
      className="glass rounded-xl border border-border/70 bg-card/30 p-4"
    >
      <h2 id="money-strip-heading" className="sr-only">
        Money
      </h2>

      {/* Column at 390px, row from `sm`. The balance is the first thing read in both. */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-baseline gap-2">
          <Wallet aria-hidden className="size-4 shrink-0 translate-y-0.5 text-muted-foreground" />
          <div>
            <p className="tnum font-mono text-xl leading-none font-medium tracking-tight">
              {unread ? <span className="text-muted-foreground">—</span> : formatUsd(usdc)}
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {unread ? "Balance unavailable right now" : <>USDC in {agent.name}&rsquo;s wallets</>}
            </p>
          </div>
          <ModeBadge mode={agent.mode} className="ml-1 self-center" />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <FundAgentDrawer
            agentId={agent.id}
            agentName={agent.name}
            wallets={wallets}
            isAdmin={isAdmin}
            trigger={
              <button type="button" className={cn(ACTION, "border-primary/40 bg-primary/10 text-primary hover:bg-primary/15")}>
                <ArrowDownToLine aria-hidden className="size-3.5" />
                Fund
              </button>
            }
          />

          <Link href={`/agents/${agent.slug}/live`} className={cn(ACTION, "border-border hover:bg-muted")}>
            <Zap aria-hidden className="size-3.5" />
            {live ? "Run a live tick" : "Go live"}
          </Link>

          {/*
            Withdraw jumps to the real form rather than duplicating it. A second place to
            type an address and press send is a second place to get it wrong, and the
            form below already knows the balances and the chain rules.
          */}
          {canWithdraw ? (
            <a href="#withdraw" className={cn(ACTION, "border-border hover:bg-muted")}>
              Withdraw
            </a>
          ) : (
            // A disabled button, not a dead link: out of the Tab order, and said as
            // "dimmed" rather than offered as somewhere to go.
            <button type="button" disabled className={cn(ACTION, "border-border opacity-40")}>
              Withdraw
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

const ACTION =
  "inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium " +
  "transition-[background-color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] " +
  "active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
