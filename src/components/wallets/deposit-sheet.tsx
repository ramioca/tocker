"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Address } from "@/components/common/address";
import { ChainBadge } from "@/components/common/chain-badge";
import { formatUsd } from "@/components/common/format";
import {
  NATIVE_SYMBOL,
  NETWORK_WORDING,
  chainLabelFor,
  cashOn,
  unifiedCash,
  type UnifiedCash,
} from "@/lib/wallets/funding";
import { cn } from "@/lib/utils";
import { CashTotal, ChainBreakdown } from "./cash-summary";
import { ONRAMP_AVAILABLE, OnrampButton } from "./onramp-button";
import { QrCode } from "./qr-code";
import { useSyncWallets } from "./use-cash";
import type { Chain, WalletBalance } from "@/server/types";

const CHAINS: Chain[] = ["base", "solana"];

export interface DepositSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  wallets: WalletBalance[];
  cash?: UnifiedCash;
  /** Opens straight on this chain — what a blocked funding step passes through. */
  initialChain?: Chain;
  /** "native" swaps the copy to gas, for the "you have no SOL" blocker. */
  initialAsset?: "usdc" | "native";
}

/**
 * Deposit: buy, or receive.
 *
 * Two paths, in that order, because most people want the first and only some
 * people can use the second. Both are per-chain — an onramp lands on one chain
 * and there is no bridge in v1 — so the chain is chosen once at the top and
 * everything below it follows.
 */
