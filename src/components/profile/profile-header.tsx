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
    <header className="glass-panel glass-grain rounded-2xl p-5 sm:p-6">
      {/*
        A grid, not a wrapping flex row: with the text column at flex-basis 0 nothing
        ever wrapped, so on a phone the bio got whatever the avatar and the buttons
        left over — about 90px, one word per line.

        Phone: avatar and actions share the first row, then name, then bio and facts at
        the full card width. sm+: avatar | name, bio, facts | actions. Share sits left
        of Follow in both, so its fan opens over the row's empty middle, not the pill.
      */}
      <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-3 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:gap-x-5 sm:gap-y-0">
        <AgentAvatar
          seed={profile.handle}
          label={profile.displayName ?? profile.handle}
          size="lg"
          rounded="rounded-2xl"
          className="col-start-1 row-start-1 sm:row-span-2 sm:size-24 sm:text-3xl"
        />

        <div className="col-start-2 row-start-1 flex items-center gap-2 self-center justify-self-end sm:col-start-3 sm:self-start">
          <ProfileShare handle={profile.handle} />
          {profile.isSelf ? (
            <Link
              href="/settings"
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-sm transition-[background-color,transform] duration-150 hover:bg-muted active:scale-[0.97] focus-ring"
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
        </div>

        <div className="col-span-2 row-start-2 min-w-0 sm:col-span-1 sm:col-start-2 sm:row-start-1">
          <h1 className="text-xl font-semibold tracking-tight break-words sm:text-2xl">
            {profile.displayName ?? profile.handle}
          </h1>
          <p className="truncate font-mono text-sm text-muted-foreground">@{profile.handle}</p>
        </div>

        <div className="col-span-2 row-start-3 min-w-0 sm:col-span-1 sm:col-start-2 sm:row-start-2">
          {profile.bio ? (
            <p className="max-w-prose text-sm leading-6 text-foreground/85 sm:mt-3">{profile.bio}</p>
          ) : null}

          <dl className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm sm:mt-4">
            {/* Each group holds only its dt and dd; the unit words live inside the dd. */}
            <div>
              <dt className="sr-only">Followers</dt>
              <dd className="font-mono font-medium tabular-nums">
                {formatCount(profile.followerCount)}{" "}
                <span className="font-sans font-normal text-muted-foreground">followers</span>
              </dd>
            </div>
            <div>
              <dt className="sr-only">Following</dt>
              <dd className="font-mono font-medium tabular-nums">
                {formatCount(profile.followingCount)}{" "}
                <span className="font-sans font-normal text-muted-foreground">following</span>
              </dd>
            </div>
            <div className="text-muted-foreground">
              <dt className="sr-only">Joined</dt>
              <dd className="flex items-center gap-1.5">
                <CalendarDays className="size-3.5" aria-hidden />
                Joined {formatJoined(profile.createdAt)}
              </dd>
            </div>
          </dl>
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
