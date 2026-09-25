"use client";

import { useState } from "react";
import { ArrowUpRight, ReceiptText, TriangleAlert } from "lucide-react";
import { Address } from "@/components/common/address";
import { formatAbsolute, formatPriceUsd, formatUsd } from "@/components/common/format";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import {
  SIMULATED_FILL_TEXT,
  exceededTolerance,
  slippageText,
  type TradeReceiptData,
} from "@/lib/trading/receipt-format";
import { isTrustedExplorerUrl } from "@/lib/tokens/links";

/**
 * The receipt, in two densities.
 *
 * A receipt is a **document**, not a card: aligned label/value pairs, tabular figures
 * that do not reflow as they tick, a hash you can copy, and a link that opens the
 * explorer in a new tab. It is the thing you screenshot when something looks wrong, so
 * nothing on it is rounded away — the quoted price sits next to the filled price and
 * the drift between them is stated in basis points against the tolerance the agent was
 * configured with, rather than left as an exercise.
 *
 * Three components, one document:
 *  - {@link TradeReceiptRow} — one dense line. This is what a feed card embeds.
 *  - {@link TradeReceiptDetail} — the full document. No state, no motion.
 *  - {@link TradeReceiptSheet} — the row, tappable, opening the document in a sheet.
 *
 * ### Embedding the compact row in the feed
 *
 * The feed's trade card can render the compact row without this workstream touching
 * feed code:
 *
 * ```tsx
 * import { TradeReceiptRow } from "@/components/trading";
 * // receipt: TradeReceiptData | null — from receiptsFor([trade.id]) in the feed query.
 * {receipt ? <TradeReceiptRow receipt={receipt} className="mt-2" /> : null}
 * ```
 *
 * `receipt` is the only required prop and `null` renders nothing, so a feed row for a
 * trade that predates receipts simply keeps its existing layout.
 *
 * **Paper fills say exactly one thing**, here and everywhere else:
 * "Simulated fill · no on-chain transaction".
 */

const SURFACE = "rounded-xl border border-border/70 bg-card/40 backdrop-blur-[2px]";

function SlippageValue({ receipt, className }: { receipt: TradeReceiptData; className?: string }) {
  const bad = exceededTolerance(receipt);
  const beat = receipt.slippageBps < -0.5;
  return (
    <span
      className={cn(
        "tnum font-mono",
        bad ? "text-negative" : beat ? "text-positive" : "text-foreground",
        className,
      )}
      title={`Tolerance ${receipt.slippageToleranceBps} bps`}
    >
      {slippageText(receipt.slippageBps)}
    </span>
  );
}

function ExplorerLink({ receipt, className }: { receipt: TradeReceiptData; className?: string }) {
  if (receipt.simulated || !isTrustedExplorerUrl(receipt.explorerUrl)) {
    return <span className={cn("tnum font-mono text-muted-foreground", className)}>{SIMULATED_FILL_TEXT}</span>;
  }
  return (
    <a
      href={receipt.explorerUrl}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "inline-flex items-center gap-1 rounded font-mono text-[11px] text-muted-foreground",
        "transition-colors duration-150 hover:text-foreground",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        className,
      )}
    >
      {receipt.txHash.slice(0, 8)}…{receipt.txHash.slice(-6)}
      <ArrowUpRight aria-hidden className="size-3" />
    </a>
  );
}

/**
 * One line: venue, quoted → filled, slippage, fees, and the hash or the simulated note.
 * Wraps on narrow screens rather than scrolling, because a single line of execution
 * facts that you have to scroll is a line nobody reads.
 */
export function TradeReceiptRow({
  receipt,
  className,
}: {
  receipt: TradeReceiptData | null | undefined;
  className?: string;
}) {
  if (!receipt) return null;
  return (
    <div
      className={cn(
        "tnum flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] text-muted-foreground",
        className,
      )}
    >
      <span className="text-foreground/80">{receipt.venueLabel}</span>
      <span aria-hidden className="text-border">
        ·
      </span>
      <span>
        {formatPriceUsd(receipt.quotedPriceUsd)} → <span className="text-foreground">{formatPriceUsd(receipt.filledPriceUsd)}</span>
      </span>
      <SlippageValue receipt={receipt} />
      {receipt.totalFeeUsd > 0 ? <span>{formatUsd(receipt.totalFeeUsd)} fees</span> : null}
      <ExplorerLink receipt={receipt} />
    </div>
  );
}

