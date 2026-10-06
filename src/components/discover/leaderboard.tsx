"use client";

/**
 * Leaderboard with 7d / 30d / all-time tabs.
 *
 * Motion budget: tabs are a hot path, so the only movement is a 150ms indicator
 * slide that preserves spatial continuity. The PnL number ticker is the exception —
 * it makes the value change legible, which is the whole point of switching windows.
 */
import { useMemo, useState } from "react";
import Link from "next/link";
import { Trophy } from "lucide-react";
import { EmptyState } from "@/components/common/empty-state";
import type { LeaderboardRow, LeaderboardWindow } from "@/server/types";
import { NumberTicker } from "@/components/spectrumui/number-ticker";
import { AgentAvatar } from "@/components/common/agent-avatar";
import { ModeBadge } from "@/components/common/mode-badge";
import { ChainBadges, ModelChip } from "@/components/social-common/chain-badge";
import { Sparkline } from "@/components/social-common/sparkline";
import { pnlColor } from "@/components/social-common/pnl-text";
import { FollowToggle } from "@/components/social-common/follow-toggle";
import { formatCount, formatUsd } from "@/components/social-common/format";

const WINDOWS: Array<{ id: LeaderboardWindow; label: string }> = [
  { id: "7d", label: "7 days" },
  { id: "30d", label: "30 days" },
  { id: "all", label: "All time" },
];

