"use client";

/**
 * The pieces the Sell position dialog and the Trade sheet share, so one manual sell
 * reads the same from either door: the slippage choice for this one order, the failure
 * that stays on screen, and what the sale realised.
 */
import { useCallback, useId } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { PnlText } from "@/components/common/pnl-text";
import { slippagePctLabel, widerSlippageChoices } from "@/lib/trading/manual-slippage";
import { pointsToRiskSettings } from "@/lib/trading/trade-error-copy";
import { cn } from "@/lib/utils";

/**
 * What to do after every manual order, filled or not: re-render the page (positions,
 * cash, the status banner) and drop the two client caches that read the same book. The
 * Trades tab kept its old list for up to 30 seconds otherwise, which is exactly when
 * someone opens it to check whether an order went through.
 */
export function useRefreshAfterTrade(agentId: string): () => void {
  const router = useRouter();
  const queryClient = useQueryClient();
  return useCallback(() => {
    router.refresh();
    void queryClient.invalidateQueries({ queryKey: ["agent-trades", agentId] });
    void queryClient.invalidateQueries({ queryKey: ["wallet-balances", agentId] });
  }, [router, queryClient, agentId]);
}

const CHIP =
  "tnum rounded-md border px-2 py-1 text-[11px] transition-[color,background-color,border-color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.97] focus-ring disabled:pointer-events-none disabled:opacity-50";
const CHIP_ON = "border-primary/50 bg-primary/10 text-foreground";
const CHIP_OFF = "border-border text-muted-foreground hover:text-foreground";

/**
 * The slippage tolerance for this one sell: the agent's own setting, or one of the wider
 * steps above it. Renders nothing when there is no wider step to offer, so a caller can
 * mount it unconditionally. `value` is null for the agent's setting.
 */
export function MaxSlippagePicker({
  agentBps,
  value,
  onChange,
  disabled = false,
  labelClassName,
  className,
}: {
  /** The agent's own Slippage tolerance, in basis points. */
  agentBps: number;
  value: number | null;
  onChange: (bps: number | null) => void;
  disabled?: boolean;
  labelClassName?: string;
  className?: string;
}) {
  const labelId = useId();
  const wider = widerSlippageChoices(agentBps);
  if (wider.length === 0) return null;
  const chosen = value !== null && wider.includes(value) ? value : null;
  return (
    <div role="group" aria-labelledby={labelId} className={cn("space-y-1.5", className)}>
      <p id={labelId} className={cn("text-xs text-muted-foreground", labelClassName)}>
        Max slippage
      </p>
      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          disabled={disabled}
          aria-pressed={chosen === null}
          onClick={() => onChange(null)}
          className={cn(CHIP, chosen === null ? CHIP_ON : CHIP_OFF)}
        >
          {slippagePctLabel(agentBps)} (agent setting)
        </button>
        {wider.map((bps) => (
          <button
            key={bps}
            type="button"
            disabled={disabled}
            aria-pressed={chosen === bps}
            onClick={() => onChange(bps)}
            className={cn(CHIP, chosen === bps ? CHIP_ON : CHIP_OFF)}
          >
            {slippagePctLabel(bps)}
          </button>
        ))}
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">
        Wider slippage lets the order land when the price is moving fast. You can receive up to that much less than
        the quote.
      </p>
    </div>
  );
}

/**
 * The last order's failure, kept on screen until the next attempt. A toast alone was
 * gone in four seconds, which is less time than it takes to read "check the Trades tab
 * before trying again".
 */
export function TradeFailureAlert({
  text,
  settingsHref,
  widerSlippage = null,
  className,
}: {
  text: string;
  /** The agent's Risk settings, linked when the sentence sends the owner there. */
  settingsHref?: string | null;
  /**
   * Where the Max slippage choice sits relative to this alert, when a wider one would
   * fix this failure and there is one left to pick. Null says nothing about it.
   */
  widerSlippage?: "above" | "below" | null;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn(
        "rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-xs leading-relaxed text-destructive",
        className,
      )}
    >
      <p>
        {text}
        {widerSlippage ? ` Or pick a wider Max slippage ${widerSlippage} and sell again.` : null}
      </p>
      {settingsHref && pointsToRiskSettings(text) ? (
        <Link
          href={settingsHref}
          className="mt-1 inline-block rounded font-medium underline underline-offset-2 transition-colors duration-150 hover:text-foreground focus-ring"
        >
          Open Risk settings
        </Link>
      ) : null}
    </div>
  );
}

/** "Realised on this sale", signed and coloured, with the caption that it is net of fees. */
export function RealisedOnSale({
  usd,
  pct,
  className,
}: {
  usd: number;
  pct: number | null;
  className?: string;
}) {
  return (
    <div className={cn("flex items-baseline justify-between gap-3 text-xs", className)}>
      <span className="shrink-0 text-muted-foreground">Realised on this sale</span>
      <span className="min-w-0 text-right">
        <PnlText usd={usd} pct={pct} dp={1} size="sm" className="font-mono" />
        <span className="ml-1.5 text-[11px] text-muted-foreground">after fees</span>
      </span>
    </div>
  );
}
