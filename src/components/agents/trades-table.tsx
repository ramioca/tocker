"use client";

import { GeckoTerminalLink } from "@/components/common/chart-link";
import Link from "next/link";
import { useInfiniteQuery } from "@tanstack/react-query";
import { ArrowUpRight, Receipt } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { SkeletonReveal } from "@/components/spectrumui/skeleton-reveal";
import { EmptyState, ErrorState } from "@/components/common/empty-state";
import { RelativeTime } from "@/components/common/relative-time";
import { TokenIcon } from "@/components/common/token-icon";
import { formatPriceUsd, formatTokenAmount, formatUsd } from "@/components/common/format";
import { ScoreBadge } from "@/components/tokens/score-badge";
import { fetchAgentTrades } from "./agent-actions";
import { cn } from "@/lib/utils";
import type { Page, TradeRow } from "@/server/types";

function TableSkeleton() {
  return (
    <div className="space-y-2 p-3" role="status" aria-label="Loading trades">
      {Array.from({ length: 6 }, (_, i) => (
        <span
          key={i}
          className="block h-9 rounded-lg bg-muted/60 motion-safe:animate-pulse"
          aria-hidden
        />
      ))}
    </div>
  );
}

function explorerUrl(trade: TradeRow): string | null {
  if (!trade.txHash) return null;
  return trade.chain === "solana"
    ? `https://solscan.io/tx/${trade.txHash}`
    : `https://basescan.org/tx/${trade.txHash}`;
}

export function TradesTable({
  agentId,
  initialPage,
}: {
  agentId: string;
  initialPage?: Page<TradeRow>;
}) {
  const query = useInfiniteQuery({
    queryKey: ["agent-trades", agentId],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => fetchAgentTrades(agentId, pageParam),
    getNextPageParam: (last: Page<TradeRow>) => last.nextCursor,
    initialData: initialPage
      ? { pages: [initialPage], pageParams: [null as string | null] }
      : undefined,
  });

  const trades = query.data?.pages.flatMap((page) => page.items) ?? [];

  if (query.isError) {
    return (
      <ErrorState
        title="Trade history did not load"
        description={(query.error as Error).message}
        action={
          <button
            type="button"
            onClick={() => void query.refetch()}
            className="rounded-lg border border-border px-3 py-1.5 text-xs transition-colors duration-150 hover:bg-muted"
          >
            Try again
          </button>
        }
      />
    );
  }

  return (
    <SkeletonReveal loading={query.isPending} skeleton={<TableSkeleton />}>
      {trades.length === 0 ? (
        <EmptyState
          icon={<Receipt />}
          title="No trades yet"
          description="Every fill this agent makes lands here with the reasoning that produced it."
        />
      ) : (
        <div className="space-y-3">
          <div className="glass-card overflow-x-auto rounded-xl">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Side</TableHead>
                  <TableHead>Token</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">Price</TableHead>
                  <TableHead className="text-right">Value</TableHead>
                  <TableHead className="text-right">Entry score</TableHead>
                  <TableHead className="text-right">Tx</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {trades.map((trade) => {
                  const url = explorerUrl(trade);
                  // Approval mode puts non-fills in the ledger: a proposal nobody
                  // approved, or one that expired, must never read as a trade.
                  const unfilled = trade.status !== "filled";
                  const failed =
                    trade.status === "failed" ||
                    trade.status === "rejected" ||
                    trade.status === "expired";
                  return (
                    <TableRow key={trade.id} className={cn(unfilled && "opacity-60")}>
                      <TableCell className="whitespace-nowrap text-xs">
                        <RelativeTime iso={trade.createdAt} />
                      </TableCell>
                      <TableCell>
                        <span className="flex flex-wrap items-center gap-1">
                          <span
                            className={cn(
                              "rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider",
                              trade.side === "buy"
                                ? "bg-positive/15 text-positive"
                                : "bg-negative/15 text-negative",
                            )}
                          >
                            {trade.side}
                          </span>
                          {unfilled ? (
                            <span
                              title={trade.error ?? undefined}
                              className={cn(
                                "rounded border px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wider",
                                failed
                                  ? "border-destructive/40 text-destructive"
                                  : "border-border text-muted-foreground",
                              )}
                            >
                              {trade.status}
                            </span>
                          ) : null}
                        </span>
                        {failed && trade.error ? (
                          <span className="mt-1 block max-w-[28rem] text-[11px] leading-snug text-muted-foreground">
                            {trade.error}
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        <Link
                          href={`/tokens/${trade.token.chain}/${trade.token.address}`}
                          className="inline-flex items-center gap-1.5 rounded hover:underline focus-ring"
                        >
                          <TokenIcon token={trade.token} size="xs" />
                          <span className="font-medium">{trade.token.symbol}</span>
                        </Link>
                        <GeckoTerminalLink
                          chain={trade.token.chain}
                          address={trade.token.address}
                          symbol={trade.token.symbol}
                          size="xs"
                          className="ml-1.5 align-middle"
                        />
                      </TableCell>
                      <TableCell className="tnum text-right text-muted-foreground">
                        {formatTokenAmount(trade.amountToken)}
                      </TableCell>
                      <TableCell className="tnum text-right text-muted-foreground">
                        {formatPriceUsd(trade.priceUsd)}
                      </TableCell>
                      <TableCell className="tnum text-right font-medium">
                        {formatUsd(trade.amountUsd)}
                      </TableCell>
                      {/*
                        The score frozen onto the row, never a live one: a re-score after
                        the fact must not be able to flatter or damn a decision already made.
                        Rows from before scoring existed link out to score the token now.
                      */}
                      <TableCell className="text-right">
                        {trade.entryScore === null ? (
                          <Link
                            href={`/tokens/${trade.token.chain}/${trade.token.address}`}
                            className="rounded font-mono text-[11px] text-muted-foreground transition-colors duration-150 hover:text-foreground focus-ring"
                          >
                            score now
                          </Link>
                        ) : (
                          <ScoreBadge
                            total={trade.entryScore}
                            verdict={trade.score?.verdict}
                            blockers={trade.score?.blockers}
                            size="xs"
                            numberOnly
                          />
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {url ? (
                          <a
                            href={url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-0.5 rounded font-mono text-[11px] text-muted-foreground transition-colors duration-150 hover:text-foreground focus-ring"
                          >
                            {trade.txHash?.slice(0, 6)}
                            <ArrowUpRight aria-hidden className="size-3" />
                          </a>
                        ) : (
                          <span className="font-mono text-[11px] text-muted-foreground">paper</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          {query.hasNextPage ? (
            <button
              type="button"
              onClick={() => void query.fetchNextPage()}
              disabled={query.isFetchingNextPage}
              className="w-full rounded-lg border border-border py-2 text-xs text-muted-foreground transition-colors duration-150 hover:bg-muted/60 hover:text-foreground disabled:opacity-50 focus-ring"
            >
              {query.isFetchingNextPage ? "Loading…" : "Load more trades"}
            </button>
          ) : null}
        </div>
      )}
    </SkeletonReveal>
  );
}
