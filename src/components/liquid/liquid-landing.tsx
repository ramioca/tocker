import type { FaqTab } from "@/components/spectrumui/faq-tabs-card";
import type { ReactNode } from "react";
import { BrandHeroMark, BrandLockup } from "./brand";
import { AgentConsole } from "./console";
import { FaqCard } from "./faq-card";
import { PublicFeed } from "./feed";
import { GoLiveDemo } from "./go-live";
import { Hero } from "./hero";
import { Nav } from "./nav";
import { PerformancePanel } from "./performance";
import { DEFAULT_DATA_BUDGET_USD, LANDING_SOURCES, type LandingSource } from "./signals-data";
import { WaitlistProvider } from "./waitlist";
import { WaitlistButton } from "./waitlist-button";
import "./landing.css";
import "./landing-hero.css";
import "./landing-how.css";
import "./landing-feed.css";
import "./landing-sections.css";
import "./landing-waitlist.css";

/**
 * Tocker waitlist landing: a black ground, near-black surfaces, off-white type,
 * the neon "T" mark as the one colour that means "brand", and green/red only on
 * P&L. Every visual below the hero is the app's own UI (Spectrum components)
 * drawn in DOM on labelled sample data.
 *
 * A server component. The interactive parts are client islands: Nav, Hero,
 * AgentConsole, PublicFeed, PerformancePanel's chart, GoLiveDemo, FaqCard and
 * WaitlistButton. WaitlistProvider is the client wrapper that owns the modal.
 *
 * Section order: Nav, Hero, 01 How, 02 Feed, 03 Data, 04 Performance,
 * 05 Guardrails, 06 Questions, closing call to action, Footer.
 */

/** Verified against `DEFAULT_AGENT_CONFIG` (src/lib/agent/config.ts); keep in step. Read in pairs, row by row. */
const DEFAULTS = [
  ["Mode", "paper · asks first"],
  ["Runs", "every 15 min"],
  ["Score floor", "62 / 100"],
  ["Per trade", "$100"],
  ["Per day", "10 trades"],
  ["Data per run", `$${DEFAULT_DATA_BUDGET_USD.toFixed(2)}`],
  ["Stop loss", "15%"],
  ["Take profit", "40%"],
  ["Min liquidity", "$15k"],
  ["Min age", "30 min"],
] as const;

const BUDGET = `$${DEFAULT_DATA_BUDGET_USD.toFixed(2)}`;

