"use client";

import { useState } from "react";
import { ArrowUpRight, ChevronDown, Plus } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CashLegend, CashTotal, ChainBreakdown } from "@/components/wallets/cash-summary";
import { DepositSheet } from "@/components/wallets/deposit-sheet";
import { useUserWallets } from "@/components/wallets/use-cash";
import { useSession } from "@/hooks/use-session";
import { preferredDepositChain } from "@/lib/wallets/funding";
import { cn } from "@/lib/utils";
import { WithdrawModal } from "./withdraw-modal";
import type { Chain } from "@/server/types";

export { ME_WALLETS_QUERY_KEY, useUserWallets } from "@/components/wallets/use-cash";
export type { MeWallets } from "@/components/wallets/use-cash";

/**
 * The money end of the top bar: your cash where you can always see it, with
 * Deposit and Withdraw hanging off it.
 *
 * "Cash" is one number — USDC across your embedded wallets on both chains —
 * because that is how people think about a balance. Which chain it happens to
 * sit on is a detail, and it lives one click away in the breakdown rather than
 * in the number itself.
 */
export function WalletChip() {
  const { ready, session } = useSession();
  const { data } = useUserWallets(Boolean(ready && session));
  const [depositOpen, setDepositOpen] = useState(false);
  // Overwritten by `openDeposit` before the sheet is ever shown; Solana only decides
  // the first render, and it is the better default of the two (see preferredDepositChain).
  const [depositChain, setDepositChain] = useState<Chain>("solana");
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);

  if (!ready || !session) return null;

  const openDeposit = (chain: Chain) => {
    setDepositChain(chain);
    setPanelOpen(false);
    setDepositOpen(true);
  };

  return (
    <>
      <Popover open={panelOpen} onOpenChange={setPanelOpen}>
        <PopoverTrigger
          className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-border bg-muted/30 px-2.5 text-sm transition-colors duration-150 hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none sm:h-8"
          aria-label="Cash balance — deposit or withdraw"
        >
          <CashTotal cash={data?.cash} size="sm" />
          <span className="hidden text-xs text-muted-foreground sm:inline">cash</span>
          <ChevronDown
            aria-hidden
            className={cn(
              "size-3.5 text-muted-foreground transition-transform duration-200 ease-[cubic-bezier(0.23,1,0.32,1)]",
              panelOpen && "rotate-180",
            )}
          />
        </PopoverTrigger>

        <PopoverContent align="end" className="glass-heavy w-80 space-y-3 rounded-2xl border border-border/60 p-4">
          <div>
            <p className="text-[11px] text-muted-foreground">Cash</p>
            <CashTotal cash={data?.cash} size="lg" className="mt-0.5 block" />
          </div>

          {data ? (
            <>
              <ChainBreakdown cash={data.cash} onDeposit={openDeposit} />
              <CashLegend cash={data.cash} />
            </>
          ) : (
            <div className="space-y-2" role="status" aria-label="Loading your balances">
              <span className="block h-14 rounded-xl bg-muted/50 motion-safe:animate-pulse" aria-hidden />
              <span className="block h-14 rounded-xl bg-muted/50 motion-safe:animate-pulse" aria-hidden />
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={() => openDeposit(preferredDepositChain(data?.cash))}
              className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-xl bg-primary text-sm font-medium text-primary-foreground transition-[background-color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-primary/90 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Plus aria-hidden className="size-4" />
              Deposit
            </button>
            <button
              type="button"
              onClick={() => {
                setPanelOpen(false);
                setWithdrawOpen(true);
              }}
              className="inline-flex h-9 items-center justify-center gap-1.5 rounded-xl border border-border px-3 text-sm transition-[background-color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-muted active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ArrowUpRight aria-hidden className="size-4" />
              Withdraw
            </button>
          </div>
        </PopoverContent>
      </Popover>

      <DepositSheet
        open={depositOpen}
        onOpenChange={setDepositOpen}
        wallets={data?.wallets ?? []}
        cash={data?.cash}
        initialChain={depositChain}
      />
      <WithdrawModal
        open={withdrawOpen}
        onOpenChange={setWithdrawOpen}
        wallets={data?.wallets ?? []}
      />
    </>
  );
}
