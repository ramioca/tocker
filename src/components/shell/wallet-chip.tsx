"use client";

import { useState } from "react";
import { ArrowUpRight, ChevronDown, CreditCard, Plus } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Address } from "@/components/common/address";
import { ChainBadge } from "@/components/common/chain-badge";
import { formatUsd } from "@/components/common/format";
import { useSession } from "@/hooks/use-session";
import type { WalletBalance } from "@/server/types";
import { WithdrawModal } from "./withdraw-modal";

export interface MeWallets {
  wallets: WalletBalance[];
  cashUsd: number;
}

export const ME_WALLETS_QUERY_KEY = ["me-wallets"] as const;

async function fetchWallets(): Promise<MeWallets> {
  const res = await fetch("/api/me/wallets", { credentials: "include", cache: "no-store" });
  if (!res.ok) throw new Error(`/api/me/wallets failed: ${res.status}`);
  return (await res.json()) as MeWallets;
}

export function useUserWallets(enabled: boolean) {
  return useQuery({
    queryKey: ME_WALLETS_QUERY_KEY,
    queryFn: fetchWallets,
    enabled,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
}

/**
 * The money end of the top bar, fomo-style: your cash where you can always see
 * it, with Deposit and Withdraw hanging off the chip. "Cash" is USDC in your own
 * embedded wallets — what you fund agents from, not any agent's trading balance.
 */
export function WalletChip() {
  const { ready, session } = useSession();
  const { data } = useUserWallets(Boolean(ready && session));
  const [depositOpen, setDepositOpen] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);

  if (!ready || !session) return null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-border bg-muted/30 px-2.5 text-sm transition-colors duration-150 hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none sm:h-8"
          aria-label="Cash balance — deposit or withdraw"
        >
          {data ? (
            <span className="tnum font-medium">{formatUsd(data.cashUsd)}</span>
          ) : (
            <span className="h-3.5 w-10 animate-pulse rounded bg-muted/60" aria-hidden />
          )}
          <span className="hidden text-xs text-muted-foreground sm:inline">cash</span>
          <ChevronDown aria-hidden className="size-3.5 text-muted-foreground" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuItem onClick={() => setDepositOpen(true)}>
            <Plus aria-hidden className="size-4" />
            Deposit
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setWithdrawOpen(true)}>
            <ArrowUpRight aria-hidden className="size-4" />
            Withdraw
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <DepositModal open={depositOpen} onOpenChange={setDepositOpen} wallets={data?.wallets ?? []} />
      <WithdrawModal
        open={withdrawOpen}
        onOpenChange={setWithdrawOpen}
        wallets={data?.wallets ?? []}
      />
    </>
  );
}

function DepositModal({
  open,
  onOpenChange,
  wallets,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  wallets: WalletBalance[];
}) {
  const queryClient = useQueryClient();
  const [syncing, setSyncing] = useState(false);

  const resync = async () => {
    setSyncing(true);
    try {
      await fetch("/api/me/sync", { method: "POST", credentials: "include" });
      await queryClient.invalidateQueries({ queryKey: ME_WALLETS_QUERY_KEY });
    } finally {
      setSyncing(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Deposit</DialogTitle>
          <DialogDescription>
            Transfer USDC from any crypto wallet to your Tocker cash wallet.
          </DialogDescription>
        </DialogHeader>

        {wallets.length > 0 ? (
          <ul className="space-y-2">
            {wallets.map((wallet) => (
              <li
                key={wallet.walletId}
                className="flex items-center justify-between gap-3 rounded-xl border border-border/70 bg-muted/20 px-3.5 py-3"
              >
                <ChainBadge chain={wallet.chain} />
                <Address address={wallet.address} label={`${wallet.chain} deposit address`} />
              </li>
            ))}
          </ul>
        ) : (
          <div className="space-y-3 rounded-xl border border-border/70 bg-muted/20 p-3.5 text-sm text-muted-foreground">
            <p>
              Your embedded wallets have not been recorded yet. Sync once and your deposit
              addresses appear here.
            </p>
            <button
              type="button"
              onClick={() => void resync()}
              disabled={syncing}
              className="inline-flex h-8 items-center rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground transition-transform duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-primary/90 active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-60"
            >
              {syncing ? "Syncing…" : "Sync wallets"}
            </button>
          </div>
        )}

        <div className="flex items-center justify-between gap-3 rounded-xl border border-border/50 bg-muted/10 px-3.5 py-3 text-muted-foreground">
          <div className="flex items-center gap-2.5">
            <CreditCard aria-hidden className="size-4" />
            <div>
              <p className="text-sm">Credit or debit</p>
              <p className="text-xs">Coming soon</p>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
