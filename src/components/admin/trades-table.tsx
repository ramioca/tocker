import Link from "next/link";
import { ModeBadge } from "@/components/common/mode-badge";
import { chainLabel } from "@/components/common/chain-badge";
import { LocalTime } from "@/components/common/relative-time";
import { formatUsd } from "@/components/common/format";
import type { AdminTradeRow } from "@/server/queries/admin";
import { cn } from "@/lib/utils";
import { DataTable, EmptyRow, TableShell, Td, Th } from "./table-shell";

/**
 * The last fifty fills, platform-wide.
 *
 * The token links to `/tokens/<chain>/<address>?trade=<id>`, which is where the receipt
 * for that fill is shown — the venue, the tx hash, quoted versus filled price, the
 * slippage and the fees. That page is public: a receipt exists only for a fill, is read
 * whole, and its key set is closed by test so it can never carry a strategy.
 *
 * Buy and sell are a word, not a colour. Colour means PnL in this app and nothing else,
 * and a table where half the rows are green would make the one column that is actually
 * about profit unreadable.
 */
export function AdminTradesTable({ rows }: { rows: AdminTradeRow[] }) {
  return (
    <TableShell title="Recent fills" hint={rows.length === 0 ? undefined : `last ${rows.length}, newest first`}>
      <DataTable label="Recent fills" minWidth="56rem">
        <thead>
          <tr>
            <Th sticky>Time</Th>
            <Th>Agent</Th>
            <Th>Side</Th>
            <Th>Token</Th>
            <Th>Chain</Th>
            <Th numeric>Notional</Th>
            <Th numeric>Fee</Th>
            <Th>Mode</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--glass-hairline)]">
          {rows.length === 0 ? (
            <EmptyRow colSpan={8}>
              No fills yet. A paper agent&apos;s first tick writes one; nothing has to be funded for that.
            </EmptyRow>
          ) : (
            rows.map((row) => (
              <tr key={row.id} className="hover:bg-muted/25">
                <Td sticky muted>
                  {/* Exact and in the reader's zone: a column of "2h ago" orders rows but
                      dates none of them. */}
                  <LocalTime iso={row.createdAt} className="whitespace-nowrap" />
                </Td>
                <Td className="max-w-[12rem]">
                  <Link
                    href={`/agents/${row.agentSlug}`}
                    className="truncate underline-offset-2 hover:underline focus-visible:underline"
                  >
                    {row.agentName}
                  </Link>
                  <span className="ml-2 text-muted-foreground">@{row.ownerHandle}</span>
                </Td>
                <Td>
                  <span
                    className={cn(
                      "rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide uppercase",
                      "border border-border bg-muted/50 text-foreground/80",
                    )}
                  >
                    {row.side}
                  </span>
                </Td>
                <Td>
                  <Link
                    href={`/tokens/${row.chain}/${row.tokenAddress}?trade=${row.id}`}
                    className="font-medium underline-offset-2 hover:underline focus-visible:underline"
                  >
                    {row.tokenSymbol}
                  </Link>
                </Td>
                <Td muted className="font-sans text-xs">
                  {chainLabel(row.chain)}
                </Td>
                <Td numeric>{formatUsd(row.notionalUsd)}</Td>
                <Td numeric muted>
                  {row.platformFeeUsd === null ? "—" : formatUsd(row.platformFeeUsd)}
                </Td>
                <Td>
                  <ModeBadge mode={row.isPaper ? "paper" : "live"} size="xs" />
                </Td>
              </tr>
            ))
          )}
        </tbody>
      </DataTable>
    </TableShell>
  );
}
