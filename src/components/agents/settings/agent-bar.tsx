"use client";

import Link from "next/link";
import { ArrowDownToLine, ChevronLeft, CircleAlert, Loader2, Pause, Play, Zap } from "lucide-react";
import { AgentAvatar } from "@/components/common/agent-avatar";
import { formatRelative, formatUsd } from "@/components/common/format";
import { ModeBadge } from "@/components/common/mode-badge";
import { StatusBadge } from "@/components/common/status-badge";
import { intervalLabel } from "@/components/agents/agent-config-summary";
import { EASE, FOCUS, HAIR, TYPE } from "@/components/agents/builder/look";
import { useCoarseNow } from "@/hooks/use-now";
import { thinkSource } from "@/lib/agent/inference";
import { cn } from "@/lib/utils";
import type { AgentConfig } from "@/db/schema";
import type { AgentDetail, WalletBalance } from "@/server/types";
import { FundAgentDrawer } from "./fund-agent-drawer";
import { useWalletBalances } from "./wallets-card";

/** An agent's USDC across the chains it trades on. */
export interface AgentCash {
  wallets: WalletBalance[];
  usdc: number;
  /** A wallet could not be read just now, so `usdc` counts a zero that means "unknown". */
  unread: boolean;
}

/**
 * The balance the bar shows. The same query the Wallets card and the Withdraw form read,
 * hydrated from the server on first paint, so no two figures on the page can disagree.
 */
export function useAgentCash(agent: Pick<AgentDetail, "id" | "chains">, initialBalances?: WalletBalance[]): AgentCash {
  const { data: wallets = [] } = useWalletBalances(agent.id, initialBalances);
  const mine = wallets.filter((wallet) => agent.chains.includes(wallet.chain));
  return {
    wallets,
    usdc: mine
      .flatMap((wallet) => wallet.balances)
      .filter((balance) => balance.asset === "usdc")
      .reduce((sum, balance) => sum + balance.amount, 0),
    unread: mine.some((wallet) => wallet.readFailed),
  };
}

/** That balance in words: "$20.00 USDC", or that it could not be read. Never "$0.00" for a wallet nobody could read. */
export function cashText(cash: Pick<AgentCash, "usdc" | "unread">): string {
  return cash.unread ? "Balance unavailable" : `${formatUsd(cash.usdc)} USDC`;
}

/**
 * The same balance for a line with no label beside it to say whose money it is, as on the
 * agent card: "$20.00 USDC in its wallets".
 */
export function cashInWalletsText(cash: Pick<AgentCash, "usdc" | "unread">): string {
  return cash.unread ? cashText(cash) : `${cashText(cash)} in its wallets`;
}

/**
 * One size for the bar's four actions. 44px where a finger presses: at a phone's width,
 * where they share one row in four equal cells, and on any touch screen.
 */
const ACTION = cn(
  "inline-flex h-9 min-w-0 items-center justify-center gap-1.5 rounded-lg border px-1.5 text-[13px] font-medium whitespace-nowrap",
  "max-sm:h-11 sm:px-3 pointer-coarse:h-11",
  "transition-[background-color,scale] duration-150 active:scale-[0.97] motion-reduce:active:scale-100",
  EASE,
  FOCUS,
);
const PLAIN = "border-border hover:bg-muted";
const TINTED = "border-primary/40 bg-primary/10 text-primary hover:bg-primary/15";
/** Under 360px of bar the icons go, so four labels still fit one row. */
const ACTION_ICON = "size-3.5 shrink-0 @max-[360px]:hidden";

/** A link inside the status sentence keeps its drawn size and grows an invisible 44px band on touch. */
const INLINE_ACTION = cn(
  "relative rounded font-medium underline underline-offset-2 transition-colors duration-150 hover:text-foreground",
  "pointer-coarse:after:absolute pointer-coarse:after:-inset-x-2 pointer-coarse:after:-inset-y-3.5",
  FOCUS,
);

/**
 * Money and status, above the steps.
 *
 * Neither is a step. Both apply at once, they are the reason most visits to this page
 * happen, and a "Resume" or "Add funds" link from the agent page has to land on a button
 * that is already on screen. So they sit in one bar that is on every step: who the agent
 * is and how it stands on the left, its balance and the four things done to it on the
 * right.
 *
 * Everything here reads the agent as it is saved, never the edits in progress: the
 * sentence says what the next tick will do, and that is decided by what is saved.
 *
 * The bar does not change the status itself. It asks (`onToggleStatus`) and is told while
 * the answer is on its way (`statusPending`). The two places it sends the owner inside
 * the page are callbacks too, so nothing here is a link that would reload it.
 */
