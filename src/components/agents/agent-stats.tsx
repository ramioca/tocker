"use client";

import { StatCards, type StatCardData } from "@/components/spectrumui/charts/stat-cards";
import { formatSignedUsd, formatUsd } from "@/components/common/format";

/** Signed and compact, like the header's PnL: "+$1.9K", "−$341.02". */
function signedCompactUsd(value: number): string {
  const amount = formatUsd(Math.abs(value), { compact: true });
  return value > 0 ? `+${amount}` : value < 0 ? `−${amount}` : amount;
}
import type { AgentDetail } from "@/server/types";

/**
 * Six numbers, in the order an owner asks them: what is it worth, is it up, does
 * it win, how often does it act, how often does it think, and what is the data
 * habit costing.
 *
 * Six rather than five because the grid is three across: five cards leave a hole
 * in the second row, and a hole reads as a missing card rather than a choice.
 */
export function AgentStats({ agent }: { agent: AgentDetail }) {
  const equity = agent.equityUsd ?? agent.paperStartingUsd;
  const series = agent.equity.map((point) => point.equityUsd);
  // Paper starts at its starting balance; a live book starts at its first live point,
  // and until there is one it starts at what it holds now — never at a paper number.
  const start = agent.mode === "live" ? (series[0] ?? equity) : agent.paperStartingUsd;

  const cards: StatCardData[] = [
    {
      label: "Equity",
      value: equity,
      previous: start,
      series: series.length > 1 ? series : undefined,
      format: (value) => formatUsd(value, { compact: true }),
      goodWhen: "up",
      deltaLabel: "vs start",
    },
    {
      label: "All-time PnL",
      value: agent.pnlUsd ?? 0,
      format: signedCompactUsd,
      goodWhen: "up",
      caption: `${formatSignedUsd(agent.stats.realizedPnlUsd)} realised · ${formatSignedUsd(agent.stats.unrealizedPnlUsd)} open`,
    },
    {
      label: "Win rate",
      value: (agent.stats.winRate ?? 0) * 100,
      progress: agent.stats.winRate ?? 0,
      format: (value) => `${value.toFixed(0)}%`,
      goodWhen: "up",
      caption: agent.stats.winRate === null ? "No closed trades yet" : undefined,
    },
    {
      label: "Trades",
      value: agent.tradeCount,
      format: (value) => value.toFixed(0),
      goodWhen: "up",
      caption: `${agent.positions.length} open now`,
    },
    {
      label: "Runs",
      value: agent.stats.runCount,
      format: (value) => value.toFixed(0),
      caption:
        agent.stats.runCount === 0
          ? "Never run"
          : `${(agent.tradeCount / Math.max(1, agent.stats.runCount)).toFixed(1)} trades per run`,
    },
    {
      label: "Data spend",
      value: agent.stats.dataSpendUsd,
      format: (value) => formatUsd(value),
      goodWhen: "down",
      caption: "lifetime x402",
    },
  ];

  return (
    <StatCards
      cards={cards}
      columns={3}
      // The registry card clips its caption to one nowrap line, which cut captions off
      // at 390; phones let them wrap. The last rule gives the sparkline's own focus
      // state our ring colour.
      className="max-sm:[&_p.whitespace-nowrap]:!h-auto max-sm:[&_p.whitespace-nowrap]:!whitespace-normal max-sm:[&_p.whitespace-nowrap]:!leading-snug [&_.cursor-crosshair:focus-visible]:!ring-ring"
    />
  );
}
