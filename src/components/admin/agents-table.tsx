import Link from "next/link";
import { ModeBadge } from "@/components/common/mode-badge";
import { StatusBadge } from "@/components/common/status-badge";
import { chainLabel } from "@/components/common/chain-badge";
import { RelativeTime } from "@/components/common/relative-time";
import { formatCount, formatSignedUsd, formatUsd } from "@/components/common/format";
import { pnlColor } from "@/components/social-common/pnl-text";
import { describeInferenceStop } from "@/lib/x402/inference-types";
import type { AdminAgentRow } from "@/server/queries/admin";
import { DataTable, EmptyRow, TableShell, Td, Th } from "./table-shell";

/**
 * Every agent on the platform — the metadata and the money, and nothing else.
 *
 * The row is built from the public `AgentCard`, which is the same shape the discover
 * grid and the feed render, so this table structurally cannot grow a strategy column:
 * there is no field on it that holds one. The two admin-only numbers are the wallet
 * USDC and the owner, both of which are facts about money and identity rather than
 * about how the agent decides anything.
 *
 * The name links to the agent's own public page. An admin who opens it sees exactly what
 * a stranger sees — no config, no transcript. Being an admin is not being the owner.
 */
export function AdminAgentsTable({
  rows,
  balancesRead,
}: {
  rows: AdminAgentRow[];
  balancesRead: boolean;
}) {
  return (
    <TableShell title="Agents" hint={rows.length === 0 ? undefined : `${rows.length}, newest first`}>
      <DataTable label="Agents" minWidth="58rem">
        <thead>
          <tr>
            <Th sticky>Agent</Th>
            <Th>Owner</Th>
            <Th>Mode</Th>
            <Th>Status</Th>
            <Th>Chains</Th>
            <Th numeric>Equity</Th>
            <Th numeric>PnL all time</Th>
            <Th numeric>Fills</Th>
            <Th numeric>USDC</Th>
            <Th>Last run</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--glass-hairline)]">
          {rows.length === 0 ? (
            <EmptyRow colSpan={10}>No agents yet. The builder at /agents/new writes the first one.</EmptyRow>
          ) : (
            rows.map(({ card, fundedUsdc, hasLlmKey, thinkSource, inferenceHold }) => (
              <tr key={card.id} className="hover:bg-muted/25">
                <Td sticky className="max-w-[14rem]">
                  <Link
                    href={`/agents/${card.slug}`}
                    className="truncate font-medium underline-offset-2 hover:underline focus-visible:underline"
                  >
                    {card.name}
                  </Link>
                </Td>
                <Td muted>
                  <Link href={`/u/${card.owner.handle}`} className="underline-offset-2 hover:underline">
                    @{card.owner.handle}
                  </Link>
                </Td>
                <Td>
                  <ModeBadge mode={card.mode} size="xs" />
                </Td>
                <Td>
                  <span className="inline-flex items-center gap-1.5">
                    <StatusBadge status={card.status} />
                    {/* A pay-per-use agent has no key on purpose: it pays for each model step
                        from its own wallet. What can stop it is a hold, and the hold says why. */}
                    {thinkSource === "usdc" ? (
                      <span
                        title={
                          inferenceHold
                            ? describeInferenceStop(inferenceHold).title
                            : "Pays for its own thinking, per step, from its Solana wallet"
                        }
                        className={
                          inferenceHold
                            ? "inline-flex items-center rounded-md border border-destructive/40 bg-destructive/12 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide whitespace-nowrap text-destructive uppercase"
                            : "inline-flex items-center rounded-md border border-border px-1.5 py-0.5 text-[10px] font-semibold tracking-wide whitespace-nowrap text-muted-foreground uppercase"
                        }
                      >
                        {inferenceHold ? "Pay per use · held" : "Pay per use"}
                      </span>
                    ) : /* ACTIVE alone hides that every tick of a keyless agent fails. */
                    hasLlmKey === false ? (
                      <span
                        title="No LLM key attached: every tick fails"
                        className="inline-flex items-center rounded-md border border-destructive/40 bg-destructive/12 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide whitespace-nowrap text-destructive uppercase"
                      >
                        No key
                      </span>
                    ) : null}
                  </span>
                </Td>
                <Td muted className="font-sans text-xs">
                  {card.chains.length === 0 ? "—" : card.chains.map(chainLabel).join(" · ")}
                </Td>
                {/* Full precision, like PnL beside it: compact switches format at $10K mid-column. */}
                <Td numeric>{formatUsd(card.equityUsd)}</Td>
                <Td numeric>
                  <span style={{ color: card.pnlUsd === null ? undefined : pnlColor(card.pnlUsd) }}>
                    {formatSignedUsd(card.pnlUsd)}
                  </span>
                </Td>
                <Td numeric>{formatCount(card.tradeCount)}</Td>
                <Td
                  numeric
                  muted={(card.mode === "paper" && thinkSource !== "usdc") || fundedUsdc === null || fundedUsdc === 0}
                >
                  {/* An unread balance is "—", not "$0.00": they are different facts and
                      only one of them means the wallet is empty. A paper agent's book is
                      not its wallet, so its USDC says nothing, unless it pays for its own
                      thinking: then that wallet is what it thinks on. */}
                  {!balancesRead || (card.mode === "paper" && thinkSource !== "usdc") || fundedUsdc === null
                    ? "—"
                    : formatUsd(fundedUsdc)}
                </Td>
                <Td muted>{card.lastRunAt ? <RelativeTime iso={card.lastRunAt} /> : "never"}</Td>
              </tr>
            ))
          )}
        </tbody>
      </DataTable>
    </TableShell>
  );
}
