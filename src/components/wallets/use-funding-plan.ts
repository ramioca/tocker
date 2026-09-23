"use client";

import { useMemo } from "react";
import { useSession } from "@/hooks/use-session";
import { planFunding, type FundingPlan, type UnifiedCash } from "@/lib/wallets/funding";
import { useUserWallets } from "./use-cash";
import type { Chain, WalletBalance } from "@/server/types";

export interface FundingPlanInput {
  mode: "paper" | "fund";
  amountUsd: number;
  /**
   * Ignored. Funding is USDC only and network fees are Tocker's, so there is no gas
   * allowance to plan. Accepted so a caller still passing the draft's field compiles.
   */
  gasUsd?: number;
  chains: Chain[];
  split: Partial<Record<Chain, number>> | null;
}

export interface UseFundingPlan {
  /** null while the balances are still loading. */
  plan: FundingPlan | null;
  cash: UnifiedCash | undefined;
  wallets: WalletBalance[];
  loading: boolean;
}

/**
 * One derivation of "what will actually be transferred, and what is stopping
 * it", shared by the builder's Funding step and its submit handler so the button
 * and the sentence under it can never disagree.
 */
export function useFundingPlan(input: FundingPlanInput): UseFundingPlan {
  const { ready, session } = useSession();
  const enabled = Boolean(ready && session);
  const { data, isPending } = useUserWallets(enabled);
  const cash = data?.cash;

  const { mode, amountUsd, chains, split } = input;
  const chainKey = chains.join(",");
  const splitKey = split ? JSON.stringify(split) : "";

  const plan = useMemo(() => {
    if (mode === "paper") {
      return planFunding({
        mode: "paper",
        amountUsd: 0,
        chains,
        cash: { totalUsd: 0, gasUsd: 0, perChain: [], inAgentsUsd: 0, agents: [], allUsd: 0 },
      });
    }
    if (!cash) return null;
    return planFunding({ mode, amountUsd, chains, cash, split: split ?? undefined });
    // `chainKey` / `splitKey` stand in for the array and object identities, which
    // are new on every render of the draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, amountUsd, chainKey, splitKey, cash]);

  return {
    plan,
    cash,
    wallets: data?.wallets ?? [],
    loading: enabled && isPending,
  };
}
