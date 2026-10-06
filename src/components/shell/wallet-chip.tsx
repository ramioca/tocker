"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowUpRight, ChevronDown, Plus, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { cashPanelTitle, cashScopeLabel, cashUnavailable } from "@/components/wallets/cash-display";
import { CashLegend, CashTotal, ChainBreakdown } from "@/components/wallets/cash-summary";
import { ME_WALLETS_QUERY_KEY, useUserWallets } from "@/components/wallets/use-cash";
import { useSession } from "@/hooks/use-session";
import { preferredDepositChain } from "@/lib/wallets/funding";
import { cn } from "@/lib/utils";
import type { Chain } from "@/server/types";
import type { AgentCash } from "@/lib/wallets/funding";

/*
 * Deposit and Withdraw are a few taps a week, and Withdraw drags in the signing path
 * (@solana/web3.js, viem's transfer helpers). The chip is on every page, so both load
 * on demand: they mount the first time the Cash panel opens, and the chunk downloads
 * while the panel is being read rather than with every page.
 */
const DepositSheet = dynamic(
  () => import("@/components/wallets/deposit-sheet").then((mod) => mod.DepositSheet),
  { ssr: false },
);
const WithdrawModal = dynamic(() => import("./withdraw-modal").then((mod) => mod.WithdrawModal), {
  ssr: false,
});

/*
 * The chip at rest with a typical "$0.00": what it reserves before the session is known
 * and the least it ever shrinks to, so the Search box and the buttons beside it do not
 * slide twice on every load. Phone widths drop the "cash" (or "total") label.
 */
const CHIP_MIN_WIDTH = "min-w-[4.875rem] sm:min-w-[6.875rem]";

/** A stable empty list: the Withdraw dialog memoises on it. */
const NO_AGENTS: AgentCash[] = [];

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
 *
 * Once the number also counts what the user's agents hold it is labelled "total", not
 * "cash": part of it is open positions, and Home's Cash is the wallets alone.
 */
