import { useId } from "react";
import Link from "next/link";
import { formatPct, formatSignedUsd, formatUsd } from "@/components/common/format";
import { cn } from "@/lib/utils";
import type { MoneyAgentRow, MoneyTotals } from "@/server/queries/money";

/**
 * One row per agent: what it is worth, what it made, and what it cost to run.
 *
 * The three cost columns are deliberately next to the P&L rather than tucked into a
 * footnote — an agent that is up $6 and has spent $9 on data is a losing agent, and the
 * only way to see that is to have both numbers on the same line.
 *
 * A fourth, "Thinking", is drawn only when an agent in the table has paid for its own
 * thinking (pay-per-use). It is the exact amount from the ledger, real USDC from that
 * agent's wallet in a paper table too. A table of agents that all think on their
 * owner's key is exactly the table it was.
 *
 * The shell owns the horizontal overflow (rule: the page body never scrolls sideways),
 * `.glass-card` rather than `.glass-panel` because a table of rows is a repeating
 * surface, and every number is `tabular-nums` so a column of them does not jitter.
 */

/**
 * The agent column stays put while the numbers scroll under it: on a phone the table
 * is wider than the card, and a row of figures with its name scrolled away is a
 * row of figures about nobody. It has to be opaque or the cells sliding beneath show
 * through, so it paints `.glass-card`'s own mix pre-composited on the page ground —
 * plain `bg-card` read as a lighter stripe. The hairline is the column's edge.
 */
const STICKY_BG =
  "[--sticky-bg:color-mix(in_oklch,var(--glass-tint)_var(--glass-card-alpha),var(--background))]";
const STICKY_CELL = "sticky left-0 z-10 bg-[var(--sticky-bg)] shadow-[1px_0_0_var(--glass-hairline)]";
/** The row's hover tint, which an opaque cell would otherwise hide. Same mix as `bg-muted/30`. */
const STICKY_HOVER =
  "transition-colors duration-100 group-hover:bg-[color-mix(in_oklab,var(--muted)_30%,var(--sticky-bg))]";

function Th({
  children,
  numeric,
  className,
}: {
  children: React.ReactNode;
  numeric?: boolean;
  className?: string;
}) {
  return (
    <th
      scope="col"
      className={cn(
        "px-3 py-2 text-[10px] font-semibold uppercase tracking-wide whitespace-nowrap text-muted-foreground",
        numeric ? "text-right" : "text-left",
        className,
      )}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  numeric,
  muted,
  className,
}: {
  children: React.ReactNode;
  numeric?: boolean;
  muted?: boolean;
  className?: string;
}) {
  return (
    <td
      className={cn(
        "px-3 py-2.5 align-middle whitespace-nowrap",
        numeric && "text-right",
        muted && "text-muted-foreground",
        className,
      )}
    >
      {children}
    </td>
  );
}

/**
 * The tooltip on a Thinking cell: what the figure is made of, and what it leaves out.
 * The cell itself is only ever the confirmed amount.
 */
function thinkingTitle(row: MoneyAgentRow): string | undefined {
  const parts: string[] = [];
  if (row.thinkingSteps > 0) {
    parts.push(
      `${row.thinkingSteps.toLocaleString("en-US")} paid step${row.thinkingSteps === 1 ? "" : "s"}${row.thinkingModel ? ` · ${row.thinkingModel}` : ""}`,
    );
  }
  if (row.thinkingUnansweredUsd > 0) parts.push(`${formatUsd(row.thinkingUnansweredUsd)} of it got no answer`);
  if (row.thinkingCheckingUsd > 0) parts.push(`${formatUsd(row.thinkingCheckingUsd)} more is being checked`);
  if (row.thinkingSimulatedUsd > 0) parts.push(`${formatUsd(row.thinkingSimulatedUsd)} simulated, no money moved`);
  return parts.length > 0 ? parts.join("\n") : undefined;
}

function pnlTone(value: number): string {
  if (value > 0) return "text-positive";
  if (value < 0) return "text-negative";
  return "text-muted-foreground";
}

