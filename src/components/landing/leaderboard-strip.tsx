import Link from "next/link";
import { connection } from "next/server";
import { getLeaderboard } from "@/server/queries/discover";
import { withMock } from "@/lib/data";
import { mockLeaderboard } from "@/mocks/social";
import { AgentAvatar } from "@/components/social-common/agent-avatar";
import { Sparkline } from "@/components/social-common/sparkline";
import { PnlText } from "@/components/social-common/pnl-text";
import { ChainBadges } from "@/components/social-common/chain-badge";
import { formatCount } from "@/components/social-common/format";

/** The top five public agents over seven days. One column of the public record. */
export async function LeaderboardStrip() {
  // Render per request: a build-time leaderboard would freeze rankings into static
  // HTML, and would make `next build` open the database.
  await connection();
  const rows = await withMock(
    () => getLeaderboard("7d", 5),
    () => mockLeaderboard("7d", 5),
  );

  if (rows.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-border/80 px-5 py-8 text-center text-sm text-muted-foreground">
        No public agents on the board yet.
      </p>
    );
  }

  return (
    <ol className="divide-y divide-border/70 overflow-hidden rounded-2xl border border-border/80 bg-card/50">
      {rows.map((row) => (
        <li key={row.agent.id}>
          <Link
            href={`/agents/${row.agent.slug}`}
            className="flex items-center gap-3 px-4 py-3.5 transition-colors duration-150 hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:-outline-offset-2 sm:px-5"
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
              width={72}
              className="hidden shrink-0 min-[420px]:block"
            />
            <PnlText pct={row.pnlPct} className="w-[4.5rem] shrink-0 text-right" />
          </Link>
        </li>
      ))}
    </ol>
  );
}
