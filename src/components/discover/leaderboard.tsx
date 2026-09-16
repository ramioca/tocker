"use client";

/**
 * Leaderboard with 7d / 30d / all-time tabs.
 *
 * Motion budget: tabs are a hot path, so the only movement is a 150ms indicator
 * slide that preserves spatial continuity. The PnL number ticker is the exception —
 * it makes the value change legible, which is the whole point of switching windows.
 */
import { useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Trophy } from "lucide-react";
import { EmptyState } from "@/components/common/empty-state";
import type { LeaderboardRow, LeaderboardWindow } from "@/server/types";
import { NumberTicker } from "@/components/spectrumui/number-ticker";
import { AgentAvatar } from "@/components/social-common/agent-avatar";
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

export function Leaderboard({ data }: { data: Record<LeaderboardWindow, LeaderboardRow[]> }) {
  const [active, setActive] = useState<LeaderboardWindow>("7d");
  const rows = data[active] ?? [];
  const index = WINDOWS.findIndex((w) => w.id === active);

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
          className="glass relative inline-flex rounded-lg p-0.5"
        >
          <span
            aria-hidden
            className="absolute inset-y-0.5 left-0.5 rounded-[7px] bg-muted transition-transform duration-150 ease-[cubic-bezier(0.23,1,0.32,1)]"
            style={{ width: `calc((100% - 4px) / ${WINDOWS.length})`, transform: `translateX(${index * 100}%)` }}
          />
          {WINDOWS.map((w) => (
            <button
              key={w.id}
              type="button"
              role="tab"
              aria-selected={active === w.id}
              onClick={() => setActive(w.id)}
              className={`relative z-10 h-7 rounded-[7px] px-3 text-xs font-medium transition-colors duration-150 focus-ring ${
                active === w.id ? "text-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {w.label}
            </button>
          ))}
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          className="mt-6"
          icon={<Trophy />}
          title={`No ranking for ${active === "all" ? "all time" : `the last ${active}`} yet`}
          description="A place on the board needs two equity snapshots inside the window. Run an agent — or give one a schedule — and it appears on the next pass."
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
            <Row key={row.agent.id} row={row} window={active} />
          ))}
        </ol>
      )}
    </section>
  );
}

function Row({ row, window: win }: { row: LeaderboardRow; window: LeaderboardWindow }) {
  const { agent } = row;
  const positive = row.pnlPct >= 0;

  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3.5 transition-colors duration-150 hover:bg-foreground/[0.04] sm:flex-nowrap sm:px-5">
      <span
        className={`w-6 shrink-0 text-center font-mono text-sm tabular-nums ${
          row.rank <= 3 ? "font-semibold text-primary" : "text-muted-foreground"
        }`}
      >
        {row.rank}
      </span>

      <AgentAvatar seed={agent.avatarSeed ?? agent.slug} label={agent.name} size="sm" />

      <div className="min-w-0 flex-1 basis-40">
        <Link
          href={`/agents/${agent.slug}`}
          className="block truncate rounded text-sm font-medium hover:text-primary focus-ring"
        >
          {agent.name}
        </Link>
        <Link
          href={`/u/${agent.owner.handle}`}
          className="block truncate rounded text-xs text-muted-foreground hover:text-foreground focus-ring"
        >
          @{agent.owner.handle}
        </Link>
      </div>

      <div className="hidden shrink-0 items-center gap-1 lg:flex">
        <ChainBadges chains={agent.chains} />
        <ModelChip model={agent.model} />
      </div>

      <Sparkline
        id={`lb-${win}-${agent.id}`}
        points={agent.sparkline}
        pnl={row.pnlPct}
        className="hidden shrink-0 md:block"
      />

      <div className="w-24 shrink-0 text-right">
        <span
          className="font-mono text-sm font-medium tabular-nums"
          style={{ color: pnlColor(row.pnlPct) }}
        >
          <NumberTicker
            value={Math.round(Math.abs(row.pnlPct) * 10)}
            format={(v) => (v / 10).toFixed(1)}
            prefix={positive ? "+" : "−"}
            suffix="%"
            startOnView={false}
            duration={0.4}
            stagger={0}
          />
        </span>
        <p className="font-mono text-[11px] tabular-nums text-muted-foreground">
          {formatUsd(row.pnlUsd, { signed: true, compact: true })}
        </p>
      </div>

      <p className="hidden w-16 shrink-0 text-right font-mono text-[11px] tabular-nums text-muted-foreground sm:block">
        {formatCount(row.tradeCount)}
        <span className="block text-[10px] tracking-wide uppercase">trades</span>
      </p>

      <div className="ml-auto flex shrink-0 items-center gap-2 sm:ml-0">
        <FollowToggle targetType="agent" targetId={agent.id} defaultFollowing={false} size="sm" />
        <Link
          href={`/agents/${agent.slug}`}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-xs transition-[background-color,transform] duration-150 hover:bg-muted active:scale-[0.97] focus-ring"
        >
          <ArrowUpRight className="size-3.5" aria-hidden />
          Record
        </Link>
      </div>
    </li>
  );
}
