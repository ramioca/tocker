import { DEFAULT_DATA_BUDGET_USD } from "./signals-data";

/**
 * The owner's view of a sample agent: headline numbers, P&L by day and open
 * positions. A picture of the product in DOM, labelled as a sample; nothing
 * in it is live. (Other visitors would see only the public trade feed: the
 * strategy itself never leaves the owner's screen.)
 */

// Thirty days of hand-shaped daily P&L, in dollars.
const DAYS = [
  42, 18, 61, -22, 9, 88, 34, 51, 70, -35, 12, 47, 66, 79, -14, 5, 58, 73, 92, -28, 40, 31, -9, 84, 22, 46, 63, -18, 55, 38,
];
const DAY_MAX = Math.max(...DAYS.map(Math.abs));

const POSITIONS = [
  { token: "MOTH", chain: "SOL", pnl: "+$38.20", pct: 38, up: true, held: "3h" },
  { token: "RUNE", chain: "BASE", pnl: "+$21.75", pct: 22, up: true, held: "52m" },
  { token: "VANTA", chain: "BASE", pnl: "+$6.10", pct: 6, up: true, held: "18m" },
  { token: "OKRA", chain: "SOL", pnl: "−$11.40", pct: 11, up: false, held: "1h" },
] as const;

export function PerformancePanel() {
  return (
    <div className="lp-app" role="img" aria-label="Sample agent dashboard: equity, trades, win rate, data spend, daily P&L and open positions">
      <div className="lp-app-bar" aria-hidden>
        <span className="lp-app-url">
          <span className="lp-app-dot" />
          tocker.xyz/agents/fresh-launch-hunter
        </span>
        <span className="lp-mono lp-app-chip">paper · So1a····7x9k</span>
      </div>

      <div className="lp-app-stats" aria-hidden>
        <Stat k="Equity" v="$12,480.22" />
        <Stat k="Trades" v="214" />
        <Stat k="Win rate" v="61%" />
        <Stat k="Data per run" v="$0.84" sub={`budget $${DEFAULT_DATA_BUDGET_USD.toFixed(2)}`} accent />
      </div>

      <div className="lp-app-card" aria-hidden>
        <div className="lp-app-card-head">
          <span>P&amp;L by day</span>
          <span className="lp-mono lp-card-meta">sample agent</span>
        </div>
        <div className="lp-bars">
          {DAYS.map((d, i) => (
            <span key={i} className="lp-bar-slot">
              <span
                className={d >= 0 ? "lp-bar" : "lp-bar lp-bar-neg"}
                // Baseline at 30% from the bottom: gains rise above it, losses hang below.
                style={{ height: `${(Math.abs(d) / DAY_MAX) * 70}%` }}
              />
            </span>
          ))}
        </div>
      </div>

      <div className="lp-app-card" aria-hidden>
        <div className="lp-app-card-head">
          <span>Open positions</span>
        </div>
        {POSITIONS.map((p) => (
          <div key={p.token} className="lp-pos">
            <div className="lp-pos-top">
              <span>
                {p.token} <span className="lp-mono lp-pos-chain">{p.chain}</span>
              </span>
              <span className={`lp-mono ${p.up ? "" : "lp-down"}`}>{p.pnl}</span>
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

function Stat({ k, v, sub, accent }: { k: string; v: string; sub?: string; accent?: boolean }) {
  return (
    <div className={accent ? "lp-app-stat lp-app-stat-accent" : "lp-app-stat"}>
      <span className="lp-app-stat-k">{k}</span>
      <span className="lp-mono lp-app-stat-v">{v}</span>
      {sub ? <span className="lp-mono lp-app-stat-sub">{sub}</span> : null}
    </div>
  );
}
