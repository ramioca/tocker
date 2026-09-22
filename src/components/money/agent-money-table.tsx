import Link from "next/link";
import { ModeBadge } from "@/components/common/mode-badge";
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
 * The shell owns the horizontal overflow (rule: the page body never scrolls sideways),
 * `.glass-card` rather than `.glass-panel` because a table of rows is a repeating
 * surface, and every number is `tabular-nums` so a column of them does not jitter.
 */

function Th({ children, numeric }: { children: React.ReactNode; numeric?: boolean }) {
  return (
    <th
      scope="col"
      className={cn(
        "px-3 py-2 text-[10px] font-semibold uppercase tracking-wide whitespace-nowrap text-muted-foreground",
        numeric ? "text-right" : "text-left",
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
  return (
    <div className="glass-card overflow-hidden rounded-2xl">
      <div className="w-full overflow-x-auto overscroll-x-contain">
        <table className="tnum w-full border-collapse text-left text-[13px]" style={{ minWidth: "52rem" }}>
          {caption ? (
            <caption className="px-4 py-2.5 text-left text-[11px] text-muted-foreground">{caption}</caption>
          ) : null}
          <thead className="border-b border-[var(--glass-hairline)]">
            <tr>
              <Th>{label}</Th>
              <Th numeric>Equity</Th>
              <Th numeric>P&amp;L</Th>
              <Th numeric>Fees</Th>
              <Th numeric>Data</Th>
              <Th numeric>Model est.</Th>
              <Th numeric>Trades</Th>
              <Th numeric>Win rate</Th>
            </tr>
          </thead>

          <tbody className="divide-y divide-[var(--glass-hairline)]">
            {rows.map((row) => (
              <tr key={row.id} className="transition-colors duration-100 hover:bg-muted/30">
                <Td>
                  <span className="flex min-w-0 items-center gap-2">
                    <Link
                      href={`/agents/${row.slug}`}
                      className="focus-ring truncate rounded font-medium hover:underline"
                    >
                      {row.name}
                    </Link>
                    <ModeBadge mode={row.mode} size="xs" />
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
                <Td>Total</Td>
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
