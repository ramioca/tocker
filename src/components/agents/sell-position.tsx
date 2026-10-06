"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type RefObject } from "react";
import { usePathname } from "next/navigation";
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
import { placeManualTrade, previewTrade, type ManualTradeResult } from "@/server/actions/trading";
import { TradeReceiptRow } from "@/components/trading";
import { SELL_SLICES, floorCents, pctLabel, sliceLabel, sliceText } from "@/components/trading/sell-amount";
import {
  MaxSlippagePicker,
  RealisedOnSale,
  TradeFailureAlert,
  useRefreshAfterTrade,
} from "@/components/trading/sell-controls";
import {
  PREVIEW_FAILED,
  PREVIEW_PATIENCE_MS,
  PREVIEW_SLOW,
  SENDING_SELL,
  noQuoteLine,
  realisedOnSale,
  sellVenueLine,
  thinPoolLine,
  thinPoolPct,
  unpreviewedLine,
} from "@/components/trading/sell-preview";
import { safeAction } from "@/lib/safe-action";
import { widerSlippageChoices } from "@/lib/trading/manual-slippage";
import { ORDER_IN_FLIGHT_LOST, isSlippageFailure, outcomeUncertain } from "@/lib/trading/trade-error-copy";
import { cn } from "@/lib/utils";
import type { Position, TradePreview } from "@/server/types";

/**
 * Sell part or all of one position by hand, from the book. Owner only — the button is
 * rendered only when the table is told the viewer may trade.
 *
 * The amount is in dollars of the position at today's mark, because that is how the
 * rest of the product sizes a trade; the dialog turns it into tokens itself. A preview
 * (the guard's answer and the venue's quote for those tokens) runs as the number
 * changes, and the fill goes through the same manual-trade path as the header's Trade
 * sheet, so it is guarded, receipted and published exactly like any other sell.
 *
 * The preview informs; it never gates. The order is checked and priced again on the
 * server when it is confirmed, so the only things that disable Sell are an amount that
 * is not one and the guard saying no.
 */

/** What the surface that mounts the dialog already knows about the agent. */
interface AgentHints {
  isPaper: boolean;
  /** The agent's own Slippage tolerance in basis points, when the viewer may know it. */
  slippageBps: number | null;
}

/** A Sell dialog somebody asked for. */
interface SellRequest {
  id: number;
  agentId: string;
  position: Position;
  returnFocus: RefObject<HTMLElement | null>;
}

/**
 * Where an open Sell dialog lives when it must outlive the row it was opened from.
 *
 * A filled sell revalidates the page in the same response, so selling a whole position
 * removes its row, and the dialog with it, at the very moment there is a result to
 * show. {@link SellPositionHost} is mounted once, outside the table, and renders the
 * dialog from here instead. A module-level store rather than context because the host
 * and the rows sit in different branches of a server-rendered page.
 */
const sellDialog = (() => {
  let request: SellRequest | null = null;
  let nextId = 1;
  const hosts = new Map<string, number>();
  const listeners = new Set<() => void>();
  const emit = () => {
    for (const listener of listeners) listener();
  };
  return {
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    current: (): SellRequest | null => request,
    hasHost: (agentId: string): boolean => (hosts.get(agentId) ?? 0) > 0,
    /** Registers a host for an agent's dialogs; the returned function removes it again. */
    addHost(agentId: string): () => void {
      hosts.set(agentId, (hosts.get(agentId) ?? 0) + 1);
      return () => {
        const left = (hosts.get(agentId) ?? 1) - 1;
        if (left > 0) {
          hosts.set(agentId, left);
          return;
        }
        hosts.delete(agentId);
        // Nothing is left to render this agent's dialog, so do not leave one queued.
        if (request?.agentId === agentId) {
          request = null;
          emit();
        }
      };
    },
    open(next: Omit<SellRequest, "id">): void {
      request = { ...next, id: nextId++ };
      emit();
    },
    close(id: number): void {
      if (request?.id !== id) return;
      request = null;
      emit();
    },
  };
})();

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
        onClick={() => {
          // Hosted when it can be, so the result survives this row. Without a host the
          // dialog opens here and a fill ends on a toast, as it always did.
          if (sellDialog.hasHost(agentId)) {
            sellDialog.open({ agentId, position, returnFocus: { current: triggerRef.current } });
          } else {
            setOpen(true);
          }
        }}
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

