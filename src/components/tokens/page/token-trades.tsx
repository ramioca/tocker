/**
 * The last fills in this token, across every visible agent.
 *
 * A flat static table rather than the agent page's paginated one: the token page
 * shows a bounded window (20 rows) and the interesting column here is *which*
 * agent, which the agent-scoped table does not have.
 *
 * The rationale is public on purpose (SPEC rule 1): it is after the fact, and
 * knowing why someone bought a token once does not hand over a system.
 *
 * Each row expands into its **receipt** — venue, quoted against filled, slippage, fees,
 * explorer link. A receipt is as public as the trade it documents (it carries no
 * thresholds, no sources, no transcript), and it is the difference between a table of
 * claims and a table of checkable facts.
 */
import Link from "next/link";
import { Receipt } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState } from "@/components/common/empty-state";
import { RelativeTime } from "@/components/common/relative-time";
import { formatTokenAmount, formatUsd } from "@/components/common/format";
import { ScoreBadge } from "@/components/tokens/score-badge";
import type { TradeRow } from "@/server/types";
import type { TradeReceiptData } from "@/db/schema";
import { TradeReceiptSheet } from "@/components/trading";
import { cn } from "@/lib/utils";

export function TokenTrades({
  trades,
  agentNames,
  receipts,
}: {
  trades: TradeRow[];
  /** agentId → { slug, name }, so a row can link to whoever made it. */
  agentNames: Record<string, { slug: string; name: string }>;
  /** tradeId → receipt. Absent for trades that predate receipts; the row still renders. */
  receipts?: Map<string, TradeReceiptData>;
}) {
  if (trades.length === 0) {
    return (
      <EmptyState
        icon={<Receipt />}
        title="No agent has traded this"
        description="Fills land here as soon as an agent touches it, with the one-line reasoning behind each one."
      />
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-border/70">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>When</TableHead>
            <TableHead>Agent</TableHead>
            <TableHead>Side</TableHead>
            <TableHead className="text-right">Amount</TableHead>
            <TableHead className="text-right">Price</TableHead>
            <TableHead className="text-right">Value</TableHead>
            <TableHead className="text-right">Score</TableHead>
            <TableHead className="text-right">Receipt</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {trades.map((trade) => {
            const agent = agentNames[trade.agentId];
            const receipt = receipts?.get(trade.id) ?? null;
            return (
              <TableRow key={trade.id}>
                <TableCell className="whitespace-nowrap text-xs">
                  <RelativeTime iso={trade.filledAt ?? trade.createdAt} />
                </TableCell>
                <TableCell className="max-w-[9rem]">
                  {agent ? (
                    <Link
                      href={`/agents/${agent.slug}`}
                      className="block truncate rounded text-xs font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      title={trade.rationale ?? agent.name}
                    >
                      {agent.name}
                    </Link>
                  ) : (
                    <span className="text-xs text-muted-foreground">an agent</span>
                  )}
                </TableCell>
                <TableCell>
                  <span
                    className={cn(
                      "rounded px-1.5 py-0.5 text-[10px] font-bold tracking-wider uppercase",
                      trade.side === "buy" ? "bg-positive/15 text-positive" : "bg-negative/15 text-negative",
                    )}
                  >
                    {trade.side}
                  </span>
                </TableCell>
                <TableCell className="tnum text-right text-muted-foreground">
                  {formatTokenAmount(trade.amountToken)}
                </TableCell>
                <TableCell className="tnum text-right text-muted-foreground">
                  {formatUsd(trade.priceUsd)}
                </TableCell>
                <TableCell className="tnum text-right font-medium">{formatUsd(trade.amountUsd)}</TableCell>
                <TableCell className="text-right">
                  {trade.entryScore === null ? (
                    <span className="font-mono text-[11px] text-muted-foreground">—</span>
                  ) : (
                    <ScoreBadge
                      total={trade.entryScore}
                      verdict={trade.score?.verdict}
                      size="xs"
                      numberOnly
                    />
                  )}
                </TableCell>
                <TableCell className="text-right">
                  {receipt ? (
                    <TradeReceiptSheet
                      receipt={receipt}
                      trigger="chip"
                      title={`${trade.side.toUpperCase()} ${trade.token.symbol}${agent ? ` · ${agent.name}` : ""}`}
                    />
                  ) : (
                    <span className="font-mono text-[11px] text-muted-foreground">—</span>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