export function Leaderboard({
  data,
  followedIds,
  viewerId,
}: {
  data: Record<LeaderboardWindow, LeaderboardRow[]>;
  /** Agents the viewer already follows, so each row's button starts out true. */
  followedIds: readonly string[];
  viewerId: string | null;
}) {
  const [active, setActive] = useState<LeaderboardWindow>("7d");
  const rows = data[active] ?? [];
  const index = WINDOWS.findIndex((w) => w.id === active);
  const followed = useMemo(() => new Set(followedIds), [followedIds]);

  // Roving focus per the ARIA tabs pattern: one tab stop, arrows move between windows.
  function onTabKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, i: number) {
    const last = WINDOWS.length - 1;
    const next =
      event.key === "ArrowRight"
        ? (i + 1) % WINDOWS.length
        : event.key === "ArrowLeft"
          ? (i + last) % WINDOWS.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? last
              : null;
    if (next === null) return;
    event.preventDefault();
    setActive(WINDOWS[next].id);
    event.currentTarget.parentElement
      ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
      [next]?.focus();
  }

  return (
    <section aria-labelledby="leaderboard-heading">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 id="leaderboard-heading" className="flex items-center gap-2 text-lg font-medium tracking-tight">
          <Trophy className="size-4.5 text-primary" aria-hidden />
          Leaderboard
        </h2>

        <div
          role="tablist"
          aria-label="Leaderboard window"
          className="glass-card relative inline-flex rounded-lg p-0.5"
        >
          <span
            aria-hidden
            className="absolute inset-y-0.5 left-0.5 rounded-[7px] bg-muted transition-transform duration-150 ease-[cubic-bezier(0.23,1,0.32,1)]"
            style={{ width: `calc((100% - 4px) / ${WINDOWS.length})`, transform: `translateX(${index * 100}%)` }}
          />
          {WINDOWS.map((w, i) => (
            <button
              key={w.id}
              type="button"
              role="tab"
              id={`leaderboard-tab-${w.id}`}
              aria-selected={active === w.id}
              aria-controls="leaderboard-panel"
              tabIndex={active === w.id ? 0 : -1}
              onClick={() => setActive(w.id)}
              onKeyDown={(event) => onTabKeyDown(event, i)}
              className={`relative z-10 h-7 rounded-[7px] px-3 text-xs font-medium transition-colors duration-150 focus-ring ${
                active === w.id ? "text-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {w.label}
            </button>
          ))}
        </div>
      </div>

      <div role="tabpanel" id="leaderboard-panel" aria-labelledby={`leaderboard-tab-${active}`}>
        {rows.length === 0 ? (
          <EmptyState
            className="mt-6"
            icon={<Trophy />}
            // The window in the words of its own tab ("7 days"), never the raw key ("7d").
            title={`No ranking for ${active === "all" ? "all time" : `the last ${WINDOWS[index].label}`} yet`}
            // Two equity points inside the window put an agent on the board, and they are
            // written five minutes apart; said as what a visitor can do about it.
            description="A public agent joins the board once it has been running for about ten minutes. Create one and it shows up here; it starts on paper."
            action={
              <Link
                href="/agents/new"
                className="focus-ring rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-transform duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.97]"
              >
                Create an agent
              </Link>
            }
          />
        ) : (
          <ol className="glass-panel mt-5 divide-y divide-[var(--glass-hairline)] overflow-hidden rounded-2xl">
            {rows.map((row) => (
              <Row
                key={row.agent.id}
                row={row}
                window={active}
                following={followed.has(row.agent.id)}
                own={viewerId !== null && row.agent.owner.id === viewerId}
              />
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}

/**
 * One ranking line. On a phone it is exactly that — rank, who, PnL — because ten
 * stacked pairs of call-to-action pills read as a list of buttons, not a ranking. The
 * name already links to the record, so there is no separate "Record" button at all.
 */
function Row({
  row,
  window: win,
  following,
  own,
}: {
  row: LeaderboardRow;
  window: LeaderboardWindow;
  following: boolean;
  own: boolean;
}) {
  const { agent } = row;
  const positive = row.pnlPct >= 0;
  // Sign and colour follow the printed one-decimal value, so −0.04% reads "0.0%", neutral.
  const printed = Number(Math.abs(row.pnlPct).toFixed(1));

  return (
    <li className="relative flex items-center gap-x-3 px-4 py-3 transition-colors duration-150 hover:bg-foreground/[0.04] active:bg-foreground/[0.06] sm:gap-x-4 sm:px-5 sm:py-3.5">
      <span
        className={`w-6 shrink-0 text-center font-mono text-sm tabular-nums ${
          row.rank <= 3 ? "font-semibold text-primary" : "text-muted-foreground"
        }`}
      >
        {row.rank}
      </span>

      <AgentAvatar seed={agent.avatarSeed ?? agent.slug} name={agent.name} size="sm" />

      <div className="min-w-0 flex-1">
        {/* The name's hit area is stretched over the whole row (`before:inset-0` against
            the li): on a phone the row is the obvious target, and a 148×20 name was the
            only thing in it that went anywhere. The li is not itself a link because it
            holds the handle link and the Follow button, which sit above it on `z-10`. */}
        <Link
          href={`/agents/${agent.slug}`}
          className="block truncate rounded text-sm font-medium before:absolute before:inset-0 before:content-[''] hover:text-primary focus-ring"
        >
          {agent.name}
        </Link>
        {/* Every public book is ranked on one board, so each row says whether its money
            is real — the badge sits beside the handle (not inside a link) at every width. */}
        <div className="flex min-w-0 items-center gap-1.5">
          <Link
            href={`/u/${agent.owner.handle}`}
            className="relative z-10 truncate rounded text-xs text-muted-foreground hover:text-foreground focus-ring"
          >
            @{agent.owner.handle}
          </Link>
          <ModeBadge mode={agent.mode} size="xs" />
        </div>
      </div>

      <div className="hidden shrink-0 items-center gap-1 lg:flex">
        <ChainBadges chains={agent.chains} />
        <ModelChip model={agent.model} />
      </div>

      <Sparkline
        id={`lb-${win}-${agent.id}`}
        // The window's own line, from the same baseline as its PnL: the card's month-long
        // line beside a 7-day figure could slope the other way.
        points={row.sparkline}
        pnl={row.pnlPct}
        className="hidden shrink-0 md:block"
      />

      {/* A floor on a phone: "+$930.75 paper" is wider than its 80px, and wrapping "paper"
          onto a third line made that row taller than the rest. A fixed 8rem from sm up, so
          one row's "+$1,260.90 paper" cannot push its sparkline and chips left of every
          other row's — the widest string ("+$9,999.99 paper"; $10K+ compacts) fits. */}
      <div className="min-w-20 shrink-0 text-right whitespace-nowrap sm:w-32 sm:min-w-0">
        <span
          className="font-mono text-sm font-medium tabular-nums"
          style={{ color: pnlColor(printed === 0 ? 0 : row.pnlPct) }}
        >
          <NumberTicker
            value={Math.round(printed * 10)}
            format={(v) => (v / 10).toFixed(1)}
            prefix={printed === 0 ? "" : positive ? "+" : "−"}
            suffix="%"
            startOnView={false}
            duration={0.4}
            stagger={0}
          />
        </span>
        <p className="font-mono text-[11px] tabular-nums text-muted-foreground">
          {formatUsd(row.pnlUsd, { signed: true, compact: true })}
          {agent.mode === "paper" ? " paper" : ""}
        </p>
      </div>

      <p className="hidden w-20 shrink-0 text-right font-mono text-[11px] tabular-nums text-muted-foreground sm:block">
        {formatCount(row.tradeCount)}
        {/* Counted inside the window, like the PnL beside it; saying so keeps a 6 on the
            7-day board from reading as the agent's whole record. */}
        <span className="block text-[10px] tracking-wide whitespace-nowrap uppercase">
          {win === "7d" ? "trades · 7d" : win === "30d" ? "trades · 30d" : "trades"}
        </span>
      </p>

      {/* Fixed width so the numbers stay in columns whether the pill reads Follow,
          Following or — on your own agent — nothing. */}
      <div className="relative z-10 hidden w-[6.75rem] shrink-0 justify-end sm:flex">
        {own ? null : (
          <FollowToggle
            targetType="agent"
            targetId={agent.id}
            defaultFollowing={following}
            size="sm"
            targetName={agent.name}
          />
        )}
      </div>
    </li>
  );
}
