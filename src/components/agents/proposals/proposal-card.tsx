"use client";

/**
 * One trade waiting on a human, built to be judged in about three seconds.
 *
 * An owner now gets up to three of these a tick, on tokens that did not exist this
 * morning, and each one dies in five minutes. So the card is ordered by what a person
 * actually asks, in the order they ask it:
 *
 * 1. **What and how much** — the side, the size, the token, the chain, and how long is
 *    left. The countdown is a ring, not a sentence: it is the thing you catch from the
 *    corner of your eye, and it goes amber with two minutes to go.
 * 2. **Is anyone there** — the stat strip. Age, buyers in the last five minutes against
 *    the hour behind them, the depth of the pool a fill would route through, the GT
 *    Score and the composite. Five cells, in the same place on every card, so three of
 *    them side by side can be read across rather than one at a time.
 * 3. **Is it a trap** — the badge row, derived from the score the agent actually pulled
 *    the trigger on. "Authority unknown" is its own state and never quietly becomes
 *    "revoked".
 * 4. **Why** — the agent's rationale, three lines until you ask for more. It is the
 *    least time-critical thing on the card and it used to be the tallest.
 *
 * Two behaviours are deliberate and unchanged: Approve is disabled when the guard says
 * the trade is no longer allowed (better to explain than to let someone tap into a
 * rejection), and live money is held rather than tapped.
 */
