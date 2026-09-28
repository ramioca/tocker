"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { SimpleSelect } from "@/components/agents/builder/simple-select";
import { truncateAddress } from "@/components/common/format";
import { FullAddress } from "@/components/common/address";
import { withdrawFromPlatformAction } from "@/server/actions/platform";
import { addressProblemForChain, normalizeAddressForChain } from "@/lib/wallet-address";
import {
  PLATFORM_SOL_FLOOR,
  platformWithdrawable,
  platformWithdrawProblem,
  platformWithdrawWarning,
  type PlatformAsset,
} from "@/lib/platform/withdraw";
import { cn } from "@/lib/utils";
import type { Chain } from "@/server/types";

const BUTTON =
  "inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-medium transition-[background-color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-muted active:scale-[0.97] disabled:pointer-events-none disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/**
 * Withdraw from one platform wallet — the admin's way to take revenue out.
 *
 * Collapsed to one button until asked for: this sits on the card the admin reads every
 * day, and a live send form open by default is a form someone eventually fills in by
 * accident. Same shape as the agent withdraw form (fill, review, confirm), and the same
 * limits the server action enforces, from `src/lib/platform/withdraw.ts`, so "Max" never
 * offers an amount the server would refuse.
 *
 * Mounted only inside `PlatformCard`, which lives behind `requireAdmin()`; the action
 * re-checks admin on its own.
 */
