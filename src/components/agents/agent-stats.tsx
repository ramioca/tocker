"use client";

import { StatCards, type StatCardData } from "@/components/spectrumui/charts/stat-cards";
import { formatUsd } from "@/components/common/format";
import type { AgentDetail } from "@/server/types";

/**
 * Five numbers, in the order an owner asks them: what is it worth, is it up,
 * does it win, how often does it act, and what is the data habit costing.
 */
export function AgentStats({ agent }: { agent: AgentDetail }) {
  const equity = agent.equityUsd ?? agent.paperStartingUsd;
  const series = agent.equity.map((point) => point.equityUsd);

  const cards: StatCardData[] = [
    {
      label: "Equity",
      value: equity,
      previous: agent.paperStartingUsd,
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
      caption: `${agent.stats.runCount} runs`,
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
