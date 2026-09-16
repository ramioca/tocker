"use client";

import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Check, Wallet } from "lucide-react";
import { Address } from "@/components/common/address";
import { ChainBadge } from "@/components/common/chain-badge";
import { formatTokenAmount, formatUsd } from "@/components/common/format";
import { RelativeTime } from "@/components/common/relative-time";
import { fetchWalletBalances } from "@/components/agents/agent-actions";
import { GLASS_ROW } from "@/components/wallets/surfaces";
import { NATIVE_SYMBOL, chainLabelFor } from "@/lib/wallets/funding";
import { getFundingIntents, type FundingIntentRow } from "@/server/actions/wallets";
import { cn } from "@/lib/utils";
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

function useFundingIntents(agentId: string) {
  return useQuery({
    queryKey: ["funding-intents", agentId],
    queryFn: async () => {
      const result = await getFundingIntents(agentId);
      return result.ok ? result.data : [];
    },
    staleTime: 15_000,
  });
}

function intentLabel(intent: FundingIntentRow): string {
  const symbol = intent.asset === "usdc" ? "USDC" : NATIVE_SYMBOL[intent.chain];
  return `${formatTokenAmount(intent.amount)} ${symbol} on ${chainLabelFor(intent.chain)}`;
}

/**
 * When an agent was created with a funding plan, one of those transfers may have
 * been rejected in the wallet popup. The agent still exists — it is simply
 * unfunded, and saying so is the whole job of this block. The Fund drawer above
 * finishes it.
 */
function UnfinishedFunding({ intents }: { intents: FundingIntentRow[] }) {
  const unfinished = intents.filter((i) => i.status !== "sent");
  if (unfinished.length === 0) return null;

  return (
    <div className="mt-3 space-y-2 rounded-xl border border-destructive/25 bg-destructive/8 p-3">
      <p className="flex items-center gap-2 text-xs font-medium">
        <AlertTriangle aria-hidden className="size-3.5 text-destructive" />
        Funding did not finish
      </p>
      <ul className="space-y-1">
        {unfinished.map((intent) => (
          <li key={intent.id} className="text-[11px] leading-relaxed text-muted-foreground">
            <span className="tnum">{intentLabel(intent)}</span>
            {intent.status === "pending"
              ? " never reached the chain"
              : intent.status === "cancelled"
                ? " was not attempted"
                : " was rejected"}
            {intent.error ? ` — ${intent.error}` : "."}{" "}
            <RelativeTime iso={intent.createdAt} />
          </li>
        ))}
      </ul>
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        The agent exists and is safe; it just has less than you meant it to. Use Fund above to send
        the rest.
      </p>
    </div>
  );
}

function RecentFunding({ intents }: { intents: FundingIntentRow[] }) {
  const sent = intents.filter((i) => i.status === "sent").slice(0, 3);
  if (sent.length === 0) return null;

  return (
    <ul className="mt-3 space-y-1">
      {sent.map((intent) => (
        <li key={intent.id} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Check aria-hidden className="size-3 text-positive" />
          <span className="tnum">{intentLabel(intent)}</span>
          <span>sent</span>
          <RelativeTime iso={intent.createdAt} />
        </li>
      ))}
    </ul>
  );
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
  const { data: intents } = useFundingIntents(agentId);
  const wallets = data ?? [];

  const cashUsd = wallets.reduce((sum, wallet) => {
    const usdc = wallet.balances.find((b) => b.asset === "usdc");
    return sum + (usdc ? (usdc.usd ?? usdc.amount) : 0);
  }, 0);

  return (
    <section className="rounded-xl border border-border/70 bg-card/30 p-4">
      <div className="flex items-center gap-2">
        <Wallet aria-hidden className="size-4 text-muted-foreground" />
        <h2 className="text-sm font-medium">Agent wallets</h2>
        {wallets.length > 0 ? (
          <div className="ml-auto">
            <FundAgentDrawer agentId={agentId} agentName={agentName} wallets={wallets} />
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
        <>
          <p className="tnum mt-3 text-sm">
            <span className="font-medium">{formatUsd(cashUsd)}</span>{" "}
            <span className="text-xs text-muted-foreground">
              {cashUsd > 0 ? "of USDC across its wallets" : "— this agent is not funded yet"}
            </span>
          </p>

          <ul className="mt-3 space-y-2">
            {wallets.map((wallet) => (
              <li key={wallet.walletId} className={cn(GLASS_ROW, "p-3")}>
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
        </>
      )}

      {intents ? <UnfinishedFunding intents={intents} /> : null}
      {intents ? <RecentFunding intents={intents} /> : null}
    </section>
  );
}
