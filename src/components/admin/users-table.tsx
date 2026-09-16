import Link from "next/link";
import { RelativeTime } from "@/components/common/relative-time";
import { formatCount } from "@/components/common/format";
import type { AdminUserRow } from "@/server/queries/admin";
import { DataTable, EmptyRow, TableShell, Td, Th } from "./table-shell";

/**
 * Who is on the platform. Newest first, because on an early deployment the question is
 * always "who signed up today".
 *
 * The handle links to the public profile — the same page anyone can see. There is no
 * admin-only view of a user, and no impersonation: nothing here reaches a strategy, so
 * there is nothing an admin could usefully open that the profile does not already show.
 */
export function AdminUsersTable({ rows }: { rows: AdminUserRow[] }) {
  return (
    <TableShell title="Users" hint={rows.length === 0 ? undefined : `${rows.length}, newest first`}>
      <DataTable label="Users" minWidth="46rem">
        <thead>
          <tr>
            <Th>Handle</Th>
            <Th>Email</Th>
            <Th>Joined</Th>
            <Th numeric>Agents</Th>
            <Th numeric>Live</Th>
            <Th>Last run</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--glass-hairline)]">
          {rows.length === 0 ? (
            <EmptyRow colSpan={6}>No users yet. The first Privy login writes the first row.</EmptyRow>
          ) : (
            rows.map((row) => (
              <tr key={row.id} className="hover:bg-muted/25">
                <Td>
                  <Link
                    href={`/u/${row.handle}`}
                    className="font-medium underline-offset-2 hover:underline focus-visible:underline"
                  >
                    @{row.handle}
                  </Link>
                  {row.displayName ? (
                    <span className="ml-2 truncate text-muted-foreground">{row.displayName}</span>
                  ) : null}
                </Td>
                <Td muted className="max-w-[16rem] truncate font-mono text-xs">
                  {row.email ?? "—"}
                </Td>
                <Td muted>
                  <RelativeTime iso={row.createdAt} />
                </Td>
                <Td numeric>{formatCount(row.agentCount)}</Td>
                <Td numeric className={row.liveAgentCount > 0 ? "text-primary" : "text-muted-foreground"}>
                  {formatCount(row.liveAgentCount)}
                </Td>
                <Td muted>{row.lastRunAt ? <RelativeTime iso={row.lastRunAt} /> : "never"}</Td>
              </tr>
            ))
          )}
        </tbody>
      </DataTable>
    </TableShell>
  );
}
