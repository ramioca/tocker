import { DEFAULT_ROWS, LANDING_DEFAULTS } from "./defaults";
import { GoLiveDemo } from "./go-live";
import { SpotlightGrid } from "./sec-spotlight";

/**
 * 05 Guardrails as a bento: the go-live demo, the exit rules that run in code, the
 * ten hard gates, how approvals behave, and the defaults a new agent starts with.
 * Every line is a product fact the FAQ states too; the figures come from
 * defaults.ts, which its test keeps in step with the agent config.
 *
 * A server component. The cards' borders catch a light under the cursor
 * (sec-spotlight.tsx, fine pointers only); the go-live hold is its own client island.
 */

/** The exit rules the engine checks between runs. The last two are opt-in. */
const EXITS = [
  { name: "Stop loss", value: `${LANDING_DEFAULTS.stopLossPct}%` },
  { name: "Take profit", value: `${LANDING_DEFAULTS.takeProfitPct}%` },
  { name: "Score collapse", value: null },
  { name: "Draining pool", value: null },
  { name: "Trailing stop", value: "optional" },
  { name: "Max hold", value: "optional" },
] as const;

/** The ten hard gates, in the FAQ's order. */
const GATES = [
  "Mint authority",
  "Freeze authority",
  "Honeypot",
  "Sell check",
  "Tax",
  "Liquidity",
  "Holder count",
  "Token age",
  "Top-ten share",
  "Blocklist",
] as const;

export function GuardrailsBento() {
  return (
    <SpotlightGrid className="lpg">
      <div className="lpg-col">
        <GoLiveDemo className="lpg-cell lpg-golive" />

        <article className="lpg-cell lpg-card lpg-approve lp-frame" aria-labelledby="lpg-approve-title">
          <div className="lpg-head">
            <h3 id="lpg-approve-title" className="lpg-title">
              It asks first
            </h3>
            <span className="lp-label">approve mode</span>
          </div>
          <div className="lpg-body">
            <p className="lpg-big lp-mono" aria-hidden>
              1<span>h</span>
            </p>
            <p className="lpg-note lpg-note-lead">
              A new agent proposes each trade and waits for you. Miss one and the proposal expires after an hour;
              nothing trades. Exits never wait for an approval.
            </p>
          </div>
        </article>
      </div>

      <div className="lpg-col">
        <article className="lpg-cell lpg-card lpg-exits lp-frame" aria-labelledby="lpg-exits-title">
          <div className="lpg-head">
            <h3 id="lpg-exits-title" className="lpg-title">
              Exits run in code
            </h3>
            <span className="lp-label">every 5 min</span>
          </div>
          <div className="lpg-body">
            <p className="lpg-big lp-mono" aria-hidden>
              5<span>min</span>
            </p>
            <ul className="lpg-chips" aria-label="Exit rules">
              {EXITS.map((e) => (
                <li key={e.name} className="lpg-chip" data-optional={e.value === "optional" || undefined}>
                  {e.name}
                  {e.value ? <span className="lp-mono">{e.value}</span> : null}
                </li>
              ))}
            </ul>
            <p className="lpg-note">
              Checked every five minutes, model awake or not. Each sells the whole position, and no entry rule can
              block it.
            </p>
          </div>
        </article>

        <article className="lpg-cell lpg-card lpg-gates lp-frame" aria-labelledby="lpg-gates-title">
          <div className="lpg-head">
            <h3 id="lpg-gates-title" className="lpg-title">
              Ten hard gates
            </h3>
            <span className="lp-label">before any buy</span>
          </div>
          <div className="lpg-body">
            <ol className="lpg-gate-list">
              {GATES.map((g, i) => (
                <li key={g}>
                  <span className="lp-mono lpg-gate-n" aria-hidden>
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  {g}
                </li>
              ))}
            </ol>
            <p className="lpg-note">No score overrides a gate, and most refuse a token when their data is missing.</p>
          </div>
        </article>
      </div>

      <article className="lpg-cell lpg-card lpg-defaults lp-frame" aria-labelledby="lpg-defaults-title">
        <div className="lpg-head">
          <h3 id="lpg-defaults-title" className="lpg-title">
            Defaults you can change
          </h3>
          <span className="lp-label">new agent</span>
        </div>
        <dl className="lpg-spec" aria-label="Defaults a new agent starts with">
          {DEFAULT_ROWS.map(([k, v]) => (
            <div key={k} className="lpg-spec-row">
              <dt className="lp-label">{k}</dt>
              <dd className="lp-mono">{v}</dd>
            </div>
          ))}
        </dl>
      </article>
    </SpotlightGrid>
  );
}
