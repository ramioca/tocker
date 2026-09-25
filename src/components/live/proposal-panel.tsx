"use client";

/**
 * A proposal, in the first-live-trade wizard (W7 B6).
 *
 * The default execution mode is `approve`: `place_trade` writes a `trades` row with
 * `status: "proposed"` and routes nothing. The wizard used to render that row through
 * the fill panel, so the screen said "Bought FARTCOIN" in green over a transaction that
 * did not exist. This is the panel that says the true thing instead — and, because the
 * operator is standing at exactly the moment the decision is wanted, carries the
 * decision itself rather than sending them to another screen to find it.
 *
 * The Approve control is `HoldToConfirmButton`, the same gesture as going live: this is
 * the tap that spends real money, and it is deliberately not a tap. Reject is a plain
 * button — refusing to trade is never the dangerous direction.
 */
import { GeckoTerminalLink } from "@/components/common/chart-link";
import { useMemo, useState } from "react";
import { ArrowDownRight, ArrowUpRight, HelpCircle } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { toast } from "sonner";
import { HoldToConfirmButton } from "@/components/spectrumui/hold-to-confirm";
import { MorphButton } from "@/components/spectrumui/morph-button";
import { MORPH_FOCUS } from "@/components/common/focus";
import { ChainBadge } from "@/components/common/chain-badge";
import { formatUsd } from "@/components/common/format";
import {
  CountdownPill,
  PriceLine,
  ProposalStatStrip,
  SafetyBadges,
} from "@/components/agents/proposals/stat-strip";
import { statsFromSnapshot } from "@/components/agents/proposals/proposal-stats";
import { decideProposalAction } from "@/server/actions/trading";
import { useNow } from "@/hooks/use-now";
import type { ProposalStats, TradeRow } from "@/server/types";
import { cn } from "@/lib/utils";

