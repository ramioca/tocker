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
 * claims and a table of checkable facts. With no receipt in the window the column goes:
 * a column of dashes says nothing.
 *
 * Below `sm`: When / Agent / Side / Value / Score, the same cut the agent page makes.
 * Amount and price multiply out to Value, and at 390px the full eight columns pushed
 * Value, Score and Receipt past a sideways scroll nobody knew to do. The receipt gets
 * its own line under the row instead.
 *
 * `focusTradeId` is the fill a `?trade=` link named. It is tinted, marked
 * `aria-current`, scrolled to the middle of the screen, and its receipt line is shown
 * at every width — that link is how a fill notification says "see the receipt".
 */
import { Fragment } from "react";
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
import { ScrollIntoView } from "./scroll-into-view";

/** When, Agent, Side, Value, Score. */
const PHONE_COLUMNS = 5;
/**
 * Phone cells give up 2px a side. Five columns at the table's 8px padding measured
 * 362px — past a 360px phone's 326px card — and the column that falls off is Score.
 */
const CELL = "max-sm:px-1.5";

export function TokenTrades({
  trades,
  agentNames,
  receipts,
  focusTradeId = null,
}: {
  trades: TradeRow[];
  /** agentId → { slug, name }, so a row can link to whoever made it. */
  agentNames: Record<string, { slug: string; name: string }>;
  /** tradeId → receipt. Absent for trades that predate receipts; the row still renders. */
  receipts?: Map<string, TradeReceiptData>;
  focusTradeId?: string | null;
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

  const anyReceipt = trades.some((trade) => receipts?.has(trade.id));
  const desktopColumns = anyReceipt ? 8 : 7;
  // Beside the holders list (lg+) the table gets ~600px, and a receipt column pushes eight
  // columns past it. The token amount goes first: Value over Price already says it.
  const amountCell = anyReceipt ? "hidden sm:table-cell lg:hidden" : "hidden sm:table-cell";

  return (
    <div className="overflow-x-auto rounded-xl border border-border/70">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className={CELL}>When</TableHead>
            <TableHead className={CELL}>Agent</TableHead>
            <TableHead className={CELL}>Side</TableHead>
            <TableHead className={cn("text-right", amountCell)}>Amount</TableHead>
            <TableHead className="hidden text-right sm:table-cell">Price</TableHead>
            <TableHead className={cn("text-right", CELL)}>Value</TableHead>
            <TableHead className={cn("text-right", CELL)}>
              <span className="sm:hidden">Score</span>
              <span className="max-sm:hidden">Entry score</span>
            </TableHead>
            {anyReceipt ? (
              <TableHead className="hidden text-right sm:table-cell">Receipt</TableHead>
            ) : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {trades.map((trade) => {
            const agent = agentNames[trade.agentId];
            const receipt = receipts?.get(trade.id) ?? null;
            const focused = trade.id === focusTradeId;
            const title = `${trade.side.toUpperCase()} ${trade.token.symbol}${agent ? ` · ${agent.name}` : ""}`;
            return (
              <Fragment key={trade.id}>
                <TableRow
                  aria-current={focused ? "true" : undefined}
                  className={cn(
                    receipt && "max-sm:border-b-0",
                    receipt && focused && "border-b-0",
                    focused && "bg-primary/10 hover:bg-primary/15",
                  )}
                >
                  {/* The accent sits on the first cell: box-shadow on a <tr> is not drawn everywhere. */}
                  <TableCell
                    className={cn("whitespace-nowrap text-xs", CELL, focused && "shadow-[inset_2px_0_0_var(--primary)]")}
                  >
                    <RelativeTime iso={trade.filledAt ?? trade.createdAt} />
                    {focused ? <ScrollIntoView /> : null}
                  </TableCell>
                  <TableCell className={cn("max-w-[5.5rem] sm:max-w-[9rem]", CELL)}>
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
                  <TableCell className={CELL}>
                    <span
                      className={cn(
                        "rounded px-1.5 py-0.5 text-[10px] font-bold tracking-wider uppercase",
                        trade.side === "buy" ? "bg-positive/15 text-positive" : "bg-negative/15 text-negative",
                      )}
                    >
                      {trade.side}
                    </span>
                  </TableCell>
                  <TableCell className={cn("tnum text-right text-muted-foreground", amountCell)}>
                    {formatTokenAmount(trade.amountToken)}
                  </TableCell>
                  <TableCell className="tnum hidden text-right text-muted-foreground sm:table-cell">
                    {formatUsd(trade.priceUsd)}
                  </TableCell>
                  <TableCell className={cn("tnum text-right font-medium", CELL)}>
                    {formatUsd(trade.amountUsd)}
                  </TableCell>
                  <TableCell className={cn("text-right", CELL)}>
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
                  {anyReceipt ? (
                    <TableCell className="hidden text-right sm:table-cell">
                      {receipt ? (
                        <TradeReceiptSheet receipt={receipt} trigger="chip" title={title} />
                      ) : (
                        <span className="font-mono text-[11px] text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  ) : null}
                </TableRow>
                {receipt ? (
                  <>
                    {/* Phone: the receipt line under its row, where the column no longer fits. */}
                    <TableRow
                      className={cn("sm:hidden", focused ? "bg-primary/10 hover:bg-primary/15" : "hover:bg-transparent")}
                    >
                      <TableCell colSpan={PHONE_COLUMNS} className="pt-0 whitespace-normal">
                        <TradeReceiptSheet receipt={receipt} trigger="row" title={title} />
                      </TableCell>
                    </TableRow>
                    {/* Desktop: only the focused fill spells its receipt out in full. */}
                    {focused ? (
                      <TableRow className="hidden bg-primary/10 hover:bg-primary/15 sm:table-row">
                        <TableCell colSpan={desktopColumns} className="pt-0 whitespace-normal">
                          <TradeReceiptSheet receipt={receipt} trigger="row" title={title} />
                        </TableCell>
                      </TableRow>
                    ) : null}
                  </>
                ) : null}
              </Fragment>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
