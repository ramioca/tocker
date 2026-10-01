"use client";

import { BentoCard } from "@/components/spectrumui/bento-card";
import { BentoGrid } from "@/components/spectrumui/bento-grid";
import { FAQTabsCard, type FaqTab } from "@/components/spectrumui/faq-tabs-card";
import { Gauge, ShieldCheck, EyeOff } from "lucide-react";
import { DecisionDemo, RecentCalls, RunSteps } from "./demo";
import { Hero } from "./hero";
import { Nav } from "./nav";
import { PerformancePanel } from "./performance";
import { DEFAULT_DATA_BUDGET_USD, LANDING_SOURCES } from "./signals-data";
import { WaitlistProvider, useWaitlist } from "./waitlist";
import "./landing.css";

/**
 * Tocker waitlist landing, in the brand kit's own terms (public/brand/tocker):
 * Night ground, Ink surfaces, Paper type, Violet as the one signal, Geist with
 * Geist Mono for every figure, the dimensional Ticker Knot as hero art and the
 * vector lockup as the wordmark. Green and red appear only on P&L. The product is the illustration — every visual below the
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
    icon: <Gauge className="size-[18px]" />,
    title: "Exits in code",
    body: "Stop-loss, take-profit and trailing stops fire on a five-minute clock, whether or not the model is awake.",
  },
  {
    icon: <ShieldCheck className="size-[18px]" />,
    title: "Ten hard gates",
    body: "Mint and freeze authority, honeypot, tax, liquidity, holders, age, concentration. No score overrides them.",
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
      { question: "How do exits work?", answer: "Stop-loss, take-profit and trailing stops run in code on a five-minute clock, whether or not the model is awake. Entry rules never block an exit." },
      { question: "What does the data cost?", answer: `Each source charges per call, in USDC over x402. The agent picks the source for the question in front of it and stays inside a budget you set, $${DEFAULT_DATA_BUDGET_USD.toFixed(2)} a run by default.` },
      { question: "Can I run more than one agent?", answer: "Yes. Run separate agents for momentum, sentiment or fresh-launch hunting, each with its own mandate and its own Solana and Base wallet." },
    ],
  },
  {
    label: "Safety",
    faqs: [
      { question: "Does it trade real money from day one?", answer: "No. Every agent starts on a simulated book against real quotes and asks before each entry. Going live is a separate screen with a hold-to-confirm." },
      { question: "What are the hard gates?", answer: "Mint and freeze authority, honeypot, tax, liquidity, holder count, token age and top-ten concentration, among others. A high score cannot override any of them." },
      { question: "Can other people see my strategy?", answer: "They see your trades, on a public feed. They never see your prompt, thresholds, data sources or the agent's reasoning. There is no fork button, and there never was one." },
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
      <h2 className="lp-h2 rise">Describe it once. It scores the whole field.</h2>
      <div className="rise">
        <DecisionDemo />
      </div>
      <div className="lp-how-pair">
        <div className="rise">
          <RunSteps />
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
      <p className="lp-eyebrow">02 — Data</p>
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
        <p className="lp-eyebrow">03 — Performance</p>
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
        <p className="lp-eyebrow">04 — Guardrails</p>
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
  const { open } = useWaitlist();
  return (
    <section id="faq" className="lp-wrap lp-section lp-faq-split">
      <div className="rise">
        <p className="lp-eyebrow">05 — Questions</p>
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
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/tocker/vector/tocker-lockup-light.svg" alt="Tocker" width={127} height={30} className="lp-footer-brand" />
            <p>
              Not investment advice. Trading crypto can lose everything in a wallet; every agent starts on paper.
            </p>
          </div>
        </div>
      </div>
    </footer>
  );
}
