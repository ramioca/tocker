"use client";

import { DecisionDemo, FieldBook, RecentCalls } from "./demo";
import { Hero } from "./hero";
import { Mark } from "./mark";
import { Nav } from "./nav";
import { PerformancePanel } from "./performance";
import { DEFAULT_DATA_BUDGET_USD, LANDING_SOURCES } from "./signals-data";
import { WaitlistProvider, useWaitlist } from "./waitlist";
import "./landing.css";

/**
 * Tocker waitlist landing. Light, quiet and fast: a warm paper ground, one
 * geometric sans with a mono for every figure, hairline cards, and violet as
 * the only accent. The product is the illustration — every visual below the
 * hero is the app's own UI drawn in DOM. No canvas, no smooth-scroll library,
 * no fixed overlays; motion is the load-in, two small sample feeds that run
 * only while on screen, and scroll-linked reveals on the compositor.
 */

/** Verified against `DEFAULT_AGENT_CONFIG` by src/lib/agent/config.ts; keep in step. */
const DEFAULTS = [
  ["Score floor", "62 / 100"],
  ["Per trade", "$100"],
  ["Per day", "10 trades"],
  ["Stop loss", "15%"],
  ["Take profit", "40%"],
  ["Data per run", `$${DEFAULT_DATA_BUDGET_USD.toFixed(2)}`],
] as const;

const PROMISES = [
  {
    title: "Exits in code",
    body: "Stop-loss, take-profit and trailing stops fire on a five-minute clock, whether or not the model is awake.",
  },
  {
    title: "Ten hard gates",
    body: "Mint and freeze authority, honeypot, tax, liquidity, holders, age, concentration. No score overrides them.",
  },
  {
    title: "Your edge stays yours",
    body: "Every trade posts to a public feed. Your prompt, thresholds and data sources never do. There is no fork button.",
  },
] as const;

const FAQ = [
  {
    q: "What does the agent trade?",
    a: "Any token on Solana and Base that clears the ten hard gates and scores above your floor. There is no allowlist; the only list is a blocklist, and it only subtracts.",
  },
  {
    q: "Does it trade real money from day one?",
    a: "No. Every agent starts on a simulated book against real quotes and asks before each entry. Going live is a separate screen with a hold-to-confirm.",
  },
  {
    q: "Can other people see my strategy?",
    a: "They see your trades, on a public feed. They never see your prompt, thresholds, data sources or the agent's reasoning. There is no fork button, and there never was one.",
  },
  {
    q: "What are the hard gates?",
    a: "Mint and freeze authority, honeypot, tax, liquidity, holder count, token age and top-ten concentration, among others. A high score cannot override any of them.",
  },
  {
    q: "How do exits work?",
    a: "Stop-loss, take-profit and trailing stops run in code on a five-minute clock, whether or not the model is awake. Entry rules never block an exit.",
  },
  {
    q: "What does the data cost?",
    a: `Each source charges per call, in USDC over x402. The agent picks the source for the question in front of it and stays inside a budget you set, $${DEFAULT_DATA_BUDGET_USD.toFixed(2)} a run by default.`,
  },
  {
    q: "Can I run more than one agent?",
    a: "Yes. Run separate agents for momentum, sentiment or fresh-launch hunting, each with its own mandate and its own Solana and Base wallet.",
  },
  {
    q: "When do I get in?",
    a: "We onboard by trading size, largest books first. Join the waitlist and we will reach out when your turn comes.",
  },
] as const;

export function LiquidLanding() {
  return (
    <WaitlistProvider>
      <div className="lp">
        <Nav />
        <main>
          <Hero />
          <Promises />
          <How />
          <Sources />
          <Performance />
          <Guardrails />
          <Faq />
        </main>
        <Footer />
      </div>
    </WaitlistProvider>
  );
}

function Promises() {
  return (
    <section className="lp-wrap lp-promises" aria-label="What every agent guarantees">
      {PROMISES.map((p) => (
        <div key={p.title} className="lp-promise rise">
          <p className="lp-promise-title">
            <span className="lp-dot" aria-hidden />
            {p.title}
          </p>
          <p className="lp-promise-body">{p.body}</p>
        </div>
      ))}
    </section>
  );
}

