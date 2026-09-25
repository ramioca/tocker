"use client";

import { useState } from "react";
import { AlertTriangle, Plus, RotateCw } from "lucide-react";
import { toast } from "sonner";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Address } from "@/components/common/address";
import { ChainBadge } from "@/components/common/chain-badge";
import { FeesCovered } from "@/components/common/fees-covered";
import { formatUsd, truncateAddress } from "@/components/common/format";
import { CashTotal } from "@/components/wallets/cash-summary";
import { DepositSheet } from "@/components/wallets/deposit-sheet";
import { useRefreshCash, useUserWallets } from "@/components/wallets/use-cash";
import { useTransfer } from "@/components/wallets/use-transfer";
import { useSession } from "@/hooks/use-session";
import {
  FUND_PRESETS,
  NETWORK_WORDING,
  cashOn,
  chainLabelFor,
  feeFailureKind,
  floorTo,
  userFacingTransferError,
} from "@/lib/wallets/funding";
import {
  recordFundingIntents,
  settleFundingIntent,
} from "@/server/actions/wallets";
import { cn } from "@/lib/utils";
import type { Chain, WalletBalance } from "@/server/types";

/** Privy is only wired once an app id exists; until then this is a copy-address flow. */
const PRIVY_CONFIGURED = Boolean(process.env.NEXT_PUBLIC_PRIVY_APP_ID);

interface FundProps {
  agentId: string;
  agentName: string;
  /** The agent's own server wallets, one per enabled chain. */
  wallets: WalletBalance[];
}

/**
 * Funding moves real value, so the flow is deliberately plain: pick a chain, type
 * an amount, read the transfer back, confirm once. Nothing animates: the review is
 * static text rather than controls that look pickable, and Send stays disabled —
 * with the reason under it — until there is something it can actually send.
 *
 * The amount is checked against the user's actual balance on that chain before
 * they are asked to sign — an over-ask becomes a deposit prompt rather than a
 * failed transaction and a wasted signature.
 *
 * USDC only, and the user never needs SOL or ETH to send it: on Solana Tocker's own
 * fee wallet is the fee payer (and pays the rent on the agent's USDC account), on Base
 * the transfer is sponsored. If a fee does fail that is Tocker's problem, and the drawer
 * says so: when the fee wallet was caught mid-refuel it offers the same send again; when
 * Tocker cannot pay this fee at all (sponsorship off, a co-sign refused) it says nothing
 * moved and does not pretend a retry will work. It never opens a deposit sheet for gas.
 */
