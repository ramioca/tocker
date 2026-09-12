import Link from "next/link";
import { CalendarDays, Pencil } from "lucide-react";
import type { UserProfile } from "@/server/types";
import { AgentAvatar } from "@/components/social-common/agent-avatar";
import { FollowToggle } from "@/components/social-common/follow-toggle";
import { PnlText } from "@/components/social-common/pnl-text";
import { formatCount, formatJoined } from "@/components/social-common/format";
import { ProfileShare } from "./profile-share";

export function ProfileHeader({ profile }: { profile: UserProfile }) {
  const liveAgents = profile.agents.filter((a) => a.mode === "live").length;
  const totalTrades = profile.agents.reduce((sum, a) => sum + a.tradeCount, 0);

  return (
    <header className="rounded-2xl border border-border/80 bg-card/50 p-5 sm:p-6">
      <div className="flex flex-wrap items-start gap-5">
        <AgentAvatar
          seed={profile.handle}
          label={profile.displayName ?? profile.handle}
          size="xl"
          rounded="rounded-2xl"
        />

        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
            {profile.displayName ?? profile.handle}
          </h1>
          <p className="font-mono text-sm text-muted-foreground">@{profile.handle}</p>

          {profile.bio ? (
            <p className="mt-3 max-w-prose text-sm leading-6 text-foreground/85">{profile.bio}</p>
          ) : null}

          <dl className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
            <div className="flex items-baseline gap-1.5">
              <dt className="sr-only">Followers</dt>
              <dd className="font-mono font-medium tabular-nums">
                {formatCount(profile.followerCount)}
              </dd>
              <span className="text-muted-foreground">followers</span>
            </div>
            <div className="flex items-baseline gap-1.5">
              <dt className="sr-only">Following</dt>
              <dd className="font-mono font-medium tabular-nums">
                {formatCount(profile.followingCount)}
              </dd>
              <span className="text-muted-foreground">following</span>
            </div>
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <CalendarDays className="size-3.5" aria-hidden />
              <dt className="sr-only">Joined</dt>
              <dd>Joined {formatJoined(profile.createdAt)}</dd>
            </div>
          </dl>
        </div>

        <div className="flex items-center gap-2">
          {profile.isSelf ? (
            <Link
              href="/settings"
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-sm transition-[background-color,transform] duration-150 hover:bg-muted active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              <Pencil className="size-3.5" aria-hidden />
              Edit profile
            </Link>
          ) : (
            <FollowToggle
              targetType="user"
              targetId={profile.id}
              defaultFollowing={profile.isFollowedByViewer}
              size="sm"
            />
          )}
          <ProfileShare handle={profile.handle} />
        </div>
      </div>

      <dl className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border/70 bg-border/60 sm:grid-cols-4">
        <Stat label="Total PnL">
          <PnlText usd={profile.totalPnlUsd} size="lg" />
        </Stat>
        <Stat label="Agents">
          <span className="font-mono text-lg font-medium tabular-nums">
            {profile.agents.length}
          </span>
          {liveAgents > 0 ? (
            <span className="ml-1.5 text-xs text-muted-foreground">{liveAgents} live</span>
          ) : null}
        </Stat>
        <Stat label="Trades">
          <span className="font-mono text-lg font-medium tabular-nums">
            {formatCount(totalTrades)}
          </span>
        </Stat>
        <Stat label="Followers">
          <span className="font-mono text-lg font-medium tabular-nums">
            {formatCount(profile.followerCount)}
          </span>
        </Stat>
      </dl>
    </header>
  );
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="bg-card px-4 py-3">
      <dt className="font-mono text-[10px] tracking-wide text-muted-foreground uppercase">
        {label}
      </dt>
      <dd className="mt-1 flex items-baseline">{children}</dd>
    </div>
  );
}