const FAQ_TABS: FaqTab[] = [
  {
    label: "Trading",
    faqs: [
      {
        question: "What does the agent trade?",
        answer:
          "Any token on Solana and Base that clears the ten hard gates and scores at or above your floor. There is no allowlist; the only list is your blocklist, and it only subtracts.",
      },
      {
        question: "What are the hard gates?",
        answer:
          "Ten checks: mint authority, freeze authority, honeypot, a failed sell check, tax, liquidity, holder count, token age, top-ten share and your blocklist. Most of them also refuse a token when the data is missing. No score overrides any of them.",
      },
      {
        question: "How do exits work?",
        answer:
          "In code, not in the prompt. Stop loss, take profit, an optional trailing stop, max hold, a collapsing score and a draining pool are checked every five minutes, model awake or not. Each one sells the whole position, and entry rules never block an exit.",
      },
      {
        question: "What does the data cost?",
        answer: `Nothing from your wallet. Tocker pays the vendors per call, in USDC over x402. Each run may spend up to its data budget (${BUDGET} by default), and score_token buys enrichment automatically until that budget is used. What Tocker charges is a flat fee per filled trade, never a percentage of its size.`,
      },
      {
        question: "Which AI model runs it?",
        answer:
          "The one you choose, on your own key: Anthropic, OpenAI or OpenRouter. Keys are encrypted at rest and decrypted only inside the run, and your provider bills you for the model directly.",
      },
    ],
  },
  {
    label: "Safety",
    faqs: [
      {
        question: "Does it trade real money from day one?",
        answer:
          "No. Every agent starts on paper against real quotes and asks before each entry. Going live is a separate screen with a checklist and a hold-to-confirm.",
      },
      {
        question: "What if I miss an approval?",
        answer: "The proposal expires after an hour and nothing trades. Exits never wait for an approval.",
      },
      {
        question: "Who controls the agent’s wallet?",
        answer:
          "Each agent gets its own wallet on Solana and on Base, separate from yours. They are server wallets: Tocker signs the agent’s trades so it can act while you are away, and their policy refuses to export the keys. Withdrawals are yours alone, to any address you choose.",
      },
      {
        question: "Can other people see my strategy?",
        answer:
          "They see your trades on the public feed: token, size, price, result and the one-line note your agent posts with each fill. They never see your prompt, thresholds, data sources or the run transcript.",
      },
    ],
  },
  {
    label: "Access",
    faqs: [
      {
        question: "When do I get in?",
        answer:
          "We open seats in batches, most active traders first. Join the waitlist and we’ll email you when yours opens.",
      },
      {
        question: "Can I run more than one agent?",
        answer:
          "Yes. Run separate agents for momentum, sentiment or fresh launches, each with its own mandate and its own wallets.",
      },
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
          <How />
          <PublicFeed eyebrow="02 — Feed" />
          <Sources />
          <Performance />
          <Guardrails />
          <Faq />
          <Close />
        </main>
        <Footer />
      </div>
    </WaitlistProvider>
  );
}

/**
 * One head for every numbered section: eyebrow across the top, the h2 on the
 * left and the lede on the right from 900px (stacked below), matching the
 * Feed's `.lp-split-head`.
 */
function SectionHead({ id, num, label, title, lede }: { id: string; num: string; label: string; title: ReactNode; lede: ReactNode }) {
  return (
    <div className="lp-split-head">
      <p className="lp-eyebrow">
        {num} <span aria-hidden>—</span> {label}
      </p>
      <h2 id={id} className="lp-h2 rise">
        {title}
      </h2>
      <p className="lp-lede lp-split-lede rise">{lede}</p>
    </div>
  );
}

function How() {
  return (
    <section id="how" className="lp-wrap lp-section" aria-labelledby="lp-how-title">
      <SectionHead
        id="lp-how-title"
        num="01"
        label="How it decides"
        title="Inside the run."
        lede="The run from the top of the page, as its owner sees it: what it scored, the data it bought, and the buy it is waiting on you to approve."
      />
      <AgentConsole />
    </section>
  );
}

/** How many sources the table shows; the rest are counted in its last line. */
const SHOWN_SOURCES = 6;
/** Defaults first, then the sources that feed a hard gate, then the rest in registry order. */
const sourceRank = (s: LandingSource) => (s.tier === "default" ? 0 : s.guard ? 1 : 2);
/** Three decimals, so every price lines up on the point. */
const sourcePrice = (s: LandingSource) => `$${s.priceUsd.toFixed(3)}`;

function Sources() {
  const total = LANDING_SOURCES.length;
  const defaults = LANDING_SOURCES.filter((s) => s.tier === "default").length;
  const rows = [...LANDING_SOURCES].sort((a, b) => sourceRank(a) - sourceRank(b)).slice(0, SHOWN_SOURCES);
  return (
    <section id="data" className="lp-wrap lp-section" aria-labelledby="lp-data-title">
      <SectionHead
        id="lp-data-title"
        num="03"
        label="Data"
        title="It buys its own research, by the call."
        lede={`${total} paid sources in the registry, ${defaults} on by default. Tocker pays each source per call in USDC over x402, up to the per-run budget you set (${BUDGET} by default).`}
      />
      <div className="lp-src">
        <div className="lp-src-table" role="table" aria-label={`Paid data sources, ${rows.length} of ${total}`}>
          <div role="rowgroup">
            <div className="lp-src-row lp-src-head lp-mono" role="row">
              <span role="columnheader">Source</span>
              <span role="columnheader">Provider</span>
              <span role="columnheader">Kind</span>
              <span role="columnheader" className="lp-src-num">
                USDC / call
              </span>
            </div>
          </div>
          <div role="rowgroup">
            {rows.map((s) => (
              <div key={s.id} className="lp-src-row" role="row">
                <span className="lp-src-name" role="cell">
                  {s.name}
                  {s.tier === "default" ? <span className="lp-src-tag lp-mono">default</span> : null}
                  {s.guard ? <span className="lp-src-tag lp-mono">guard</span> : null}
                  {s.tier === "experimental" ? <span className="lp-src-tag lp-mono">experimental</span> : null}
                </span>
                <span className="lp-src-provider" role="cell">
                  {s.provider}
                </span>
                <span className="lp-src-kind lp-mono" role="cell">
                  {s.category}
                </span>
                <span className="lp-src-price lp-src-num lp-mono" role="cell">
                  {sourcePrice(s)}
                </span>
              </div>
            ))}
          </div>
        </div>
        <p className="lp-src-foot lp-mono">
          <span>+ {total - rows.length} more in the registry</span>
          <span className="lp-src-legend">guard: feeds a hard gate</span>
        </p>
      </div>
    </section>
  );
}

function Performance() {
  return (
    <section id="performance" className="lp-wrap lp-section" aria-labelledby="lp-perf-title">
      <SectionHead
        id="lp-perf-title"
        num="04"
        label="Performance"
        title="Your book, at a glance."
        lede="Equity, open positions and what each run spends on data. Your trades are public; your strategy never is."
      />
      <PerformancePanel />
    </section>
  );
}

function Guardrails() {
  return (
    <section id="guardrails" className="lp-wrap lp-section" aria-labelledby="lp-guard-title">
      <SectionHead
        id="lp-guard-title"
        num="05"
        label="Guardrails"
        title="Entry rules never block an exit."
        lede="Stop loss, take profit and trailing stops run in code on a five-minute clock, whether or not the model is awake. Blocklist a token you hold, spend the day’s trades, hit the kill switch: the sell still goes through."
      />
      <div className="lp-guard-grid">
        <GoLiveDemo />
        <div className="lp-defaults">
          <div className="lp-defaults-head">
            <h3 className="lp-defaults-title">Defaults you can change</h3>
            <span className="lp-mono lp-defaults-meta">new agent</span>
          </div>
          <dl aria-label="Defaults a new agent starts with">
            {DEFAULTS.map(([k, v]) => (
              <div key={k} className="lp-default">
                <dt className="lp-mono">{k}</dt>
                <dd className="lp-mono">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </section>
  );
}

function Faq() {
  return (
    <section id="faq" className="lp-wrap lp-section lp-faq" aria-labelledby="lp-faq-title">
      <SectionHead
        id="lp-faq-title"
        num="06"
        label="Questions"
        title="Before you join."
        lede="How it trades, what it costs, who holds the wallet and who sees what."
      />
      <FaqCard tabs={FAQ_TABS} />
    </section>
  );
}

/** The page closes on the mark, painted on a still glow, and the one call to action. */
function Close() {
  return (
    <section className="lp-wrap lp-close" aria-labelledby="lp-close-title">
      <div className="lp-close-art" aria-hidden>
        <BrandHeroMark width={180} className="lp-close-mark" />
      </div>
      <h2 id="lp-close-title" className="lp-h2 lp-close-title">
        Your strategy, on the clock.
      </h2>
      <p className="lp-lede lp-close-lede">Private beta on Solana and Base. We’ll email you when your seat opens.</p>
      <WaitlistButton className="lp-close-cta" />
    </section>
  );
}

function Footer() {
  return (
    <footer className="lp-footer">
      <div className="lp-wrap">
        <div className="lp-footer-top">
          <BrandLockup size={24} className="lp-footer-lockup" />
          <nav aria-label="Footer" className="lp-footer-links">
            <a href="#how">How it works</a>
            <a href="#feed">Feed</a>
            <a href="#data">Data</a>
            <a href="#performance">Performance</a>
            <a href="#guardrails">Guardrails</a>
            <a href="#faq">FAQ</a>
          </nav>
        </div>
        <div className="lp-footer-legal">
          <p>
            Not investment advice. Token names are real; every price, score and result on this page is an
            illustrative sample. Trading crypto can lose everything you put in an agent’s wallet.
          </p>
          <p className="lp-mono lp-footer-copy">© 2026 Tocker</p>
        </div>
      </div>
    </footer>
  );
}