export function AgentMoneyTable({
  rows,
  totals,
  caption,
  label,
}: {
  rows: MoneyAgentRow[];
  /** Live only. Paper has no totals on purpose — nothing sums a notional. */
  totals?: MoneyTotals;
  caption?: string;
  label: string;
}) {
  const captionId = useId();
  // Anything on the ledger for these agents, simulated and still-being-checked included,
  // or the column would be missing exactly when a row has something to say in it.
  const showThinking = rows.some(
    (row) => row.thinkingUsd > 0 || row.thinkingCheckingUsd > 0 || row.thinkingSimulatedUsd > 0,
  );
  return (
    <div className="glass-card overflow-hidden rounded-2xl">
      {/* Outside the scroller: as a <caption> it took the table's full width and was
          cut off mid-sentence on a phone. */}
      {caption ? (
        <p
          id={captionId}
          className="border-b border-[var(--glass-hairline)] px-4 py-2.5 text-[11px] text-muted-foreground"
        >
          {caption}
        </p>
      ) : null}
      <div className="w-full overflow-x-auto overscroll-x-contain">
        {/*
          Sized to its content, not a fixed 52rem: on a phone that pushed P&L past the
          edge. `min-w-full` still fills the card on a desktop.
        */}
        <table
          className={cn("tnum w-max min-w-full border-collapse text-left text-[13px]", STICKY_BG)}
          aria-describedby={caption ? captionId : undefined}
        >
          <thead className="border-b border-[var(--glass-hairline)]">
            <tr>
              <Th className={STICKY_CELL}>{label}</Th>
              <Th numeric>Equity</Th>
              <Th numeric>P&amp;L</Th>
              <Th numeric>Tocker fee</Th>
              <Th numeric>Data</Th>
              <Th numeric>Model est.</Th>
              {showThinking ? <Th numeric>Thinking</Th> : null}
              <Th numeric>Trades</Th>
              <Th numeric>Win rate</Th>
            </tr>
          </thead>

          <tbody className="divide-y divide-[var(--glass-hairline)]">
            {rows.map((row) => (
              <tr key={row.id} className="group transition-colors duration-100 hover:bg-muted/30">
                <Td className={cn(STICKY_CELL, STICKY_HOVER, "max-w-[11rem]")}>
                  {/* No mode badge: each table holds one mode, and its label says which. */}
                  <span className="flex min-w-0 items-center gap-2">
                    <Link
                      href={`/agents/${row.slug}`}
                      className="focus-ring truncate rounded font-medium hover:underline"
                    >
                      {row.name}
                    </Link>
                    {row.stale ? (
                      <span
                        className="text-[10px] uppercase tracking-wide text-muted-foreground"
                        title="The wallet could not be read just now — this row is the last recorded snapshot."
                      >
                        stale
                      </span>
                    ) : null}
                  </span>
                </Td>
                <Td numeric>{formatUsd(row.equityUsd)}</Td>
                <Td numeric className={cn("font-medium", pnlTone(row.pnlUsd))}>
                  {formatSignedUsd(row.pnlUsd)}
                </Td>
                <Td numeric muted>
                  {formatUsd(row.feesUsd)}
                </Td>
                <Td numeric muted>
                  {formatUsd(row.dataSpendUsd)}
                </Td>
                <Td
                  numeric
                  muted
                  className={row.modelSpendUsd === null ? "italic" : undefined}
                  // The model id is the answer to "why is this dash here", so it is on
                  // the cell rather than in a legend somebody has to go find.
                >
                  <span title={row.model ? `${row.model} · ${row.inputTokens.toLocaleString("en-US")} in / ${row.outputTokens.toLocaleString("en-US")} out` : undefined}>
                    {row.modelSpendUsd === null ? "no price" : formatUsd(row.modelSpendUsd)}
                  </span>
                </Td>
                {showThinking ? (
                  <Td numeric muted>
                    <span title={thinkingTitle(row)}>{formatUsd(row.thinkingUsd)}</span>
                  </Td>
                ) : null}
                <Td numeric muted>
                  {row.tradeCount}
                </Td>
                <Td numeric muted>
                  {row.winRate === null ? "—" : formatPct(row.winRate * 100, 0)}
                </Td>
              </tr>
            ))}
          </tbody>

          {totals ? (
            <tfoot className="border-t border-[var(--glass-hairline)]">
              <tr className="text-[13px] font-medium">
                <Td className={STICKY_CELL}>Total</Td>
                <Td numeric>{formatUsd(totals.equityUsd)}</Td>
                <Td numeric className={pnlTone(totals.pnlUsd)}>
                  {formatSignedUsd(totals.pnlUsd)}
                </Td>
                <Td numeric muted>
                  {formatUsd(totals.feesUsd)}
                </Td>
                <Td numeric muted>
                  {formatUsd(totals.dataSpendUsd)}
                </Td>
                <Td numeric muted>
                  {formatUsd(totals.modelSpendUsd)}
                </Td>
                {showThinking ? (
                  <Td numeric muted>
                    {formatUsd(totals.thinkingUsd)}
                  </Td>
                ) : null}
                <Td numeric muted>
                  {totals.tradeCount}
                </Td>
                <Td numeric muted>
                  —
                </Td>
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>
    </div>
  );
}
