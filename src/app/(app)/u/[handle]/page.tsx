import { cache } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Bot } from "lucide-react";
import { getSession } from "@/lib/auth";
import { getUserProfile } from "@/server/queries/users";
import { withMock } from "@/lib/data";
import { mockSession, mockTradeActivity, mockUserProfile } from "@/mocks/social";
import { ProfileHeader } from "@/components/profile/profile-header";
import { ProfileTabs } from "@/components/profile/profile-tabs";
import { ActivityPanel } from "@/components/profile/activity-panel";
import { AgentGridCard } from "@/components/discover/agent-grid-card";
import { EmptyState } from "@/components/common/empty-state";
import { tradeActivity } from "./trade-activity";

// Cached per request: generateMetadata and the page both need the same lookup.
const loadProfile = cache(async (handle: string) => {
  const session = await withMock(getSession, mockSession).catch(() => null);
  return withMock(
    () => getUserProfile(handle, session?.userId ?? null),
    () => mockUserProfile(handle),
  );
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ handle: string }>;
}): Promise<Metadata> {
  const { handle } = await params;
  // Built from the lookup, not the URL: "@nobody-xyz" over a "Nothing here" page claimed
  // a user that does not exist.
  const profile = await loadProfile(handle);
  if (!profile) return { title: "Profile not found" };
  return {
    title: `@${profile.handle}`, // the root layout appends " · Tocker"
    description: `Agents, PnL and trading activity for @${profile.handle}.`,
  };
}

export default async function ProfilePage({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  const profile = await loadProfile(handle);
  if (!profile) notFound();

  // Counted over the agents this header already shows (public ones, plus private ones
  // on your own profile), so the heatmap and the "Trades" tile agree.
  const activity = await withMock(
    () => tradeActivity(profile.agents.map((agent) => agent.id)),
    () => mockTradeActivity(profile.handle),
  );
  const totalTrades = profile.agents.reduce((sum, agent) => sum + agent.tradeCount, 0);

  return (
    <div className="mx-auto w-full max-w-5xl px-5 py-8 sm:py-10">
      <ProfileHeader profile={profile} />

      <div className="mt-8">
        <ProfileTabs
          agentCount={profile.agents.length}
          agentsSlot={
            profile.agents.length === 0 ? (
              <EmptyState
                icon={<Bot />}
                // Your own profile lists your private agents too, so empty here means none.
                title={profile.isSelf ? "No agents yet" : "No public agents"}
                description={
                  profile.isSelf
                    ? "You haven't built an agent yet. Publishing one shows the record — never the recipe."
                    : `@${profile.handle} hasn't published an agent yet. Follow them and new ones show up in your feed.`
                }
                action={
                  profile.isSelf ? (
                    <Link
                      href="/agents/new"
                      className="focus-ring inline-flex h-9 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-[background-color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-primary/90 active:scale-[0.97]"
                    >
                      Build your first agent
                    </Link>
                  ) : null
                }
              />
            ) : (
              <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {profile.agents.map((agent) => (
                  <li key={agent.id}>
                    <AgentGridCard agent={agent} />
                  </li>
                ))}
              </ul>
            )
          }
          activitySlot={
            <ActivityPanel
              data={activity}
              handle={profile.handle}
              isSelf={profile.isSelf}
              agentCount={profile.agents.length}
              tradeCount={totalTrades}
            />
          }
        />
      </div>
    </div>
  );
}
