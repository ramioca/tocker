import { Coins, Receipt, Sun, Wallet } from "lucide-react";
import { PnlText } from "@/components/common/pnl-text";
import { formatSignedPct, formatSignedUsd, formatUsd } from "@/components/common/format";
import { cn } from "@/lib/utils";
import type { MoneySummary } from "@/server/queries/money";
import { flowText } from "./day-tally";

/**
 * The four numbers, headed by the one the page exists for.
 *
 * `net` gets the hero slot rather than equity because equity does not know what the
 * operation cost. An agent can be up $40 on the book and down on the month once the
 * fee ledger, the x402 payments and the token bill are counted, and the operator who
 * only ever sees equity finds that out from their card statement.
 *
 * Live agents only. A paper agent is born holding a $10,000 notional; adding that to a
 * $12 live wallet does not make a bigger number, it makes a meaningless one.
 *
 * Server component, and nothing here moves. A money figure that counts up on every
 * navigation is a small lie about what just changed.
 */

function Well({
  icon: Icon,
  label,
  children,
  footnote,
  title,
}: {
  icon: React.ElementType;
  label: string;
  children: React.ReactNode;
  footnote?: React.ReactNode;
  /** Native tooltip — the split, spelled out, with no client JS to deliver it. */
  title?: string;
}) {
  return (
    <div className="glass-inset rounded-xl px-3.5 py-3" title={title}>
      <p className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        <Icon aria-hidden className="size-3" />
        {label}
      </p>
      <p className="tnum mt-1.5 text-base font-medium">{children}</p>
      {footnote ? (
        <p className="tnum mt-0.5 text-[11px] leading-4 text-muted-foreground">{footnote}</p>
      ) : null}
    </div>
  );
}

export function MoneyHeadline({ summary }: { summary: MoneySummary }) {
  const { totals, today, stale } = summary;
  const costParts = [
    `${formatUsd(totals.feesUsd)} Tocker fees`,
    `${formatUsd(totals.dataSpendUsd)} market data`,
    `${formatUsd(totals.modelSpendUsd)} model tokens (estimate)`,
  ];

  return (
    <section
      aria-labelledby="money-net-heading"
      className="glass-panel glass-grain overflow-hidden rounded-2xl"
    >
      <div className="px-5 pt-5 sm:px-6 sm:pt-6">
        <h2
          id="money-net-heading"
          className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
        >
          Net, after costs
        </h2>
        <p
          className={cn(
            "tnum mt-1 text-3xl font-semibold tracking-tight sm:text-4xl",
            totals.netUsd > 0 ? "text-positive" : totals.netUsd < 0 ? "text-negative" : "text-foreground",
          )}
        >
          {totals.netUsd > 0 ? "+" : totals.netUsd < 0 ? "−" : ""}
          {formatUsd(Math.abs(totals.netUsd))}
        </p>
        <p className="mt-1 max-w-xl text-xs text-muted-foreground">
          All-time P&amp;L across {totals.agentCount} live agent{totals.agentCount === 1 ? "" : "s"}, minus every
          Tocker fee, market-data payment and estimated model token. Paper agents are listed below but counted in nothing
          here.
        </p>
        {stale ? (
          <p className="mt-2 text-[11px] text-muted-foreground">
            One or more wallet balances could not be read just now, so those rows are the last recorded snapshot
            rather than this second.
          </p>
        ) : null}
      </div>

      <div className="grid grid-cols-2 gap-2 px-5 pb-5 pt-4 sm:grid-cols-4 sm:px-6 sm:pb-6">
        <Well
          icon={Wallet}
          label="Equity"
          footnote={`${formatUsd(totals.cashUsd)} cash · ${formatUsd(totals.positionsUsd)} in positions`}
        >
          {formatUsd(totals.equityUsd)}
        </Well>

        {/* The percentage rides in the footnote, as All-time's split does: a half-width
            well on a phone has ~124px, and "+$1,234.56 +11.11%" cannot break apart. A
            deposit or withdrawal today is already taken out of the figure; the note says
            so in place of the %, whose base moved with the money. */}
        <Well
          icon={Sun}
          label="Today’s change"
          footnote={
            today.pnlUsd === null ? (
              "needs a second day of marks"
            ) : today.flowUsd !== 0 ? (
              <>
                <span className="whitespace-nowrap">{flowText(today.flowUsd)}</span> ·{" "}
                <span className="whitespace-nowrap">since 00:00 UTC</span>
              </>
            ) : today.pnlPct === null ? (
              "since 00:00 UTC"
            ) : (
              <>
                {formatSignedPct(today.pnlPct, 2)} · <span className="whitespace-nowrap">since 00:00 UTC</span>
              </>
            )
          }
        >
          {today.pnlUsd === null ? (
            <span className="text-muted-foreground">—</span>
          ) : (
            <PnlText usd={today.pnlUsd} size="md" />
          )}
        </Well>

        <Well
          icon={Coins}
          label="All-time P&L"
          // Each figure kept whole: a line break after "−" left "$140.25 open" reading as a gain.
          footnote={
            <>
              <span className="whitespace-nowrap">{formatSignedUsd(totals.realizedPnlUsd)} realised</span> ·{" "}
              <span className="whitespace-nowrap">{formatSignedUsd(totals.unrealizedPnlUsd)} open</span>
            </>
          }
        >
          <PnlText usd={totals.pnlUsd} size="md" />
        </Well>

        <Well
          icon={Receipt}
          label="Costs"
          title={costParts.join("\n")}
          footnote={
            <>
              {formatUsd(totals.feesUsd)} fees · {formatUsd(totals.dataSpendUsd)} data ·{" "}
              {formatUsd(totals.modelSpendUsd)} model
            </>
          }
        >
          {formatUsd(totals.costsUsd)}
        </Well>
      </div>
    </section>
  );
}
