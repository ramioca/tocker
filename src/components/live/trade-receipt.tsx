"use client";

import { Receipt, TriangleAlert } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { TradeReceiptDetail } from "@/components/trading";
import { ChainBadge } from "@/components/common/chain-badge";
import { formatTokenAmount, formatUsd } from "@/components/common/format";
import type { TradeReceiptData } from "@/db/schema";
import type { TradeRow } from "@/server/types";
import { cn } from "@/lib/utils";

/**
 * The first live fill, framed.
 *
 * The document itself is `TradeReceiptDetail` from the trading workstream — venue,
 * quoted vs filled, slippage against the agent's own tolerance, both fee legs, the
 * score at entry, the hash and its explorer link. This wraps it in the one thing
 * this screen adds: a heading that says what just happened, and the pause button,
 * right there, so the answer to "that is enough for today" is one control away
 * rather than two screens away.
 *
 * `receipt` is null for a trade that predates execution receipts or one the
 * executor could not record. The fallback states that plainly and shows the trade
 * row's own numbers rather than inventing a receipt that was never captured.
 */
export function FirstFillPanel({
  trade,
  receipt,
  children,
}: {
  trade: TradeRow;
  receipt: TradeReceiptData | null;
  children?: React.ReactNode;
}) {
  const reduce = useReducedMotion();
  // `expired` joins the failures (W7 B6): a proposal nobody answered in time did not
  // trade, and green is the wrong colour for it. `proposed` never reaches this panel —
  // it gets `ProposalPanel`, which can actually be acted on.
  const failed = trade.status === "failed" || trade.status === "rejected" || trade.status === "expired";
  const settling = trade.status === "pending" || trade.status === "submitted";

  return (
    <motion.section
      initial={reduce ? { opacity: 0 } : { opacity: 0, y: 8 }}
      animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0 }}
      transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 300, damping: 30 }}
      className={cn(
        "glass-heavy rounded-xl border p-4",
        failed
          ? "border-destructive/40 bg-destructive/5"
          : settling
            ? "border-border/70 bg-card/30"
            : "border-positive/30 bg-positive/[0.04]",
      )}
      aria-label="Trade receipt"
    >
      <div className="flex items-center gap-2">
        <Receipt
          aria-hidden
          className={cn("size-4", failed ? "text-destructive" : settling ? "text-muted-foreground" : "text-positive")}
        />
        <h3 className="text-sm font-medium">
          {failed
            ? trade.status === "expired"
              ? "The proposal expired before it was answered"
              : "The trade did not fill"
            : settling
              ? `Still settling ${trade.token.symbol}`
              : `${trade.side === "buy" ? "Bought" : "Sold"} ${trade.token.symbol}`}
        </h3>
        <ChainBadge chain={trade.chain} className="ml-auto" />
      </div>

      {settling ? (
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          The order was submitted and the chain has not answered yet. It settles by itself — the marks loop
          reconciles anything still open after two minutes against the transaction, and the result lands on the
          agent page.
        </p>
      ) : null}

      {trade.isPaper ? (
        <p className="mt-2 rounded-lg border border-border/60 bg-muted/30 px-2.5 py-1.5 text-xs text-muted-foreground">
          This was a simulated fill. It proves the pipeline, not the money.
        </p>
      ) : null}

      {failed && trade.error ? (
        <p className="mt-2 font-mono text-xs leading-5 text-destructive">{trade.error}</p>
      ) : null}

      {receipt ? (
        <TradeReceiptDetail receipt={receipt} className="mt-3" />
      ) : (
        <>
          <p className="mt-3 flex items-start gap-2 text-xs leading-5 text-muted-foreground">
            <TriangleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />
            No execution receipt was recorded for this fill, so there is nothing to check quoted price against
            filled. These are the trade&rsquo;s own numbers.
          </p>
          <dl className="mt-2 divide-y divide-border/50 text-sm">
            <Row label="Size" value={formatUsd(trade.amountUsd)} />
            <Row label="Filled" value={`${formatTokenAmount(trade.amountToken)} ${trade.token.symbol}`} />
            <Row label="Fill price" value={formatUsd(trade.priceUsd)} />
            <Row label="Fees" value={formatUsd(trade.feeUsd)} />
          </dl>
        </>
      )}

      {trade.rationale ? (
        <p className="mt-3 border-l-2 border-border/70 pl-3 text-sm leading-6 text-muted-foreground">
          &ldquo;{trade.rationale}&rdquo;
        </p>
      ) : null}

      {children ? <div className="mt-4 flex flex-wrap items-center gap-2">{children}</div> : null}
    </motion.section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="tnum font-mono text-xs">{value}</dd>
    </div>
  );
}