export function ProposalPanel({
  trade,
  agentName,
  ttlMinutes,
  stats,
  onDecided,
  children,
}: {
  trade: TradeRow;
  agentName: string;
  /** From the agent's own `execution.proposalTtlMinutes`. */
  ttlMinutes: number;
  /**
   * The live market read, when the caller has one (it comes with a `ProposalRow`).
   * Without it the strip is filled from the trade's own score snapshot, which on this
   * screen is seconds old.
   */
  stats?: ProposalStats | null;
  /** Called after the server settles it, so the wizard can re-read the run. */
  onDecided?: () => void;
  children?: React.ReactNode;
}) {
  const reduce = useReducedMotion();
  const now = useNow();
  const [pending, setPending] = useState(false);

  const proposedAt = trade.proposedAt ?? trade.createdAt;
  const ttlMs = ttlMinutes * 60_000;
  const expiresAt = new Date(proposedAt).getTime() + ttlMs;
  const remaining = expiresAt - now;
  const expired = remaining <= 0;
  const requestedUsd = trade.requestedUsd ?? trade.amountUsd;
  const buying = trade.side === "buy";
  // Same five cells and the same badges as the agent page's card: one decision, one
  // vocabulary, whichever screen the operator happens to be standing on.
  const strip = useMemo(() => stats ?? statsFromSnapshot(trade.score), [stats, trade.score]);

  const decide = async (decision: "approve" | "reject") => {
    setPending(true);
    const result = await decideProposalAction(trade.id, decision);
    setPending(false);
    if (!result.ok) {
      toast.error(decision === "approve" ? "Not approved" : "Not rejected", { description: result.error });
      throw new Error(result.error);
    }
    toast.success(result.data.message);
    onDecided?.();
  };

  return (
    <motion.section
      initial={reduce ? { opacity: 0 } : { opacity: 0, y: 8 }}
      animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0 }}
      transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 300, damping: 30 }}
      className="glass-heavy rounded-xl border border-primary/40 bg-primary/[0.04] p-4"
      aria-label="Proposed trade awaiting your decision"
    >
      <div className="flex flex-wrap items-center gap-2">
        <HelpCircle aria-hidden className="size-4 text-primary" />
        <h3 className="text-sm font-medium">Proposed — waiting for you</h3>
        <ChainBadge chain={trade.chain} className="ml-auto" />
        <GeckoTerminalLink chain={trade.chain} address={trade.token.address} symbol={trade.token.symbol} />
      </div>

      <p className="mt-2 text-sm leading-6 text-muted-foreground">
        {agentName} wants to {buying ? "buy" : "sell"}{" "}
        <span className="tnum font-medium text-foreground">{formatUsd(requestedUsd)}</span> of{" "}
        <span className="font-medium text-foreground">{trade.token.symbol}</span>. Nothing has been signed and
        nothing has moved — this agent asks before it trades. {trade.isPaper ? "Approving it simulates the fill." : "Approving it signs a real transaction from its wallet."}
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide",
            buying
              ? "border-[oklch(0.72_0.17_150)]/40 bg-[oklch(0.72_0.17_150)]/10 text-[oklch(0.78_0.15_150)]"
              : "border-[oklch(0.68_0.2_25)]/40 bg-[oklch(0.68_0.2_25)]/10 text-[oklch(0.74_0.18_25)]",
          )}
        >
          {buying ? <ArrowUpRight aria-hidden className="size-3" /> : <ArrowDownRight aria-hidden className="size-3" />}
          {trade.side}
        </span>
        <CountdownPill msRemaining={remaining} ttlMs={ttlMs} className="ml-auto" />
      </div>

      <ProposalStatStrip stats={strip} score={trade.score} className="mt-3.5" />

      <PriceLine
        priceUsd={trade.priceUsd > 0 ? trade.priceUsd : null}
        symbol={trade.token.symbol}
        sparkline={strip.sparkline}
        className="mt-3"
      />

      <SafetyBadges safety={strip.safety} className="mt-3" />

      {trade.rationale ? (
        <p className="mt-3 border-l-2 border-border/70 pl-3 text-sm leading-6 text-muted-foreground">
          &ldquo;{trade.rationale}&rdquo;
        </p>
      ) : null}

      {expired ? (
        <p className="mt-3 rounded-lg border border-destructive/30 bg-destructive/5 px-2.5 py-2 text-xs leading-5 text-muted-foreground">
          This proposal expired before it was answered, so nothing was traded. Run another tick — the agent will
          propose again if it still likes the trade.
        </p>
      ) : (
        <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            disabled={pending}
            onClick={() => void decide("reject").catch(() => undefined)}
            className={cn(
              "inline-flex h-8 items-center rounded-lg px-3 text-xs font-medium text-muted-foreground",
              "transition-[background-color,color,transform] duration-150 hover:bg-muted hover:text-foreground active:scale-[0.97]",
              "disabled:pointer-events-none disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            )}
          >
            Reject
          </button>
          {trade.isPaper ? (
            <MorphButton
              size="sm"
              className={MORPH_FOCUS}
              loadingLabel="Approving…"
              successLabel="Filled"
              errorLabel="Refused"
              onAction={() => decide("approve")}
            >
              Approve
            </MorphButton>
          ) : (
            <HoldToConfirmButton
              size="sm"
              duration={1_600}
              disabled={pending}
              label={`Hold to approve ${formatUsd(requestedUsd)}`}
              confirmedLabel="Approved"
              icon={<ArrowUpRight size={12} strokeWidth={2} />}
              onConfirm={() => void decide("approve").catch(() => undefined)}
              className="border-primary/40 bg-primary/10 text-foreground hover:bg-primary/15 dark:border-primary/40 dark:bg-primary/10 dark:text-foreground dark:hover:bg-primary/15"
            />
          )}
        </div>
      )}

      {children ? <div className="mt-4 flex flex-wrap items-center gap-2">{children}</div> : null}
    </motion.section>
  );
}
