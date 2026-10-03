import { PortfolioChart, type PortfolioPoint } from "@/components/spectrumui/charts/portfolio-chart";
import { TokenIcon } from "@/components/common/token-icon";
import { COINS, type CoinName } from "./coins";
import { DEFAULT_DATA_BUDGET_USD } from "./signals-data";

/**
 * A sample paper book as its owner sees it: Spectrum's PortfolioChart for
 * equity, the open positions, and what a run spends on data, in one frame.
 * Made-up figures, labelled as a sample; nothing in it is live. The book is
 * deliberately unnamed: it is not the hero's agent.
 *
 * A server component: the series and sparklines are computed here once, and
 * only the chart (and the token logos) hydrate.
 */

const DAY = 86_400_000;
const END = Date.UTC(2026, 8, 30);
/** `agents.paperStartingUsd` defaults to $10,000. */
const START_USD = 10_000;

/**
 * Ninety days of a deterministic paper book: about +9.7% with a 6% drawdown.
 * Seed and drift were picked so every range's axis stays above the basis
 * ticks' compact-format threshold ($10K, $10.5K, $11K), so no axis mixes
 * "$9,500.00" with "$10K".
 */
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
  pnl: string;
  said: string;
  up: boolean;
  held: string;
  heldWords: string;
  spark: ReturnType<typeof sparkPath>;
};

const POSITIONS: Position[] = [
  { token: "TIBBIR", chain: "Base", pnl: "+$27.90", said: "up $27.90", up: true, held: "3h", heldWords: "3 hours", spark: sparkPath(11, 0.35) },
  { token: "SUPER INU", chain: "Solana", pnl: "+$21.75", said: "up $21.75", up: true, held: "52m", heldWords: "52 minutes", spark: sparkPath(23, 0.25) },
  { token: "SOL", chain: "Solana", pnl: "−$11.40", said: "down $11.40", up: false, held: "1h", heldWords: "1 hour", spark: sparkPath(41, -0.25) },
];

const POSITIONS_LABEL = `Open positions, sample: ${POSITIONS.map(
  (p) => `${p.token} on ${p.chain}, ${p.said}, held ${p.heldWords}`,
).join("; ")}.`;

const usd = (v: number) => `$${v.toFixed(2)}`;

export function PerformancePanel() {
  return (
    <div className="lp-perf lp-frame" role="group" aria-label="Sample book">
      <div className="lp-perf-bar lp-label">
        <span>Sample book · paper · 90 days</span>
        <span className="lp-perf-bar-stats">
          {TRADES} trades · {WIN_RATE}% won
        </span>
      </div>

      <div className="lp-perf-grid">
        <div className="lp-perf-chart">
          <PortfolioChart
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
                {POSITIONS.map((p) => (
                  <div key={p.token} className="lp-pos">
                    <TokenIcon token={COINS[p.token]} size="md" className="lp-pos-logo" />
                    <span className="lp-pos-id">
                      <span className="lp-pos-name">{p.token}</span>
                      <span className="lp-mono lp-pos-sub">
                        {p.chain} · {p.held}
                      </span>
                    </span>
                    <svg
                      className={`lp-pos-spark ${p.up ? "lp-up" : "lp-down"}`}
                      viewBox="0 0 100 32"
                      preserveAspectRatio="none"
                      aria-hidden
                    >
                      <path d={p.spark.area} fill="currentColor" opacity="0.08" />
                      <path
                        d={p.spark.line}
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinejoin="round"
                        strokeLinecap="round"
                        vectorEffect="non-scaling-stroke"
                      />
                    </svg>
                    <span className={`lp-mono lp-pos-pnl ${p.up ? "lp-up" : "lp-down"}`}>{p.pnl}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="lp-perf-data">
            <p className="lp-perf-label lp-label">Data per run</p>
            <p className="lp-perf-data-value lp-mono">
              {usd(DATA_PER_RUN_USD)} <span>avg · {usd(DEFAULT_DATA_BUDGET_USD)} budget</span>
            </p>
            <div className="lp-perf-meter" aria-hidden>
              <span style={{ width: `${(DATA_PER_RUN_USD / DEFAULT_DATA_BUDGET_USD) * 100}%` }} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
