"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowDownToLine, Link2, Lock, Play, Settings2, Zap } from "lucide-react";
import { toast } from "sonner";
import { FollowButton } from "@/components/spectrumui/follow-button";
import { MorphButton } from "@/components/spectrumui/morph-button";
import { ShareButton } from "@/components/spectrumui/share-button";
import { AgentAvatar } from "@/components/common/agent-avatar";
import { copyLink } from "@/components/common/copy-link";
import { MORPH_FOCUS } from "@/components/common/focus";
import { ChainBadge } from "@/components/common/chain-badge";
import { ModeBadge } from "@/components/common/mode-badge";
import { RelativeTime } from "@/components/common/relative-time";
import { StatusBadge } from "@/components/common/status-badge";
import { modelLabel } from "@/components/social-common/chain-badge";
import { useRunStatus } from "@/components/providers/run-status";
import { followUser } from "@/components/feed/feed-actions";
import { FundAgentDrawer } from "./settings/fund-agent-drawer";
import { useWalletBalances } from "./settings/wallets-card";
import { ManualTradeSheet } from "./manual-trade";
import { triggerRunAction } from "./agent-actions";
import { safeAction } from "@/lib/safe-action";
import { cn } from "@/lib/utils";
import type { AgentStatusItem } from "@/server/queries/agent-status";
import type { AgentDetail } from "@/server/types";

export function AgentHeader({
  agent,
  accountPaused = false,
  runBlocker = null,
  isAdmin = false,
}: {
  agent: AgentDetail;
  /** Admins get the env-var hint in the Fund drawer's fallback; everyone else the plain copy. */
  isAdmin?: boolean;
  accountPaused?: boolean;
  /**
   * Owner only: the status item that makes a run fail before it starts (no LLM key).
   * "Run now" is disabled while it holds, rather than reporting "Run started" for a
   * run that is already lost.
   */
  runBlocker?: Pick<AgentStatusItem, "action"> | null;
}) {
  const { watchRun } = useRunStatus();
  const [following, setFollowing] = useState(agent.isFollowedByViewer);
  // The count sits in the same header as the button, so it moves with it.
  const followers = agent.followerCount + (following === agent.isFollowedByViewer ? 0 : following ? 1 : -1);

  const shareUrl =
    typeof window === "undefined"
      ? `/agents/${agent.slug}`
      : `${window.location.origin}/agents/${agent.slug}`;

  const runNow = async () => {
    // `safeAction`: a request that never lands (offline, a deploy in between) must
    // toast too, not only flash "Failed" on the button with no reason.
    const result = await safeAction(() => triggerRunAction(agent.id));
    if (!result.ok) {
      toast.error("Could not start the run", { description: result.error });
      throw new Error(result.error);
    }
    watchRun({
      runId: result.data.runId,
      agentId: agent.id,
      agentSlug: agent.slug,
      agentName: agent.name,
      avatarSeed: agent.avatarSeed,
    });
    // No "Run started" toast: the button's "Running" and the run island already say it,
    // and a toast outlives a short run — it sat on top of the island's "Run finished".
  };

  const onFollow = async (next: boolean) => {
    setFollowing(next);
    const result = await safeAction(() => followUser("agent", agent.id, next));
    if (!result.ok) {
      setFollowing(!next);
      toast.error("Follow failed", { description: result.error });
    }
  };

  return (
    <header className="glass-panel glass-grain rounded-2xl px-4 py-5 sm:px-6">
      {/*
        A grid so the avatar can sit beside the name on a phone without narrowing the
        buttons: there the actions span both columns under it. On its own row, with the
        PnL block stacked under the buttons, the header used to fill the first screen.
        The PnL itself is the first stat card below, with its realized/open split.
      */}
      <div className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 gap-y-4 sm:gap-x-4">
        <AgentAvatar seed={agent.avatarSeed} name={agent.name} size="lg" className="rounded-xl sm:hidden" />
        <AgentAvatar
          seed={agent.avatarSeed}
          name={agent.name}
          size="xl"
          className="rounded-2xl max-sm:hidden sm:row-span-2"
        />

        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight">{agent.name}</h1>
            <ModeBadge mode={agent.mode} />
            <StatusBadge status={agent.status} accountPaused={agent.isOwner && accountPaused} />
            {!agent.isPublic ? (
              <span className="rounded-md border border-border bg-muted/50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Private
              </span>
            ) : null}
          </div>

          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
            <Link
              href={`/u/${agent.owner.handle}`}
              className="rounded hover:text-foreground hover:underline focus-ring"
            >
              @{agent.owner.handle}
            </Link>
            <MetaSegment>
              <span title={agent.model}>{modelLabel(agent.model)}</span>
            </MetaSegment>
            <MetaSegment>
              {agent.chains.map((chain) => (
                <ChainBadge key={chain} chain={chain} />
              ))}
            </MetaSegment>
            {/* Activity is its own line on a phone, so it starts with "ran", not a "·"
                left over from the line above; on desktop it rejoins the one line. */}
            <span className="flex w-full flex-wrap items-center gap-x-2 gap-y-1 sm:w-auto">
              {agent.lastRunAt ? (
                <MetaSegment leadingDotClassName="hidden sm:inline">
                  <span className="text-xs">
                    ran <RelativeTime iso={agent.lastRunAt} className="text-xs" />
                  </span>
                </MetaSegment>
              ) : null}
              <MetaSegment leadingDotClassName={agent.lastRunAt ? undefined : "hidden sm:inline"}>
                <span className="tnum text-xs">
                  {followers.toLocaleString()} follower{followers === 1 ? "" : "s"}
                </span>
              </MetaSegment>
            </span>
          </p>

          {agent.tagline ? (
            <p className="mt-2 max-w-2xl text-sm text-foreground/85">{agent.tagline}</p>
          ) : null}

          {!agent.isOwner ? (
            <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
              <Lock aria-hidden className="size-3.5" />
              Strategy private · record public
            </p>
          ) : null}
        </div>

        <div className="col-span-2 flex flex-wrap items-center gap-2 sm:col-span-1 sm:col-start-2">
          {agent.isOwner ? (
            <>
              <MorphButton
                size="sm"
                className={MORPH_FOCUS}
                onAction={runNow}
                loadingLabel="Starting…"
                successLabel="Running"
                errorLabel="Failed"
                disabled={agent.status === "draft" || runBlocker !== null}
              >
                <span className="flex items-center gap-1.5">
                  <Play aria-hidden className="size-3.5" />
                  Run now
                </span>
              </MorphButton>

              {/* Visible, not a tooltip: a disabled button explains nothing on touch. */}
              {runBlocker ? (
                <Link
                  href={runBlocker.action?.href ?? `/agents/${agent.slug}/settings#brain`}
                  className="rounded text-xs font-medium text-foreground/85 underline decoration-muted-foreground/50 underline-offset-2 transition-colors duration-150 hover:decoration-foreground focus-ring"
                >
                  Attach a key to run
                </Link>
              ) : null}

              {/* Owner-only: trade the agent's book by hand. */}
              <ManualTradeSheet agent={agent} />

              <OwnerMoneyActions agent={agent} isAdmin={isAdmin} />

              <Link
                href={`/agents/${agent.slug}/settings`}
                className={cn(HEADER_ACTION, "border-border hover:bg-muted")}
              >
                <Settings2 aria-hidden className="size-3.5" />
                Settings
              </Link>
            </>
          ) : (
            <FollowButton
              size="sm"
              following={following}
              onFollowingChange={(next) => void onFollow(next)}
            />
          )}

          <ShareButton
            size="sm"
            label="Share this agent"
            actions={[
              {
                icon: <Link2 aria-hidden className="size-3.5" />,
                label: "Copy link",
                onSelect: () => copyLink(shareUrl),
              },
            ]}
          />
        </div>
      </div>
    </header>
  );
}

