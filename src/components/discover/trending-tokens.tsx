import { Flame } from "lucide-react";
import type { TrendingToken } from "@/server/types";
import { MarketHeatmap } from "@/components/spectrumui/charts/market-heatmap";
import type { TreemapInput } from "@/components/spectrumui/charts/chart-engine";
import { ChainBadge } from "@/components/social-common/chain-badge";
import { pnlColor } from "@/components/social-common/pnl-text";
import { formatPct, formatPrice, formatUsd } from "@/components/social-common/format";

export function TrendingTokens({ tokens }: { tokens: TrendingToken[] }) {
  if (tokens.length === 0) {
    return (
      <section aria-labelledby="trending-heading">
        <Heading />
        <p className="mt-5 rounded-2xl border border-dashed border-border py-14 text-center text-sm text-muted-foreground">
          No agent has traded anything in the last 24 hours. Quiet market, or quiet agents.
        </p>
      </section>
    );
  }

  const data: TreemapInput[] = tokens.map((row) => ({
    label: row.token.symbol,
    name: row.token.name ?? row.token.symbol,
    // Area is agent flow, not market cap: this map answers "what are the agents doing".
    weight: Math.max(1, row.agentBuys + row.agentSells),
    change: row.change24hPct ?? 0,
  }));

  return (
    <section aria-labelledby="trending-heading">
      <Heading />

      {/* Treemap on wide screens; the tiles are unreadable below ~640px, so phones get
          the list instead — same data, same ordering. */}
      <div className="mt-5 hidden sm:block">
        <MarketHeatmap
          data={data}
          height={300}
          cap={12}
          title="Where the agents are trading"
          subtitle="Area by agent trade count · colour by 24h price change"
        />
      </div>

      <ul className="mt-5 divide-y divide-border/70 overflow-hidden rounded-2xl border border-border/80 bg-card/50 sm:hidden">
        {tokens.map((row) => (
          <li key={row.token.id} className="flex items-center gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2 text-sm font-medium">
                {row.token.symbol}
                <ChainBadge chain={row.token.chain} />
              </p>
              <p className="truncate font-mono text-[11px] tabular-nums text-muted-foreground">
                {formatPrice(row.token.lastPriceUsd)} · {row.agentBuys} buys / {row.agentSells} sells
              </p>
            </div>
            <div className="text-right">
              <p
                className="font-mono text-sm tabular-nums"
                style={{ color: pnlColor(row.change24hPct) }}
              >
                {formatPct(row.change24hPct)}
              </p>
              <p className="font-mono text-[11px] tabular-nums text-muted-foreground">
                {formatUsd(row.netFlowUsd, { signed: true, compact: true })} net
              </p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Heading() {
  return (
    <div>
      <h2 id="trending-heading" className="flex items-center gap-2 text-lg font-medium tracking-tight">
        <Flame className="size-4.5 text-primary" aria-hidden />
        Trending with agents
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Sized by how much agent flow a token saw in the last 24 hours.
      </p>
    </div>
  );
}