export function AgentBar({
  agent,
  config,
  initialBalances,
  accountPaused,
  skippingLine = null,
  isAdmin = false,
  statusPending,
  onToggleStatus,
  onWithdraw,
  onChooseKey,
}: {
  agent: AgentDetail;
  /** The config as last saved. */
  config: AgentConfig;
  initialBalances: WalletBalance[];
  /** Trading is paused account-wide (Security → Pause all trading). */
  accountPaused: boolean;
  /**
   * Set while the saved agent's scheduled runs are being skipped for want of room to buy:
   * the sentence that says so, from the server (`getSkippingRunsLine`).
   */
  skippingLine?: string | null;
  /** Shows operator-only notes in the Fund sheet. */
  isAdmin?: boolean;
  /** A status change is on its way: the button spins and takes no second press. */
  statusPending: boolean;
  /** Pause an active agent; resume or activate any other. */
  onToggleStatus: () => void;
  /** Show the Withdraw form. */
  onWithdraw: () => void;
  /** Show where the key is chosen, with focus on it. */
  onChooseKey: () => void;
}) {
  const cash = useAgentCash(agent, initialBalances);
  const live = agent.mode === "live";
  // A wallet that could not be read may still hold money, so Withdraw stays reachable.
  const canWithdraw = cash.usdc > 0 || cash.unread;

  const toggle =
    agent.status === "active"
      ? { label: "Pause", Icon: Pause }
      : // A draft has never run, so there is nothing to resume.
        { label: agent.status === "draft" ? "Activate" : "Resume", Icon: Play };

  return (
    <header
      className={cn(
        "@container flex flex-col gap-3 border-b pb-3 lg:flex-row lg:flex-wrap lg:items-center lg:gap-x-6",
        HAIR,
      )}
    >
      {/* Back, picture, name and badges on one line, the sentence under the name. On a
          phone the sentence takes the full width of a line of its own. */}
      <div className="grid min-w-0 grid-cols-[auto_auto_minmax(0,1fr)] items-center gap-x-2.5 gap-y-1.5 sm:gap-y-0 lg:flex-1 lg:basis-72">
        <Link
          href={`/agents/${agent.slug}`}
          aria-label={`Back to ${agent.name}`}
          className={cn(
            "-ml-2 grid size-9 place-items-center rounded-lg text-muted-foreground max-sm:size-11 sm:row-span-2 pointer-coarse:size-11",
            "transition-[color,background-color,scale] duration-150 hover:bg-muted hover:text-foreground active:scale-[0.97] motion-reduce:active:scale-100",
            EASE,
            FOCUS,
          )}
        >
          <ChevronLeft aria-hidden className="size-4" />
        </Link>
        <AgentAvatar seed={agent.avatarSeed} name={agent.name} size="sm" className="sm:row-span-2" />
        <div className="flex min-w-0 items-center gap-2">
          {/* The page's one h1. The step's title below is the large line. `relative`, so the
              hidden word is cut off with the name: it sits where a long name would have
              ended, and left to the page it made a phone scroll sideways. */}
          <h1 className={cn(TYPE.heading, "relative truncate")}>
            {agent.name}
            <span className="sr-only"> settings</span>
          </h1>
          <ModeBadge mode={agent.mode} className="shrink-0" />
          {/* Short: the sentence below says the pause is account-wide. */}
          <StatusBadge status={agent.status} accountPaused={accountPaused} short />
        </div>
        <StatusLine
          agent={agent}
          config={config}
          accountPaused={accountPaused}
          skippingLine={skippingLine}
          onChooseKey={onChooseKey}
          className="col-span-full sm:col-span-1 sm:col-start-3"
        />
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4 lg:shrink-0">
        <p className="tnum font-mono text-sm leading-5 whitespace-nowrap">
          <span className="sr-only">In its wallets: </span>
          {cash.unread ? (
            // A wallet that could not be read is not an empty one: no "$0.00" over it.
            <>
              <span aria-hidden className="text-muted-foreground">
                —
              </span>{" "}
              <span className="font-sans text-xs text-muted-foreground">Balance unavailable</span>
            </>
          ) : (
            <>
              <span className="font-medium">{formatUsd(cash.usdc)}</span>{" "}
              <span className="text-muted-foreground">USDC</span>
            </>
          )}
        </p>

        <div className="grid grid-cols-4 gap-1.5 sm:flex sm:gap-2">
          <FundAgentDrawer
            agentId={agent.id}
            agentName={agent.name}
            wallets={cash.wallets}
            isAdmin={isAdmin}
            trigger={
              <button type="button" className={cn(ACTION, TINTED)}>
                <ArrowDownToLine aria-hidden className={ACTION_ICON} />
                Fund
              </button>
            }
          />

          {/* The same words as the agent page's header. */}
          <Link href={`/agents/${agent.slug}/live`} className={cn(ACTION, live ? PLAIN : TINTED)}>
            <Zap aria-hidden className={ACTION_ICON} />
            {live ? "Live tick" : "Go live"}
          </Link>

          {/* With nothing to take it is a disabled button, not a dead link: out of the Tab
              order, and said as dimmed. */}
          <button
            type="button"
            disabled={!canWithdraw}
            onClick={onWithdraw}
            className={cn(ACTION, PLAIN, "disabled:pointer-events-none disabled:opacity-40")}
          >
            Withdraw
          </button>

          {/* Never disabled, a draft's included: a link that says "Activate" or "Resume"
              puts the focus here, and a disabled button cannot take it. */}
          <button
            type="button"
            id="agent-status-toggle"
            aria-busy={statusPending || undefined}
            onClick={() => {
              if (!statusPending) onToggleStatus();
            }}
            className={cn(ACTION, PLAIN)}
          >
            {statusPending ? (
              <Loader2 aria-hidden className="size-3.5 shrink-0 motion-safe:animate-spin" />
            ) : (
              <toggle.Icon aria-hidden className={ACTION_ICON} />
            )}
            {toggle.label}
          </button>
        </div>
      </div>
    </header>
  );
}

