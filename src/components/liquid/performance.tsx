import type { CSSProperties } from "react";
import type { PortfolioPoint } from "@/components/spectrumui/charts/portfolio-chart";
import { TokenIcon } from "@/components/common/token-icon";
import { COINS, type CoinName } from "./coins";
import { PerformanceChart } from "./performance-chart";
import { InView } from "./sec-in-view";
import { Ticker } from "./sec-ticker";
import { DEFAULT_DATA_BUDGET_USD, usd2 } from "./signals-data";

/**
 * A sample paper book as its owner sees it: Spectrum's PortfolioChart for
 * equity, the open positions, and what a run spends on data, in one frame.
 * Made-up figures, labelled as a sample; nothing in it is live. The book is
 * deliberately unnamed: it is not the hero's agent.
 *
 * A server component: the series and sparklines are computed here once, and
 * only the chart (performance-chart.tsx), the token logos and two small motion
 * leaves hydrate: the figures count up once (sec-ticker.tsx) and the sparklines
 * and meter draw in once (sec-in-view.tsx), each from a server-rendered final
 * state that is what paints without script or with reduced motion.
 */

const DAY = 86_400_000;
const END = Date.UTC(2026, 8, 30);
/** `agents.paperStartingUsd` defaults to $10,000. */
const START_USD = 10_000;

/** Ninety days of a deterministic paper book: about +9.7% with a 6% drawdown. */
const EQUITY: PortfolioPoint[] = (() => {
  let seed = 789;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  const out: PortfolioPoint[] = [];
  let value = START_USD;
  for (let i = 0; i < 90; i += 1) {
    value *= 1 + (rand() - 0.5) * 0.03 + 0.0011;
    out.push({ t: END - (89 - i) * DAY, value: Math.round(value * 100) / 100, basis: START_USD });
  }
  return out;
})();

/** The book's return over the window and its worst peak-to-trough fall, in percent. */
const RETURN_PCT = ((EQUITY[EQUITY.length - 1]!.value - START_USD) / START_USD) * 100;
const MAX_DRAWDOWN_PCT = (() => {
  let peak = START_USD;
  let worst = 0;
  for (const p of EQUITY) {
    peak = Math.max(peak, p.value);
    worst = Math.max(worst, (peak - p.value) / peak);
  }
  return worst * 100;
})();

const TRADES = 163;
const WIN_RATE = 57;
/** Average paid-data spend per run on this book, against the default budget. */
const DATA_PER_RUN_USD = 0.14;

/** Price since entry as a static SVG path (0–100 × 0–32), deterministic. */
function sparkPath(seed: number, drift: number) {
  let x = seed;
  let v = 0;
  const walk = Array.from({ length: 36 }, () => {
    x = (x * 16807) % 2147483647;
    v += (x / 2147483647 - 0.5) * 1.2 + drift;
    return v;
  });
  const lo = Math.min(...walk);
  const hi = Math.max(...walk);
  const pts = walk.map((w, i) => [(i / (walk.length - 1)) * 100, 29 - (26 * (w - lo)) / (hi - lo || 1)] as const);
  const line = pts.map(([px, py], i) => `${i ? "L" : "M"}${px.toFixed(2)},${py.toFixed(2)}`).join("");
  return { line, area: `${line}L100,32L0,32Z` };
}

type Position = {
  token: CoinName;
  chain: "Base" | "Solana";
  /** Unrealised P&L, dollars. */
  pnlUsd: number;
  heldMin: number;
  spark: ReturnType<typeof sparkPath>;
};

const POSITIONS: Position[] = [
  { token: "TIBBIR", chain: "Base", pnlUsd: 27.9, heldMin: 180, spark: sparkPath(11, 0.35) },
  { token: "SUPER INU", chain: "Solana", pnlUsd: 21.75, heldMin: 52, spark: sparkPath(23, 0.25) },
  { token: "SOL", chain: "Solana", pnlUsd: -11.4, heldMin: 60, spark: sparkPath(41, -0.25) },
];

/** What each row prints, and says, from the one number. */
const show = (p: Position) => {
  const hours = p.heldMin / 60;
  const whole = p.heldMin % 60 === 0;
  return {
    up: p.pnlUsd >= 0,
    pnl: `${p.pnlUsd >= 0 ? "+" : "\u2212"}${usd2(Math.abs(p.pnlUsd))}`,
    said: `${p.pnlUsd >= 0 ? "up" : "down"} ${usd2(Math.abs(p.pnlUsd))}`,
    held: whole ? `${hours}h` : `${p.heldMin}m`,
    heldWords: whole ? `${hours} hour${hours === 1 ? "" : "s"}` : `${p.heldMin} minutes`,
  };
};