function FundBody({ agentId, agentName, wallets }: FundProps) {
  const { ready, session } = useSession();
  const { data } = useUserWallets(Boolean(ready && session));
  const [chain, setChain] = useState<Chain>(wallets[0]?.chain ?? "base");
  const asset = "usdc" as const;
  const [amount, setAmount] = useState("");
  const [pending, setPending] = useState(false);
  const [depositOpen, setDepositOpen] = useState(false);
  /**
   * Set when the transfer failed on its network fee — Tocker's side, never the user's.
   * `retry` only when the fee wallet was short for a moment and the same send can work.
   */
  const [feeFailed, setFeeFailed] = useState<{ message: string; retry: boolean } | null>(null);
  const { send, available } = useTransfer();
  const refresh = useRefreshCash();

  const target = wallets.find((entry) => entry.chain === chain) ?? wallets[0];
  const myCash = data?.cash;
  const myChain = myCash ? cashOn(myCash, chain) : null;
  const availableHere = myChain ? myChain.usdc : 0;

  const parsed = Number(amount);
  const positive = Number.isFinite(parsed) && parsed > 0;
  const overBalance = positive && myChain !== null && parsed > availableHere;
  const valid = positive && Boolean(target) && !overBalance;
  const sendDisabled = !valid || pending || !available;
  // Why Send is dead, in the order the user would fix it. Nothing while pending: the
  // label already says what it is waiting for.
  const sendBlockedReason = pending
    ? null
    : !available
      ? "Wallets aren’t available here yet."
      : !positive
        ? "Enter an amount."
        : overBalance
          ? `More than you hold on ${chainLabelFor(chain)}.`
          : null;

  const confirm = async () => {
    if (!valid || !target || pending) return;
    setPending(true);
    setFeeFailed(null);

    const recorded = await recordFundingIntents({
      agentId,
      transfers: [{ chain, asset, amount: parsed, amountUsd: parsed }],
    });
    const intentId = recorded.ok ? recorded.data.ids[0] : undefined;

    try {
      const result = await send({ chain, asset, amount: parsed, to: target.address });
      if (intentId) {
        void settleFundingIntent({ id: intentId, status: "sent", txHash: result.hash });
      }
      toast.success("Funding sent", {
        description: `${truncateAddress(result.hash, 8, 6)} — balances update once it confirms.`,
      });
      setAmount("");
      void refresh();
      void refresh(12_000);
    } catch (error) {
      // `useTransfer` has already turned an SDK failure into a sentence. The only
      // question left is whether it was the network fee — Tocker's to fix, never a
      // reason to ask this user for SOL or ETH — or anything else (a cancel, say).
      const message = error instanceof Error ? error.message : "Your wallet rejected the request.";
      if (intentId) {
        void settleFundingIntent({ id: intentId, status: "failed", error: message });
      }
      const readable = userFacingTransferError(message, chain);
      const kind = feeFailureKind(message);
      if (kind) setFeeFailed({ message: readable, retry: kind === "refuel" });
      toast.error("Transfer failed", { description: readable });
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between gap-3 rounded-xl border border-border/50 bg-background/40 px-3 py-2.5">
        <span className="text-xs text-muted-foreground">Your cash</span>
        <span className="text-right">
          <CashTotal cash={myCash} size="sm" />
          {myChain ? (
            <span className="tnum block text-[11px] text-muted-foreground">
              {formatUsd(myChain.usdcUsd)} on {chainLabelFor(chain)}
            </span>
          ) : null}
        </span>
      </div>

      <div>
        <span className="mb-1 block text-xs text-muted-foreground">Chain</span>
        <div className="grid grid-cols-2 gap-1 rounded-xl border border-border/60 bg-muted/20 p-1">
          {wallets.map((wallet) => (
            <button
              key={wallet.chain}
              type="button"
              aria-pressed={wallet.chain === chain}
              onClick={() => {
                setChain(wallet.chain);
                setFeeFailed(null);
              }}
              className={cn(
                "h-8 rounded-lg text-xs font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                wallet.chain === chain
                  ? "bg-card text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {chainLabelFor(wallet.chain)}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label htmlFor="fund-amount" className="mb-1 block text-xs text-muted-foreground">
          Amount
        </label>
        <Input
          id="fund-amount"
          value={amount}
          inputMode="decimal"
          placeholder="25"
          onChange={(event) => setAmount(event.target.value.replace(/[^0-9.]/g, ""))}
          className="tnum font-mono"
        />
        <div className="mt-2 flex items-center gap-1.5">
          {FUND_PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => setAmount(String(preset))}
              className="tnum h-7 flex-1 rounded-lg border border-border text-xs text-muted-foreground transition-colors duration-150 hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              ${preset}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setAmount(String(floorTo(availableHere, 2)))}
            className="h-7 flex-1 rounded-lg border border-border text-xs text-muted-foreground transition-colors duration-150 hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Max
          </button>
        </div>
      </div>

      {overBalance ? (
        <div className="space-y-2 rounded-xl border border-destructive/25 bg-destructive/8 p-3">
          <p className="flex gap-2 text-xs leading-relaxed text-muted-foreground">
            <AlertTriangle aria-hidden className="mt-px size-3.5 shrink-0 text-destructive" />
            <span>
              You have {formatUsd(availableHere)} of USDC on {chainLabelFor(chain)}. Deposit more, or
              send less — this never quietly sends the smaller amount.
            </span>
          </p>
          <button
            type="button"
            onClick={() => setDepositOpen(true)}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-medium transition-colors duration-150 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Plus aria-hidden className="size-3.5" />
            Deposit USDC on {chainLabelFor(chain)}
          </button>
        </div>
      ) : null}

      {/* Not red: nothing is wrong with the user's wallet, and nothing is theirs to fix. */}
      {feeFailed ? (
        <div className="space-y-2 rounded-xl border border-border/60 bg-muted/20 p-3" role="status">
          <p className="text-xs leading-relaxed text-muted-foreground">{feeFailed.message}</p>
          {feeFailed.retry ? (
            <button
              type="button"
              disabled={pending || !valid}
              onClick={() => void confirm()}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-medium transition-[background-color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-muted active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <RotateCw aria-hidden className="size-3.5" />
              Try again
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="space-y-3">
        <div>
          <h3 className="text-sm font-medium">Fund {agentName}</h3>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            From your embedded wallet to the agent&apos;s own wallet. The agent signs its own trades from there.
          </p>
        </div>
        <dl className="space-y-2 rounded-xl border border-border/60 bg-card/40 p-3 text-xs">
          <ReviewRow label="From">Your wallet on {chainLabelFor(chain)}</ReviewRow>
          <ReviewRow label="To">
            {target ? `${agentName} · ${truncateAddress(target.address, 6, 6)}` : "—"}
          </ReviewRow>
          <ReviewRow label="Network">{NETWORK_WORDING[chain].network}</ReviewRow>
          <div className="flex items-baseline justify-between gap-3 border-t border-border/50 pt-2">
            <dt className="font-medium text-foreground">Agent receives</dt>
            <dd className="tnum text-right font-mono text-sm font-medium">
              {positive ? `${formatUsd(parsed)} USDC` : "—"}
            </dd>
          </div>
        </dl>
        <Button
          className="w-full"
          size="lg"
          disabled={sendDisabled}
          aria-describedby={sendDisabled && sendBlockedReason ? "fund-send-reason" : undefined}
          onClick={() => void confirm()}
        >
          {pending ? "Waiting for your wallet to confirm…" : `Send ${positive ? `${formatUsd(parsed)} ` : ""}USDC`}
        </Button>
        {sendDisabled && sendBlockedReason ? (
          <p id="fund-send-reason" className="-mt-1 text-xs text-muted-foreground">
            {sendBlockedReason}
          </p>
        ) : null}
      </div>
      {/* A footnote to the button, so it sits close under it rather than a full gap away. */}
      <FeesCovered className="-mt-2 justify-center" />

      <DepositSheet
        open={depositOpen}
        onOpenChange={setDepositOpen}
        wallets={data?.wallets ?? []}
        cash={data?.cash}
        initialChain={chain}
      />
    </div>
  );
}

function ReviewRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate text-right">{children}</dd>
    </div>
  );
}

function FundFallback({ agentName, wallets }: Omit<FundProps, "agentId">) {
  return (
    <div className="space-y-3">
      <p className="rounded-xl border border-border/70 bg-card/40 p-3 text-sm leading-relaxed text-muted-foreground">
        In-app funding needs Privy configured (<code className="font-mono">NEXT_PUBLIC_PRIVY_APP_ID</code>
        ). Until then, send USDC to {agentName}&apos;s addresses from any wallet — the agent trades
        from whatever lands there.
      </p>
      <ul className="space-y-2">
        {wallets.map((wallet) => (
          <li
            key={wallet.walletId}
            className="space-y-1.5 rounded-xl border border-border/70 bg-card/40 px-3 py-2.5"
          >
            <div className="flex items-center justify-between gap-3">
              <ChainBadge chain={wallet.chain} />
              <Address address={wallet.address} label={`${wallet.chain} address`} />
            </div>
            <p className="text-[11px] text-muted-foreground">
              {NETWORK_WORDING[wallet.chain].asset} · {NETWORK_WORDING[wallet.chain].network}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function FundAgentDrawer({
  agentId,
  agentName,
  wallets,
  trigger,
}: FundProps & { trigger?: React.ReactNode }) {
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          (trigger as React.ReactElement) ?? (
            <button
              type="button"
              className="inline-flex h-8 items-center rounded-lg border border-border px-3 text-xs font-medium transition-[background-color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-muted active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Fund
            </button>
          )
        }
      />
      {/* Same-variant classes, so tailwind-merge replaces the primitive's 75% width. */}
      <SheetContent side="right" className="overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="text-sm">Fund {agentName}</SheetTitle>
          <SheetDescription className="text-xs">
            The agent trades from these wallets. Its data is paid for by Tocker&apos;s platform wallet and charged to its data budget.
          </SheetDescription>
        </SheetHeader>
        <div className="px-4 pb-6">
          {PRIVY_CONFIGURED ? (
            <FundBody agentId={agentId} agentName={agentName} wallets={wallets} />
          ) : (
            <FundFallback agentName={agentName} wallets={wallets} />
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