export function DepositSheet({
  open,
  onOpenChange,
  wallets,
  cash,
  initialChain = "base",
  initialAsset = "usdc",
}: DepositSheetProps) {
  const [chain, setChain] = useState<Chain>(initialChain);
  const [asset, setAsset] = useState<"usdc" | "native">(initialAsset);

  // Reopening from a different blocker must land on that blocker's chain, and
  // a chain the user picked last time must not stick. Adjusted during render
  // rather than in an effect — no cascading re-render, no flash of the old tab.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setChain(initialChain);
      setAsset(initialAsset);
    }
  }

  const resolved = useMemo(() => cash ?? unifiedCash(wallets), [cash, wallets]);
  const chainCash = cashOn(resolved, chain);
  const wording = NETWORK_WORDING[chain];
  const syncWallets = useSyncWallets();
  const [syncing, setSyncing] = useState(false);

  const resync = async () => {
    setSyncing(true);
    try {
      await syncWallets();
    } finally {
      setSyncing(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="text-sm">Deposit</SheetTitle>
          <SheetDescription className="text-xs">
            Add USDC to your Tocker cash. It is what you fund agents from.
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-4 px-4 pb-8">
          <div className="glass rounded-2xl border border-border/60 px-4 py-3.5">
            <p className="text-[11px] text-muted-foreground">Your cash</p>
            <CashTotal cash={resolved} size="lg" className="mt-0.5" />
            <p className="mt-1 text-[11px] text-muted-foreground">
              USDC on Base and Solana, added up. Deposits land on one chain and stay there —
              there is no bridge yet.
            </p>
          </div>

          <div
            role="tablist"
            aria-label="Deposit network"
            className="grid grid-cols-2 gap-1 rounded-xl border border-border/60 bg-muted/20 p-1"
          >
            {CHAINS.map((entry) => {
              const active = entry === chain;
              return (
                <button
                  key={entry}
                  role="tab"
                  type="button"
                  aria-selected={active}
                  onClick={() => setChain(entry)}
                  className={cn(
                    "h-9 rounded-lg text-sm font-medium",
                    "transition-[background-color,color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.98]",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    active
                      ? "bg-card text-foreground shadow-[inset_0_1px_0_0_oklch(1_0_0/6%)]"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {chainLabelFor(entry)}
                </button>
              );
            })}
          </div>

          <div className="flex items-center justify-between rounded-xl border border-border/50 bg-background/40 px-3 py-2.5">
            <span className="text-xs text-muted-foreground">
              On {chainLabelFor(chain)} you hold
            </span>
            <span className="text-right">
              <span className="tnum block text-sm font-medium">{formatUsd(chainCash.usdcUsd)}</span>
            </span>
          </div>

          <div className="glass space-y-3 rounded-2xl border border-border/60 p-4">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-medium">Receive</h3>
              <ChainBadge chain={chain} />
            </div>

            {chainCash.address ? (
              <>
                <div className="flex justify-center py-1">
                  <QrCode
                    value={chainCash.address}
                    label={`${chainLabelFor(chain)} deposit address`}
                    size={168}
                  />
                </div>

                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-muted-foreground">Your address</span>
                  <Address
                    address={chainCash.address}
                    lead={8}
                    tail={8}
                    label={`${chainLabelFor(chain)} deposit address`}
                  />
                </div>

                <dl className="space-y-1.5 border-t border-border/50 pt-3 text-xs">
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">Network</dt>
                    <dd className="text-right">{wording.network}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">Send only</dt>
                    <dd className="text-right">
                      {asset === "native" ? `${NATIVE_SYMBOL[chain]} for gas` : wording.asset}
                    </dd>
                  </div>
                </dl>

                <p className="flex gap-2 rounded-lg border border-destructive/25 bg-destructive/8 p-2.5 text-[11px] leading-relaxed text-muted-foreground">
                  <AlertTriangle aria-hidden className="mt-px size-3.5 shrink-0 text-destructive" />
                  <span>{wording.warning}</span>
                </p>

                {/*
                  The recipe, because "send USDC here" is not actually the hard part —
                  picking the right network in an exchange's withdraw screen is, and
                  picking the wrong one loses the money.
                */}
                <details className="group border-t border-border/50 pt-3">
                  <summary className="cursor-pointer list-none text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    Sending from Coinbase, Kraken or Binance?
                  </summary>
                  <ol className="mt-2 space-y-1.5 text-[11px] leading-relaxed text-muted-foreground">
                    <li>
                      <span className="text-foreground">1.</span> Open Withdraw (or Send) and pick{" "}
                      <span className="text-foreground">USDC</span>. Not USDT, not USDbC.
                    </li>
                    <li>
                      <span className="text-foreground">2.</span> Set the network to{" "}
                      <span className="text-foreground">{wording.network}</span>. This is the step
                      that loses money if you get it wrong.
                    </li>
                    <li>
                      <span className="text-foreground">3.</span> Paste the address above and send a
                      small test amount first if this is your first time.
                    </li>
                    <li>
                      <span className="text-foreground">4.</span> It lands in a minute or two. Your
                      cash here updates on its own.
                    </li>
                  </ol>
                </details>
              </>
            ) : (
              <div className="space-y-3 text-sm text-muted-foreground">
                <p className="text-xs leading-relaxed">
                  Your {chainLabelFor(chain)} wallet has not been recorded yet. Sync once and the
                  address appears here.
                </p>
                <button
                  type="button"
                  onClick={() => void resync()}
                  disabled={syncing}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-medium transition-colors duration-150 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
                >
                  <RefreshCw aria-hidden className={cn("size-3.5", syncing && "animate-spin")} />
                  {syncing ? "Looking for your wallets…" : "Sync wallets"}
                </button>
              </div>
            )}
          </div>

          {ONRAMP_AVAILABLE ? (
            <div className="space-y-1.5">
              <OnrampButton chain={chain} address={chainCash.address ?? ""} amountUsd={25} />
              <p className="text-center text-[11px] text-muted-foreground">
                Card or exchange, through Privy. Settles in a few minutes.
              </p>
            </div>
          ) : null}

          <div className="space-y-2">
            <h3 className="text-xs font-medium text-muted-foreground">Where your cash sits</h3>
            <ChainBreakdown cash={resolved} onDeposit={setChain} />
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