/**
 * Renders the Sell dialog for one agent's rows from somewhere that stays mounted when a
 * row does not. Mount it once per agent page, next to an owner-only control.
 */
export function SellPositionHost({
  agentId,
  isPaper,
  slippageBps,
  fallbackFocus,
}: AgentHints & {
  agentId: string;
  /** Where focus goes when the row the dialog was opened from no longer exists. */
  fallbackFocus?: RefObject<HTMLElement | null>;
}) {
  useEffect(() => sellDialog.addHost(agentId), [agentId]);
  const request = useSyncExternalStore(sellDialog.subscribe, sellDialog.current, () => null);
  if (request === null || request.agentId !== agentId) return null;
  return (
    <SellPositionDialog
      // A new request is a new dialog: nothing of the last one's amount or result carries over.
      key={request.id}
      agentId={agentId}
      position={request.position}
      returnFocus={request.returnFocus}
      fallbackFocus={fallbackFocus}
      hints={{ isPaper, slippageBps }}
      staysOnResult
      onClose={() => sellDialog.close(request.id)}
    />
  );
}

/** A fill, with what it realised against the position as it stood before the sale. */
interface SoldResult {
  fill: ManualTradeResult;
  realised: { usd: number; pct: number | null };
}

function SellPositionDialog({
  agentId,
  position,
  returnFocus,
  fallbackFocus,
  hints,
  staysOnResult = false,
  onClose,
}: {
  agentId: string;
  /** The position as the row showed it when Sell was pressed; the preview brings the fresh value. */
  position: Position;
  returnFocus: RefObject<HTMLElement | null>;
  fallbackFocus?: RefObject<HTMLElement | null>;
  hints?: AgentHints;
  /** True when this dialog outlives its row, so a fill can end on the result instead of a toast. */
  staysOnResult?: boolean;
  onClose: () => void;
}) {
  const pathname = usePathname();
  const refreshBook = useRefreshAfterTrade(agentId);
  const { chain, address, symbol } = position.token;

  // Keyed by the order it answers for, so a stale answer is simply not shown rather
  // than cleared with a synchronous setState (which React flags as a cascading render).
  const [preview, setPreview] = useState<{ key: string; data: TradePreview | null; error: string | null } | null>(
    null,
  );
  // The newest answer for any size. It carries what does not depend on the size: what
  // the position is worth now, the agent's own slippage limit, paper or live.
  const [latest, setLatest] = useState<TradePreview | null>(null);

  const pageValueUsd = position.valueUsd ?? 0;
  const valueUsd = latest?.positionValueUsd ?? pageValueUsd;
  // Every figure the dialog offers is floored to the cent: the guard refuses a sell
  // worth more than the position, and `toFixed(2)` rounds up half the time.
  const fullUsd = floorCents(valueUsd);

  // "Everything" is an intent, not a number: the box shows the position's value as it
  // moves, and the order sells the balance. A typed figure is kept exactly as typed.
  const [everything, setEverything] = useState(true);
  const [typed, setTyped] = useState("");
  const amountText = everything ? (fullUsd > 0 ? fullUsd.toFixed(2) : "") : typed;
  const amountUsd = Number(amountText);
  // A cent is the floor the hint below promises; "$0.001" was accepted and offered as a sell.
  const valid = Number.isFinite(amountUsd) && amountUsd >= 0.01 && amountUsd <= valueUsd * 1.0001;
  const pct = valueUsd > 0 && valid ? Math.min(100, (amountUsd / valueUsd) * 100) : 0;
  // Asking for the whole value is asking for everything. The server is told so
  // explicitly and sells the balance, not a dollar figure that the mark has outrun.
  const sellAll = valid && (everything || amountUsd >= fullUsd);
  // Typing the rounded figure the description shows ("worth $3,528.15" for $3,528.146)
  // still means everything, so the order carries the floored full value, never more.
  const orderUsd = sellAll ? fullUsd : amountUsd;
  // The preview of a sell-all carries the value the row was opened with, not the fresh
  // one: the server sizes "everything" itself, and a figure that moved with each answer
  // would ask for the preview again every time it arrived.
  const pageFullUsd = floorCents(pageValueUsd);
  const previewUsd = sellAll && pageFullUsd > 0 ? pageFullUsd : orderUsd;

  const isPaper = latest?.isPaper ?? hints?.isPaper ?? null;
  const agentBps = latest?.slippageLimitBps ?? hints?.slippageBps ?? null;
  // The simulator applies no slippage, so there is nothing to widen on a paper agent.
  const widerChoices = agentBps !== null && isPaper === false ? widerSlippageChoices(agentBps) : [];
  const [chosenBps, setChosenBps] = useState<number | null>(null);
  // Only a figure the action will honour is ever sent; anything else is the agent's setting.
  const maxSlippageBps = chosenBps !== null && widerChoices.includes(chosenBps) ? chosenBps : null;

  const [pending, setPending] = useState(false);
  // Set in the click handler, before React has re-rendered the button as disabled.
  const inFlight = useRef(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [sold, setSold] = useState<SoldResult | null>(null);

  const key = valid ? `${sellAll ? "all" : orderUsd}|${maxSlippageBps ?? "agent"}` : null;
  const current = preview !== null && preview.key === key ? preview : null;

  // Preview follows the order, debounced: the guard's verdict and the venue's quote.
  // Asked once per order and never refreshed on its own: a live preview runs the real
  // quote path, which spends Jupiter's rate limit and can top up a wallet.
  useEffect(() => {
    if (key === null) return;
    let cancelled = false;
    let answered = false;
    const handle = setTimeout(async () => {
      // `sellAll` goes along so the preview sizes "everything" from the balance, as the
      // sell itself does. A request that throws becomes an answer like any other.
      const answer = await safeAction(
        () =>
          previewTrade({
            agentId,
            chain,
            side: "sell",
            tokenAddress: address,
            amountUsd: previewUsd,
            sellAll,
            ...(maxSlippageBps === null ? {} : { maxSlippageBps }),
          }),
        PREVIEW_FAILED,
      );
      if (cancelled) return;
      answered = true;
      setPreview(answer.ok ? { key, data: answer.data, error: null } : { key, data: null, error: answer.error });
      if (answer.ok) {
        setLatest(answer.data);
        // A typed figure that meant everything keeps meaning it once the fresh value is
        // in: left as typed, it would now read as more than the position is worth.
        if (sellAll) setEverything(true);
      }
    }, 350);
    // A preview that never answers must not hold the exit shut. A late answer replaces this.
    const patience = setTimeout(() => {
      if (cancelled || answered) return;
      setPreview({ key, data: null, error: PREVIEW_SLOW });
    }, PREVIEW_PATIENCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(handle);
      clearTimeout(patience);
    };
  }, [agentId, chain, address, key, previewUsd, sellAll, maxSlippageBps]);

  // An unusable figure is an error, not a hint: it says so in the destructive colour and
  // on the input itself, not only in grey under it.
  const badAmount = !valid && amountText !== "";
  const data = current?.data ?? null;
  const refused = valid && data?.allowed === false;
  const quote = data?.allowed ? (data.sell ?? null) : null;

  const sell = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setFailure(null);
    try {
      const result = await safeAction(
        () =>
          placeManualTrade({
            agentId,
            chain,
            side: "sell",
            tokenAddress: address,
            amountUsd: orderUsd,
            sellAll,
            ...(maxSlippageBps === null ? {} : { maxSlippageBps }),
            note: sellAll
              ? "Manual sell from the positions table (everything)."
              : `Manual sell from the positions table (${pctLabel(pct)} of the position).`,
          }),
        ORDER_IN_FLIGHT_LOST,
      );
      // After every attempt: a failed order still wrote a trade row, and one that lost
      // its answer may have filled.
      refreshBook();
      if (!result.ok) {
        setFailure(result.error);
        // "Not sold" is a claim. An order that may have filled does not get that heading.
        toast.error(outcomeUncertain(result.error) ? `${symbol} sell unconfirmed` : `${symbol} not sold`, {
          description: result.error,
        });
        return;
      }
      if (!staysOnResult) {
        // This dialog lives in the row, and the row may be gone with the position.
        toast.success(
          `Sold ${formatTokenAmount(result.data.amountToken)} ${result.data.symbol} for ${formatUsd(result.data.amountUsd)}`,
          { description: `at ${formatPriceUsd(result.data.priceUsd)}${result.data.isPaper ? " (simulated)" : ""}` },
        );
        onClose();
        return;
      }
      setSold({
        fill: result.data,
        realised: realisedOnSale({
          amountUsd: result.data.amountUsd,
          amountToken: result.data.amountToken,
          totalFeeUsd: result.data.receipt.totalFeeUsd,
          heldToken: position.amountToken,
          avgCostUsd: position.avgCostUsd,
        }),
      });
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  };

  const feeText = data
    ? [formatPreviewFees(data.fees), !data.isPaper && chain === "solana" ? "network fee covered by Tocker" : null]
        .filter((part): part is string => Boolean(part))
        .join(" · ")
    : null;
  // The row is kept while the next size previews, so the dialog does not change height
  // under the cursor; a live agent has one from the start.
  const showFloor = data
    ? quote !== null && quote.minProceedsUsd !== null
    : latest
      ? (latest.sell?.minProceedsUsd ?? null) !== null
      : isPaper === false;
  // Against the value of what is being sold at the last price: the whole position on a
  // full exit, the typed dollars otherwise. Null without a live quote.
  const thin = quote ? thinPoolPct(quote.proceedsUsd, quote.fullExit ? data?.positionValueUsd : orderUsd) : null;
  const widerLeft = widerChoices.some((bps) => bps > (maxSlippageBps ?? agentBps ?? 0));
  const status = pending
    ? SENDING_SELL
    : !valid
      ? amountText === ""
        ? "Enter an amount."
        : `Enter a number between $0.01 and ${formatUsd(valueUsd)}.`
      : current === null
        ? "Getting a quote…"
        : data === null
          ? // The preview failed, timed out or was refused as a request. None of that
            // decides the order, so it says what it could not do and that Sell still works.
            unpreviewedLine(current.error ?? PREVIEW_FAILED)
          : !data.allowed
            ? `Not allowed: ${data.reason ?? "the guard refused this size"}`
            : data.quoted === false
              ? // A slippage refusal shows up here first, before any order: point at the
                // choice that fixes it without leaving the dialog.
                noQuoteLine(
                  data.quoteNote && isSlippageFailure(data.quoteNote) && widerLeft
                    ? `${data.quoteNote} Or pick a wider Max slippage below.`
                    : data.quoteNote,
                )
              : sellVenueLine(chain, data.isPaper);
  // The link only makes sense on the agent's own page, which is where this is mounted.
  const settingsHref = /^\/agents\/[^/]+$/.test(pathname) ? `${pathname}/settings#risk` : null;

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        // Not while an order is in flight: closing and reopening offered Sell again
        // with the first order still running.
        if (!next && !pending) onClose();
      }}
    >
      <DialogContent
        className="sm:max-w-md"
        showCloseButton={!pending}
        finalFocus={() => (returnFocus.current?.isConnected ? returnFocus.current : (fallbackFocus?.current ?? true))}
      >
        {sold ? (
          <>
            <DialogHeader>
              <DialogTitle>Sold {sold.fill.symbol}</DialogTitle>
            </DialogHeader>

            <div role="status" className="space-y-3">
              <div>
                <p className="text-xs text-muted-foreground">Received</p>
                <p className="tnum font-mono text-2xl font-medium tracking-tight">{formatUsd(sold.fill.amountUsd)}</p>
                <p className="tnum mt-0.5 text-xs text-muted-foreground">
                  {formatTokenAmount(sold.fill.amountToken)} {sold.fill.symbol} at {formatPriceUsd(sold.fill.priceUsd)}
                </p>
              </div>
              <RealisedOnSale usd={sold.realised.usd} pct={sold.realised.pct} />
              <TradeReceiptRow receipt={sold.fill.receipt} className="border-t border-border/60 pt-3" />
            </div>

            <DialogFooter>
              {/* The Sell button that had focus is gone; the next thing to do is leave. */}
              <Button autoFocus onClick={onClose}>
                Done
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Sell {symbol}</DialogTitle>
              <DialogDescription>
                Holding {formatTokenAmount(position.amountToken)} {symbol}, worth{" "}
                <span className="tnum">{formatUsd(valueUsd)}</span> at the last price.
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
                  disabled={pending}
                  value={amountText}
                  aria-invalid={badAmount || undefined}
                  aria-describedby="sell-amount-status"
                  onChange={(event) => {
                    setEverything(false);
                    setTyped(event.target.value.replace(/[^0-9.]/g, ""));
                  }}
                  className="tnum font-mono"
                />
              </div>
              <div className="flex gap-1.5">
                {SELL_SLICES.map((slice) => (
                  <button
                    key={slice}
                    type="button"
                    disabled={pending}
                    aria-pressed={Math.abs(pct - slice) < 0.5}
                    onClick={() => {
                      setEverything(slice === 100);
                      setTyped(sliceText(valueUsd, slice));
                    }}
                    className={cn(
                      "rounded-md border px-2 py-1 text-[11px] transition-colors duration-150 focus-ring disabled:pointer-events-none disabled:opacity-50",
                      Math.abs(pct - slice) < 0.5
                        ? "border-primary/50 bg-primary/10 text-foreground"
                        : "border-border text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {sliceLabel(slice)}
                  </button>
                ))}
              </div>

              {valid && !refused ? (
                <dl className="grid gap-y-1.5 text-xs">
                  <QuoteRow
                    label="You sell"
                    value={
                      quote && quote.amountToken !== null
                        ? `${formatTokenAmount(quote.amountToken)} ${symbol}${quote.fullExit ? " (everything)" : ""}`
                        : "—"
                    }
                  />
                  <QuoteRow
                    label="You receive ≈"
                    value={
                      quote === null
                        ? "—"
                        : quote.proceedsUsd !== null
                          ? formatUsd(quote.proceedsUsd)
                          : `${formatUsd(quote.fullExit ? valueUsd : orderUsd)} at the last price`
                    }
                  />
                  {showFloor ? (
                    <QuoteRow
                      label="At worst ≈"
                      value={quote && quote.minProceedsUsd !== null ? formatUsd(quote.minProceedsUsd) : "—"}
                      hint="past this the order cancels and nothing is sold"
                    />
                  ) : null}
                  {feeText !== "" ? <QuoteRow label="Fees" value={feeText ?? "—"} /> : null}
                </dl>
              ) : null}
              {thin !== null ? <p className="text-xs leading-5 text-destructive">{thinPoolLine(thin)}</p> : null}

              <p
                id="sell-amount-status"
                className={cn(
                  "min-h-[2.5rem] text-xs leading-5",
                  !pending && (badAmount || refused) ? "text-destructive" : "text-muted-foreground",
                )}
                aria-live="polite"
              >
                {status}
              </p>

              {failure !== null ? (
                <TradeFailureAlert
                  text={failure}
                  settingsHref={settingsHref}
                  widerSlippage={isSlippageFailure(failure) && widerLeft ? "below" : null}
                />
              ) : null}

              {agentBps !== null && widerChoices.length > 0 ? (
                <MaxSlippagePicker agentBps={agentBps} value={maxSlippageBps} onChange={setChosenBps} disabled={pending} />
              ) : null}
            </div>

            <DialogFooter>
              <Button variant="ghost" onClick={onClose} disabled={pending}>
                Cancel
              </Button>
              {/* A preview that failed or timed out leaves this enabled: the server
                  runs every check again when the order is placed. */}
              <Button
                variant="destructive"
                onClick={() => void sell()}
                disabled={pending || !valid || current === null || data?.allowed === false}
              >
                {pending ? "Selling…" : sellAll ? "Sell everything" : valid ? `Sell ${formatUsd(orderUsd)}` : "Sell"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function QuoteRow({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="tnum min-w-0 text-right font-mono break-words">
        {value}
        {hint ? <span className="block font-sans text-[11px] text-muted-foreground">{hint}</span> : null}
      </dd>
    </div>
  );
}
