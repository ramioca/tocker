import { ShieldCheck, SlidersHorizontal } from "lucide-react";
import { formatUsd } from "@/components/common/format";
import type { AgentConfig } from "@/db/schema";
import { cn } from "@/lib/utils";

/**
 * The caps, stated as money rather than as slider positions.
 *
 * The point of this card is the sentence at the bottom: these are enforced by
 * `riskGuard()` before any executor is reached, so they are a property of the
 * code path, not a request made of the model in a prompt. That distinction is the
 * whole reason the numbers can be trusted, and it is invisible from the sliders.
 */
export function BudgetCard({
  config,
  className,
  compact = false,
}: {
  config: AgentConfig;
  className?: string;
  compact?: boolean;
}) {
  const { risk } = config;
  const dailyTurnover = risk.maxTradeUsd * risk.maxDailyTrades;

  return (
    <section className={cn("glass rounded-xl border border-border/70 bg-card/30 p-4", className)}>
      <div className="flex items-center gap-2">
        <SlidersHorizontal aria-hidden className="size-4 text-muted-foreground" />
        <h2 className="text-sm font-medium">Spend caps</h2>
      </div>

      <dl className="mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-2">
        <Row label="Per trade" value={formatUsd(risk.maxTradeUsd)} />
        <Row label="Trades per day" value={String(risk.maxDailyTrades)} />
        <Row label="Most it can move in a day" value={formatUsd(dailyTurnover)} />
        <Row label="One token, at most" value={`${Math.round(risk.maxPositionPct)}% of equity`} />
        <Row label="Data spend per run" value={formatUsd(risk.maxDataSpendUsdPerRun)} />
        <Row label="Slippage tolerance" value={`${(risk.slippageBps / 100).toFixed(2)}%`} />
      </dl>

      {compact ? null : (
        <p className="mt-3 flex items-start gap-2 text-xs leading-5 text-muted-foreground">
          <ShieldCheck aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          <span>
            Enforced in code by the risk guard before a quote is ever requested — not asked of the model in a
            prompt. A strategy that decides to buy {formatUsd(risk.maxTradeUsd * 10)} of something gets refused,
            and the refusal is written into the run transcript. Changes take effect from the next tick and are
            written to your audit log.
          </span>
        </p>
      )}
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border/40 pb-1.5 text-sm last:border-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="tnum font-mono text-xs">{value}</dd>
    </div>
  );
}
