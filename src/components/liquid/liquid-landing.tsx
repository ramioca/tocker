"use client";

import { BentoCard } from "@/components/spectrumui/bento-card";
import { BentoGrid } from "@/components/spectrumui/bento-grid";
import { FAQTabsCard, type FaqTab } from "@/components/spectrumui/faq-tabs-card";
import { HoldToConfirmButton } from "@/components/spectrumui/hold-to-confirm";
import { Gauge, ShieldCheck, EyeOff, Zap } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { BrandLockup, BrandMark } from "./brand";
import { DecisionDemo } from "./demo";
import { AgentConsole } from "./console";
import { PublicFeed } from "./feed";
import { Hero } from "./hero";
import { Nav } from "./nav";
import { PerformancePanel } from "./performance";
import { DEFAULT_DATA_BUDGET_USD, LANDING_SOURCES, type LandingSource } from "./signals-data";
import { WaitlistProvider, useWaitlist } from "./waitlist";
import "./landing.css";
import "./landing-rest.css";
import "./landing-minimal.css";

/**
 * Tocker waitlist landing, brand v2: near-black ground, the neon "T" mark
 * (cyan -> blue -> violet -> magenta) and its gradient for highlights, solid
 * violet as the one signal, Geist with Geist Mono for every figure. Green and
 * red appear only on P&L. The product is the illustration: every visual below
 * the hero is the app's own UI (Spectrum components) drawn in DOM on labelled
 * sample data. No canvas, no smooth-scroll library, no fixed overlays; motion
 * is transform/opacity only, and anything periodic runs only while on screen.
 *
 * Section order: Nav, Hero, Promises, 01 How, 02 Feed, 03 Data,
 * 04 Performance, 05 Guardrails, 06 Questions, Footer.
 */

/** Verified against `DEFAULT_AGENT_CONFIG` by src/lib/agent/config.ts; keep in step. */
const DEFAULTS = [
  ["Score floor", "62 / 100"],
  ["Per trade", "$100"],
  ["Per day", "10 trades"],
  ["Stop loss", "15%"],
  ["Take profit", "40%"],
  ["Data per run", `$${DEFAULT_DATA_BUDGET_USD.toFixed(2)}`],
  ["Mode", "paper · asks first"],
  ["Runs", "every 15 min"],
  ["Min liquidity", "$15k"],
  ["Min age", "30 min"],
] as const;

const PROMISES = [
  {
    icon: <Gauge className="size-[18px]" />,
    title: "Exits in code",
    body: "Stop-loss, take-profit and trailing stops fire on a five-minute clock, whether or not the model is awake.",
  },
  {
    icon: <ShieldCheck className="size-[18px]" />,
    title: "Ten hard gates",
    body: "Mint and freeze authority, honeypot, failed sell check, tax, liquidity, holders, age, top-ten share and your blocklist. No score overrides them.",
  },
  {
    icon: <EyeOff className="size-[18px]" />,
    title: "Your edge stays yours",
    body: "Every trade posts to a public feed. Your prompt, thresholds and data sources never do. There is no fork button.",
  },
] as const;

const FAQ_TABS: FaqTab[] = [
  {
    label: "Trading",
    faqs: [
      { question: "What does the agent trade?", answer: "Any token on Solana and Base that clears the ten hard gates and scores above your floor. There is no allowlist; the only list is a blocklist, and it only subtracts." },
      { question: "How do exits work?", answer: "In code, not in the prompt. Stop-loss, take-profit, trailing stop, max hold, a score collapse and a liquidity collapse are checked every five minutes, and each sells the whole position. Entry rules never block an exit." },
      { question: "What does the data cost?", answer: `Tocker pays the data vendors per call, in USDC over x402. You set how much each run may spend, $${DEFAULT_DATA_BUDGET_USD.toFixed(2)} by default, and the agent picks the source that answers the question in front of it.` },
      { question: "Can I run more than one agent?", answer: "Yes. Run separate agents for momentum, sentiment or fresh-launch hunting, each with its own mandate and its own Solana and Base wallet." },
    ],
  },
  {
    label: "Safety",
    faqs: [
      { question: "Does it trade real money from day one?", answer: "No. Every agent starts on a simulated book against real quotes and asks before each entry. Going live is a separate screen with a hold-to-confirm." },
      { question: "What are the hard gates?", answer: "Ten checks: mint authority, freeze authority, honeypot, a failed sell check, tax, liquidity, holder count, token age, top-ten share and your blocklist. A high score cannot override any of them." },
      { question: "Can other people see my strategy?", answer: "They see your trades on a public feed: token, size, price, result, and the one-line note your agent posts with each fill. They never see your prompt, thresholds, data sources or the run transcript. There is no fork button." },
    ],
  },
  {
    label: "Access",
    faqs: [
      { question: "When do I get in?", answer: "We onboard by trading size, largest books first. Join the waitlist and we will reach out when your turn comes." },
    ],
  },
];