export function PlatformWithdraw({
  chain,
  address,
  usdc,
  native,
}: {
  chain: Chain;
  /** The platform wallet's own address — refused as a destination. */
  address: string;
  usdc: number | null;
  native: number | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [asset, setAsset] = useState<PlatformAsset>("usdc");
  const [amount, setAmount] = useState("");
  const [toAddress, setToAddress] = useState("");
  const [reviewing, setReviewing] = useState(false);
  const [pending, setPending] = useState(false);

  const balances = { usdc, native };
  const nativeSymbol = chain === "solana" ? "SOL" : "ETH";
  const symbol = asset === "usdc" ? "USDC" : nativeSymbol;
  const max = platformWithdrawable(chain, asset, balances);
  const amountNum = Number(amount);
  const amountProblem =
    amount.length === 0 ? null : platformWithdrawProblem({ chain, asset, amount: amountNum, balances });
  const trimmed = toAddress.trim();
  const addressProblem =
    trimmed.length === 0
      ? null
      : (addressProblemForChain(chain, trimmed) ??
        (trimmed.toLowerCase() === address.toLowerCase() ? "That is this wallet's own address." : null));
  const canReview = amount.length > 0 && amountProblem === null && trimmed.length > 0 && addressProblem === null;
  const warning = canReview ? platformWithdrawWarning({ chain, asset, amount: amountNum, balances }) : null;

  const reset = () => {
    setAmount("");
    setToAddress("");
    setAsset("usdc");
    setReviewing(false);
    setOpen(false);
  };

  const send = async () => {
    setPending(true);
    let result: Awaited<ReturnType<typeof withdrawFromPlatformAction>>;
    try {
      result = await withdrawFromPlatformAction({
        chain,
        asset,
        amount: amountNum,
        toAddress: normalizeAddressForChain(chain, trimmed),
      });
    } catch {
      toast.error("Withdrawal status unknown", {
        description: "The connection dropped before Tocker answered. Check the balance and the audit log before retrying.",
      });
      return;
    } finally {
      setPending(false);
    }

    if (!result.ok) {
      toast.error("Withdrawal failed", { description: result.error });
      return;
    }
    const { txHash, status } = result.data;
    if (status === "succeeded") {
      toast.success("Withdrawal confirmed", { description: txHash ? truncateAddress(txHash, 8, 6) : "It landed on chain." });
    } else {
      toast.message("Withdrawal submitted", {
        description: txHash
          ? `${truncateAddress(txHash, 8, 6)} — waiting for it to confirm.`
          : "It is broadcasting. The balance updates once it confirms.",
      });
    }
    reset();
    router.refresh();
  };

  if (!open) {
    return (
      <div className="mt-3">
        <button type="button" className={BUTTON} disabled={usdc === null && native === null} onClick={() => setOpen(true)}>
          Withdraw
        </button>
      </div>
    );
  }

  const idPrefix = `platform-withdraw-${chain}`;

  return (
    <div className="mt-3 rounded-lg border border-border/70 bg-muted/10 p-3">
      {reviewing ? (
        <div className="space-y-3">
          <dl className="space-y-2 text-sm">
            <div className="flex items-center justify-between gap-3">
              <dt className="text-muted-foreground">Amount</dt>
              <dd className="tnum font-mono font-medium">
                {amount} {symbol}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-muted-foreground">From</dt>
              <dd>Platform {chain} wallet</dd>
            </div>
            <div className="flex items-start justify-between gap-3">
              <dt className="shrink-0 text-muted-foreground">To</dt>
              <dd className="min-w-0 text-right">
                <FullAddress address={trimmed} className="justify-end" />
              </dd>
            </div>
          </dl>
          {warning ? <p className="text-xs text-amber-700 dark:text-amber-400">{warning}</p> : null}
          <p className="text-xs text-destructive">This sends real funds on-chain and cannot be undone. Check the address.</p>
          <div className="flex items-center gap-2">
            <button type="button" className={BUTTON} disabled={pending} onClick={() => setReviewing(false)}>
              <ArrowLeft aria-hidden className="size-3.5" />
              Back
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => void send()}
              className="inline-flex h-8 items-center rounded-lg bg-destructive px-3 text-xs font-semibold text-destructive-foreground transition-transform duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-destructive/90 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {pending ? "Sending…" : `Confirm — send ${amount} ${symbol}`}
            </button>
          </div>
        </div>
      ) : (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (canReview) setReviewing(true);
          }}
        >
          <div>
            <label htmlFor={`${idPrefix}-asset`} className="mb-1 block text-xs text-muted-foreground">
              Asset
            </label>
            <SimpleSelect
              id={`${idPrefix}-asset`}
              value={asset}
              options={[
                { value: "usdc", label: "USDC" },
                { value: "native", label: nativeSymbol },
              ]}
              onChange={(next) => {
                setAsset(next as PlatformAsset);
                setAmount("");
              }}
            />
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between gap-2">
              <label htmlFor={`${idPrefix}-amount`} className="block text-xs text-muted-foreground">
                Amount
              </label>
              {max !== null ? (
                <button
                  type="button"
                  onClick={() => setAmount(String(max))}
                  className="tnum rounded text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  Available {max.toLocaleString("en-US", { maximumFractionDigits: 6 })} {symbol} · Max
                </button>
              ) : null}
            </div>
            <Input
              id={`${idPrefix}-amount`}
              value={amount}
              inputMode="decimal"
              placeholder="0.00"
              aria-invalid={amountProblem !== null}
              onChange={(event) => setAmount(event.target.value.replace(/[^0-9.]/g, ""))}
              className="tnum font-mono"
            />
            {amountProblem ? (
              <p className="mt-1 text-xs text-destructive">{amountProblem}</p>
            ) : asset === "native" && chain === "solana" ? (
              <p className="mt-1 text-xs text-muted-foreground">
                {PLATFORM_SOL_FLOOR} SOL always stays: this wallet pays every network fee on Solana.
              </p>
            ) : null}
          </div>

          <div>
            <label htmlFor={`${idPrefix}-to`} className="mb-1 block text-xs text-muted-foreground">
              Destination address
            </label>
            <Input
              id={`${idPrefix}-to`}
              value={toAddress}
              placeholder={chain === "solana" ? "7xKX…MpTqL" : "0x9A3f…8d90"}
              aria-invalid={addressProblem !== null}
              onChange={(event) => setToAddress(event.target.value)}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              className="font-mono"
            />
            {addressProblem ? <p className="mt-1 text-xs text-destructive">{addressProblem}</p> : null}
          </div>

          <div className="flex items-center gap-2">
            <button type="button" className={BUTTON} onClick={reset}>
              Cancel
            </button>
            <button type="submit" disabled={!canReview} className={cn(BUTTON, "bg-card")}>
              Review withdrawal
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