export function WalletChip() {
  const { ready, session } = useSession();
  const { data, isError, refetch, isRefetching } = useUserWallets(Boolean(ready && session));
  // Only when there is nothing to show: a failed background refetch keeps the last number.
  const failed = isError && !data;
  // The request answered, but a wallet or an agent in it could not be read. There is no
  // total to print, yet the rows that were read and the deposit addresses still stand.
  const partial = data ? cashUnavailable(data.cash, "all") : false;
  const scopeLabel = cashScopeLabel(data?.cash);
  // Land on the same mark as the page: every navigation re-reads the balance, so the
  // chip and an agent page rendered a moment later agree to the cent.
  const pathname = usePathname();
  const queryClient = useQueryClient();
  useEffect(() => {
    void queryClient.invalidateQueries({ queryKey: ME_WALLETS_QUERY_KEY });
  }, [pathname, queryClient]);
  const [depositOpen, setDepositOpen] = useState(false);
  // Overwritten by `openDeposit` before the sheet is ever shown; Solana only decides
  // the first render, and it is the better default of the two (see preferredDepositChain).
  const [depositChain, setDepositChain] = useState<Chain>("solana");
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  // Latches on the first open of the Cash panel; see DepositSheet / WithdrawModal above.
  const [moneyFlowsWanted, setMoneyFlowsWanted] = useState(false);

  // The chip outlives every navigation, and so would its surfaces: a link inside the
  // deposit sheet (an agent under "Where your cash sits") would leave the sheet open
  // over the page it opened. Any route change closes all three. Adjusted during render,
  // not in an effect, so the new page never paints with the old sheet on it.
  const [lastPathname, setLastPathname] = useState(pathname);
  if (pathname !== lastPathname) {
    setLastPathname(pathname);
    setDepositOpen(false);
    setWithdrawOpen(false);
    setPanelOpen(false);
  }

  // Held open until the session is known, like the avatar beside it.
  if (!ready) {
    return (
      <div
        aria-hidden
        className={cn("h-9 shrink-0 rounded-lg border border-border bg-muted/30 sm:h-8", CHIP_MIN_WIDTH)}
      />
    );
  }
  if (!session) return null;

  const openDeposit = (chain: Chain) => {
    setDepositChain(chain);
    setPanelOpen(false);
    setDepositOpen(true);
  };

  return (
    <>
      <Popover
        open={panelOpen}
        onOpenChange={(next) => {
          setPanelOpen(next);
          if (next) {
            setMoneyFlowsWanted(true);
            // Never a figure older than the click: Withdraw opens from here, on whichever
            // chain this says the cash is on.
            void refetch();
          }
        }}
      >
        <PopoverTrigger
          className={cn(
            "flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-border bg-muted/30 px-2.5 text-sm transition-colors duration-150 hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none sm:h-8",
            CHIP_MIN_WIDTH,
          )}
          aria-label={
            failed || partial
              ? "Balance unavailable — deposit or withdraw"
              : scopeLabel === "total"
                ? "Total balance — deposit or withdraw"
                : "Cash balance — deposit or withdraw"
          }
        >
          {failed || partial ? (
            <span className="text-sm font-medium text-muted-foreground">—</span>
          ) : data ? (
            <CashTotal cash={data.cash} size="sm" scope="all" />
          ) : (
            // CashTotal's own small skeleton is wider than the "$0.00" most chips settle
            // on; this one is the number's width, so the chip does not shrink as it lands.
            <span aria-hidden className="block h-[1.1rem] w-9 rounded bg-muted/60 motion-safe:animate-pulse" />
          )}
          <span className="hidden text-xs text-muted-foreground sm:inline">{scopeLabel}</span>
          <ChevronDown
            aria-hidden
            className={cn(
              "size-3.5 text-muted-foreground transition-transform duration-200 ease-[cubic-bezier(0.23,1,0.32,1)]",
              panelOpen && "rotate-180",
            )}
          />
        </PopoverTrigger>

        <PopoverContent align="end" collisionPadding={16} className="glass-heavy w-[calc(100vw-2rem)] sm:w-80 space-y-3 rounded-2xl border border-border/60 p-4">
          <div>
            {/* The panel's name: without it the dialog is announced as just "dialog". */}
            <PopoverTitle className="text-[11px] font-normal text-muted-foreground">
              {cashPanelTitle(data?.cash)}
            </PopoverTitle>
            {failed || partial ? (
              <p className="mt-0.5 text-3xl font-semibold text-muted-foreground" aria-hidden>
                —
              </p>
            ) : (
              <CashTotal cash={data?.cash} size="lg" scope="all" className="mt-0.5 block" />
            )}
          </div>

          {failed || partial ? (
            // A skeleton that never resolves reads as "still loading" forever; say it failed.
            <div role="alert" className="flex items-center justify-between gap-3 rounded-xl border border-border/60 bg-muted/20 px-3 py-2.5">
              <p className="text-xs text-muted-foreground">
                {failed ? "Couldn’t load your balance." : "Couldn’t load all of your balance."}
              </p>
              <Button
                variant="outline"
                size="sm"
                disabled={isRefetching}
                onClick={() => void refetch()}
              >
                <RotateCw aria-hidden className={cn(isRefetching && "motion-safe:animate-spin")} />
                {isRefetching ? "Retrying…" : "Retry"}
              </Button>
            </div>
          ) : null}

          {data ? (
            <>
              {/* Kept when only part of it could not be read: the rows that were read, and
                  the deposit addresses, are still true. The unread row says "Unavailable". */}
              <ChainBreakdown cash={data.cash} onDeposit={openDeposit} onNavigate={() => setPanelOpen(false)} />
              <CashLegend cash={data.cash} />
            </>
          ) : failed ? null : (
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
            {/* Withdraw opens on the chain the cash is on, so it waits for the balance; the
                panel above already says whether that is loading or failed. */}
            <button
              type="button"
              disabled={!data}
              onClick={() => {
                setPanelOpen(false);
                setWithdrawOpen(true);
              }}
              className="inline-flex h-9 items-center justify-center gap-1.5 rounded-xl border border-border px-3 text-sm transition-[background-color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-muted active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
            >
              <ArrowUpRight aria-hidden className="size-4" />
              Withdraw
            </button>
          </div>
        </PopoverContent>
      </Popover>

      {moneyFlowsWanted ? (
        <>
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
            // The chip's number counts agents' money; the dialog has to know where it is.
            agents={data?.cash.agents ?? NO_AGENTS}
            onDeposit={() => {
              setWithdrawOpen(false);
              openDeposit(preferredDepositChain(data?.cash));
            }}
          />
        </>
      ) : null}
    </>
  );
}