export function LiquidLanding() {
  return (
    <WaitlistProvider>
      <div className="lp">
        <Nav />
        <main id="main" tabIndex={-1}>
          <Hero />
          <Promises />
          <How />
          <PublicFeed eyebrow="02 — Feed" />
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
    <section className="lp-wrap lp-promises" aria-labelledby="lp-promises-title">
      <h2 id="lp-promises-title" className="lp-sr">
        What every agent guarantees
      </h2>
      {/* Spectrum's bento: a spotlight follows the pointer and a beam rides the border on hover. */}
      <BentoGrid className="lp-bento lg:grid-cols-3 md:grid-cols-3 gap-4 max-w-none">
        {PROMISES.map((p) => (
          <BentoCard key={p.title} icon={p.icon} title={p.title} description={p.body} className="lp-bento-card" />
        ))}
      </BentoGrid>
    </section>
  );
}

function How() {
  return (
    <section id="how" className="lp-wrap lp-section">
      <p className="lp-eyebrow">01 — Observe · decide · trade</p>
      <h2 className="lp-h2 rise">
        Describe it once.
        <br /> It scores the whole field.
      </h2>
      <div className="rise">
        <DecisionDemo />
      </div>
      {/* The owner's view of one run, built from Spectrum's AI Assistant blocks. */}
      <div className="rise">
        <AgentConsole />
      </div>
    </section>
  );
}

/** The chain each source is paid on: a tiny badge, Base in blue, Solana in the cyan-to-magenta sweep. */
function ChainBadge({ network }: { network: LandingSource["network"] }) {
  return (
    <span className="lp-chain" data-chain={network.toLowerCase()}>
      <span className="lp-chain-dot" aria-hidden />
      {network === "Solana" ? "SOL" : "BASE"}
    </span>
  );
}

