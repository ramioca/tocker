"use client";

import { useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { AlertTriangle, Check, ChevronDown, Copy, RefreshCw } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { FullAddress, useCopy } from "@/components/common/address";
import { Button } from "@/components/ui/button";
import { ChainBadge } from "@/components/common/chain-badge";
import { FeesCovered } from "@/components/common/fees-covered";
import { formatUsd } from "@/components/common/format";
import {
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
}

/**
 * Deposit: buy, or receive.
 *
 * Two paths, in that order, because most people want the first and only some
 * people can use the second. Both are per-chain — an onramp lands on one chain
 * and there is no bridge in v1 — so the chain is chosen once at the top and
 * everything below it follows.
 *
 * USDC only, on both chains. There used to be a "SOL / ETH for gas" variant of this
 * sheet for a blocker that asked the user to deposit gas; no such blocker exists any
 * more, because every network fee is Tocker's — Privy sponsors Base, and Tocker's own
 * fee wallet pays on Solana. One quiet line says so, and that is all the user needs.
 */
export function DepositSheet({
  open,
  onOpenChange,
  wallets,
  cash,
  initialChain = "base",
}: DepositSheetProps) {
  const [chain, setChain] = useState<Chain>(initialChain);

  // Reopening from a different blocker must land on that blocker's chain, and
  // a chain the user picked last time must not stick. Adjusted during render
  // rather than in an effect — no cascading re-render, no flash of the old tab.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setChain(initialChain);
  }

  const resolved = useMemo(() => cash ?? unifiedCash(wallets), [cash, wallets]);
  const chainCash = cashOn(resolved, chain);
  const wording = NETWORK_WORDING[chain];
  const syncWallets = useSyncWallets();
  const [syncing, setSyncing] = useState(false);
  // Why a sync came back empty. Without it the button just stopped spinning.
  const [syncNote, setSyncNote] = useState<string | null>(null);
  const tabsRef = useRef<HTMLDivElement>(null);
  const selectedTabRef = useRef<HTMLButtonElement>(null);
  const uid = useId();
  const tabId = (entry: Chain) => `${uid}-tab-${entry}`;
  const panelId = `${uid}-panel`;

  const resync = async () => {
    setSyncing(true);
    setSyncNote(null);
    try {
      const result = await syncWallets();
      if (result.wallets.length === 0) {
        setSyncNote(
          result.note === "privy not configured"
            ? "Wallet sync isn’t available in this environment."
            : "No wallet to sync yet.",
        );
      }
    } catch {
      setSyncNote("Could not reach Tocker. Try again in a moment.");
    } finally {
      setSyncing(false);
    }
  };

  const selectChain = (next: Chain) => {
    setChain(next);
    setSyncNote(null);
  };

  // Roving focus per the ARIA tabs pattern, as on the leaderboard: one tab stop, and
  // the arrows move the selection with the focus.
  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const last = CHAINS.length - 1;
    const next =
      event.key === "ArrowRight"
        ? (i + 1) % CHAINS.length
        : event.key === "ArrowLeft"
          ? (i + last) % CHAINS.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? last
              : null;
    if (next === null) return;
    event.preventDefault();
    selectChain(CHAINS[next]);
    event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
  };

  // "Deposit on …" sits at the bottom of the sheet; the tabs and address it switches are
  // at the top, so bring them into view instead of changing something off-screen.
  const depositOn = (next: Chain) => {
    setChain(next);
    setSyncNote(null);
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    tabsRef.current?.scrollIntoView({ block: "nearest", behavior: reduced ? "auto" : "smooth" });
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      {/* `data-[side=right]:` so these replace the sheet's own 3/4 width and max-w-sm rather than lose to them. */}
      {/* Opens on the selected network, not the first tab: a sheet opened for Solana
          used to put focus on Base. */}
      <SheetContent
        side="right"
        initialFocus={selectedTabRef}
        className="overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-md"
      >
        <SheetHeader>
          <SheetTitle className="text-sm">Deposit</SheetTitle>
          <SheetDescription className="text-xs">
            Add USDC to your Tocker cash. It is what you fund agents from.
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-4 px-4 pb-8">
          <div className="glass rounded-2xl border border-border/60 px-4 py-3.5">
            {/*
              "In your wallets", not "Your cash": the top bar's Cash also counts what live
              agents hold, and one word must not name two numbers a click apart.
            */}
            <p className="text-[11px] text-muted-foreground">In your wallets</p>
            <CashTotal cash={resolved} size="lg" className="mt-0.5" />
            {resolved.inAgentsUsd > 0 ? (
              <p className="tnum text-xs text-muted-foreground">
                plus {formatUsd(resolved.inAgentsUsd)} working in your agents
              </p>
            ) : null}
            <p className="mt-2 text-[11px] text-muted-foreground">
              USDC on Base and Solana, added up. Deposits land on one chain and stay there —
              there is no bridge yet.
            </p>
            <FeesCovered className="mt-2" />
          </div>

          <div
            ref={tabsRef}
            role="tablist"
            aria-label="Deposit network"
            className="scroll-mt-4 grid grid-cols-2 gap-1 rounded-xl border border-border/60 bg-muted/20 p-1"
          >
            {CHAINS.map((entry, i) => {
              const active = entry === chain;
              return (
                <button
                  key={entry}
                  ref={active ? selectedTabRef : undefined}
                  id={tabId(entry)}
                  role="tab"
                  type="button"
                  aria-selected={active}
                  aria-controls={panelId}
                  tabIndex={active ? 0 : -1}
                  onClick={() => selectChain(entry)}
                  onKeyDown={(event) => onTabKeyDown(event, i)}
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

          <div
            id={panelId}
            role="tabpanel"
            aria-labelledby={tabId(chain)}
            className="glass space-y-3 rounded-2xl border border-border/60 p-4"
          >
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

                {/*
                  Every character, like the withdraw confirm: this is the address people
                  paste into an exchange, and a truncated one is what address poisoning forges.
                */}
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">Your address</p>
                  <FullAddress address={chainCash.address} className="flex" />
                  <CopyAddressButton key={chainCash.address} address={chainCash.address} />
                </div>

                <dl className="space-y-2 border-t border-border/50 pt-3 text-xs">
                  <div className="flex flex-col gap-x-4 gap-y-0.5 sm:flex-row sm:justify-between">
                    <dt className="shrink-0 text-muted-foreground">Network</dt>
                    <dd className="sm:text-right">{wording.network}</dd>
                  </div>
                  <div className="flex flex-col gap-x-4 gap-y-0.5 sm:flex-row sm:justify-between">
                    <dt className="shrink-0 text-muted-foreground">Send only</dt>
                    <dd className="sm:text-right">{wording.asset}</dd>
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
                  {/* The chevron is what says this opens; without it the line read as a caption. */}
                  <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
                    Sending from Coinbase, Kraken or Binance?
                    <ChevronDown
                      aria-hidden
                      className="size-3 transition-transform duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] group-open:rotate-180"
                    />
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
                <p role="status" className="text-xs leading-relaxed empty:hidden">
                  {syncNote}
                </p>
              </div>
            )}
          </div>

          {ONRAMP_AVAILABLE ? (
            <div className="space-y-1.5">
              <OnrampButton chain={chain} address={chainCash.address ?? ""} amountUsd={25} />
              <p className="text-center text-[11px] text-muted-foreground">
                Card or exchange. Settles in a few minutes.
              </p>
            </div>
          ) : null}

          <div className="space-y-2">
            <h3 className="text-xs font-medium text-muted-foreground">Where your cash sits</h3>
            <ChainBreakdown cash={resolved} onDeposit={depositOn} />
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** Keyed by address, so switching chains never shows "Copied" for an address that was not. */
function CopyAddressButton({ address }: { address: string }) {
  const { copied, failed, copy } = useCopy();
  return (
    <Button variant="outline" size="lg" className="w-full" onClick={() => void copy(address)}>
      {copied ? (
        <Check aria-hidden className="text-positive" />
      ) : failed ? (
        <AlertTriangle aria-hidden className="text-destructive" />
      ) : (
        <Copy aria-hidden />
      )}
      {/* Said in the button, not a toast: a toast behind this modal sheet may never be
          announced, and a refused clipboard used to look like nothing happened. */}
      <span aria-live="polite">
        {copied ? "Copied" : failed ? "Couldn't copy — select the address above" : "Copy address"}
      </span>
    </Button>
  );
}
