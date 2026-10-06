import { LocalTime } from "@/components/common/relative-time";
import type { AdminSlotRequestRow } from "@/server/queries/admin";
import { DataTable, EmptyRow, TableShell, Td, Th } from "./table-shell";

/**
 * Who signed up on the landing page's waitlist before sign-up opened. Newest first.
 *
 * Read-only on purpose: who may sign in is a switch in the Privy dashboard, so there is
 * no button here that could look like it grants access and no action behind one. The
 * address selects whole on a click, since copying it is the one thing this table is for;
 * `title` carries it in full where the pinned column has to cut it short.
 *
 * "Account" answers whether that person has arrived: yes once somebody has signed in
 * with that address.
 */
export function AdminRequestsTable({ rows }: { rows: AdminSlotRequestRow[] }) {
  return (
    <TableShell title="Signups" hint={rows.length === 0 ? undefined : `${rows.length}, newest first`}>
      <DataTable label="Earlier waitlist signups" minWidth="46rem">
        <thead>
          <tr>
            <Th sticky>Email</Th>
            <Th>Volume</Th>
            <Th>Chains</Th>
            <Th>Trades most</Th>
            <Th>Signed up</Th>
            <Th>Account</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--glass-hairline)]">
          {rows.length === 0 ? (
            <EmptyRow colSpan={6}>Nobody signed up on the waitlist.</EmptyRow>
          ) : (
            rows.map((row) => (
              <tr key={row.id} className="hover:bg-muted/25">
                <Td sticky className="max-w-[11rem] truncate font-mono text-xs select-all lg:max-w-[18rem]">
                  <span title={row.email}>{row.email}</span>
                </Td>
                <Td muted>{row.volume}</Td>
                <Td muted>{row.chains.length > 0 ? row.chains.join(", ") : "—"}</Td>
                <Td muted>{row.style ?? "—"}</Td>
                <Td muted>
                  <LocalTime iso={row.createdAt} className="whitespace-nowrap" />
                </Td>
                <Td className={row.hasAccount ? undefined : "text-muted-foreground"}>{row.hasAccount ? "yes" : "no"}</Td>
              </tr>
            ))
          )}
        </tbody>
      </DataTable>
    </TableShell>
  );
}
