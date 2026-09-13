"use client";

/**
 * One trade waiting on a human.
 *
 * Built on the shape of Spectrum's `approval-card` (`blocks/ai-assistants/approval-card`):
 * the same title → body → meta → two-button layout and the same settle-in-place
 * confirmation, re-skinned onto the app's tokens and given the four things a *trade*
 * needs that a generic approval does not — the size and the quoted price, the score it
 * was proposed on, a countdown, and a live "is this still allowed?" verdict.
 *
 * Two deliberate choices:
 *
 * - **Approve is disabled when the guard says no.** Better to explain why a trade is no
 *   longer allowed than to let someone tap Approve and receive a rejection.
 * - **Live money is held, not tapped.** A paper agent gets a morph button; a live one
 *   gets hold-to-confirm, the same gesture as going live in the first place.
 */
import { useState } from "react";
import { ArrowDownRight, ArrowUpRight, Clock, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import type { ApprovalDecision } from "@/components/spectrumui/blocks/ai-assistants/approval-card";
import { HoldToConfirmButton } from "@/components/spectrumui/hold-to-confirm";
import { MorphButton } from "@/components/spectrumui/morph-button";
import { AgentAvatar } from "@/components/common/agent-avatar";
import { ChainBadge } from "@/components/common/chain-badge";
import { formatUsd } from "@/components/common/format";
import { TradeScoreChip } from "@/components/tokens";
import { useRunStatus } from "@/components/providers/run-status";
import { decideProposalAction } from "@/server/actions/trading";
import { cn } from "@/lib/utils";
import { useNow } from "@/hooks/use-now";
import type { ProposalRow } from "@/server/types";

/** "12:04" under an hour, "3h 12m" over it, "Expired" past the TTL. */
export function formatCountdown(msRemaining: number): string {
  if (msRemaining <= 0) return "Expired";
  const totalSeconds = Math.floor(msRemaining / 1000);
  if (totalSeconds < 3_600) {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
  }
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  return `${hours}h ${minutes}m`;
}

export function ProposalCard({
  proposal,
  highlighted = false,
  showAgent = false,
  onDecided,
}: {
  proposal: ProposalRow;
  highlighted?: boolean;
  /** Show which agent is asking — the notifications page lists several agents at once. */
  showAgent?: boolean;
  onDecided?: (tradeId: string, status: "filled" | "rejected") => void;
}) {
  const now = useNow();
  const { refreshProposals } = useRunStatus();
  const [decision, setDecision] = useState<ApprovalDecision | null>(null);
  const [settledMessage, setSettledMessage] = useState<string | null>(null);

  const remaining = new Date(proposal.expiresAt).getTime() - now;
  const expired = remaining <= 0;
  const urgent = !expired && remaining < 120_000;
  const requestedUsd = proposal.requestedUsd ?? proposal.amountUsd;
  const buying = proposal.side === "buy";
  const blocked = !proposal.stillValid || expired;

  const decide = async (next: ApprovalDecision) => {
    // Optimistic: the card settles at once, and reverts only if the server disagrees.
    setDecision(next);
    const result = await decideProposalAction(proposal.id, next === "approved" ? "approve" : "reject");
    if (!result.ok) {
      setDecision(null);
      toast.error(next === "approved" ? "Not approved" : "Not rejected", { description: result.error });
      throw new Error(result.error);
    }
    setSettledMessage(result.data.message);
    // The island counts proposals, so it has to hear about this immediately.
    refreshProposals();
    onDecided?.(proposal.id, result.data.status);
    toast.success(result.data.message);
  };

  if (decision !== null) {
    return (
      <SettledCard
        decision={decision}
        message={settledMessage}
        symbol={proposal.token.symbol}
        side={proposal.side}
        requestedUsd={requestedUsd}
      />
    );
  }

  return (
    <article
      id={`proposal-${proposal.id}`}
      className={cn(
        "rounded-xl border bg-card/40 p-4",
        "transition-[border-color,box-shadow] duration-300 ease-[cubic-bezier(0.23,1,0.32,1)]",
        highlighted ? "border-primary/60 ring-2 ring-primary/30" : "border-border/70",
      )}
    >
      <header className="flex flex-wrap items-center gap-2">
        {showAgent ? (
          <AgentAvatar seed={proposal.agentAvatarSeed} name={proposal.agentName} size="sm" />
        ) : null}
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide",
            buying
              ? "border-[oklch(0.72_0.17_150)]/40 bg-[oklch(0.72_0.17_150)]/10 text-[oklch(0.78_0.15_150)]"
              : "border-[oklch(0.68_0.2_25)]/40 bg-[oklch(0.68_0.2_25)]/10 text-[oklch(0.74_0.18_25)]",
          )}
        >
          {buying ? <ArrowUpRight aria-hidden className="size-3" /> : <ArrowDownRight aria-hidden className="size-3" />}
          {proposal.side}
        </span>

        <h3 className="text-sm font-semibold tracking-tight">
          {formatUsd(requestedUsd)} of {proposal.token.symbol}
        </h3>
        <ChainBadge chain={proposal.chain} />
        {proposal.isPaper ? null : (
          <span className="rounded-md border border-[oklch(0.7_0.19_300)]/40 bg-[oklch(0.7_0.19_300)]/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[oklch(0.78_0.15_300)]">
            Live money
          </span>
        )}

        <span
          className={cn(
            "tnum ml-auto inline-flex items-center gap-1.5 font-mono text-xs",
            expired ? "text-destructive" : urgent ? "text-[oklch(0.8_0.15_75)]" : "text-muted-foreground",
          )}
          title={`Expires ${new Date(proposal.expiresAt).toLocaleString()}`}
        >
          <Clock aria-hidden className="size-3.5" />
          {formatCountdown(remaining)}
        </span>
      </header>

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-4">
        <Stat label="Requested" value={formatUsd(requestedUsd)} />
        <Stat label="Quoted price" value={formatUsd(proposal.priceUsd || null)} />
        <Stat
          label="Est. tokens"
          value={
            proposal.priceUsd > 0
              ? (requestedUsd / proposal.priceUsd).toLocaleString("en-US", { maximumFractionDigits: 2 })
              : "—"
          }
        />
        <Stat label={showAgent ? "Agent" : "Proposed"} value={showAgent ? proposal.agentName : relative(proposal.proposedAt)} />
      </dl>

      {proposal.score ? <div className="mt-3">{<TradeScoreChip score={proposal.score} />}</div> : null}

      {proposal.rationale ? (
        <p className="mt-3 text-sm leading-relaxed text-foreground/85">{proposal.rationale}</p>
      ) : null}

      {blocked ? (
        <p className="mt-3 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-2.5 py-2 text-xs leading-relaxed text-destructive">
          <ShieldAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          <span>
            {expired
              ? "This proposal expired. The agent will propose again next tick if it still likes the trade."
              : proposal.invalidReason}
          </span>
        </p>
      ) : null}

      <footer className="mt-4 flex flex-wrap items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => void decide("rejected").catch(() => undefined)}
          className={cn(
            "inline-flex h-8 items-center rounded-lg px-3 text-xs font-medium text-muted-foreground",
            "transition-[background-color,color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)]",
            "hover:bg-muted hover:text-foreground active:scale-[0.97]",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          )}
        >
          Reject
        </button>

        {proposal.isPaper ? (
          <MorphButton
            size="sm"
            disabled={blocked}
            loadingLabel="Approving…"
            successLabel="Filled"
            errorLabel="Refused"
            onAction={() => decide("approved")}
          >
            Approve
          </MorphButton>
        ) : (
          <HoldToConfirmButton
            size="sm"
            disabled={blocked}
            duration={1_400}
            label="Hold to approve"
            confirmedLabel="Approved"
            icon={<ArrowUpRight size={12} strokeWidth={2} />}
            onConfirm={() => void decide("approved").catch(() => undefined)}
            className="border-primary/40 bg-primary/10 text-foreground hover:bg-primary/15 dark:border-primary/40 dark:bg-primary/10 dark:text-foreground dark:hover:bg-primary/15"
          />
        )}
      </footer>
    </article>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="tnum truncate font-mono text-xs">{value}</dd>
    </div>
  );
}

function relative(iso: string | null): string {
  if (!iso) return "—";
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
}

/** The settled state: the decision reads for a beat before the list drops the card. */
function SettledCard({
  decision,
  message,
  symbol,
  side,
  requestedUsd,
}: {
  decision: ApprovalDecision;
  message: string | null;
  symbol: string;
  side: "buy" | "sell";
  requestedUsd: number;
}) {
  const approved = decision === "approved";
  return (
    <article
      className={cn(
        "rounded-xl border p-4 motion-safe:animate-in motion-safe:fade-in motion-safe:duration-200",
        approved ? "border-[oklch(0.72_0.17_150)]/40 bg-[oklch(0.72_0.17_150)]/[0.06]" : "border-border/70 bg-card/30",
      )}
    >
      <p className="text-sm font-medium">
        {message ??
          (approved
            ? `Approved — ${side === "buy" ? "buying" : "selling"} ${formatUsd(requestedUsd)} of ${symbol}.`
            : `Rejected — ${symbol} was not traded.`)}
      </p>
      <p className="mt-1 font-mono text-[11px] text-muted-foreground">
        {approved ? "decided by you · published to your followers" : "decided by you · nothing published"}
      </p>
    </article>
  );
}
