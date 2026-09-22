import { Cpu, Database, Receipt } from "lucide-react";
import { formatUsd } from "@/components/common/format";
import { MODEL_PRICES } from "@/server/queries/money";
import type { MoneySummary } from "@/server/queries/money";

/**
 * What each cost actually is, in sentences.
 *
 * Every line on this page that subtracts money has to be explainable, because the
 * alternative is an operator who sees "Costs $14.20" and assumes we took it. Two of the
 * three costs are not ours to take: the x402 payments come out of the platform's own
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
  children,
}: {
  icon: React.ElementType;
  title: string;
  amount: string;
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
          <span className="tnum text-sm">{amount}</span>
        </p>
        <div className="mt-1 space-y-1.5 text-[13px] leading-5 text-muted-foreground">{children}</div>
      </div>
    </li>
  );
}

export function CostsNote({
  summary,
  feeUsd,
  settleMinUsd,
}: {
  summary: MoneySummary;
  /** `PLATFORM_FEE_USD` as the server actually reads it — never a hardcoded $0.10. */
  feeUsd: number;
  settleMinUsd: number;
}) {
  const { totals, live } = summary;
  const accrued = live.reduce((sum, agent) => sum + agent.feesAccruedUsd, 0);
  const simulated = live.reduce((sum, agent) => sum + agent.dataSpendSimulatedUsd, 0);

  return (
    <div className="glass-card overflow-hidden rounded-2xl">
      <ul className="divide-y divide-[var(--glass-hairline)]">
        <Item icon={Receipt} title="Tocker fee" amount={formatUsd(totals.feesUsd)}>
          <p>
            {feeUsd > 0 ? (
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

        <Item icon={Database} title="x402 data" amount={formatUsd(totals.dataSpendUsd)}>
          <p>
            Sentiment, safety and launch feeds your agents chose to buy. <strong>The platform pays for these</strong>{" "}
            — every 402 is settled from Tocker&rsquo;s own wallet, not yours. It is booked against the agent anyway,
            because a strategy that spends a dollar a day on data to make eighty cents is worth knowing about.
          </p>
          {simulated > 0 ? (
            <p className="tnum">
              {formatUsd(simulated)} of that was mock-mode and moved no money — it is priced at what the call would
              have cost.
            </p>
          ) : null}
        </Item>

        <Item icon={Cpu} title="Model tokens (estimate)" amount={formatUsd(totals.modelSpendUsd)}>
          <p>
            You bring your own key, so this charge lands on your own Anthropic or OpenAI account and never passes
            through Tocker. The figure is an <strong>estimate</strong>: each run&rsquo;s recorded input and output
            tokens at list price, for the model the agent is configured with today.
          </p>
          <p>
            It reads high. Cached input is billed at a fraction of the input rate and we do not record cache hits,
            so a real invoice is usually lower — and a run taken last week on a different model is priced at
            today&rsquo;s choice.
          </p>
          <ul className="tnum flex flex-wrap gap-x-4 gap-y-1 pt-0.5 text-[11px]">
            {Object.entries(MODEL_PRICES).map(([id, price]) => (
              <li key={id}>
                {price.label} <span className="text-foreground/70">${price.inputPerMTok}</span> /{" "}
                <span className="text-foreground/70">${price.outputPerMTok}</span> per M
              </li>
            ))}
          </ul>
          {totals.unpricedAgents > 0 ? (
            <p>
              {totals.unpricedAgents} live agent{totals.unpricedAgents === 1 ? " runs" : "s run"} a model with no
              published price here, so {totals.unpricedAgents === 1 ? "its" : "their"} tokens are not counted in
              this total.
            </p>
          ) : null}
        </Item>
      </ul>
    </div>
  );
}
