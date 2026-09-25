import Link from "next/link";
import { Address } from "@/components/common/address";
import { chainLabel } from "@/components/common/chain-badge";
import { formatUsd, formatTokenAmount } from "@/components/common/format";
import type { AdminBalancesSnapshot } from "@/server/queries/admin";
import { DataTable, EmptyRow, TableShell, Td, Th } from "./table-shell";
import { RefreshBalances } from "./refresh-balances";

/**
 * What the agent wallets actually hold, wallet by wallet.
 *
 * This is the only part of the dashboard that is not a database read, and the only part
 * that costs anything: two Privy calls per real wallet. The query reads at most 200 real
 * wallets, ordered by recent activity, four at a time, and caches the result for a
 * minute — so the header shows when it was taken rather than implying it is now, and the
 * refresh button is the only way to pay for a newer one.
 *
 * Paper wallets are listed at zero without a call. They are deterministic placeholders
 * with no chain behind them (`src/lib/wallets/index.ts`), so a reading would be two calls
 * to be told about an address that does not exist.
 */
export function AdminBalancesTable({ snapshot }: { snapshot: AdminBalancesSnapshot }) {
  const funded = snapshot.rows.filter((r) => r.usdc > 0);
  const rest = snapshot.rows.filter((r) => r.usdc <= 0);
  // Funded first: an admin looking at this table is looking for money.
  const rows = [...funded, ...rest];

  return (
    <TableShell
      title="Agent wallet balances"
      hint={`${snapshot.fundedCount} funded · ${formatUsd(snapshot.totalUsdc)} USDC`}
      action={<RefreshBalances readAt={snapshot.readAt} />}
      maxHeightClass="max-h-[30rem]"
      notice={
        <>
          {snapshot.privyConfigured ? null : (
            <p className="border-b border-[var(--glass-hairline)] bg-muted/30 px-4 py-2 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">Privy is not configured</span> — every balance below is a
              placeholder zero, not a reading. Set <span className="font-mono">NEXT_PUBLIC_PRIVY_APP_ID</span> and{" "}
              <span className="font-mono">PRIVY_APP_SECRET</span>.
            </p>
          )}
          {snapshot.capped ? (
            <p className="border-b border-[var(--glass-hairline)] bg-muted/30 px-4 py-2 text-xs text-muted-foreground">
              Showing the most recently active wallets. {snapshot.walletsOnRecord} agent wallets are on record and
              reading all of them would be two Privy calls each, so the read is capped.
            </p>
          ) : null}
        </>
      }
    >
      <DataTable label="Agent wallet balances" minWidth="40rem">
        <thead>
          <tr>
            {/* `w-[1%]` sizes the pinned column to its content: auto layout otherwise hands
                it all the spare width, and on a phone it filled the whole scroller. */}
            <Th sticky className="w-[1%]">
              Agent
            </Th>
            <Th>Chain</Th>
            <Th>Address</Th>
            <Th numeric>USDC</Th>
            <Th numeric>Native</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--glass-hairline)]">
          {rows.length === 0 ? (
            <EmptyRow colSpan={5}>
              No agent wallets yet. Two are created per agent — one per chain — the moment an agent is built.
            </EmptyRow>
          ) : (
            rows.map((row) => (
              <tr key={row.walletId} className="hover:bg-muted/25">
                <Td sticky>
                  {/* The cap lives on this span, not the cell — a table cell ignores max-width.
                      Under `lg` the Chain column is scrolled off, so the chain rides along
                      under the name: every agent has two wallets, and the rows read as
                      duplicates without it. */}
                  <span className="flex max-w-[7.5rem] flex-col sm:max-w-[14rem] lg:flex-row lg:items-baseline">
                    <Link
                      href={`/agents/${row.agentSlug}`}
                      className="min-w-0 truncate underline-offset-2 hover:underline focus-visible:underline"
                    >
                      {row.agentName}
                    </Link>
                    <span className="shrink-0 text-[10px] tracking-wide text-muted-foreground uppercase lg:ml-2">
                      <span className="lg:hidden">
                        {chainLabel(row.chain)}
                        {row.isPaper ? " · " : null}
                      </span>
                      {row.isPaper ? "paper" : null}
                    </span>
                  </span>
                </Td>
                <Td muted className="font-sans text-xs">
                  {chainLabel(row.chain)}
                </Td>
                <Td>
                  {row.isPaper ? (
                    <span className="font-mono text-[11px] text-muted-foreground">placeholder</span>
                  ) : (
                    <Address address={row.address} label={`${row.agentName} ${row.chain} wallet`} lead={6} tail={6} />
                  )}
                </Td>
                <Td numeric muted={row.usdc <= 0}>
                  {formatUsd(row.usdc)}
                </Td>
                <Td numeric muted>
                  {formatTokenAmount(row.native)} {row.chain === "base" ? "ETH" : "SOL"}
                </Td>
              </tr>
            ))
          )}
        </tbody>
      </DataTable>
    </TableShell>
  );
}
