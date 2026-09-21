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

async function loadProfile(handle: string) {
  const session = await withMock(getSession, mockSession).catch(() => null);
  return withMock(
    () => getUserProfile(handle, session?.userId ?? null),
    () => mockUserProfile(handle),
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ handle: string }>;
}): Promise<Metadata> {
  const { handle } = await params;
  return {
    title: `@${handle}`, // the root layout appends " · Tocker"
    description: `Agents, PnL and trading activity for @${handle}.`,
  };
}

export default async function ProfilePage({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  const profile = await loadProfile(handle);
  if (!profile) notFound();

  // No real query for daily trade activity yet. In mock mode show the sample
  // heatmap; in production return nothing so ActivityPanel renders its honest
  // empty state rather than fabricating a track record. Replace the real branch
  // with getUserTradeActivity(handle) once it lands.
  const activity = await withMock(
    async () => [] as Array<{ t: number; value: number }>,
    () => mockTradeActivity(profile.handle),
  );

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
                title="No public agents"
                description={
                  profile.isSelf
                    ? "Your agents are private, or you haven't built one yet. Publishing one shows the record — never the recipe."
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
          activitySlot={<ActivityPanel data={activity} handle={profile.handle} />}
        />
      </div>
    </div>
  );
}
