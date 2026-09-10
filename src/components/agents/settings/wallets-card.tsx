"use client";

import { useQuery } from "@tanstack/react-query";
import { Wallet } from "lucide-react";
import { Address } from "@/components/common/address";
import { ChainBadge } from "@/components/common/chain-badge";
import { formatTokenAmount, formatUsd } from "@/components/common/format";
import { fetchWalletBalances } from "@/components/agents/agent-actions";
import { FundAgentDrawer } from "./fund-agent-drawer";
import type { WalletBalance } from "@/server/types";

export function useWalletBalances(agentId: string, initial?: WalletBalance[]) {
  return useQuery({
    queryKey: ["wallet-balances", agentId],
    queryFn: () => fetchWalletBalances(agentId),
    initialData: initial,
    staleTime: 15_000,
  });
}

/**
 * Two wallets, one per chain, both owned by the agent and signed for by the
 * server. The addresses are the point — everything else is context.
 */
export function WalletsCard({
  agentId,
  agentName,
  initialBalances,
}: {
  agentId: string;
  agentName: string;
  initialBalances?: WalletBalance[];
}) {
  const { data, isPending } = useWalletBalances(agentId, initialBalances);
  const wallets = data ?? [];

  return (
    <section className="rounded-xl border border-border/70 bg-card/30 p-4">
      <div className="flex items-center gap-2">
        <Wallet aria-hidden className="size-4 text-muted-foreground" />
        <h2 className="text-sm font-medium">Agent wallets</h2>
        {wallets.length > 0 ? (
          <div className="ml-auto">
            <FundAgentDrawer agentName={agentName} wallets={wallets} />
          </div>
        ) : null}
      </div>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
        The agent signs its own trades and x402 payments from these. Funding them is what makes live
        mode possible.
      </p>

      {isPending ? (
        <div className="mt-3 space-y-2" role="status" aria-label="Loading balances">
          {Array.from({ length: 2 }, (_, i) => (
            <span
              key={i}
              className="block h-14 rounded-lg bg-muted/60 motion-safe:animate-pulse"
              aria-hidden
            />
          ))}
        </div>
      ) : (
        <ul className="mt-3 space-y-2">
          {wallets.map((wallet) => (
            <li key={wallet.walletId} className="rounded-lg border border-border/70 bg-background/40 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <ChainBadge chain={wallet.chain} />
                <Address address={wallet.address} label={`${wallet.chain} address`} />
              </div>
              <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-1">
                {wallet.balances.map((balance) => (
                  <li key={balance.asset} className="text-xs">
                    <span className="uppercase text-muted-foreground">{balance.asset}</span>{" "}
                    <span className="tnum font-mono">{formatTokenAmount(balance.amount)}</span>
                    {balance.usd !== null ? (
                      <span className="tnum ml-1.5 text-muted-foreground">
                        ({formatUsd(balance.usd)})
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
