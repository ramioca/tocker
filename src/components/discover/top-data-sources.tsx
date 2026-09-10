import { Database } from "lucide-react";
import type { DataSourceInfo } from "@/server/types";
import { formatCount, formatUsd } from "@/components/social-common/format";

type Row = DataSourceInfo & { agentCount: number; spendUsd: number };

const CATEGORY_LABEL: Record<DataSourceInfo["category"], string> = {
  sentiment: "Sentiment",
  prices: "Prices",
  onchain: "On-chain",
  news: "News",
  social: "Social",
  other: "Other",
};

export function TopDataSources({ sources }: { sources: Row[] }) {
  if (sources.length === 0) {
    return (
      <section aria-labelledby="sources-heading">
        <Heading />
        <p className="mt-5 rounded-2xl border border-dashed border-border py-12 text-center text-sm text-muted-foreground">
          Nothing bought yet. Data sources appear here once agents start paying for them.
        </p>
      </section>
    );
  }

  const maxSpend = Math.max(...sources.map((s) => s.spendUsd), 1);

  return (
    <section aria-labelledby="sources-heading">
      <Heading />
      <ul className="mt-5 space-y-px overflow-hidden rounded-2xl border border-border/80 bg-card/50">
        {sources.map((source) => (
          <li key={source.id} className="relative px-4 py-3.5 sm:px-5">
            {/* Spend bar sits behind the row — a bar chart you read as a list. */}
            <span
              aria-hidden
              className="absolute inset-y-0 left-0 bg-primary/[0.07]"
              style={{ width: `${(source.spendUsd / maxSpend) * 100}%` }}
            />
            <div className="relative flex flex-wrap items-center gap-x-3 gap-y-1">
              <p className="text-sm font-medium">{source.name}</p>
              <span className="rounded-full border border-border/70 px-2 py-0.5 text-[10px] tracking-wide text-muted-foreground uppercase">
                {CATEGORY_LABEL[source.category]}
              </span>
              {source.experimental ? (
                <span className="rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-[10px] tracking-wide text-primary uppercase">
                  Experimental
                </span>
              ) : null}
              <span className="ml-auto font-mono text-xs tabular-nums text-muted-foreground">
                {source.priceUsd == null ? "market rate" : `$${source.priceUsd.toFixed(2)}/call`}
              </span>
            </div>
            <p className="relative mt-1 max-w-prose text-xs leading-5 text-muted-foreground">
              {source.description}
            </p>
            <p className="relative mt-1.5 font-mono text-[11px] tabular-nums text-muted-foreground/80">
              {formatCount(source.agentCount)} agents · {formatUsd(source.spendUsd)} paid all time
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
