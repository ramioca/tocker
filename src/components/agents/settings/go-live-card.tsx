"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Zap } from "lucide-react";
import { toast } from "sonner";
import { LiquidMetal } from "@/components/common/liquid-metal";
import { ModeBadge } from "@/components/common/mode-badge";
import { formatUsd } from "@/components/common/format";
import { safeAction } from "@/lib/safe-action";
import { backToPaperAction } from "@/server/actions/security";
import { useWalletBalances } from "./wallets-card";
import { FundAgentDrawer } from "./fund-agent-drawer";
import type { AgentDetail } from "@/server/types";

/** Enough USDC to place a trade. Network fees are Tocker's, never the agent's. */
const MIN_USDC = 5;

/**
 * Mode, from the settings page.
 *
 * Going live is deliberately NOT a button here any more. It is one link into
 * `/agents/[slug]/live`, where ten preconditions are checked on the server
 * behind a second factor and the switch refuses while any is red. A
 * hold-to-confirm sitting next to a funding number was the entire ceremony for
 * the most consequential switch in the product; now the ceremony is a checklist
 * that can say no. The link keeps the chrome, because it is still the one
 * consequential control on this card.
 *
 * Going *back* to paper stays here and stays one click: stopping is never the
 * direction that needs friction.
 */
export function GoLiveCard({ agent, isAdmin = false }: { agent: AgentDetail; isAdmin?: boolean }) {
  const router = useRouter();
  const { data: wallets = [] } = useWalletBalances(agent.id);

  const usdc = wallets
    .filter((wallet) => agent.chains.includes(wallet.chain))
    .flatMap((wallet) => wallet.balances)
    .filter((balance) => balance.asset === "usdc")
    .reduce((sum, balance) => sum + balance.amount, 0);

  const live = agent.mode === "live";
  // The product default is `approve`, and this card used to say flatly that live mode
  // has "no approval step in between" — which would have the operator believe their
  // first tick placed a trade when what it placed was a proposal waiting on them.
  // Say whichever is actually configured.
  const approves = agent.config?.execution.mode === "approve";

  const backToPaper = async () => {
    const result = await safeAction(() => backToPaperAction(agent.id));
    if (!result.ok) {
      toast.error("Mode not changed", { description: result.error });
      return;
    }
    toast.success("Back on paper", { description: "Fills are simulated from here." });
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
            To stop it now, pause the agent; its stop loss keeps working. You can switch back to paper once
            its live positions are sold. To stop every agent you own at once, use the kill switch in{" "}
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
            Live mode means real money moves from the agent&rsquo;s own wallet.{" "}
            {approves ? (
              <>
                This agent is set to <span className="text-foreground">propose and wait for you</span>: each
                trade it decides on appears as a proposal you approve or reject, and nothing is signed until
                you do.
              </>
            ) : (
              <>
                This agent is set to <span className="text-foreground">trade on its own</span>: it signs
                without asking, and its risk caps and wallet budget are the only things between the model and
                your balance.
              </>
            )}{" "}
            Either way it is not a toggle: the checklist walks ten preconditions — database, wallet infrastructure,
            your second factor, real wallets, funding, network fees, spend caps, risk, data sources and the kill
            switch — and refuses while any of them is red.
          </p>

          <dl className="mt-3 space-y-1.5">
            <div className="flex items-center justify-between gap-3 text-xs">
              <dt className="text-muted-foreground">USDC to trade with</dt>
              <dd className={usdc >= MIN_USDC ? "tnum text-positive" : "tnum text-muted-foreground"}>
                {formatUsd(usdc)} / {formatUsd(MIN_USDC)} minimum
              </dd>
            </div>
            <div className="flex items-center justify-between gap-3 text-xs">
              <dt className="text-muted-foreground">Who approves a trade</dt>
              <dd className="text-foreground">{approves ? "You, per trade" : "The agent, on its own"}</dd>
            </div>
          </dl>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            {/* The one truly consequential control in settings keeps the chrome. */}
            <LiquidMetal preset="chromatic" theme="dark" strength={0.85}>
              <Link
                href={`/agents/${agent.slug}/live`}
                className="inline-flex h-8 items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-3 text-xs font-medium text-primary transition-[background-color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-primary/15 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Zap aria-hidden className="size-3.5" />
                Start the first-live-trade checklist
              </Link>
            </LiquidMetal>
            {/* Always offered. Hiding Fund the moment the balance clears the minimum is
                what made topping up hard to find — $5 is a floor, not a target. */}
            <FundAgentDrawer agentId={agent.id} agentName={agent.name} wallets={wallets} isAdmin={isAdmin} />
          </div>
        </>
      )}
    </section>
  );
}
