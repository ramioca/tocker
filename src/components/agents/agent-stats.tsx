"use client";

import { StatCards, type StatCardData } from "@/components/spectrumui/charts/stat-cards";
import { formatUsd } from "@/components/common/format";
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
      format: (value) => formatUsd(value, { compact: true }),
      goodWhen: "up",
      caption: `${formatUsd(agent.stats.realizedPnlUsd)} realised · ${formatUsd(agent.stats.unrealizedPnlUsd)} open`,
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

  return <StatCards cards={cards} columns={3} />;
}
