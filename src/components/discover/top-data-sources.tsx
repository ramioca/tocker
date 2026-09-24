import { Database } from "lucide-react";
import type { DataSourceInfo } from "@/server/types";
import { EmptyState } from "@/components/common/empty-state";
import { formatCount, formatPrice, formatUsd } from "@/components/social-common/format";

type Row = DataSourceInfo & { agentCount: number; spendUsd: number };

const CATEGORY_LABEL: Record<DataSourceInfo["category"], string> = {
  sentiment: "Sentiment",
  prices: "Prices",
  onchain: "On-chain",
  news: "News",
  social: "Social",
  other: "Other",
};

/**
 * A source we paid but no longer register comes back from the query named by its raw
 * id ("token-intel-sol"). The host it was paid at is the more honest label.
 */
function displayName(source: Row): string {
  if (source.name !== source.id || !source.url) return source.name;
  try {
    return new URL(source.url).host || source.name;
  } catch {
    return source.name;
  }
}

/** Per-call prices live under a cent: "$0.006", not "$0.01" (rounded up) or "$0.0060". */
function perCall(priceUsd: number): string {
  if (priceUsd > 0 && priceUsd < 0.01) return `$${priceUsd.toPrecision(2).replace(/(\.\d*?)0+$/, "$1")}`;
  return formatPrice(priceUsd);
}

export function TopDataSources({ sources }: { sources: Row[] }) {
  if (sources.length === 0) {
    return (
      <section aria-labelledby="sources-heading">
        <Heading />
        <EmptyState
          className="mt-5"
          icon={<Database />}
          title="Nothing bought yet"
          description="Sources appear here the first time an agent pays one over x402. Add a paid source in the builder and it shows up after the next run."
        />
      </section>
    );
  }

  const maxSpend = Math.max(...sources.map((s) => s.spendUsd), 1);

  return (
    <section aria-labelledby="sources-heading">
      <Heading />
      <ul className="glass-panel mt-5 divide-y divide-[var(--glass-hairline)] overflow-hidden rounded-2xl">
        {sources.map((source) => (
          <li key={source.id} className="relative px-4 py-3.5 sm:px-5">
            {/*
              Spend bar behind the row — a bar chart you read as a list. It fades
              out rather than ending on a hard edge: a flat block that stops
              mid-sentence reads as a redaction, not a measurement.
            */}
            <span
              aria-hidden
              className="absolute inset-y-0 left-0 bg-gradient-to-r from-primary/[0.14] to-transparent"
              style={{ width: `${(source.spendUsd / maxSpend) * 100}%` }}
            />
            {/* Price in its own column, so it sits top-right on every row instead of
                wrapping under the badges on some rows and not others. */}
            <div className="relative grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3">
              <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                <p className="min-w-0 truncate text-sm font-medium">{displayName(source)}</p>
                <span className="rounded-full border border-border/70 px-2 py-0.5 text-[10px] tracking-wide text-muted-foreground uppercase">
                  {CATEGORY_LABEL[source.category]}
                </span>
                {source.experimental ? (
                  <span className="rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-[10px] tracking-wide text-primary uppercase">
                    Experimental
                  </span>
                ) : null}
              </div>
              <span className="pt-0.5 font-mono text-xs tabular-nums text-muted-foreground">
                {source.priceUsd == null ? "market rate" : `${perCall(source.priceUsd)}/call`}
              </span>
            </div>
            {/*
              `summary` is the plain sentence written for people. `description` is written
              for the model — modes, prices, vendor quirks, operator notes — and is never
              public copy, so a row without a summary shows no line rather than that.
            */}
            {source.summary ? (
              <p className="relative mt-1 max-w-prose text-xs leading-5 text-muted-foreground">
                {source.summary}
              </p>
            ) : null}
            {/*
              A source nobody has bought yet is padding — the list is ranked by spend and
              backfilled from the registry so it is never a one-line page. Saying
              "0 agents · $0.00 paid all time" under a heading that promises what agents
              actually pay for reads as a measurement of zero rather than an absence of
              one, so say the absence instead.

              Rows with spend are aggregates over at least `MIN_AGGREGATE_AGENTS` public
              agents; smaller groups are dropped in the query, not hidden here.
            */}
            <p className="relative mt-1.5 font-mono text-[11px] tabular-nums text-muted-foreground/80">
              {source.agentCount === 0
                ? "Not bought yet"
                : `${formatCount(source.agentCount)} agents · ${formatUsd(source.spendUsd)} paid all time`}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Heading() {
  return (
    <div>
      <h2 id="sources-heading" className="flex items-center gap-2 text-lg font-medium tracking-tight">
        <Database className="size-4.5 text-primary" aria-hidden />
        Top data sources
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        What agents actually pay for, ranked by lifetime x402 spend.
      </p>
    </div>
  );
}