/**
 * How the agent stands, in one sentence, from what is saved: this is what the next tick
 * runs with. A green Active over a schedule reads as healthy, so an agent that fails
 * every tick for want of a key says so here, with the way to fix it.
 */
function StatusLine({
  agent,
  config,
  accountPaused,
  skippingLine,
  onChooseKey,
  className,
}: {
  agent: AgentDetail;
  config: AgentConfig;
  accountPaused: boolean;
  skippingLine: string | null;
  onChooseKey: () => void;
  className?: string;
}) {
  const line = cn(TYPE.caption, "text-pretty text-muted-foreground", className);

  if (agent.status === "draft") {
    return <p className={line}>Never started. Activate it to put it on its schedule.</p>;
  }
  if (agent.status !== "active") {
    // Not "Paused" under a badge that reads "Error": that agent was stopped by a run, not by its owner.
    return <p className={line}>{agent.status === "paused" ? "Paused" : "Stopped"}. It keeps its positions and history.</p>;
  }
  if (accountPaused) {
    return (
      <p className={line}>
        Paused account-wide.{" "}
        <Link href="/settings/security#kill-switch" className={INLINE_ACTION}>
          Resume trading
        </Link>{" "}
        in Security.
      </p>
    );
  }
  if (agent.llmKeyId === null && thinkSource(config) === "key") {
    return (
      // The icon as well as the colour: red alone does not say "broken" to everyone.
      <p className={cn(line, "text-destructive")}>
        <CircleAlert aria-hidden className="mr-1 inline size-3.5 align-[-2.5px]" />
        Every tick fails: no API key attached.{" "}
        <button type="button" onClick={onChooseKey} className={INLINE_ACTION}>
          Choose a key
        </button>
      </p>
    );
  }
  const minutes = config.schedule.intervalMinutes;
  // On a schedule, and its runs are being skipped because it has no room to buy: "next
  // tick scheduled" would be true and would still mislead. The sentence is the server's.
  if (skippingLine && minutes !== 0) return <p className={line}>{skippingLine}</p>;
  // Set to skip a run with no room to buy, and not skipping right now. Its last run can
  // then be far older than its interval (a skipped slot leaves no run behind), and "next
  // tick scheduled" under "ran 2 days ago" gives no reason and no time. So the line says
  // that runs can be skipped, and when the agent is next looked at.
  if (minutes !== 0 && config.schedule.skipWhenFull === true && agent.nextRunAt) {
    return (
      <p className={line}>
        Runs {intervalLabel(minutes).toLowerCase()} · skips a run with no room to buy · next look{" "}
        <NextLook iso={agent.nextRunAt} />
      </p>
    );
  }
  return (
    <p className={line}>
      {minutes === 0
        ? "Manual runs only"
        : `Runs ${intervalLabel(minutes).toLowerCase()} · next tick ${agent.nextRunAt ? "scheduled" : "unscheduled"}`}
    </p>
  );
}

/**
 * When a scheduled agent is next looked at: "in 23 hr.", or "now" once its time has come
 * and it is waiting for the next pass. On the page's shared half-minute clock, and
 * relative, so the server and the reader's browser need not agree on a time zone.
 */
function NextLook({ iso }: { iso: string }) {
  const now = useCoarseNow();
  const due = new Date(iso).getTime() - now < 45_000;
  return (
    <time dateTime={iso} suppressHydrationWarning>
      {due ? "now" : formatRelative(iso, now)}
    </time>
  );
}
