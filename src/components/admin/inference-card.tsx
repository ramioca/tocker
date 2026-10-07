import Link from "next/link";
import { formatCount, formatUsd } from "@/components/common/format";
import { LocalTime, RelativeTime } from "@/components/common/relative-time";
import { cn } from "@/lib/utils";
import { describeInferenceStop, isInferenceStopReason, type InferenceStage } from "@/lib/x402/inference-types";
import type { AdminInference } from "@/server/queries/admin";
import { InferenceControls } from "./inference-controls";
import { RowTime } from "./row-time";
import { DataTable, EmptyRow, PINNED_TIME_WIDTH, TableShell, Td, Th } from "./table-shell";

/**
 * Pay-per-use thinking, for the operator: what is switched on, what has been spent today
 * against each cap, what is still open, what the breakers see, and the switch that stops
 * it.
 *
 * Everything on it is the ledger's own: amounts, statuses, times, model ids. The ledger
 * keeps no prompt and no answer, so neither can appear; a provider's words for a failure
 * arrive already redacted and cut short (`getAdminInference`). An agent's name links to
 * its public page, as everywhere else on this dashboard.
 *
 * The environment switches are read-only here on purpose. They are a deploy. The one
 * switch on this page that takes effect at once is the halt, and it only ever stops.
 */

const STAGE_LABEL: Record<InferenceStage, string> = {
  off: "Switched off",
  owner: "Admins and invited accounts only",
  on: "On for everyone",
};

const BREAKER_LABEL: Record<AdminInference["breakers"][number]["rule"], string> = {
  unanswered: "Steps paid for, or maybe paid for, with no answer",
  gateway: "Runs stopped because the gateway did not answer",
  signature: "Runs stopped because the wallet did not sign",
  pin_mismatch: "Runs stopped because the payment asked for was not the pinned one",
};

function Fact({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  tone?: "alert";
}) {
  return (
    // Each tile paints its own ground so the grid's 1px gaps read as hairlines, as on
    // the headline tiles above.
    <div className="min-w-0 bg-[var(--card)] px-4 py-3.5">
      <p className="text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">{label}</p>
      <p className={cn("tnum mt-1 font-mono text-lg leading-tight", tone === "alert" ? "text-destructive" : "text-foreground")}>
        {value}
      </p>
      {sub ? <p className="tnum mt-1 font-mono text-[11px] leading-4 text-muted-foreground">{sub}</p> : null}
    </div>
  );
}

/** "$0.42 of $2.00": a counter against its cap. */
function against(usd: number, capUsd: number): string {
  return `${formatUsd(usd)} of ${formatUsd(capUsd)}`;
}

/** What a payment asked for this second would be told, in one line. */
function verdict(data: AdminInference): { text: string; refused: boolean } {
  if (data.switches.mock) return { text: "Mock mode: nothing is paid, every step is simulated.", refused: false };
  if (data.switches.stage === "off") return { text: "Refused: pay-per-use is switched off (INFERENCE_USDC).", refused: true };
  if (data.control.stops === "halted") return { text: "Refused: an admin has halted pay-per-use.", refused: true };
  if (data.control.stops === "paused") return { text: "Refused: a breaker has paused pay-per-use.", refused: true };
  if (!data.switches.rpcConfigured) return { text: "Refused: SOLANA_RPC_URL is not set, so no payment can be checked.", refused: true };
  if (!(data.switches.platformDayUsd > 0)) return { text: "Refused: the platform's daily limit is zero.", refused: true };
  if (data.today.platformUsd >= data.switches.platformDayUsd) return { text: "Refused: the platform's daily limit is reached.", refused: true };
  // Not a refusal: the pay path asks only that SOLANA_RPC_URL is set, so with the public
  // endpoint a payment IS signed. It is said here because that is the one setting under
  // which money moves while the checks behind it (the balance read, the reconciler) rest
  // on a rate-limited node.
  const caution = data.switches.rpcPublic
    ? " But SOLANA_RPC_URL is the public Solana endpoint: set your own provider's URL before any payment is made."
    : "";
  return {
    text:
      (data.switches.stage === "owner"
        ? "Allowed for admins and invited accounts, within every cap."
        : "Allowed for every account, within every cap.") + caution,
    refused: false,
  };
}

