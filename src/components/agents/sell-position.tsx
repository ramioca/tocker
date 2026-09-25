"use client";

import { useEffect, useRef, useState, useTransition, type RefObject } from "react";
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
import { formatPreviewFees, formatPriceUsd, formatTokenAmount, formatUsd } from "@/components/common/format";
import { placeManualTrade, previewTrade } from "@/server/actions/trading";
import { SELL_SLICES, floorCents, pctLabel, sliceLabel, sliceText } from "@/components/trading/sell-amount";
import { cn } from "@/lib/utils";
import type { Position, TradePreview } from "@/server/types";

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
  // The dialog mounts on demand, so Base UI has no trigger of its own to hand focus back
  // to on close; without this it fell to <body> and Tab started the page over.
  const triggerRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        // One "Sell" per row: the symbol is what tells them apart to a screen reader.
        aria-label={`Sell ${position.token.symbol}`}
        className="rounded-md border border-border px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors duration-150 hover:border-negative/50 hover:text-negative focus-ring"
      >
        Sell
      </button>
      {open ? (
        <SellPositionDialog
          agentId={agentId}
          position={position}
          returnFocus={triggerRef}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

function SellPositionDialog({
  agentId,
  position,
  returnFocus,
  onClose,
}: {
  agentId: string;
  position: Position;
  returnFocus: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
}) {
  const router = useRouter();
  const valueUsd = position.valueUsd ?? 0;
  // Every figure the dialog offers is floored to the cent: the guard refuses a sell
  // worth more than the position, and `toFixed(2)` rounds up half the time.
  const fullUsd = floorCents(valueUsd);
  const [amountText, setAmountText] = useState(fullUsd > 0 ? fullUsd.toFixed(2) : "");
  // Keyed by the amount it answers for, so a stale answer is simply not shown rather
  // than cleared with a synchronous setState (which React flags as a cascading render).
  const [preview, setPreview] = useState<{ forUsd: number; data: TradePreview | null; error: string | null } | null>(
    null,
  );
  const [pending, start] = useTransition();

  const amountUsd = Number(amountText);
  // A cent is the floor the hint below promises; "$0.001" was accepted and offered as a sell.
  const valid = Number.isFinite(amountUsd) && amountUsd >= 0.01 && amountUsd <= valueUsd * 1.0001;
  const pct = valueUsd > 0 && valid ? Math.min(100, (amountUsd / valueUsd) * 100) : 0;
  // Asking for the whole value is asking for everything. The server is told so
  // explicitly and sells the balance, not a dollar figure that the mark has outrun.
  const sellAll = valid && amountUsd >= fullUsd;
  // Typing the rounded figure the description shows ("worth $3,528.15" for $3,528.146)
  // still means everything, so the order carries the floored full value, never more.
  const orderUsd = sellAll ? fullUsd : amountUsd;

  const current = preview !== null && preview.forUsd === orderUsd ? preview : null;

  // Preview follows the number, debounced: the guard's verdict and the venue's price.
  useEffect(() => {
    if (!valid) return;
    let cancelled = false;
    const handle = setTimeout(async () => {
      // `sellAll` goes along so the preview can size "everything" from the balance, as
      // the sell itself does; the floored figure keeps it inside the mark either way.
      const request: Parameters<typeof previewTrade>[0] & { sellAll: boolean } = {
        agentId,
        chain: position.token.chain,
        side: "sell",
        tokenAddress: position.token.address,
        amountUsd: orderUsd,
        sellAll,
      };
      const answer = await previewTrade(request);
      if (cancelled) return;
      setPreview(
        answer.ok
          ? { forUsd: orderUsd, data: answer.data, error: null }
          : { forUsd: orderUsd, data: null, error: answer.error },
      );
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [agentId, orderUsd, sellAll, valid, position.token.chain, position.token.address]);

  // An unusable figure is an error, not a hint: it says so in the destructive colour and
  // on the input itself, not only in grey under it.
  const badAmount = !valid && amountText !== "";
  const refused = valid && (Boolean(current?.error) || current?.data?.allowed === false);

  const sell = () =>
    start(async () => {
      const result = await placeManualTrade({
        agentId,
        chain: position.token.chain,
        side: "sell",
        tokenAddress: position.token.address,
        amountUsd: orderUsd,
        sellAll,
        note: sellAll
          ? "Manual sell from the positions table (everything)."
          : `Manual sell from the positions table (${pctLabel(pct)} of the position).`,
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
      <DialogContent className="sm:max-w-md" finalFocus={returnFocus}>
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
              aria-invalid={badAmount || undefined}
              aria-describedby="sell-amount-status"
              onChange={(event) => setAmountText(event.target.value.replace(/[^0-9.]/g, ""))}
              className="tnum font-mono"
            />
          </div>
          <div className="flex gap-1.5">
            {SELL_SLICES.map((slice) => (
              <button
                key={slice}
                type="button"
                aria-pressed={Math.abs(pct - slice) < 0.5}
                onClick={() => setAmountText(sliceText(valueUsd, slice))}
                className={cn(
                  "rounded-md border px-2 py-1 text-[11px] transition-colors duration-150 focus-ring",
                  Math.abs(pct - slice) < 0.5
                    ? "border-primary/50 bg-primary/10 text-foreground"
                    : "border-border text-muted-foreground hover:text-foreground",
                )}
              >
                {sliceLabel(slice)}
              </button>
            ))}
          </div>

          <p
            id="sell-amount-status"
            className={cn(
              "min-h-[2.5rem] text-xs leading-5",
              badAmount || refused ? "text-destructive" : "text-muted-foreground",
            )}
            aria-live="polite"
          >
            {!valid
              ? amountText === ""
                ? "Enter an amount."
                : `Enter a number between $0.01 and ${formatUsd(valueUsd)}.`
              : current?.error
                ? current.error
                : !current?.data
                  ? "Checking with the guard and Jupiter…"
                  : current.data.allowed
                    ? `${sellAll ? "Everything" : `${pctLabel(pct)} of the position`}${current.data.priceUsd !== null ? `, quoted at ${formatPriceUsd(current.data.priceUsd)}` : ""}. Sells right away — your click is the approval.`
                    : `Not allowed: ${current.data.reason ?? "the guard refused this size"}`}
          </p>
          {valid && current?.data?.allowed && current.data.fees && formatPreviewFees(current.data.fees) ? (
            <dl className="flex items-baseline justify-between gap-3 text-xs">
              <dt className="shrink-0 text-muted-foreground">Fees</dt>
              <dd className="tnum min-w-0 text-right font-mono break-words">
                {formatPreviewFees(current.data.fees)}
              </dd>
            </dl>
          ) : null}
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
            {pending ? "Selling…" : sellAll ? "Sell everything" : valid ? `Sell ${formatUsd(orderUsd)}` : "Sell"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
