import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, Plus, Wallet } from "lucide-react";
import { EquityChart } from "@/components/charts/equity-chart";
import { EmptyState } from "@/components/common/empty-state";
import { formatSignedUsd } from "@/components/common/format";
import { AgentMoneyTable } from "@/components/money/agent-money-table";
import { sumCosts } from "@/components/money/cost-totals";
import { CostsNote } from "@/components/money/costs-note";
import { MoneyHeadline } from "@/components/money/money-headline";
import { PnlByDay } from "@/components/money/pnl-by-day";
import { getSession } from "@/lib/auth";
import { platformFeeUsd, settleMinUsd } from "@/lib/platform/fee";
import { getMoney } from "@/server/queries/money";

export const metadata: Metadata = {
  title: "Money",
  description: "Equity, P&L and what it cost to earn it, across every agent you own.",
};

/**
 * One screen that answers "is this making money".
 *
 * Owner-only and single-user by construction: `getMoney` takes the session user id and
 * filters every read on `agents.ownerId`. There is no viewer variant and there never
 * should be — the numbers here are an operator's own book, and the public record of an
 * agent already lives on its page.
 *
 * Live and paper are kept apart the whole way down. Paper agents appear in their own
 * table, below the line, labelled; no total on this page includes one.
 */
function SectionHeading({
  id,
  title,
  hint,
  action,
}: {
  id: string;
  title: string;
  hint: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
      <div>
        <h2 id={id} className="text-base font-semibold tracking-tight">
          {title}
        </h2>
        <p className="mt-0.5 text-[13px] text-muted-foreground">{hint}</p>
      </div>
      {action}
    </div>
  );
}

const NEW_AGENT_BUTTON = (
  <Link
    href="/agents/new"
    className="focus-ring inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground transition-[background-color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-primary/90 active:scale-[0.97]"
  >
    <Plus aria-hidden className="size-4" />
    New agent
  </Link>
);

// Going live is a per-agent step, so a paper-only account is sent straight to the
// go-live flow of its best paper record — the one most likely to be worth trusting —
// rather than to a list with no go-live control on it.
// Named, because "an agent" left an owner of several guessing which one they were about to fund.
function GoLiveButton({ href, name }: { href: string; name?: string }) {
  return (
    <Link
      href={href}
      className="focus-ring inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground transition-[background-color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-primary/90 active:scale-[0.97]"
    >
      {name ? `Take ${name} live` : "Take an agent live"}
      <ArrowRight aria-hidden className="size-4" />
    </Link>
  );
}

export default async function MoneyPage() {
  const session = await getSession();
  if (!session) redirect(`/login?next=${encodeURIComponent("/money")}`);

  const summary = await getMoney(session.userId);
  const hasLive = summary.live.length > 0;
  const hasAny = hasLive || summary.paper.length > 0;
  // Before anything is live, the costs worth explaining are the paper agents' — the
  // live totals would print $0.00 directly under a table that says otherwise.
  const costScope = hasLive ? "live" : "paper";
  const bestPaper = summary.paper.reduce<(typeof summary.paper)[number] | null>(
    (best, row) => (best === null || row.pnlUsd > best.pnlUsd ? row : best),
    null,
  );
  const goLiveHref = bestPaper ? `/agents/${bestPaper.slug}/live` : "/agents";

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Money</h1>
        <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">
          {hasLive
            ? "Everything your live agents are worth, everything they have made, and everything it cost to make it."
            : "What your agents are worth and what they cost to run. Totals count live agents only."}
        </p>
      </header>

      <div className="mt-6 space-y-10 sm:mt-8 sm:space-y-12">
        {hasLive ? (
          <>
            <MoneyHeadline summary={summary} />

            <section aria-labelledby="money-equity-heading" className="space-y-4">
              <SectionHeading
                id="money-equity-heading"
                title="Equity"
                hint={
                  summary.totals.fundedUsd > 0
                    ? "Every live agent's book, summed, against the USDC you have sent them."
                    : "Every live agent's book, summed, against where the curve started."
                }
              />
              <EquityChart points={summary.equity} startingUsd={summary.basisUsd} label="Live equity" />
            </section>

            <section aria-labelledby="money-days-heading" className="space-y-4">
              <SectionHeading
                id="money-days-heading"
                title="Change in equity by day"
                hint="The last 30 UTC days. A day's number is the change in what every live agent held at the last mark of that day, less any money moved in or out."
              />
              <PnlByDay days={summary.days} />
            </section>

            <section aria-labelledby="money-agents-heading" className="space-y-4">
              <SectionHeading
                id="money-agents-heading"
                title="By agent"
                hint="Who is earning it, and who is spending it."
              />
              <AgentMoneyTable rows={summary.live} totals={summary.totals} label="Live agent" />
            </section>
          </>
        ) : (
          <EmptyState
            icon={<Wallet />}
            title={hasAny ? "Nothing is trading real money yet" : "No agents yet"}
            description={
              hasAny
                ? `Your paper agents are below. Their P&L is real arithmetic on simulated fills, but none of it is counted here — this page only totals live books. Fund an agent and switch it to live when its record convinces you.${bestPaper ? ` Best paper record so far: ${bestPaper.name}, ${formatSignedUsd(bestPaper.pnlUsd)}.` : ""}`
                : "An agent is a prompt, a wallet and a schedule. Build one — it starts on paper, so no trade can lose real money — and this page fills in the day it goes live."
            }
            action={hasAny ? <GoLiveButton href={goLiveHref} name={bestPaper?.name} /> : NEW_AGENT_BUTTON}
          />
        )}

        {summary.paper.length > 0 ? (
          <section aria-labelledby="money-paper-heading" className="space-y-4">
            <SectionHeading
              id="money-paper-heading"
              title="Paper"
              hint="Simulated books, kept separate. Nothing here is added to any total above."
            />
            <AgentMoneyTable
              rows={summary.paper}
              label="Paper agent"
              caption="Paper agents pay the same Tocker fee and are charged the same simulated slippage, so their P&L is comparable to a live one — but the equity is a notional, not a wallet."
            />
          </section>
        ) : null}

        {hasAny ? (
          <section aria-labelledby="money-costs-heading" className="space-y-4">
            <SectionHeading
              id="money-costs-heading"
              title="Costs"
              hint={
                costScope === "live"
                  ? "Separate bills, only one of which we collect."
                  : "What your paper agents have cost so far. The fee is simulated; the model tokens are a real bill on your own key."
              }
            />
            <CostsNote
              summary={summary}
              scope={costScope}
              totals={costScope === "paper" ? sumCosts(summary.paper) : undefined}
              feeUsd={platformFeeUsd()}
              settleMinUsd={settleMinUsd()}
            />
          </section>
        ) : null}
      </div>
    </div>
  );
}
