import Link from "next/link";
import { RelativeTime } from "@/components/common/relative-time";
import type { AdminAuditRow } from "@/server/queries/admin";
import { DataTable, EmptyRow, TableShell, Td, Th } from "./table-shell";

/**
 * The audit trail across every user — the one read in the app that is not user-scoped.
 *
 * `metadata` is not shown, and not even selected by the query. A dozen call sites write
 * into that column; nothing is supposed to put a secret there, and an admin table is the
 * wrong place to discover that one of them did. The summary is a sentence written for a
 * human, which is the whole point of the column existing.
 *
 * The agent name is denormalised onto the row, so a line still reads correctly after the
 * agent is deleted — which is exactly when someone comes looking.
 */
export function AdminAuditTable({ rows }: { rows: AdminAuditRow[] }) {
  return (
    <TableShell title="Audit events" hint={rows.length === 0 ? undefined : `last ${rows.length}, every user, newest first`}>
      <DataTable label="Audit events" minWidth="50rem">
        <thead>
          <tr>
            <Th>Time</Th>
            <Th>User</Th>
            <Th>Kind</Th>
            <Th>What happened</Th>
            <Th>Agent</Th>
            <Th>IP</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--glass-hairline)]">
          {rows.length === 0 ? (
            <EmptyRow colSpan={6}>
              Nothing recorded yet. Withdrawals, budget changes, mode switches, key changes and the kill switch all
              land here.
            </EmptyRow>
          ) : (
            rows.map((row) => (
              <tr key={row.id} className="hover:bg-muted/25">
                <Td muted>
                  <RelativeTime iso={row.createdAt} />
                </Td>
                <Td>
                  {row.handle ? (
                    <Link href={`/u/${row.handle}`} className="underline-offset-2 hover:underline">
                      @{row.handle}
                    </Link>
                  ) : (
                    <span className="text-muted-foreground">deleted</span>
                  )}
                </Td>
                <Td muted className="font-mono text-[11px]">
                  {row.kind}
                </Td>
                <Td className="max-w-[24rem] font-sans whitespace-normal">{row.summary}</Td>
                <Td muted className="max-w-[10rem] truncate font-sans text-xs">
                  {row.agentName ?? "—"}
                </Td>
                <Td muted className="font-mono text-[11px]">
                  {row.ip ?? "—"}
                </Td>
              </tr>
            ))
          )}
        </tbody>
      </DataTable>
    </TableShell>
  );
}
