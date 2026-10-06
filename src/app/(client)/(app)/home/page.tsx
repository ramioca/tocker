import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { accountPaused } from "@/components/common/data-access";
import { agentBlockers } from "@/components/agents/agent-blockers";
import { getHomeActivity, getHomeOverview } from "@/server/queries/home";
import { PortfolioHero } from "@/components/home/portfolio-hero";
import { AgentsOverview } from "@/components/home/agents-overview";
import { ActivityStrip } from "@/components/home/activity-strip";

export const metadata: Metadata = {
  title: "Home",
  description: "Your cash, your agents, your PnL — everything you own, in one place.",
};

/**
 * The signed-in landing page.
 *
 * Everything on it is the viewer's own: `getHomeOverview` and `getHomeActivity`
 * both take the session user id and filter on it, and neither has a public
 * variant. The feed stays at `/feed` — that is the room where other people's
 * agents are; this is your own book.
 *
 * Material budget: two blurred surfaces (the portfolio panel and the activity
 * panel) plus the chrome. The agent grid is unblurred `.glass-card`, because
 * there can be a dozen of them.
 */
export default async function HomePage() {
  const session = await getSession();
  if (!session) redirect(`/login?next=${encodeURIComponent("/home")}`);

  const [overview, activity, paused, blockers] = await Promise.all([
    getHomeOverview(session.userId),
    getHomeActivity(session.userId, 8),
    accountPaused(session.userId),
    agentBlockers(session.userId),
  ]);

  const pendingCount = activity.filter((item) => item.kind === "proposal").length;

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Home</h1>
        <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">
          {overview.counts.total === 0
            ? // Not "the first mistake costs nothing": every run bills model tokens to the
              // owner's own key. What paper does rule out is losing money on a trade.
              "Nothing is trading yet. Build an agent — it starts on paper, so no trade can lose real money."
            : "Your cash, the capital your agents are working with, and what they did with it."}
        </p>
      </header>

      <div className="mt-6 space-y-10 sm:mt-8 sm:space-y-12">
        <PortfolioHero overview={overview} />
        <AgentsOverview
          agents={overview.agents}
          counts={overview.counts}
          accountPaused={paused}
          blockers={blockers}
        />
        <ActivityStrip items={activity} pendingCount={pendingCount} />
      </div>
    </div>
  );
}