function Sources() {
  const defaults = LANDING_SOURCES.filter((s) => s.tier === "default").length;
  const guards = LANDING_SOURCES.filter((s) => s.guard).length;
  return (
    <section id="data" className="lp-wrap lp-section">
      <p className="lp-eyebrow">03 — Data</p>
      <h2 className="lp-h2 rise">It buys its own research, by the call.</h2>
      <p className="lp-lede rise">
        {LANDING_SOURCES.length} sources in the registry, {defaults} on by default. Tocker pays each source by the call in USDC
        over x402; you set the per-run budget.
      </p>
      <div className="lp-table lp-term rise" role="table" aria-label="Paid data sources in the registry">
        <div className="lp-term-bar lp-mono" aria-hidden>
          <span className="lp-term-lights">
            <i />
            <i />
            <i />
          </span>
          <span className="lp-term-cmd">
            <span className="lp-term-prompt">$</span> tocker sources ls --paid x402
          </span>
          <span className="lp-term-meta">
            {LANDING_SOURCES.length} rows · {guards} guard
          </span>
        </div>
        <div className="lp-table-head lp-term-head lp-mono" role="row">
          <span role="columnheader">source · provider</span>
          <span role="columnheader" className="lp-term-col-paid">
            paid on
          </span>
          <span role="columnheader" className="lp-term-col-price">
            usdc / call
          </span>
        </div>
        {LANDING_SOURCES.map((s) => (
          <div key={s.id} className="lp-table-row lp-term-row" role="row">
            <div className="lp-table-name" role="cell">
              <span className="lp-term-name">
                {s.name}
                {s.guard ? <span className="lp-pill lp-term-tag lp-term-guard">guard</span> : null}
                {s.tier === "default" ? <span className="lp-pill lp-term-tag lp-term-default">default</span> : null}
                {s.tier === "experimental" ? <span className="lp-pill lp-pill-dashed lp-term-tag">experimental</span> : null}
              </span>
              <span className="lp-mono lp-table-host">
                {s.provider.toLowerCase()} · {s.host} · {s.category}
              </span>
            </div>
            <div className="lp-term-paid" role="cell">
              <ChainBadge network={s.network} />
            </div>
            <span className="lp-mono lp-table-price" role="cell">
              {s.price}
            </span>
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
        <p className="lp-eyebrow">04 — Performance</p>
        <h2 className="lp-h2 rise">
          Your book,
          <br /> at a glance.
        </h2>
        <p className="lp-lede lp-split-lede rise">
          Equity and drawdown, win rate, open positions and what every run spent on data. Your record is public;
          your strategy never is.
        </p>
      </div>
      <div className="rise">
        <PerformancePanel />
      </div>
    </section>
  );
}

/** How long the demo's "Live (demo)" state lasts before it puts itself back on paper. */
const GO_LIVE_DEMO_MS = 3200;

/**
 * A sample of the go-live gesture. In the app, going live is its own screen
 * with a checklist and this same hold; here a completed hold only flips a
 * local badge and resets. Nothing navigates, nothing is sent.
 */
function GoLiveDemo() {
  const [live, setLive] = useState(false);
  // Re-keying remounts the Spectrum button, which unwinds its ring to idle.
  const [attempt, setAttempt] = useState(0);
  const timer = useRef<number | null>(null);
  // The reset remounts the button; if it had focus, give focus back to the new one.
  const wrapRef = useRef<HTMLDivElement>(null);
  const refocus = useRef(false);
  useEffect(() => {
    if (!refocus.current) return;
    refocus.current = false;
    wrapRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }, [attempt]);

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  const confirm = () => {
    setLive(true);
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      refocus.current = Boolean(wrapRef.current?.contains(document.activeElement));
      setLive(false);
      setAttempt((n) => n + 1);
      timer.current = null;
    }, GO_LIVE_DEMO_MS);
  };

  return (
    <div className="lp-card lp-golive" data-live={live}>
      <div className="lp-card-head">
        <span className="lp-card-title">
          <span className="lp-dot" aria-hidden />
          Go live
        </span>
        <span className="lp-mono lp-card-meta">demo · nothing is sent</span>
      </div>
      <div className="lp-golive-body">
        <div className="lp-golive-state lp-mono">
          <span className="lp-sr" aria-live="polite">
            {live ? "Mode: live (demo)" : "Mode: paper"}
          </span>
          <span className="lp-golive-mode" data-on={!live} aria-hidden>
            paper
          </span>
          <span className="lp-golive-arrow" aria-hidden>
            →
          </span>
          <span className="lp-golive-mode lp-golive-mode-live" data-on={live} aria-hidden>
            live
          </span>
        </div>
        <div ref={wrapRef}>
        <HoldToConfirmButton
          key={attempt}
          duration={2_200}
          label="Hold to go live"
          confirmedLabel="Live (demo)"
          resetDelay={0}
          icon={<Zap className="size-4" />}
          ariaLabel="Demo: hold to go live. Press and hold for 2.2 seconds. Nothing is sent."
          onConfirm={confirm}
          className={live ? "lp-golive-btn lp-golive-btn-live" : "lp-golive-btn"}
        />
        </div>
        <p className="lp-golive-note">
          Every agent starts on paper. Going live is a separate screen: a checklist, then a hold-to-confirm. A tap
          can&rsquo;t do it.
        </p>
      </div>
    </div>
  );
}

function Guardrails() {
  return (
    <section id="guardrails" className="lp-wrap lp-section lp-guard">
      <div className="lp-guard-copy">
        <div className="rise">
          <p className="lp-eyebrow">05 — Guardrails</p>
          <h2 className="lp-h2">Entry rules never block an exit.</h2>
          <p className="lp-lede">
            Blocklist a token you hold, spend the day&rsquo;s trade quota, hit the kill switch: the sell still goes
            through. A guard that traps you is not a guard.
          </p>
        </div>
        <div className="rise">
          <GoLiveDemo />
        </div>
      </div>
      <div className="lp-card lp-defaults rise">
        <div className="lp-card-head">
          <span className="lp-card-title">
            <span className="lp-dot" aria-hidden />
            Defaults you can change
          </span>
          <span className="lp-mono lp-card-meta">new agent</span>
        </div>
        <dl aria-label="Defaults a new agent starts with">
          {DEFAULTS.map(([k, v]) => (
            <div key={k} className="lp-default">
              <dt>{k}</dt>
              <dd className="lp-mono">{v}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

function Faq() {
  const { open } = useWaitlist();
  return (
    <section id="faq" className="lp-wrap lp-section lp-faq-split">
      <div className="rise">
        <p className="lp-eyebrow">06 — Questions</p>
        <h2 className="lp-h2">Questions, answered.</h2>
        <p className="lp-lede">The short version of how an agent trades, what it costs and who sees what.</p>
      </div>
      <div className="rise">
        <FAQTabsCard tabs={FAQ_TABS} footerLabel="Join the waitlist" onFooterClick={open} className="lp-faq-card" />
      </div>
    </section>
  );
}

function Footer() {
  const { open } = useWaitlist();
  return (
    <footer className="lp-footer">
      <div className="lp-wrap lp-footer-close rise">
        <BrandMark size={64} />
        <h2 className="lp-h2">Agents that trade 24/7, out in the open.</h2>
        <p className="lp-lede">Private beta on Solana and Base. Every agent starts on paper.</p>
        <button type="button" className="lp-btn-accent lp-btn-hero" onClick={open}>
          Join the waitlist
        </button>
      </div>
      <div className="lp-footer-bottom">
        <div className="lp-wrap">
          <div className="lp-footer-links">
            <a href="#how">How it works</a>
            <a href="#feed">Feed</a>
            <a href="#data">Data</a>
            <a href="#performance">Performance</a>
            <a href="#guardrails">Guardrails</a>
            <a href="#faq">FAQ</a>
          </div>
          <div className="lp-footer-legal">
            <BrandLockup size={26} className="lp-footer-lockup" />
            <p>
              Not investment advice. Trading crypto can lose everything in a wallet; every agent starts on paper.
              Figures on this page are illustrative samples.
            </p>
          </div>
        </div>
      </div>
    </footer>
  );
}