export function InferenceCard({ data }: { data: AdminInference }) {
  const { switches, today, control, openCounts } = data;
  const openTotal = openCounts.reserved + openCounts.signed + openCounts.unconfirmed + openCounts.answered_unproven;
  const now = verdict(data);

  return (
    <div className="min-w-0 space-y-6">
      {/* What a payment asked for right now would be told, before any figure. */}
      <p
        className={cn(
          "rounded-lg border px-3 py-2.5 text-sm",
          now.refused ? "border-destructive/25 bg-destructive/[0.06]" : "border-[var(--glass-hairline)]",
        )}
      >
        <span className="font-medium">Right now.</span> {now.text}
      </p>

      <div className="glass-card grid min-w-0 grid-cols-2 gap-px overflow-hidden rounded-2xl bg-[var(--glass-hairline)] lg:grid-cols-4">
        <Fact
          label="Switch"
          value={STAGE_LABEL[switches.stage]}
          sub={
            switches.stage === "owner"
              ? `${formatCount(switches.invitedUsers)} invited account${switches.invitedUsers === 1 ? "" : "s"} · INFERENCE_USDC`
              : "INFERENCE_USDC · a deploy changes it"
          }
        />
        <Fact
          label={`All agents · ${data.day} UTC`}
          value={against(today.platformUsd, switches.platformDayUsd)}
          sub={`${formatCount(today.platformRequests)} request${today.platformRequests === 1 ? "" : "s"} · starts again 00:00 UTC`}
          tone={switches.platformDayUsd > 0 && today.platformUsd >= switches.platformDayUsd ? "alert" : undefined}
        />
        <Fact
          label="Busiest account today"
          value={against(today.largestOwnerUsd, switches.ownerDayUsd)}
          sub={`${formatCount(today.owners)} account${today.owners === 1 ? "" : "s"} · ${formatCount(today.agents)} agent${today.agents === 1 ? "" : "s"} · ${formatCount(today.manualRuns)} by hand`}
        />
        <Fact
          label="Still open"
          value={formatCount(openTotal)}
          // The fourth kind and the late count are named only when there are any, so the
          // line reads as it did while there are none.
          sub={[
            `${formatCount(openCounts.reserved)} reserved`,
            `${formatCount(openCounts.signed)} signed`,
            `${formatCount(openCounts.unconfirmed)} unconfirmed`,
            ...(openCounts.answered_unproven > 0 ? [`${formatCount(openCounts.answered_unproven)} answered, unproven`] : []),
            ...(data.noVerdictInTime > 0 ? [`${formatCount(data.noVerdictInTime)} with no verdict in time`] : []),
          ].join(" · ")}
          tone={openCounts.unconfirmed > 0 || data.noVerdictInTime > 0 ? "alert" : undefined}
        />
      </div>

      <dl className="grid min-w-0 gap-x-8 gap-y-4 text-sm sm:grid-cols-2">
        <div className="min-w-0">
          <dt className="font-medium">Caps</dt>
          <dd className="tnum mt-1 leading-6 text-muted-foreground">
            {formatUsd(switches.stepUsd)} a step at most · {formatUsd(switches.ownerDayUsd)} an account a day ·{" "}
            {formatUsd(switches.platformDayUsd)} all agents a day · {formatCount(switches.agentDayRequests)} requests an
            agent a day. Each owner&rsquo;s own run and day limits sit under these.
            {switches.rpcConfigured ? "" : " SOLANA_RPC_URL is not set: nothing can be paid until it is."}
            {switches.rpcPublic
              ? " SOLANA_RPC_URL is the public Solana endpoint (api.mainnet-beta.solana.com). It is rate limited: a payment would still be signed, and the wallet read before a run and the reconciler after it would depend on it. Use your own provider's URL."
              : ""}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="font-medium">Today&rsquo;s ledger</dt>
          <dd className="tnum mt-1 leading-6 text-muted-foreground">
            {today.byStatus.length === 0
              ? "No payment has been reserved today."
              : today.byStatus
                  .map((row) => `${formatCount(row.count)} ${row.status.replace(/_/g, " ")} (${formatUsd(row.usd)})`)
                  .join(" · ")}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="font-medium">Admin halt</dt>
          <dd className="mt-1 leading-6 text-muted-foreground">
            {control.halted ? (
              <>
                <span className="font-medium text-destructive">On.</span>{" "}
                <span className="block max-h-64 overflow-y-auto break-words whitespace-pre-wrap">
                  {control.haltReason ?? "No reason was recorded."}
                </span>
                {control.updatedBy ? ` Set by ${control.updatedBy}` : ""}
                {control.updatedAt ? (
                  <>
                    {" "}
                    <RelativeTime iso={control.updatedAt} />.
                  </>
                ) : control.updatedBy ? (
                  "."
                ) : null}
              </>
            ) : control.haltClearedAt ? (
              <>
                Off. Last cleared <RelativeTime iso={control.haltClearedAt} />
                {control.updatedBy ? ` by ${control.updatedBy}` : ""}.
              </>
            ) : (
              "Off. It has never been thrown."
            )}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="font-medium">Breaker pause</dt>
          <dd className="mt-1 leading-6 text-muted-foreground">
            {control.stops === "paused" && control.pausedUntil ? (
              <>
                <span className="font-medium text-destructive">Paused</span> until <LocalTime iso={control.pausedUntil} />
                {control.pauseReason ? `: ${control.pauseReason}.` : "."}
              </>
            ) : control.pausedUntil ? (
              <>
                Not paused. The last pause ended <RelativeTime iso={control.pausedUntil} />.
              </>
            ) : (
              "Not paused. No breaker has tripped."
            )}
          </dd>
        </div>
      </dl>

      <div className="min-w-0">
        <h3 className="text-sm font-medium">What the breakers see</h3>
        <ul className="tnum mt-2 divide-y divide-[var(--glass-hairline)] rounded-lg border border-[var(--glass-hairline)] text-[13px]">
          {data.breakers.map((breaker) => (
            <li key={breaker.rule} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 px-3 py-2">
              <span className="min-w-0">{BREAKER_LABEL[breaker.rule]}</span>
              <span className={cn("font-mono text-xs", breaker.tripped ? "text-destructive" : "text-muted-foreground")}>
                {formatCount(breaker.count)}
                {breaker.accounts === null ? "" : ` from ${formatCount(breaker.accounts)} account${breaker.accounts === 1 ? "" : "s"}`} in{" "}
                {breaker.windowMinutes} min · pauses at {breaker.threshold}
                {/* Accounts, not agents: two agents of one owner are one, as the ledger counts. */}
                {breaker.accountsThreshold === null ? "" : ` from ${formatCount(breaker.accountsThreshold)} accounts`}
                {breaker.tripped ? " · tripped" : ""}
              </span>
            </li>
          ))}
        </ul>
        {data.holds.length > 0 ? (
          <p className="tnum mt-2 text-xs leading-5 text-muted-foreground">
            Agents held, and why:{" "}
            {data.holds
              .map((hold) => {
                const title = isInferenceStopReason(hold.reason) ? describeInferenceStop(hold.reason).title : hold.reason;
                return `${formatCount(hold.agents)} · ${title}`;
              })
              .join("; ")}
            . A held agent is not failing: no run row is written and its owner is told once.
          </p>
        ) : null}
      </div>

      <TableShell
        title="Payments still open"
        hint={
          openTotal > data.open.length
            ? `the ${data.open.length} oldest of ${formatCount(openTotal)}`
            : openTotal === 0
              ? undefined
              : "oldest first"
        }
        scrollPadLeft={PINNED_TIME_WIDTH}
        notice={
          <p className="border-b border-[var(--glass-hairline)] bg-muted/30 px-4 py-2 text-xs text-muted-foreground">
            Reserved: counted against the caps, nothing signed. Signed: the paid request is in flight, or its process died.
            Unconfirmed: signed, the request failed, and the chain has not been asked yet; counted as charged until it has.
            Answered, unproven: the step was answered and the gateway named no transaction for its payment; counted as
            charged, and kept out of the owner&rsquo;s Money total and out of every P&amp;L until its transaction is
            on the row. The reconciler asks the chain about these every five minutes, for{" "}
            {formatCount(data.checkedForHours)} hours from when a row was written. A row marked &ldquo;no verdict in
            time&rdquo; is older than that: it stays counted as charged and is looked at again only now and then,
            until {formatCount(data.lateLookDays)} days old, and after that not at all. Audit that wallet with{" "}
            <span className="font-mono">scripts/inference-audit.ts</span>.
          </p>
        }
      >
        <DataTable label="Payments still open" minWidth="46rem">
          <thead>
            <tr>
              <Th sticky>Reserved</Th>
              <Th>Status</Th>
              <Th>Agent</Th>
              <Th>Model</Th>
              <Th numeric>Quoted</Th>
              <Th numeric>HTTP</Th>
              <Th>Why</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--glass-hairline)]">
            {data.open.length === 0 ? (
              <EmptyRow colSpan={7}>Nothing is open. Every payment on the ledger has reached its end.</EmptyRow>
            ) : (
              data.open.map((row) => (
                <tr key={row.id} className="hover:bg-muted/25">
                  <Td sticky muted className="text-xs">
                    <RowTime iso={row.createdAt} />
                  </Td>
                  <Td className={cn("text-xs", (row.status === "unconfirmed" || row.noVerdictInTime) && "text-destructive")}>
                    {row.status === "answered_unproven" ? "answered, unproven" : row.status}
                    {row.noVerdictInTime ? <span className="block text-[11px]">no verdict in time</span> : null}
                  </Td>
                  <Td>
                    <span className="flex max-w-[12rem] flex-col">
                      {row.agentSlug && row.agentName ? (
                        <Link
                          href={`/agents/${row.agentSlug}`}
                          className="truncate underline-offset-2 hover:underline focus-visible:underline"
                        >
                          {row.agentName}
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">deleted agent</span>
                      )}
                      {row.ownerHandle ? <span className="truncate text-[11px] text-muted-foreground">@{row.ownerHandle}</span> : null}
                    </span>
                  </Td>
                  <Td muted className="font-mono text-[11px]">
                    {row.model}
                  </Td>
                  <Td numeric>{formatUsd(row.quotedUsd)}</Td>
                  <Td numeric muted>
                    {row.httpStatus ?? "—"}
                  </Td>
                  <Td muted className="max-w-[18rem] text-xs">
                    {/* Already redacted and cut short by the query. Plain text, never markup. */}
                    <span className="block truncate" title={row.detail ?? undefined}>
                      {row.detail ?? "—"}
                    </span>
                  </Td>
                </tr>
              ))
            )}
          </tbody>
        </DataTable>
      </TableShell>

      <InferenceControls
        halted={control.halted}
        paused={control.stops === "paused"}
        wallets={data.wallets.map((wallet) => ({
          walletId: wallet.walletId,
          address: wallet.address,
          agentName: wallet.agentName,
          payPerUse: wallet.payPerUse,
        }))}
      />
    </div>
  );
}
