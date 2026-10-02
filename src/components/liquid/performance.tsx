"use client";

import { formatUsd } from "@/components/common/format";
import { PortfolioChart, type PortfolioPoint } from "@/components/spectrumui/charts/portfolio-chart";
import { Sparkline } from "@/components/spectrumui/charts/sparkline-chart";
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

/** Ninety days of a deterministic paper book: about +10% with an 11% drawdown, a plausible sample. */
const EQUITY: PortfolioPoint[] = (() => {
  let seed = 31;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  const out: PortfolioPoint[] = [];
  let value = START_USD;
  for (let i = 0; i < 90; i += 1) {
    value *= 1 + (rand() - 0.47) * 0.07;
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
    value: 57,
    progress: 0.57,
    format: (v) => `${v.toFixed(0)}%`,
    goodWhen: "up",
  },
  {
    label: "Trades",
    value: 163,
    format: (v) => v.toFixed(0),
    caption: "4 open now",
  },
  {
    label: "Data per run",
    value: 0.31,
    format: (v) => formatUsd(v),
    goodWhen: "down",
    caption: `budget ${formatUsd(DEFAULT_DATA_BUDGET_USD)}`,
  },
];

/**
 * Price since entry, deterministic. Rescaled into 1–10 because the sparkline's
 * y axis starts at zero: raw prices near $100 would draw as a flat line. The
 * drift sets the direction, so each line's colour matches its P&L.
 */
function path(seed: number, drift: number) {
  let x = seed;
  let v = 0;
  const walk = Array.from({ length: 36 }, () => {
    x = (x * 16807) % 2147483647;
    v += (x / 2147483647 - 0.5) * 1.2 + drift;
    return v;
  });
  const lo = Math.min(...walk);
  const hi = Math.max(...walk);
  return walk.map((w, i) => ({ i, value: 1 + (9 * (w - lo)) / (hi - lo || 1) }));
}

const POSITIONS = [
  { token: "MOTH", chain: "SOL", pnl: "+$27.90", up: true, held: "3h", series: path(11, 0.35) },
  { token: "RUNE", chain: "BASE", pnl: "+$21.75", up: true, held: "52m", series: path(23, 0.25) },
  { token: "VANTA", chain: "BASE", pnl: "+$6.10", up: true, held: "18m", series: path(5, 0.15) },
  { token: "OKRA", chain: "SOL", pnl: "−$11.40", up: false, held: "1h", series: path(41, -0.25) },
];

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
            <span className="lp-pos-name">
              {p.token} <span className="lp-mono lp-pos-chain">{p.chain}</span>
            </span>
            {/* Line, not `filled`: the registry draws its Area inside a LineChart, which Recharts never renders. */}
            <Sparkline data={p.series} framed={false} glowing className="lp-pos-spark" />
            <span className={`lp-mono lp-pos-pnl ${p.up ? "lp-up" : "lp-down"}`}>{p.pnl}</span>
            <span className="lp-mono lp-pos-held">{p.held}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
