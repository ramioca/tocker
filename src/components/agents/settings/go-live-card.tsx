"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Zap } from "lucide-react";
import { toast } from "sonner";
import { ModeBadge } from "@/components/common/mode-badge";
import { formatUsd } from "@/components/common/format";
import { backToPaperAction } from "@/server/actions/security";
import { useWalletBalances } from "./wallets-card";
import { FundAgentDrawer } from "./fund-agent-drawer";
import type { AgentDetail } from "@/server/types";

/** Enough USDC to place a trade and enough native to pay for gas. */
const MIN_USDC = 5;

/**
 * Mode, from the settings page.
 *
 * Going live is deliberately NOT a button here any more. It is one link into
 * `/agents/[slug]/live`, where every precondition is checked on the server behind
 * a second factor. A hold-to-confirm sitting next to a funding number was the
 * whole ceremony for the most consequential switch in the product; now the
 * ceremony is a checklist that can refuse.
 *
 * Going *back* to paper stays here and stays one click: stopping is never the
 * direction that needs friction.
 */
export function GoLiveCard({ agent }: { agent: AgentDetail }) {
  const router = useRouter();
  const { data: wallets = [] } = useWalletBalances(agent.id);

  const usdc = wallets
    .filter((wallet) => agent.chains.includes(wallet.chain))
    .flatMap((wallet) => wallet.balances)
    .filter((balance) => balance.asset === "usdc")
    .reduce((sum, balance) => sum + balance.amount, 0);

  const gas = wallets
    .filter((wallet) => agent.chains.includes(wallet.chain))
    .flatMap((wallet) => wallet.balances)
    .filter((balance) => balance.asset !== "usdc")
    .reduce((sum, balance) => sum + (balance.usd ?? 0), 0);

  const funded = usdc >= MIN_USDC && gas > 0;
  const live = agent.mode === "live";

  const backToPaper = async () => {
    const result = await backToPaperAction(agent.id);
    if (!result.ok) {
      toast.error("Mode not changed", { description: result.error });
      return;
    }
    toast.success("Back on paper", { description: "Fills are simulated again. Positions carry over." });
    router.refresh();
  };

  return (
    <section className="glass rounded-xl border border-border/70 bg-card/30 p-4">
      <div className="flex items-center gap-2">
        <Zap aria-hidden className="size-4 text-muted-foreground" />
        <h2 className="text-sm font-medium">Mode</h2>
        <ModeBadge mode={agent.mode} className="ml-auto" />
      </div>

      {live ? (
        <>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            This agent is spending real money, up to {formatUsd(agent.config?.risk.maxTradeUsd ?? 0)} a trade.
            Switching back to paper stops that immediately; open positions stay on the books and are marked at
            live prices. To stop every agent you own at once, use the kill switch in{" "}
            <Link href="/settings/security" className="text-foreground underline underline-offset-2">
              Settings → Security
            </Link>
            .
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void backToPaper()}
              className="inline-flex h-8 items-center rounded-lg border border-border px-3 text-xs font-medium transition-[background-color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-muted active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Switch back to paper
            </button>
            <Link
              href={`/agents/${agent.slug}/live`}
              className="inline-flex h-8 items-center gap-1 rounded-lg px-2.5 text-xs text-muted-foreground transition-colors duration-150 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Run one tick and read the receipt
              <ArrowRight aria-hidden className="size-3" />
            </Link>
          </div>
        </>
      ) : (
        <>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            Live mode means the agent signs real transactions from its own wallet, with no approval step in
            between. Its risk caps are the only thing standing between the model and your balance, so it is not a
            toggle: the checklist walks nine preconditions — database, Privy, your second factor, real wallets,
            funding, caps, risk, data sources and the kill switch — and refuses while any is red.
          </p>

          <dl className="mt-3 space-y-1.5">
            <div className="flex items-center justify-between gap-3 text-xs">
              <dt className="text-muted-foreground">USDC to trade with</dt>
              <dd className={usdc >= MIN_USDC ? "tnum text-positive" : "tnum text-muted-foreground"}>
                {formatUsd(usdc)} / {formatUsd(MIN_USDC)} minimum
              </dd>
            </div>
            <div className="flex items-center justify-between gap-3 text-xs">
              <dt className="text-muted-foreground">Native balance for gas</dt>
              <dd className={gas > 0 ? "tnum text-positive" : "tnum text-muted-foreground"}>{formatUsd(gas)}</dd>
            </div>
          </dl>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Link
              href={`/agents/${agent.slug}/live`}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-primary/40 bg-primary/10 px-3 text-xs font-medium text-primary transition-[background-color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-primary/15 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Zap aria-hidden className="size-3.5" />
              Start the first-live-trade checklist
            </Link>
            {funded ? null : <FundAgentDrawer agentName={agent.name} wallets={wallets} />}
          </div>
        </>
      )}
    </section>
  );
}
