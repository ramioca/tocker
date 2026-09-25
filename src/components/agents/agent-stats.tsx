"use client";

import { StatCards, type StatCardData } from "@/components/spectrumui/charts/stat-cards";
import { formatSignedUsd, formatUsd } from "@/components/common/format";
import { bookBasisUsd } from "./book-basis";

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
  const series = agent.equity.map((point) => point.equityUsd);
  // Never a paper number for a live book: `paperStartingUsd` outlives the flip. Before
  // its wallet has been read, a live book is worth its last live point.
  const equity = agent.equityUsd ?? (agent.mode === "live" ? (series.at(-1) ?? 0) : agent.paperStartingUsd);
  // The PnL card's own basis, so "vs start" is the same move as the card beside it.
  const start = bookBasisUsd(agent, series[0]);

  const cards: StatCardData[] = [
    {
      label: "Equity",
      value: equity,
      previous: start,
      series: series.length > 1 ? series : undefined,
      // Exact below $100K, so it reads as the same number as the /agents card and the
      // cent-exact PnL card beside it; compact only once the digits would not fit.
      format: (value) => (Math.abs(value) < 100_000 ? formatUsd(value) : formatUsd(value, { compact: true })),
      goodWhen: "up",
      deltaLabel: "vs start",
    },
    {
      label: "All-time PnL",
      value: agent.pnlUsd ?? 0,
      format: signedCompactUsd,
      goodWhen: "up",
      caption: `${formatSignedUsd(agent.stats.realizedPnlUsd)} realized · ${formatSignedUsd(agent.stats.unrealizedPnlUsd)} open`,
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

  // Each card is a labelled image ("All-time PnL: +$1.9K"), which reads its number but
  // not the line under it. The captions carry the split and the context, so they are
  // said here once more, from the same values.
  const captions = cards.flatMap((card) =>
    card.caption ? [`${card.label}: ${card.caption.replace(/ · /g, ", ")}`] : [],
  );

  return (
    <>
      <StatCards
        cards={cards}
        columns={3}
        // The registry card clips its caption to one nowrap line, which cut captions off
        // at 390; phones let them wrap. The sparkline takes what the exact equity leaves
        // rather than a fixed 44%, which ran "$10,749.80" into it in the three-across
        // grid. The last rule gives the sparkline's own focus state our ring colour.
        className="max-sm:[&_p.whitespace-nowrap]:!h-auto max-sm:[&_p.whitespace-nowrap]:!whitespace-normal max-sm:[&_p.whitespace-nowrap]:!leading-snug [&_.cursor-crosshair]:!w-auto [&_.cursor-crosshair]:!min-w-16 [&_.cursor-crosshair]:!flex-1 [&_.cursor-crosshair:focus-visible]:!ring-ring"
      />
      <ul className="sr-only">
        {captions.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </>
  );
}