function How() {
  return (
    <section id="how" className="lp-wrap lp-section">
      <h2 className="lp-h2 rise">Describe it once. It scores the whole field.</h2>
      <div className="rise">
        <DecisionDemo />
      </div>
      <div className="lp-how-pair">
        <div className="rise">
          <FieldBook />
        </div>
        <div className="rise">
          <RecentCalls />
        </div>
      </div>
    </section>
  );
}

function Sources() {
  const defaults = LANDING_SOURCES.filter((s) => s.tier === "default").length;
  return (
    <section id="data" className="lp-wrap lp-section">
      <h2 className="lp-h2 rise">It buys its own research, by the call.</h2>
      <p className="lp-lede rise">
        {LANDING_SOURCES.length} sources in the registry, {defaults} on by default. Paid in USDC over x402, inside a
        budget you set.
      </p>
      <div className="lp-table rise">
        <div className="lp-table-head lp-mono">
          <span>source · provider</span>
          <span>per call</span>
        </div>
        {LANDING_SOURCES.map((s) => (
          <div key={s.id} className="lp-table-row">
            <div className="lp-table-name">
              <span>{s.name}</span>
              <span className="lp-mono lp-table-host">
                {s.provider.toLowerCase()} · {s.host}
              </span>
            </div>
            <div className="lp-table-right">
              {s.guard ? <span className="lp-pill lp-pill-ink">guard</span> : null}
              {s.tier === "default" ? <span className="lp-pill lp-pill-accent">default</span> : null}
              {s.tier === "experimental" ? <span className="lp-pill lp-pill-dashed">experimental</span> : null}
              <span className="lp-pill lp-table-net">{s.network}</span>
              <span className="lp-mono lp-table-price">{s.price}</span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function Performance() {
  return (
    <section id="performance" className="lp-wrap lp-section">
      <div className="lp-split-head">
        <h2 className="lp-h2 rise">
          Performance, the way
          <br /> you&rsquo;re used to.
        </h2>
        <p className="lp-lede lp-split-lede rise">
          Equity, P&amp;L by day, open positions and what every run spent on data, on your own agent. Everyone else
          sees the trades, never the strategy.
        </p>
      </div>
      <div className="rise">
        <PerformancePanel />
      </div>
    </section>
  );
}

function Guardrails() {
  return (
    <section className="lp-wrap lp-section lp-guard">
      <div className="lp-guard-copy rise">
        <h2 className="lp-h2">Entry rules never block an exit.</h2>
        <p className="lp-lede">
          Blocklist a token you hold, spend the day&rsquo;s trade quota, hit the kill switch: the sell still goes
          through. A guard that traps you is not a guard.
        </p>
      </div>
      <dl className="lp-card lp-defaults rise" aria-label="Defaults a new agent starts with">
        <div className="lp-card-head">
          <span className="lp-card-title">
            <span className="lp-dot" aria-hidden />
            Defaults you can change
          </span>
        </div>
        {DEFAULTS.map(([k, v]) => (
          <div key={k} className="lp-default">
            <dt>{k}</dt>
            <dd className="lp-mono">{v}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function Faq() {
  return (
    <section id="faq" className="lp-wrap lp-section">
      <h2 className="lp-h2 rise">Questions</h2>
      <div className="lp-faq">
        {FAQ.map((f) => (
          <details key={f.q} className="lp-faq-item">
            <summary>
              {f.q}
              <span className="lp-faq-icon" aria-hidden />
            </summary>
            <p>{f.a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

function Footer() {
  const { open } = useWaitlist();
  return (
    <footer className="lp-footer">
      <div className="lp-wrap lp-footer-line">
        <p>
          Agents that trade 24/7, out in the open.{" "}
          <button type="button" className="lp-underline" onClick={open}>
            Join the waitlist.
          </button>
        </p>
      </div>
      <div className="lp-footer-bottom">
        <div className="lp-wrap">
          <div className="lp-footer-links">
            <a href="#how">How it works</a>
            <a href="#data">Data</a>
            <a href="#performance">Performance</a>
            <a href="#faq">FAQ</a>
          </div>
          <div className="lp-footer-legal">
            <span className="lp-footer-brand">
              <Mark size={22} />
              tocker
            </span>
            <p>
              Not investment advice. Trading crypto can lose everything in a wallet; every agent starts on paper.
            </p>
          </div>
        </div>
      </div>
    </footer>
  );
}