function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <dt className="shrink-0 text-[11px] tracking-wide text-muted-foreground uppercase">{label}</dt>
      <dd className="tnum min-w-0 text-right font-mono text-xs text-foreground">
        {children}
        {hint ? <span className="ml-1.5 font-sans text-[11px] text-muted-foreground">{hint}</span> : null}
      </dd>
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-border/60 pt-2 first:border-t-0 first:pt-0">
      <h3 className="mb-0.5 text-[10px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">{title}</h3>
      <dl className="divide-y divide-border/40">{children}</dl>
    </section>
  );
}

/**
 * The full document. No state of its own and no motion: everything on it is laid out
 * on first paint, and the only interactive parts are the copy control on a hash and the
 * explorer link. The moment you want a receipt is the moment you do not want it to
 * animate at you.
 */
export function TradeReceiptDetail({
  receipt,
  className,
}: {
  receipt: TradeReceiptData;
  className?: string;
}) {
  const overTolerance = exceededTolerance(receipt);
  return (
    <div className={cn("min-w-0 space-y-3", className)}>
      {overTolerance ? (
        <p className="flex items-start gap-2 rounded-lg border border-negative/30 bg-negative/10 px-3 py-2 text-xs text-foreground">
          <TriangleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0 text-negative" />
          <span>
            This fill drifted <SlippageValue receipt={receipt} className="text-xs" /> from the quote, past the{" "}
            <span className="tnum font-mono">{receipt.slippageToleranceBps} bps</span> this agent was configured to
            accept. A route that keeps doing this is costing more than its fees.
          </span>
        </p>
      ) : null}

      <Group title="Execution">
        <Field label="Venue">{receipt.venueLabel}</Field>
        <Field label="Side">
          <span className={receipt.side === "buy" ? "text-positive" : "text-negative"}>
            {receipt.side.toUpperCase()}
          </span>{" "}
          {receipt.symbol}
        </Field>
        <Field label="Quoted">{formatPriceUsd(receipt.quotedPriceUsd)}</Field>
        <Field label="Filled">{formatPriceUsd(receipt.filledPriceUsd)}</Field>
        <Field label="Slippage" hint={`tolerance ${receipt.slippageToleranceBps} bps`}>
          <SlippageValue receipt={receipt} />
        </Field>
        <Field label="Size">
          {receipt.amountToken.toLocaleString("en-US", { maximumFractionDigits: 6 })} {receipt.symbol}
        </Field>
        <Field label="Notional">{formatUsd(receipt.amountUsd)}</Field>
      </Group>

      <Group title="Costs">
        <Field label="Venue fee">{formatUsd(receipt.venueFeeUsd)}</Field>
        {/*
          The platform's own cut, named the way it is named everywhere else ("Tocker
          fee" — see PLATFORM_FEE_LABEL). Shown only when there was one: a receipt from
          before the fee existed, or from a deploy with PLATFORM_FEE_USD=0, should not
          grow a row that says $0.00 and makes the reader wonder what they missed.
        */}
        {receipt.platformFeeUsd && receipt.platformFeeUsd > 0 ? (
          <Field label="Tocker fee" hint="per fill">
            {formatUsd(receipt.platformFeeUsd)}
          </Field>
        ) : null}
        <Field label="Network fee">
          {receipt.simulated ? (
            // A paper fill never touched a chain, so there was no fee to report.
            <span className="text-muted-foreground">none (simulated)</span>
          ) : receipt.networkFeeUsd === null ? (
            <span className="text-muted-foreground">not reported</span>
          ) : (
            formatUsd(receipt.networkFeeUsd)
          )}
        </Field>
        <Field label="Total">{formatUsd(receipt.totalFeeUsd)}</Field>
      </Group>

      {receipt.scoreTotal === null ? null : (
        <Group title="Score at entry">
          <Field label="Total" hint={receipt.scoreVerdict ?? undefined}>
            {Math.round(receipt.scoreTotal)}/100
          </Field>
          {receipt.scoreReasons.map((reason) => (
            <Field key={reason.key} label={reason.label}>
              {reason.value}
            </Field>
          ))}
        </Group>
      )}

      <Group title="Settlement">
        <Field label="Chain">{receipt.chain === "solana" ? "Solana" : "Base"}</Field>
        <Field label="Quoted at">{formatAbsolute(receipt.quotedAt)}</Field>
        <Field label="Filled at" hint={`${(receipt.latencyMs / 1000).toFixed(2)}s`}>
          {formatAbsolute(receipt.filledAt)}
        </Field>
        <div className="flex items-baseline justify-between gap-4 py-1.5">
          <dt className="shrink-0 text-[11px] tracking-wide text-muted-foreground uppercase">
            {receipt.simulated ? "Transaction" : "Tx hash"}
          </dt>
          <dd className="min-w-0 text-right">
            {receipt.simulated ? (
              <span className="font-mono text-xs text-muted-foreground">{SIMULATED_FILL_TEXT}</span>
            ) : (
              <span className="inline-flex items-center gap-2">
                <Address address={receipt.txHash} label="transaction hash" lead={8} tail={8} />
                <ExplorerLink receipt={receipt} />
              </span>
            )}
          </dd>
        </div>
        <Field label="Token">
          <Address address={receipt.tokenAddress} label="token address" lead={6} tail={6} />
        </Field>
      </Group>
    </div>
  );
}

