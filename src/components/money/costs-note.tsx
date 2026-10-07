import Link from "next/link";
import { ChevronDown, Cpu, Database, Receipt, Zap } from "lucide-react";
import { formatCount, formatUsd } from "@/components/common/format";
import { txExplorerUrl } from "@/lib/tokens/links";
import { resolveModelPrice, THINKING_LATE_LOOK_DAYS } from "@/server/queries/money";
import type { MoneySummary, ThinkingStepRow, ThinkingSummary } from "@/server/queries/money";
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
 *
 * A fourth line, "Thinking (pay per use)", exists only for an owner whose agents have
 * paid for their own thinking. It is not ours either: the agent's own wallet pays the
 * model provider directly. Its figure counts only payments proven to have left the
 * wallet, and it is where a step that got no answer is listed, plainly, with its
 * transaction when there is one.
 *
 * What is not proven is said beside the figure and never inside it, in the words that
 * are true of it: being checked while the chain is asked about it on every pass, could
 * not be checked in time once it no longer is. A payment that is only maybe gone is not
 * called paid here.
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

/** "Oct 6, 14:02 UTC". Rendered on the server, so it names its zone instead of guessing the reader's. */
const stepTime = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "UTC",
});

function stepWhen(iso: string): string {
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? "" : `${stepTime.format(at)} UTC`;
}

/**
 * What happened to one step, in our words. The provider's own text is never shown here:
 * it is a third party's sentence, and this page prints only what the ledger knows.
 */
function stepOutcome(step: ThinkingStepRow): string {
  if (step.state === "checking") return "being checked against the chain";
  if (step.state === "unchecked") return "could not be checked against the chain";
  return step.httpStatus ? `paid, no answer (the provider returned ${step.httpStatus})` : "paid, no answer";
}

const plural = (count: number) => (count === 1 ? "" : "s");

function UnansweredSteps({ thinking }: { thinking: ThinkingSummary }) {
  // Every step that got no answer: paid, being checked, or never checked. An answered
  // step whose payment is still being confirmed is in the amounts above, not in this list.
  const total =
    thinking.unansweredSteps +
    (thinking.checkingSteps - thinking.checkingAnsweredSteps) +
    (thinking.uncheckedSteps - thinking.uncheckedAnsweredSteps);
  if (thinking.unanswered.length === 0) return null;
  return (
    <div className="space-y-1.5">
      {/* "Signed for", not "paid for": for some of these whether the money moved is the
          very thing still in question, and each line says which. */}
      <p className="text-foreground/80">Steps that were signed for and got no answer</p>
      <ul className="tnum space-y-1 text-[12px] leading-5">
        {thinking.unanswered.map((step) => {
          const explorer = txExplorerUrl("solana", step.txHash);
          return (
            <li key={step.id} className="flex flex-wrap items-baseline gap-x-2">
              <span className="whitespace-nowrap">{stepWhen(step.at)}</span>
              {step.agentSlug && step.agentName ? (
                <Link href={`/agents/${step.agentSlug}`} className="focus-ring rounded text-foreground/80 hover:underline">
                  {step.agentName}
                </Link>
              ) : (
                <span>a deleted agent</span>
              )}
              <span className="font-mono text-[11px]">{step.model}</span>
              <span className="text-foreground/80">{formatUsd(step.usd)}</span>
              <span>{stepOutcome(step)}</span>
              {explorer ? (
                <a
                  href={explorer}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="focus-ring rounded text-foreground/80 underline underline-offset-2"
                >
                  transaction
                </a>
              ) : null}
            </li>
          );
        })}
      </ul>
      {total > thinking.unanswered.length ? (
        <p>
          The {formatCount(thinking.unanswered.length)} most recent of {formatCount(total)}. The amounts above count all
          of them.
        </p>
      ) : null}
    </div>
  );
}

