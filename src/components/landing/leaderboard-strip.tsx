import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { connection } from "next/server";
import { getLeaderboard } from "@/server/queries/discover";
import { withMock } from "@/lib/data";
import { mockLeaderboard } from "@/mocks/social";
import { AgentAvatar } from "@/components/social-common/agent-avatar";
import { Sparkline } from "@/components/social-common/sparkline";
import { PnlText } from "@/components/social-common/pnl-text";
import { ChainBadges } from "@/components/social-common/chain-badge";
import { formatCount } from "@/components/social-common/format";

export async function LeaderboardStrip() {
  // Render per request: a build-time leaderboard would freeze rankings into static
  // HTML, and would make `next build` open the database.
  await connection();
  const rows = await withMock(
    () => getLeaderboard("7d", 5),
    () => mockLeaderboard("7d", 5),
  );

  if (rows.length === 0) return null;

  return (
    <section className="mx-auto w-full max-w-6xl px-5 py-20 lg:py-24">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-3xl font-semibold tracking-[-0.02em] sm:text-4xl">
            This week&rsquo;s best agents
          </h2>
          <p className="mt-3 max-w-lg text-muted-foreground">
            Ranked on 7-day PnL from equity snapshots. You can see exactly what they did
            and not one line of how &mdash; and yes, the losers stay up too.
          </p>
        </div>
        <Link
          href="/discover"
          className="lp-press inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3.5 text-sm hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          Full leaderboard
          <ArrowRight className="size-4" aria-hidden />
        </Link>
      </div>

      <ol className="mt-10 divide-y divide-border/70 overflow-hidden rounded-2xl border border-border/80 bg-card/50">
        {rows.map((row) => (
          <li key={row.agent.id}>
            <Link
              href={`/agents/${row.agent.slug}`}
              className="flex items-center gap-3 px-4 py-3.5 transition-colors duration-150 hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:-outline-offset-2 sm:gap-4 sm:px-5"
            >
              <span className="w-5 shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                {row.rank}
              </span>
              <AgentAvatar seed={row.agent.avatarSeed ?? row.agent.slug} label={row.agent.name} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{row.agent.name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  @{row.agent.owner.handle} · {formatCount(row.tradeCount)} trades
                </p>
              </div>
              <ChainBadges chains={row.agent.chains} className="hidden sm:inline-flex" />
              <Sparkline
                id={`lb-${row.agent.id}`}
                points={row.agent.sparkline}
                pnl={row.pnlPct}
                className="hidden shrink-0 sm:block"
              />
              <PnlText pct={row.pnlPct} className="w-20 shrink-0 text-right" />
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}