/**
 * One part of the header's meta line, carrying the separator in front of it. A
 * separator that is its own flex item can be the last thing on a wrapped line — "Base ·"
 * on a phone — so each "·" travels with what it introduces instead.
 */
function MetaSegment({
  children,
  leadingDotClassName,
}: {
  children: React.ReactNode;
  /** For a segment that opens its own line on phones and so has nothing to follow there. */
  leadingDotClassName?: string;
}) {
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap">
      <span aria-hidden className={leadingDotClassName}>
        ·
      </span>
      {children}
    </span>
  );
}

/**
 * Fund and Go live, for the owner only.
 *
 * Its own component so the balance query is mounted only when there is an owner to
 * mount it for — `getAgentWalletBalances` refuses a non-owner server-side, and a
 * request that is going to be refused is one nobody should be making.
 *
 * These two are the things an owner does *to* an agent rather than *with* it, and the
 * agent page is where you are standing when you decide to. They open the same sheet and
 * the same checklist as the settings cards, so there is still exactly one Fund flow and
 * one go-live flow in the product.
 */
function OwnerMoneyActions({ agent, isAdmin }: { agent: AgentDetail; isAdmin: boolean }) {
  const { data: wallets = [] } = useWalletBalances(agent.id);
  const live = agent.mode === "live";

  return (
    <>
      <FundAgentDrawer
        agentId={agent.id}
        agentName={agent.name}
        wallets={wallets}
        isAdmin={isAdmin}
        trigger={
          <button type="button" className={cn(HEADER_ACTION, "border-border hover:bg-muted")}>
            <ArrowDownToLine aria-hidden className="size-3.5" />
            Fund
          </button>
        }
      />
      <Link
        href={`/agents/${agent.slug}/live`}
        className={cn(
          HEADER_ACTION,
          live
            ? "border-border hover:bg-muted"
            : "border-primary/40 bg-primary/10 text-primary hover:bg-primary/15",
        )}
      >
        <Zap aria-hidden className="size-3.5" />
        {live ? "Live tick" : "Go live"}
      </Link>
    </>
  );
}

const HEADER_ACTION =
  "inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium " +
  "transition-[background-color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] " +
  "active:scale-[0.97] focus-ring";
