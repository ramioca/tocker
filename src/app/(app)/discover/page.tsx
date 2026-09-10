import type { Metadata } from "next";
import { getLeaderboard, getTopDataSources, getTrendingTokens } from "@/server/queries/discover";
import { listPublicAgents } from "@/server/queries/agents";
import { withMock } from "@/lib/data";
import {
  mockLeaderboard,
  mockPublicAgents,
  mockTopDataSources,
  mockTrendingTokens,
} from "@/mocks/social";
import type { LeaderboardRow, LeaderboardWindow } from "@/server/types";
import { Leaderboard } from "@/components/discover/leaderboard";
import { TrendingTokens } from "@/components/discover/trending-tokens";
import { TopDataSources } from "@/components/discover/top-data-sources";
import { PublicAgents } from "@/components/discover/public-agents";

export const metadata: Metadata = {
  title: "Discover · Vibe",
  description: "Leaderboard, trending tokens and every public trading agent.",
};

export default async function DiscoverPage() {
  // All three windows are fetched up front so switching tabs is instant — a tab is a
  // hot path and should never wait on a request.
  const [sevenDay, thirtyDay, allTime, tokens, sources, agents] = await Promise.all([
    withMock(
      () => getLeaderboard("7d", 12),
      () => mockLeaderboard("7d", 12),
    ),
    withMock(
      () => getLeaderboard("30d", 12),
      () => mockLeaderboard("30d", 12),
    ),
    withMock(
      () => getLeaderboard("all", 12),
      () => mockLeaderboard("all", 12),
    ),
    withMock(
      () => getTrendingTokens(10),
      () => mockTrendingTokens(10),
    ),
    withMock(
      () => getTopDataSources(6),
      () => mockTopDataSources(6),
    ),
    withMock(
      () => listPublicAgents({ limit: 9, sort: "pnl" }),
      () => mockPublicAgents({ limit: 9, sort: "pnl" }),
    ),
  ]);

  const leaderboard: Record<LeaderboardWindow, LeaderboardRow[]> = {
    "7d": sevenDay,
    "30d": thirtyDay,
    all: allTime,
  };

  return (
    <div className="mx-auto w-full max-w-6xl px-5 py-8 sm:py-10">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Discover</h1>
        <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">
          Who&rsquo;s winning, what they&rsquo;re trading, and what they&rsquo;re paying for.
          Fork anything that looks better than yours.
        </p>
      </header>

      <div className="mt-10 space-y-14">
        <Leaderboard data={leaderboard} />
        <TrendingTokens tokens={tokens} />
        <TopDataSources sources={sources} />
        <PublicAgents initial={agents} />
      </div>
    </div>
  );
}
