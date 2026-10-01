"use client";

import { formatUsd } from "@/components/common/format";
import { PortfolioChart, type PortfolioPoint } from "@/components/spectrumui/charts/portfolio-chart";
import { StatCards, type StatCardData } from "@/components/spectrumui/charts/stat-cards";
import { DEFAULT_DATA_BUDGET_USD } from "./signals-data";

/**
 * The owner's view of a sample agent, drawn with the same Spectrum pieces the
 * app's agent page uses (StatCards, PortfolioChart), on made-up data and
 * labelled as a sample. Nothing in it is live. Other visitors would see only
 * the public trade feed: the strategy never leaves the owner's screen.
 */

const DAY = 86_400_000;
const END = Date.UTC(2026, 8, 30);
const START_USD = 10_000;

/** Ninety days of a hand-tuned, deterministic paper book that ends near $12.5K. */
const EQUITY: PortfolioPoint[] = (() => {
  let seed = 7;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  const out: PortfolioPoint[] = [];
  let value = START_USD;
  for (let i = 0; i < 90; i += 1) {
    value *= 1 + (rand() - 0.43) * 0.024;
    out.push({ t: END - (89 - i) * DAY, value: Math.round(value * 100) / 100, basis: START_USD });
  }
  return out;
})();
const LAST = EQUITY[EQUITY.length - 1].value;

const CARDS: StatCardData[] = [
  {
    label: "Equity",
    value: LAST,
    previous: START_USD,
    series: EQUITY.map((p) => p.value),
    format: (v) => formatUsd(v),
    goodWhen: "up",
    deltaLabel: "vs start",
  },
  {
    label: "Win rate",
    value: 61,
    progress: 0.61,
    format: (v) => `${v.toFixed(0)}%`,
    goodWhen: "up",
  },
  {
    label: "Trades",
    value: 214,
    format: (v) => v.toFixed(0),
    caption: "4 open now",
  },
  {
    label: "Data per run",
    value: 0.84,
    format: (v) => formatUsd(v),
    goodWhen: "down",
    caption: `budget ${formatUsd(DEFAULT_DATA_BUDGET_USD)}`,
  },
];

const POSITIONS = [
  { token: "MOTH", chain: "SOL", pnl: "+$38.20", pct: 38, up: true, held: "3h" },
  { token: "RUNE", chain: "BASE", pnl: "+$21.75", pct: 22, up: true, held: "52m" },
  { token: "VANTA", chain: "BASE", pnl: "+$6.10", pct: 6, up: true, held: "18m" },
  { token: "OKRA", chain: "SOL", pnl: "−$11.40", pct: 11, up: false, held: "1h" },
] as const;

export function PerformancePanel() {
  return (
    <div className="lp-app" aria-label="Sample agent dashboard" role="group">
      <div className="lp-app-bar" aria-hidden>
        <span className="lp-app-url">
          <span className="lp-app-dot" />
          tocker.xyz/agents/fresh-launch-hunter
        </span>
        <span className="lp-mono lp-app-chip">sample · paper</span>
      </div>

      <div className="lp-app-stats-spectrum">
        {/* The same overrides the app's agent page uses: the sparkline takes what the
            value leaves instead of a fixed width, and captions may wrap on phones. */}
        <StatCards
          cards={CARDS}
          columns={4}
          className="max-sm:[&_p.whitespace-nowrap]:!h-auto max-sm:[&_p.whitespace-nowrap]:!whitespace-normal max-sm:[&_p.whitespace-nowrap]:!leading-snug [&_.cursor-crosshair]:!w-auto [&_.cursor-crosshair]:!min-w-16 [&_.cursor-crosshair]:!flex-1"
        />
      </div>

      <div className="lp-app-chart">
        <PortfolioChart
          data={EQUITY}
          label="Equity · sample agent"
          ranges={[
            { label: "7D", bars: 7 },
            { label: "30D", bars: 30 },
            { label: "90D", bars: null },
          ]}
          defaultRange="90D"
          height={300}
          showDrawdown
        />
      </div>

      <div className="lp-app-card" aria-label="Open positions, sample" role="img">
        <div className="lp-app-card-head" aria-hidden>
          <span>Open positions</span>
        </div>
        {POSITIONS.map((p) => (
          <div key={p.token} className="lp-pos" aria-hidden>
            <div className="lp-pos-top">
              <span>
                {p.token} <span className="lp-mono lp-pos-chain">{p.chain}</span>
              </span>
              <span className={`lp-mono ${p.up ? "lp-up" : "lp-down"}`}>{p.pnl}</span>
              <span className="lp-mono lp-pos-held">{p.held}</span>
            </div>
            <span className="lp-pos-track">
              <span className={p.up ? "lp-pos-fill" : "lp-pos-fill lp-pos-fill-neg"} style={{ transform: `scaleX(${p.pct / 40})` }} />
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