/**
 * The pay-per-use line. `scopeUsd` is the figure for the agents this note is about (the
 * live ones, or the paper ones for an account with nothing live), so the four lines add
 * up to the Costs figure in the headline. What the rest of the account paid is said in
 * a sentence, not folded into that number.
 *
 * `former` is the account that has no agent left: everything the ledger holds was paid
 * by agents since deleted, there is no P&L on the page to speak of, and the figure is
 * that whole amount.
 */
function ThinkingItem({
  thinking,
  scopeUsd,
  paper,
  former = false,
}: {
  thinking: ThinkingSummary;
  scopeUsd: number;
  paper: boolean;
  former?: boolean;
}) {
  const elsewhere = paper || former ? 0 : thinking.paperUsd;
  const compare = thinking.ownKey;
  // The two kinds of step that are counted as charged and not yet proven: one whose
  // request failed after it was signed, and one that was answered with no transaction
  // given for its payment. Told apart, because only the first may never have been paid.
  const failedCheckingUsd = thinking.checkingUsd - thinking.checkingAnsweredUsd;
  const failedCheckingSteps = thinking.checkingSteps - thinking.checkingAnsweredSteps;
  return (
    <Item icon={Zap} title="Thinking (pay per use)" amount={formatUsd(scopeUsd)}>
      <p>
        {former ? "What the agents you have since deleted paid" : "What your agents paid"} for their own model
        steps: USDC, from each agent&rsquo;s own Solana wallet, straight to BlockRun, the provider that sells them.
        Tocker does not collect it and adds nothing to it. The figure counts only payments confirmed to have left
        the wallet
        {former ? ". The record of what a wallet paid is kept after its agent is gone." : (
          <>, and it is a cost here rather than a loss in the P&amp;L above.</>
        )}
        {paper ? " Unlike the rest of a paper agent’s book, this is real USDC from its real wallet." : ""}
      </p>
      {thinking.unansweredUsd > 0 ? (
        <p className="tnum">
          {formatUsd(thinking.unansweredUsd)} of what was paid bought {formatCount(thinking.unansweredSteps)} step
          {plural(thinking.unansweredSteps)} that got no answer. A step that is paid for and then fails is not
          refunded, and the run stops rather than pay for it twice.
        </p>
      ) : null}
      {failedCheckingSteps > 0 ? (
        <p className="tnum">
          {formatUsd(failedCheckingUsd)} more was signed for {formatCount(failedCheckingSteps)} step
          {plural(failedCheckingSteps)} whose request failed. Whether that money moved is being checked against the
          chain; it joins the total only if it did.
        </p>
      ) : null}
      {thinking.checkingAnsweredSteps > 0 ? (
        <p className="tnum">
          {formatUsd(thinking.checkingAnsweredUsd)} more is for {formatCount(thinking.checkingAnsweredSteps)}{" "}
          answered step{plural(thinking.checkingAnsweredSteps)} whose payment is still being confirmed on the chain.
          It joins the total when it is.
        </p>
      ) : null}
      {thinking.checkingSteps > 0 && !former ? (
        <p>
          Until the chain has answered, none of that is taken out of the P&amp;L above: where the wallet has paid,
          it reads there as a loss of the same amount.
        </p>
      ) : null}
      {thinking.uncheckedSteps > 0 ? (
        <p className="tnum">
          {formatUsd(thinking.uncheckedUsd)} more was signed for {formatCount(thinking.uncheckedSteps)} step
          {plural(thinking.uncheckedSteps)} whose payment could not be checked against the chain in time, so
          nobody can say here whether that money moved. Such a payment is looked for again from time to time until{" "}
          {THINKING_LATE_LOOK_DAYS} days after it was signed, and not after that. Until the chain shows it, it stays
          counted against your limits as charged, and it is in no total on this page
          {former ? "." : "; where the wallet did pay, the P&L above shows it as a loss of that amount, not as a cost."}
        </p>
      ) : null}
      <UnansweredSteps thinking={thinking} />
      {elsewhere > 0 ? (
        <p className="tnum">
          Your paper agents paid {formatUsd(elsewhere)} more. A paper agent trades a notional and still pays for
          its thinking in real USDC, so that amount is on its row in the Paper table and in no total above.
        </p>
      ) : null}
      {thinking.formerAgentsUsd > 0 && !former ? (
        <p className="tnum">Agents you have since deleted paid {formatUsd(thinking.formerAgentsUsd)} more.</p>
      ) : null}
      {thinking.simulatedUsd > 0 ? (
        <p className="tnum">
          {formatUsd(thinking.simulatedUsd)} more was simulated and moved no money. It is counted in nothing.
        </p>
      ) : null}
      {compare ? (
        <p className="tnum">
          For comparison: the {formatCount(compare.steps)} answered step{compare.steps === 1 ? "" : "s"} that
          reported {compare.steps === 1 ? "its" : "their"} usage read {formatCount(compare.inputTokens)} tokens and
          wrote {formatCount(compare.outputTokens)}. At list price on your own API key that is about{" "}
          {formatUsd(compare.ownKeyUsd)}; paid per use, the same steps cost {formatUsd(compare.paidUsd)}. The first
          figure is an estimate, made the same way as the model line above.
          {compare.unpricedSteps > 0
            ? ` ${formatCount(compare.unpricedSteps)} more step${compare.unpricedSteps === 1 ? "" : "s"} ran on a model with no list price here and ${compare.unpricedSteps === 1 ? "is" : "are"} in neither figure.`
            : ""}
        </p>
      ) : null}
    </Item>
  );
}

