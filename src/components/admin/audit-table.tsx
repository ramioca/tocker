import Link from "next/link";
import { LocalTime } from "@/components/common/relative-time";
import type { AdminAuditRow } from "@/server/queries/admin";
import type { AuditKind } from "@/lib/security/types";
import { DataTable, EmptyRow, TableShell, Td, Th } from "./table-shell";

/** Words for the enum. A `Record` so a new kind is a type error here, not a raw `snake_case` cell. */
const KIND_LABEL: Record<AuditKind, string> = {
  withdraw: "Withdrawal",
  budget_change: "Budget change",
  go_live: "Went live",
  go_paper: "Back to paper",
  agent_paused: "Agent paused",
  agent_resumed: "Agent resumed",
  llm_key_added: "Key added",
  llm_key_rotated: "Key rotated",
  llm_key_removed: "Key revoked",
  kill_switch_on: "Kill switch on",
  kill_switch_off: "Kill switch off",
  mfa_enrolled: "2FA enrolled",
  mfa_unenrolled: "2FA removed",
  first_trade_preset: "First-trade preset",
  manual_run: "Manual run",
};

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
            <Th sticky>Time</Th>
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
                <Td sticky muted>
                  {/* Exact and in the reader's zone: a column of "2h ago" orders rows but
                      dates none of them. */}
                  <LocalTime iso={row.createdAt} className="whitespace-nowrap" />
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
                {/* The raw kind stays in the tooltip: it is what an admin greps the logs for. */}
                <Td muted className="font-sans text-xs">
                  <span title={row.kind}>{KIND_LABEL[row.kind as AuditKind] ?? row.kind}</span>
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