import { GeckoTerminalLink } from "@/components/common/chart-link";
import { useEffect, useRef, useState } from "react";
import { ArrowDownRight, ArrowUpRight, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import type { ApprovalDecision } from "@/components/spectrumui/blocks/ai-assistants/approval-card";
import { HoldToConfirmButton } from "@/components/spectrumui/hold-to-confirm";
import { MorphButton } from "@/components/spectrumui/morph-button";
import { MORPH_FOCUS } from "@/components/common/focus";
import { AgentAvatar } from "@/components/common/agent-avatar";
import { ChainBadge } from "@/components/common/chain-badge";
import { formatUsd } from "@/components/common/format";
import { useRunStatus } from "@/components/providers/run-status";
import { decideProposalAction } from "@/server/actions/trading";
import { cn } from "@/lib/utils";
import { useNow } from "@/hooks/use-now";
import type { ProposalRow } from "@/server/types";
import { CountdownPill, PriceLine, ProposalStatStrip, SafetyBadges } from "./stat-strip";
import { formatCountdown } from "./proposal-stats";

/** Re-exported: the live wizard's panel and this card must show the same clock. */
export { formatCountdown };

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
  // The decision in flight. The card settles only once the server has said yes, so a
  // refused approval never flashes "Approved" first. A refusal remounts the hold button.
  const [pending, setPending] = useState<ApprovalDecision | null>(null);
  const [attempt, setAttempt] = useState(0);
  // Whether the decision was made from this card's own controls with focus still on them.
  // Settling swaps the card out, which would drop that focus to <body>; the settled card
  // takes it instead.
  const [focusSettled, setFocusSettled] = useState(false);
  const articleRef = useRef<HTMLElement>(null);

  const expiresAt = new Date(proposal.expiresAt).getTime();
  const proposedAt = new Date(proposal.proposedAt ?? proposal.createdAt).getTime();
  const remaining = expiresAt - now;
  const ttlMs = Math.max(1, expiresAt - proposedAt);
  const expired = remaining <= 0;
  const requestedUsd = proposal.requestedUsd ?? proposal.amountUsd;
  const buying = proposal.side === "buy";
  const blocked = !proposal.stillValid || expired;

  const decide = async (next: ApprovalDecision) => {
    if (pending !== null) return;
    // Read at the press: Reject disables while pending, and a disabled button lets go of focus.
    const focusedAtPress = articleRef.current?.contains(document.activeElement) ?? false;
    setPending(next);
    const result = await decideProposalAction(proposal.id, next === "approved" ? "approve" : "reject").catch(
      () => ({ ok: false as const, error: "Could not reach Tocker. Nothing was decided." }),
    );
    if (!result.ok) {
      setPending(null);
      setAttempt((n) => n + 1);
      toast.error(next === "approved" ? "Not approved" : "Not rejected", { description: result.error });
      throw new Error(result.error);
    }
    setSettledMessage(result.data.message);
    // Unless the operator has since moved on to something else on the page.
    const active = document.activeElement;
    setFocusSettled(
      focusedAtPress && (active === null || active === document.body || (articleRef.current?.contains(active) ?? false)),
    );
    setDecision(next);
    // The island counts proposals, so it has to hear about this immediately.
    refreshProposals();
    onDecided?.(proposal.id, result.data.status);
    toast.success(result.data.message);
  };

  if (decision !== null) {
    return (
      <SettledCard
        id={proposal.id}
        autoFocus={focusSettled}
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
      ref={articleRef}
      id={`proposal-${proposal.id}`}
      data-proposal-card=""
      // Focusable from script only: the list hands focus here when a decided card leaves.
      tabIndex={-1}
      className={cn(
        "flex h-full flex-col rounded-xl border bg-card/40 p-4 outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
        "transition-[border-color,box-shadow] duration-300 ease-[cubic-bezier(0.23,1,0.32,1)]",
        highlighted ? "border-primary/60 ring-2 ring-primary/30" : "border-border/70",
      )}
    >
      <header className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
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

        <h3 className="tnum min-w-0 truncate text-sm font-semibold tracking-tight">
          {formatUsd(requestedUsd)} of {proposal.token.symbol}
        </h3>
        <ChainBadge chain={proposal.chain} />
        <GeckoTerminalLink chain={proposal.chain} address={proposal.token.address} symbol={proposal.token.symbol} />
        {proposal.isPaper ? null : (
          <span className="rounded-md border border-[oklch(0.7_0.19_300)]/40 bg-[oklch(0.7_0.19_300)]/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[oklch(0.78_0.15_300)]">
            Live money
          </span>
        )}

        <CountdownPill msRemaining={remaining} ttlMs={ttlMs} className="ml-auto" />
      </header>

      {showAgent ? (
        <p className="mt-1.5 truncate text-[11px] text-muted-foreground">{proposal.agentName} is asking</p>
      ) : null}

      <ProposalStatStrip stats={proposal} score={proposal.score} className="mt-3.5" />

      <PriceLine
        priceUsd={proposal.priceUsd > 0 ? proposal.priceUsd : null}
        symbol={proposal.token.symbol}
        sparkline={proposal.sparkline}
        className="mt-3"
      />

      <SafetyBadges safety={proposal.safety} className="mt-3" />

      {proposal.rationale ? <Rationale text={proposal.rationale} className="mt-3" /> : null}

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

      {/* `mt-auto`: in the compare grid the action rows line up across cards even when
          one rationale runs longer than another. */}
      <footer className="mt-auto flex flex-wrap items-center justify-end gap-2 pt-4">
        <button
          type="button"
          onClick={() => void decide("rejected").catch(() => undefined)}
          disabled={pending !== null}
          aria-busy={pending === "rejected" || undefined}
          className={cn(
            "inline-flex h-8 items-center rounded-lg px-3 text-xs font-medium text-muted-foreground",
            "transition-[background-color,color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)]",
            "hover:bg-muted hover:text-foreground active:scale-[0.97]",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            "disabled:pointer-events-none disabled:opacity-50",
          )}
        >
          {pending === "rejected" ? "Rejecting…" : "Reject"}
        </button>

        {proposal.isPaper ? (
          <MorphButton
            size="sm"
            className={MORPH_FOCUS}
            disabled={blocked || pending === "rejected"}
            loadingLabel="Approving…"
            successLabel="Filled"
            errorLabel="Refused"
            onAction={() => decide("approved")}
          >
            Approve
          </MorphButton>
        ) : (
          <HoldToConfirmButton
            key={attempt}
            size="sm"
            disabled={blocked || pending === "rejected"}
            duration={1_400}
            label="Hold to approve"
            confirmedLabel="Approving…"
            resetDelay={0}
            icon={<ArrowUpRight size={12} strokeWidth={2} />}
            onConfirm={() => void decide("approved").catch(() => undefined)}
            className="border-primary/40 bg-primary/10 text-foreground hover:bg-primary/15 dark:border-primary/40 dark:bg-primary/10 dark:text-foreground dark:hover:bg-primary/15"
          />
        )}
      </footer>
    </article>
  );
}

/**
 * The agent's reasoning, three lines deep.
 *
 * The toggle only appears when there is something behind it: measured rather than
 * guessed from the string length, because three lines is a function of the card's
 * width, and in the compare grid that width changes with the viewport.
 */
function Rationale({ text, className }: { text: string; className?: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [clamped, setClamped] = useState(false);

  useEffect(() => {
    const node = ref.current;
    // While expanded there is nothing to measure — scrollHeight equals clientHeight,
    // and re-measuring would hide the control that collapses it again.
    if (!node || expanded) return;
    const measure = () => setClamped(node.scrollHeight > node.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [text, expanded]);

  return (
    <div className={className}>
      <p
        ref={ref}
        className={cn("text-sm leading-relaxed text-foreground/85", expanded ? null : "line-clamp-3")}
      >
        {text}
      </p>
      {clamped ? (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
          className={cn(
            "mt-1 rounded text-[11px] font-medium text-muted-foreground",
            "transition-colors duration-150 hover:text-foreground focus-ring",
          )}
        >
          {expanded ? "Show less" : "Expand"}
        </button>
      ) : null}
    </div>
  );
}

/** The settled state: the decision reads for a beat before the list drops the card. */
function SettledCard({
  id,
  autoFocus = false,
  decision,
  message,
  symbol,
  side,
  requestedUsd,
}: {
  id: string;
  /** Take focus on mount: the button that decided it was focused and has just unmounted. */
  autoFocus?: boolean;
  decision: ApprovalDecision;
  message: string | null;
  symbol: string;
  side: "buy" | "sell";
  requestedUsd: number;
}) {
  const approved = decision === "approved";
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (autoFocus) ref.current?.focus({ preventScroll: true });
  }, [autoFocus]);
  return (
    <article
      ref={ref}
      id={`proposal-${id}`}
      data-proposal-card=""
      tabIndex={-1}
      className={cn(
        "h-full rounded-xl border p-4 outline-none focus-visible:ring-2 focus-visible:ring-ring/50 motion-safe:animate-in motion-safe:fade-in motion-safe:duration-200",
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
