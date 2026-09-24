"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowDownToLine, Lock, Play, Settings2, Zap } from "lucide-react";
import { toast } from "sonner";
import { FollowButton } from "@/components/spectrumui/follow-button";
import { MorphButton } from "@/components/spectrumui/morph-button";
import { ShareButton } from "@/components/spectrumui/share-button";
import { AgentAvatar } from "@/components/common/agent-avatar";
import { ChainBadge } from "@/components/common/chain-badge";
import { ModeBadge } from "@/components/common/mode-badge";
import { PnlText } from "@/components/common/pnl-text";
import { RelativeTime } from "@/components/common/relative-time";
import { StatusBadge } from "@/components/common/status-badge";
import { useRunStatus } from "@/components/providers/run-status";
import { followUser } from "@/components/feed/feed-actions";
import { FundAgentDrawer } from "./settings/fund-agent-drawer";
import { useWalletBalances } from "./settings/wallets-card";
import { ManualTradeSheet } from "./manual-trade";
import { triggerRunAction } from "./agent-actions";
import { cn } from "@/lib/utils";
import type { AgentDetail } from "@/server/types";

export function AgentHeader({ agent, accountPaused = false }: { agent: AgentDetail; accountPaused?: boolean }) {
  const { watchRun } = useRunStatus();
  const [following, setFollowing] = useState(agent.isFollowedByViewer);

  const shareUrl =
    typeof window === "undefined"
      ? `/agents/${agent.slug}`
      : `${window.location.origin}/agents/${agent.slug}`;

  const runNow = async () => {
    const result = await triggerRunAction(agent.id);
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
    toast.success("Run started", { description: "Watch it live in the island." });
  };

  const onFollow = async (next: boolean) => {
    setFollowing(next);
    const result = await followUser("agent", agent.id, next);
    if (!result.ok) {
      setFollowing(!next);
      toast.error("Follow failed", { description: result.error });
    }
  };

  return (
    <header className="glass-panel glass-grain rounded-2xl px-4 py-5 sm:px-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <AgentAvatar seed={agent.avatarSeed} name={agent.name} size="xl" className="rounded-2xl" />

        <div className="min-w-0 flex-1">
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
            <span aria-hidden>·</span>
            <span className="font-mono text-xs">{agent.model}</span>
            <span aria-hidden>·</span>
            {agent.chains.map((chain) => (
              <ChainBadge key={chain} chain={chain} />
            ))}
            {agent.lastRunAt ? (
              <>
                <span aria-hidden>·</span>
                <span className="text-xs">
                  ran <RelativeTime iso={agent.lastRunAt} className="text-xs" />
                </span>
              </>
            ) : null}
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

          <div className="mt-4 flex flex-wrap items-center gap-2">
            {agent.isOwner ? (
              <>
                <MorphButton
                  size="sm"
                  onAction={runNow}
                  loadingLabel="Starting…"
                  successLabel="Running"
                  errorLabel="Failed"
                  disabled={agent.status === "draft"}
                >
                  <span className="flex items-center gap-1.5">
                    <Play aria-hidden className="size-3.5" />
                    Run now
                  </span>
                </MorphButton>

                {/* Owner-only: trade the agent's book by hand. */}
                <ManualTradeSheet agent={agent} />

                <OwnerMoneyActions agent={agent} />

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

            <ShareButton size="sm" copyValue={shareUrl} label="Share this agent" actions={[]} />
          </div>
        </div>

        <div className="shrink-0 text-left sm:text-right">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">All-time PnL</p>
          <PnlText usd={agent.pnlUsd} size="lg" className="block" />
          <PnlText pct={agent.pnlPct} size="xs" className="block" />
          <p className="tnum mt-1 text-xs text-muted-foreground">
            {agent.followerCount.toLocaleString()} follower{agent.followerCount === 1 ? "" : "s"}
          </p>
        </div>
      </div>
    </header>
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
function OwnerMoneyActions({ agent }: { agent: AgentDetail }) {
  const { data: wallets = [] } = useWalletBalances(agent.id);
  const live = agent.mode === "live";

  return (
    <>
      <FundAgentDrawer
        agentId={agent.id}
        agentName={agent.name}
        wallets={wallets}
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
