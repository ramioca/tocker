"use client";

import { useRouter } from "next/navigation";
import { Zap } from "lucide-react";
import { toast } from "sonner";
import { LiquidMetal } from "@/components/common/liquid-metal";
import { HoldToConfirmButton } from "@/components/spectrumui/hold-to-confirm";
import { ModeBadge } from "@/components/common/mode-badge";
import { formatUsd } from "@/components/common/format";
import { setAgentModeAction } from "@/components/agents/agent-actions";
import { useWalletBalances } from "./wallets-card";
import { FundAgentDrawer } from "./fund-agent-drawer";
import type { AgentDetail } from "@/server/types";

/** Enough USDC to place a trade and enough native to pay for gas. */
const MIN_USDC = 5;

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

  const setMode = async (mode: "paper" | "live") => {
    const result = await setAgentModeAction(agent.id, mode);
    if (!result.ok) {
      toast.error("Mode not changed", { description: result.error });
      return;
    }
    toast.success(mode === "live" ? "Trading live" : "Back on paper", {
      description:
        mode === "live"
          ? "Every fill from here spends real money from the agent's wallet."
          : "Fills are simulated again. Positions carry over.",
    });
    router.refresh();
  };

  return (
    <section className="rounded-xl border border-border/70 bg-card/30 p-4">
      <div className="flex items-center gap-2">
        <Zap aria-hidden className="size-4 text-muted-foreground" />
        <h2 className="text-sm font-medium">Mode</h2>
        <ModeBadge mode={agent.mode} className="ml-auto" />
      </div>

      {live ? (
        <>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            This agent is spending real money. Switching back to paper stops that immediately;
            open positions stay on the books and are marked at live prices.
          </p>
          <button
            type="button"
            onClick={() => void setMode("paper")}
            className="mt-3 inline-flex h-8 items-center rounded-lg border border-border px-3 text-xs font-medium transition-[background-color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-muted active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Switch back to paper
          </button>
        </>
      ) : (
        <>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            Live mode means the agent signs real transactions from its own wallet, with no approval
            step in between. Its risk caps are the only thing standing between the model and your
            balance.
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
              <dd className={gas > 0 ? "tnum text-positive" : "tnum text-muted-foreground"}>
                {formatUsd(gas)}
              </dd>
            </div>
          </dl>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            {funded ? (
              /* The one truly consequential button in settings gets the chrome. */
              <LiquidMetal preset="chromatic" theme="dark" strength={0.85}>
                <HoldToConfirmButton
                  size="sm"
                  duration={1_800}
                  label="Hold to go live"
                  confirmedLabel="Live"
                  onConfirm={() => void setMode("live")}
                />
              </LiquidMetal>
            ) : (
              <>
                <p className="text-xs text-muted-foreground">
                  Fund the wallet first — at least {formatUsd(MIN_USDC)} of USDC and a little native
                  for gas.
                </p>
                <FundAgentDrawer agentName={agent.name} wallets={wallets} />
              </>
            )}
          </div>
        </>
      )}
    </section>
  );
}
