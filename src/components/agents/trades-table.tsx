"use client";

import { Fragment } from "react";
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
import { LoadMoreFailed } from "./load-more-failed";
import { cn } from "@/lib/utils";
import type { Page, TradeRow } from "@/server/types";
import { txExplorerUrl } from "@/lib/tokens/links";

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
  return txExplorerUrl(trade.chain, trade.txHash);
}

/** The columns left below `sm`, which the phone-only rationale row spans. */
const MOBILE_COLUMNS = 5;

export function TradesTable({
  agentId,
  agentSlug,
  initialPage,
}: {
  agentId: string;
  /** For the link from each trade to the run that placed it. */
  agentSlug: string;
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

  // Only when there is nothing to show. `isError` is also true when just an older page
  // failed, and the pages already loaded are still in `query.data` — those must stay.
  if (query.isError && !query.data) {
    return (
      <ErrorState
        title="Trade history did not load"
        description="Try again in a moment."
        action={
          <button
            type="button"
            onClick={() => void query.refetch()}
            className="focus-ring rounded-lg border border-border px-3 py-1.5 text-xs transition-[background-color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-muted active:scale-[0.97]"
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
          <div className="@container glass-card overflow-x-auto rounded-xl">
            {/*
              Below `sm`: When / Side / Token / Value / Entry score. Amount and price
              multiply out to Value, and a column of "paper" is not worth the width.
            */}
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Side</TableHead>
                  <TableHead>Token</TableHead>
                  <TableHead className="hidden text-right sm:table-cell">Amount</TableHead>
                  <TableHead className="hidden text-right sm:table-cell">Price</TableHead>
                  <TableHead className="text-right">Value</TableHead>
                  <TableHead className="text-right">
                    <span className="sm:hidden">Score</span>
                    <span className="max-sm:hidden">Entry score</span>
                  </TableHead>
                  <TableHead className="hidden text-right sm:table-cell">Tx</TableHead>
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
                    <Fragment key={trade.id}>
                      <TableRow className={cn(unfilled && "opacity-60", trade.rationale && "max-sm:border-b-0")}>
                        <TableCell className="whitespace-nowrap text-xs">
                          {trade.runId ? (
                            <Link
                              href={`/agents/${agentSlug}/runs/${trade.runId}`}
                              className="rounded underline decoration-muted-foreground/50 decoration-dotted underline-offset-2 transition-colors duration-150 hover:decoration-foreground hover:decoration-solid focus-ring"
                              title="Open the run that placed this trade"
                            >
                              <RelativeTime iso={trade.createdAt} />
                            </Link>
                          ) : (
                            <RelativeTime iso={trade.createdAt} />
                          )}
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
                          {/*
                            The one line the agent wrote for this fill — public, like the
                            fill. Never the transcript that led to it.
                          */}
                          {trade.rationale ? (
                            // The cell is `whitespace-nowrap`, so the sentence has to be let wrap;
                            // `max-sm:hidden` rather than `sm:block`, which would undo the clamp.
                            <p className="mt-0.5 line-clamp-2 max-w-[28rem] whitespace-normal text-[11px] leading-snug text-muted-foreground max-sm:hidden">
                              {trade.rationale}
                            </p>
                          ) : null}
                        </TableCell>
                        <TableCell className="tnum hidden text-right text-muted-foreground sm:table-cell">
                          {formatTokenAmount(trade.amountToken)}
                        </TableCell>
                        <TableCell className="tnum hidden text-right text-muted-foreground sm:table-cell">
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
                        <TableCell className="hidden text-right sm:table-cell">
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
                      {/*
                        On a phone the rationale gets its own line under the row: in the
                        Token cell it would widen that column and push Value off-screen.
                        Capped at the visible width (`cqw` of the scroller), not the
                        table's, so the end of each line is not hidden past the edge.
                      */}
                      {trade.rationale ? (
                        <TableRow className={cn("hover:bg-transparent sm:hidden", unfilled && "opacity-60")}>
                          <TableCell colSpan={MOBILE_COLUMNS} className="pt-0 whitespace-normal">
                            <p className="line-clamp-2 max-w-[calc(100cqw-1rem)] text-[11px] leading-snug text-muted-foreground">
                              {trade.rationale}
                            </p>
                          </TableCell>
                        </TableRow>
                      ) : null}
                    </Fragment>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          {query.isFetchNextPageError && !query.isFetchingNextPage ? (
            <LoadMoreFailed what="trades" onRetry={() => void query.fetchNextPage()} />
          ) : query.hasNextPage ? (
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
