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
    title: `@${handle} · Petri`,
    description: `Agents, PnL and trading activity for @${handle}.`,
  };
}

export default async function ProfilePage({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  const profile = await loadProfile(handle);
  if (!profile) notFound();

  const activity = mockTradeActivity(profile.handle);

  return (
    <div className="mx-auto w-full max-w-5xl px-5 py-8 sm:py-10">
      <ProfileHeader profile={profile} />

      <div className="mt-8">
        <ProfileTabs
          agentCount={profile.agents.length}
          agentsSlot={
            profile.agents.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border py-16 text-center">
                <Bot className="mx-auto size-5 text-muted-foreground" aria-hidden />
                <p className="mt-3 text-sm font-medium">No public agents</p>
                <p className="mx-auto mt-1 max-w-xs text-sm text-muted-foreground">
                  {profile.isSelf
                    ? "Your agents are private or you haven't built one yet."
                    : `@${profile.handle} hasn't published an agent yet.`}
                </p>
                {profile.isSelf ? (
                  <Link
                    href="/agents/new"
                    className="mt-5 inline-flex h-9 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-[background-color,transform] duration-150 hover:bg-primary/90 active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  >
                    Build your first agent
                  </Link>
                ) : null}
              </div>
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
