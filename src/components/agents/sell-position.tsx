"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { formatPriceUsd, formatTokenAmount, formatUsd } from "@/components/common/format";
import { placeManualTrade, previewTrade } from "@/server/actions/trading";
import { cn } from "@/lib/utils";
import type { Position, TradePreview } from "@/server/types";

const SLICES = [25, 50, 75, 100] as const;

/**
 * Sell part or all of one position by hand, from the book. Owner only — the button is
 * rendered only when the table is told the viewer may trade.
 *
 * The amount is in dollars of the position at today's mark, because that is how the
 * rest of the product sizes a trade; the dialog turns it into tokens itself. A preview
 * (the guard's answer and Jupiter's price) runs as the number changes, and the fill goes
 * through the same manual-trade path as the header's Trade sheet, so it is guarded,
 * receipted and published exactly like any other sell.
 */
export function SellPositionButton({ agentId, position }: { agentId: string; position: Position }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md border border-border px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors duration-150 hover:border-negative/50 hover:text-negative focus-ring"
      >
        Sell
      </button>
      {open ? <SellPositionDialog agentId={agentId} position={position} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function SellPositionDialog({
  agentId,
  position,
  onClose,
}: {
  agentId: string;
  position: Position;
  onClose: () => void;
}) {
  const router = useRouter();
  const valueUsd = position.valueUsd ?? 0;
  const [amountText, setAmountText] = useState(valueUsd > 0 ? valueUsd.toFixed(2) : "");
  // Keyed by the amount it answers for, so a stale answer is simply not shown rather
  // than cleared with a synchronous setState (which React flags as a cascading render).
  const [preview, setPreview] = useState<{ forUsd: number; data: TradePreview | null; error: string | null } | null>(
    null,
  );
  const [pending, start] = useTransition();

  const amountUsd = Number(amountText);
  const valid = Number.isFinite(amountUsd) && amountUsd > 0 && amountUsd <= valueUsd * 1.0001;
  const pct = valueUsd > 0 && valid ? Math.min(100, (amountUsd / valueUsd) * 100) : 0;

  const current = preview !== null && preview.forUsd === amountUsd ? preview : null;

  // Preview follows the number, debounced: the guard's verdict and the venue's price.
  useEffect(() => {
    if (!valid) return;
    let cancelled = false;
    const handle = setTimeout(async () => {
      const answer = await previewTrade({
        agentId,
        chain: position.token.chain,
        side: "sell",
        tokenAddress: position.token.address,
        amountUsd,
      });
      if (cancelled) return;
      setPreview(
        answer.ok
          ? { forUsd: amountUsd, data: answer.data, error: null }
          : { forUsd: amountUsd, data: null, error: answer.error },
      );
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [agentId, amountUsd, valid, position.token.chain, position.token.address]);

  const sell = () =>
    start(async () => {
      const result = await placeManualTrade({
        agentId,
        chain: position.token.chain,
        side: "sell",
        tokenAddress: position.token.address,
        amountUsd,
        note: `Manual sell from the positions table (${pct.toFixed(0)}% of the position).`,
      });
      if (!result.ok) {
        toast.error(`${position.token.symbol} not sold`, { description: result.error });
        return;
      }
      toast.success(
        `Sold ${formatTokenAmount(result.data.amountToken)} ${result.data.symbol} for ${formatUsd(result.data.amountUsd)}`,
        { description: `at ${formatPriceUsd(result.data.priceUsd)}${result.data.isPaper ? " (simulated)" : ""}` },
      );
      onClose();
      router.refresh();
    });

  return (
    <Dialog open onOpenChange={(next) => (next ? null : onClose())}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Sell {position.token.symbol}</DialogTitle>
          <DialogDescription>
            Holding {formatTokenAmount(position.amountToken)} {position.token.symbol}, worth{" "}
            <span className="tnum">{formatUsd(valueUsd)}</span> at {formatPriceUsd(position.markPriceUsd)}. Fills at
            Jupiter&rsquo;s price, under the agent&rsquo;s slippage ceiling.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <label className="block text-xs text-muted-foreground" htmlFor="sell-amount">
            Amount to sell (USD of the position)
          </label>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">$</span>
            <Input
              id="sell-amount"
              inputMode="decimal"
              autoFocus
              value={amountText}
              onChange={(event) => setAmountText(event.target.value.replace(/[^0-9.]/g, ""))}
              className="tnum font-mono"
            />
          </div>
          <div className="flex gap-1.5">
            {SLICES.map((slice) => (
              <button
                key={slice}
                type="button"
                onClick={() => setAmountText(((valueUsd * slice) / 100).toFixed(2))}
                className={cn(
                  "rounded-md border px-2 py-1 text-[11px] transition-colors duration-150 focus-ring",
                  Math.abs(pct - slice) < 0.5
                    ? "border-primary/50 bg-primary/10 text-foreground"
                    : "border-border text-muted-foreground hover:text-foreground",
                )}
              >
                {slice === 100 ? "All" : `${slice}%`}
              </button>
            ))}
          </div>

          <p className="min-h-[2.5rem] text-xs leading-5 text-muted-foreground" aria-live="polite">
            {!valid
              ? amountText === ""
                ? "Enter an amount."
                : `Enter a number between $0.01 and ${formatUsd(valueUsd)}.`
              : current?.error
                ? current.error
                : !current?.data
                  ? "Checking with the guard and Jupiter…"
                  : current.data.allowed
                    ? `${pct.toFixed(0)}% of the position${current.data.priceUsd !== null ? `, quoted at ${formatPriceUsd(current.data.priceUsd)}` : ""}.${current.data.requiresApproval ? " This agent is in approval mode, so this becomes a proposal you then approve." : ""}`
                    : `Not allowed: ${current.data.reason ?? "the guard refused this size"}`}
          </p>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={sell}
            disabled={pending || !valid || !current?.data || !current.data.allowed}
          >
            {pending ? "Selling…" : `Sell ${valid ? formatUsd(amountUsd) : ""}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