/**
 * The Costs card of an account with no agent left. Its three ordinary bills are all
 * nothing, so they are not drawn at zero; what the deleted agents paid for their own
 * thinking is still on the ledger, and is the one line here.
 */
export function FormerThinkingNote({ thinking }: { thinking: ThinkingSummary }) {
  return (
    <div className="glass-card overflow-hidden rounded-2xl">
      <ul className="divide-y divide-[var(--glass-hairline)]">
        <ThinkingItem thinking={thinking} scopeUsd={thinking.formerAgentsUsd} paper={false} former />
      </ul>
    </div>
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
  // One row per priced model the agents on this page run, in the order they appear.
  const pricesInUse = [
    ...new Map(
      (paper ? summary.paper : live)
        .map((agent) => resolveModelPrice(agent.model))
        .filter((price) => price !== null)
        .map((price) => [price.label, price] as const),
    ).values(),
  ];
  const totals: CostTotals = override ?? {
    feesUsd: summary.totals.feesUsd,
    dataSpendUsd: summary.totals.dataSpendUsd,
    dataSpendSimulatedUsd: live.reduce((sum, agent) => sum + agent.dataSpendSimulatedUsd, 0),
    modelSpendUsd: summary.totals.modelSpendUsd,
    unpricedAgents: summary.totals.unpricedAgents,
    thinkingUsd: summary.totals.thinkingUsd,
  };
  // Null for an owner who has never paid for a step: nothing about pay-per-use is drawn.
  const thinking = summary.thinking;
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
            {thinking
              ? "For the runs that used your own key: the charge lands on your own Anthropic or OpenAI account and never passes through Tocker. "
              : "You bring your own key, so this charge lands on your own Anthropic or OpenAI account and never passes through Tocker. "}
            The figure is an <strong>estimate</strong>: each run&rsquo;s recorded input and output tokens at list
            price, for the model the agent is configured with today.
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
              {/* The rates behind this total: the models these agents run, not the whole
                  price list, which runs to dozens of rows now. */}
              {pricesInUse.length > 0 ? (
                <ul className="tnum flex flex-wrap gap-x-4 gap-y-1 pt-0.5 text-[11px]">
                  {pricesInUse.map((price) => (
                    <li key={price.label}>
                      {price.label} <span className="text-foreground/70">${price.inputPerMTok}</span> /{" "}
                      <span className="text-foreground/70">${price.outputPerMTok}</span> per M
                    </li>
                  ))}
                </ul>
              ) : null}
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

        {thinking ? <ThinkingItem thinking={thinking} scopeUsd={totals.thinkingUsd} paper={paper} /> : null}
      </ul>
    </div>
  );
}
