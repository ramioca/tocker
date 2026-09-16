"use client";

import { ArrowUpRight, Receipt } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { formatTokenAmount, formatUsd, truncateAddress } from "@/components/common/format";
import { ChainBadge } from "@/components/common/chain-badge";
import { explorerName, explorerTxUrl } from "./explorer";
import type { TradeRow } from "@/server/types";
import { cn } from "@/lib/utils";

/**
 * The first live fill, as a receipt.
 *
 * Deliberately boring and complete: what was bought, at what price, what it cost
 * in fees, and a link to the transaction on the chain. This is the artefact
 * someone screenshots, and the one they come back to when they want to check that
 * the number in the app matches the number on chain.
 *
 * `priceUsd` and `feeUsd` are what the executor recorded on the fill — not a
 * re-quote — so the receipt cannot drift from the trade row behind it.
 */
export function TradeReceipt({ trade, children }: { trade: TradeRow; children?: React.ReactNode }) {
  const reduce = useReducedMotion();
  const txUrl = explorerTxUrl(trade.chain, trade.txHash);
  const failed = trade.status === "failed" || trade.status === "rejected";

  return (
    <motion.section
      initial={reduce ? { opacity: 0 } : { opacity: 0, y: 8 }}
      animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0 }}
      transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 300, damping: 30 }}
      className={cn(
        "glass-heavy rounded-xl border p-4",
        failed ? "border-destructive/40 bg-destructive/5" : "border-positive/30 bg-positive/[0.04]",
      )}
      aria-label="Trade receipt"
    >
      <div className="flex items-center gap-2">
        <Receipt aria-hidden className={cn("size-4", failed ? "text-destructive" : "text-positive")} />
        <h3 className="text-sm font-medium">
          {failed ? "The trade did not fill" : `${trade.side === "buy" ? "Bought" : "Sold"} ${trade.token.symbol}`}
        </h3>
        <ChainBadge chain={trade.chain} className="ml-auto" />
      </div>

      {trade.isPaper ? (
        <p className="mt-2 rounded-lg border border-border/60 bg-muted/30 px-2.5 py-1.5 text-xs text-muted-foreground">
          This was a simulated fill. It proves the pipeline, not the money.
        </p>
      ) : null}

      {failed && trade.error ? (
        <p className="mt-2 font-mono text-xs leading-5 text-destructive">{trade.error}</p>
      ) : null}

      <dl className="mt-3 divide-y divide-border/50 text-sm">
        <Row label="Size" value={formatUsd(trade.amountUsd)} />
        <Row label="Filled" value={`${formatTokenAmount(trade.amountToken)} ${trade.token.symbol}`} />
        <Row label="Fill price" value={formatUsd(trade.priceUsd)} />
        <Row label="Fees" value={formatUsd(trade.feeUsd)} />
        {trade.entryScore !== null ? <Row label="Score at entry" value={`${trade.entryScore.toFixed(0)} / 100`} /> : null}
        <div className="flex items-baseline justify-between gap-3 py-1.5">
          <dt className="text-muted-foreground">Transaction</dt>
          <dd className="min-w-0 truncate font-mono text-xs">
            {txUrl ? (
              <a
                href={txUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-1 text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {truncateAddress(trade.txHash ?? "", 8, 6)}
                <span className="text-muted-foreground">on {explorerName(trade.chain)}</span>
                <ArrowUpRight aria-hidden className="size-3" />
              </a>
            ) : (
              <span className="text-muted-foreground">
                {trade.txHash ? truncateAddress(trade.txHash, 8, 6) : "none"}
              </span>
            )}
          </dd>
        </div>
      </dl>

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