/**
 * The compact row, tappable, opening the full document in a sheet. Use this wherever
 * the row has somewhere to go; use {@link TradeReceiptRow} alone where it does not.
 */
export function TradeReceiptSheet({
  receipt,
  title,
  trigger = "row",
  defaultOpen = false,
  className,
}: {
  receipt: TradeReceiptData | null | undefined;
  /** Sheet heading; defaults to "<SIDE> <symbol>". */
  title?: string;
  /**
   * `row` is the full compact line, for anywhere with horizontal room. `chip` is an
   * icon and the slippage figure, for a table cell — where the full line would either
   * blow out the column or force the table into a horizontal scroll.
   */
  trigger?: "row" | "chip";
  /** Open on mount, for a fill the URL points at (`?trade=`). Pass it to one instance only. */
  defaultOpen?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  if (!receipt) return null;

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <button
            type="button"
            className={cn(
              "group rounded-lg text-left",
              trigger === "chip"
                ? "inline-flex items-center gap-1.5 border border-border/70 px-1.5 py-1"
                : "w-full px-2 py-1.5",
              "transition-colors duration-150 hover:bg-muted/50",
              "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
              className,
            )}
            aria-label={`Receipt for ${receipt.side} ${receipt.symbol}`}
          >
            {trigger === "chip" ? (
              <>
                <ReceiptText aria-hidden className="size-3 shrink-0 text-muted-foreground" />
                <SlippageValue receipt={receipt} className="text-[11px]" />
              </>
            ) : (
              <span className="flex items-center gap-2">
                <ReceiptText aria-hidden className="size-3 shrink-0 text-muted-foreground" />
                <TradeReceiptRow receipt={receipt} className="min-w-0" />
              </span>
            )}
          </button>
        }
      />
      <SheetContent side="right" className="overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="font-mono tracking-tight">
            {title ?? `${receipt.side.toUpperCase()} ${receipt.symbol}`}
          </SheetTitle>
          <SheetDescription>
            {receipt.simulated
              ? SIMULATED_FILL_TEXT
              : `Settled on ${receipt.chain === "solana" ? "Solana" : "Base"} via ${receipt.venueLabel}.`}
          </SheetDescription>
        </SheetHeader>
        <div className="px-4 pb-6">
          <TradeReceiptDetail receipt={receipt} />
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** The document in a bordered panel, for a page that is not a sheet. */
export function TradeReceiptCard({
  receipt,
  className,
}: {
  receipt: TradeReceiptData | null | undefined;
  className?: string;
}) {
  if (!receipt) return null;
  return (
    <div className={cn(SURFACE, "p-3 sm:p-4", className)}>
      <TradeReceiptDetail receipt={receipt} />
    </div>
  );
}