const POSITIONS_LABEL = `Open positions, sample: ${POSITIONS.map((p) => {
  const v = show(p);
  return `${p.token} on ${p.chain}, ${v.said}, held ${v.heldWords}`;
}).join("; ")}.`;

export function PerformancePanel() {
  return (
    <div className="lp-perf lp-frame" role="group" aria-label="Sample book">
      <div className="lp-perf-bar lp-label">
        <span>Sample book · paper · 90 days</span>
        <span className="lp-perf-bar-stats">Illustrative figures</span>
      </div>

      <dl className="lp-perf-kpis" aria-label="Sample book, 90 days">
        <div className="lp-perf-kpi">
          <dt className="lp-label">Return</dt>
          <dd className="lp-mono lp-up">
            <Ticker value={RETURN_PCT} decimals={1} suffix="%" signed />
          </dd>
        </div>
        <div className="lp-perf-kpi">
          <dt className="lp-label">Max drawdown</dt>
          <dd className="lp-mono">
            <Ticker value={MAX_DRAWDOWN_PCT} decimals={1} suffix="%" />
          </dd>
        </div>
        <div className="lp-perf-kpi">
          <dt className="lp-label">Trades</dt>
          <dd className="lp-mono">
            <Ticker value={TRADES} />
          </dd>
        </div>
        <div className="lp-perf-kpi">
          <dt className="lp-label">Won</dt>
          <dd className="lp-mono">
            <Ticker value={WIN_RATE} suffix="%" />
          </dd>
        </div>
      </dl>

      <InView className="lp-perf-grid">
        <div className="lp-perf-chart">
          <PerformanceChart
            data={EQUITY}
            label="Equity"
            ranges={[
              { label: "7D", bars: 7 },
              { label: "30D", bars: 30 },
              { label: "90D", bars: null },
            ]}
            defaultRange="90D"
            height={260}
            showDrawdown={false}
            tableMaxRows={15}
          />
        </div>

        <div className="lp-perf-side">
          <div className="lp-perf-pos">
            <p className="lp-perf-label lp-label">
              Open positions <span className="lp-perf-count">{POSITIONS.length}</span>
            </p>
            {/* The rows are a picture of the list; the label carries every figure in it. */}
            <div role="img" aria-label={POSITIONS_LABEL}>
              <div className="lp-perf-rows" inert>
                {POSITIONS.map((p, i) => {
                  const v = show(p);
                  return (
                  <div key={p.token} className="lp-pos" style={{ "--i": i } as CSSProperties}>
                    <TokenIcon token={COINS[p.token]} size="md" className="lp-pos-logo" />
                    <span className="lp-pos-id">
                      <span className="lp-pos-name">{p.token}</span>
                      <span className="lp-mono lp-pos-sub">
                        {p.chain} · {v.held}
                      </span>
                    </span>
                    <svg
                      className={`lp-pos-spark ${v.up ? "lp-up" : "lp-down"}`}
                      viewBox="0 0 100 32"
                      preserveAspectRatio="none"
                      aria-hidden
                    >
                      <path className="lp-pos-spark-area" d={p.spark.area} fill="currentColor" opacity="0.08" />
                      <path
                        className="lp-pos-spark-line"
                        pathLength={1}
                        d={p.spark.line}
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.7"
                        strokeLinejoin="round"
                        strokeLinecap="round"
                      />
                    </svg>
                    <span className={`lp-mono lp-pos-pnl ${v.up ? "lp-up" : "lp-down"}`}>{v.pnl}</span>
                  </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="lp-perf-data">
            <p className="lp-perf-label lp-label">Data per run</p>
            <p className="lp-perf-data-value lp-mono">
              <Ticker value={DATA_PER_RUN_USD} decimals={2} prefix="$" />{" "}
              <span className="lp-perf-data-meta">avg · {usd2(DEFAULT_DATA_BUDGET_USD)} budget</span>
            </p>
            <div className="lp-perf-meter" aria-hidden>
              <span style={{ width: `${(DATA_PER_RUN_USD / DEFAULT_DATA_BUDGET_USD) * 100}%` }} />
            </div>
          </div>
        </div>
      </InView>
    </div>
  );
}
