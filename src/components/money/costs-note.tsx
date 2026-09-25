import { ChevronDown, Cpu, Database, Receipt } from "lucide-react";
import { formatUsd } from "@/components/common/format";
import { MODEL_PRICES } from "@/server/queries/money";
import type { MoneySummary } from "@/server/queries/money";
import type { CostTotals } from "./cost-totals";

/**
 * What each cost actually is, in sentences.
 *
 * Every line on this page that subtracts money has to be explainable, because the
 * alternative is an operator who sees "Costs $14.20" and assumes we took it. Two of the
 * three costs are not ours to take: the market-data (x402) payments come out of the platform's own
 * wallet, and the model tokens are billed to the operator's own LLM account and never
 * pass through Tocker at all. Only the flat per-fill fee is money we collect.
 *
 * The model number is the one estimate on the page and it is labelled as one every time
 * it appears.
 */

function Item({
  icon: Icon,
  title,
  amount,
  qualifier,
  children,
}: {
  icon: React.ElementType;
  title: string;
  amount: string;
  /** A word after the amount that changes what it means, e.g. "simulated". */
  qualifier?: string;
  children: React.ReactNode;
}) {
  return (
    <li className="flex gap-3 px-4 py-4 sm:px-5">
      <span className="glass-inset mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg text-muted-foreground">
        <Icon aria-hidden className="size-3.5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-baseline justify-between gap-x-3">
          <span className="text-sm font-medium">{title}</span>
          <span className="tnum text-sm">
            {amount}
            {qualifier ? <span className="ml-1.5 text-xs text-muted-foreground">{qualifier}</span> : null}
          </span>
        </p>
        <div className="mt-1 space-y-1.5 text-[13px] leading-5 text-muted-foreground">{children}</div>
      </div>
    </li>
  );
}

export function CostsNote({
  summary,
  scope = "live",
  totals: override,
  feeUsd,
  settleMinUsd,
}: {
  summary: MoneySummary;
  /**
   * Whose costs these are. "paper" is for an account with no live agent yet: the
   * page's own totals are live-only and would print $0.00 under a paper table that
   * plainly has costs in it.
   */
  scope?: "live" | "paper";
  /** The sums to print when they are not the live totals — see `sumCosts`. */
  totals?: CostTotals;
  /** `PLATFORM_FEE_USD` as the server actually reads it — never a hardcoded $0.10. */
  feeUsd: number;
  settleMinUsd: number;
}) {
  const { live } = summary;
  const paper = scope === "paper";
  const totals: CostTotals = override ?? {
    feesUsd: summary.totals.feesUsd,
    dataSpendUsd: summary.totals.dataSpendUsd,
    dataSpendSimulatedUsd: live.reduce((sum, agent) => sum + agent.dataSpendSimulatedUsd, 0),
    modelSpendUsd: summary.totals.modelSpendUsd,
    unpricedAgents: summary.totals.unpricedAgents,
  };
  // Owed fees only exist in a real wallet. A paper book has no cash to deduct them from.
  const accrued = paper ? 0 : live.reduce((sum, agent) => sum + agent.feesAccruedUsd, 0);
  const simulated = totals.dataSpendSimulatedUsd;

  return (
    <div className="glass-card overflow-hidden rounded-2xl">
      {paper ? (
        <p className="border-b border-[var(--glass-hairline)] px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground sm:px-5">
          Paper agents
        </p>
      ) : null}
      <ul className="divide-y divide-[var(--glass-hairline)]">
        <Item
          icon={Receipt}
          title="Tocker fee"
          amount={formatUsd(totals.feesUsd)}
          qualifier={paper ? "simulated" : undefined}
        >
          <p>
            {feeUsd > 0 && paper ? (
              <>
                A flat {formatUsd(feeUsd)} on every simulated fill, taken out of the paper book so its P&amp;L
                compares with a live one. Nothing is collected until an agent trades live.
              </>
            ) : feeUsd > 0 ? (
              <>
                A flat {formatUsd(feeUsd)} on every executed fill — buy or sell, whether the agent placed it, you
                approved it, or the exit engine took it. Flat rather than a percentage, so we never want a bigger
                ticket than your strategy does.
              </>
            ) : (
              <>The per-fill fee is switched off on this deployment, so nothing has been charged.</>
            )}
          </p>
          {accrued > 0 ? (
            <p className="tnum">
              {formatUsd(accrued)} of that is still sitting in your agent wallets, already deducted from the cash
              figures above. It is swept to Tocker in one transfer per chain once it clears{" "}
              {formatUsd(settleMinUsd)}.
            </p>
          ) : null}
        </Item>

        <Item icon={Database} title="Market data" amount={formatUsd(totals.dataSpendUsd)}>
          <p>
            Sentiment, safety and launch feeds your agents chose to buy. Tocker pays for these from its own wallet,
            not yours. They are booked against the agent anyway, because a strategy that spends a dollar a day on
            data to make eighty cents is worth knowing about.
          </p>
          {/* When every call was simulated, "$1.11 of that" repeated the total back. */}
          {simulated > 0 && simulated >= totals.dataSpendUsd ? (
            <p>All of it was simulated — no money moved; it is priced at what the calls would cost.</p>
          ) : simulated > 0 ? (
            <p className="tnum">
              {formatUsd(simulated)} of that was simulated and moved no money — it is priced at what the calls
              would cost.
            </p>
          ) : null}
        </Item>

        <Item icon={Cpu} title="Model tokens (estimate)" amount={formatUsd(totals.modelSpendUsd)}>
          <p>
            You bring your own key, so this charge lands on your own Anthropic or OpenAI account and never passes
            through Tocker. The figure is an <strong>estimate</strong>: each run&rsquo;s recorded input and output
            tokens at list price, for the model the agent is configured with today.
          </p>
          {/* The method and the price list are for the reader who doubts the number. Native
              <details>, so it costs no client JS and the card stays one screen on a phone. */}
          <details className="group">
            <summary className="focus-ring inline-flex cursor-pointer list-none items-center gap-1 rounded text-foreground/80 transition-colors duration-150 hover:text-foreground [&::-webkit-details-marker]:hidden">
              How we estimate
              <ChevronDown
                aria-hidden
                className="size-3.5 transition-transform duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] group-open:rotate-180"
              />
            </summary>
            <div className="mt-1.5 space-y-1.5">
              <p>
                It reads high. Cached input is billed at a fraction of the input rate and we do not record cache
                hits, so a real invoice is usually lower — and a run taken last week on a different model is priced
                at today&rsquo;s choice.
              </p>
              <ul className="tnum flex flex-wrap gap-x-4 gap-y-1 pt-0.5 text-[11px]">
                {Object.entries(MODEL_PRICES).map(([id, price]) => (
                  <li key={id}>
                    {price.label} <span className="text-foreground/70">${price.inputPerMTok}</span> /{" "}
                    <span className="text-foreground/70">${price.outputPerMTok}</span> per M
                  </li>
                ))}
              </ul>
            </div>
          </details>
          {totals.unpricedAgents > 0 ? (
            <p>
              {totals.unpricedAgents} {paper ? "paper" : "live"} agent
              {totals.unpricedAgents === 1 ? " runs" : "s run"} a model with no
              published price here, so {totals.unpricedAgents === 1 ? "its" : "their"} tokens are not counted in
              this total.
            </p>
          ) : null}
        </Item>
      </ul>
    </div>
  );
}
