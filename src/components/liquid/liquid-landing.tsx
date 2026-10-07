import type { FaqTab } from "@/components/spectrumui/faq-tabs-card";
import { PROVIDER_ORDER, providerLabel } from "@/lib/agent/providers";
import { feeEnabled, platformFeeUsd } from "@/lib/platform/fee";
import { inferenceFlags } from "@/lib/x402/inference-types";
import { BrandLockup } from "./brand";
import { AgentConsole } from "./console";
import { feeSentence, thinkingAnswers } from "./defaults";
import { PublicFeed } from "./feed";
import { Hero } from "./hero";
import { Nav } from "./nav";
import { PerformancePanel } from "./performance";
import { CloseCta } from "./sec-close";
import { FaqList } from "./sec-faq";
import { FooterWordmark } from "./sec-footer-wordmark";
import { GuardrailsBento } from "./sec-guardrails-bento";
import { SectionHead } from "./section-head";
import { SmoothScroll } from "./smooth-scroll";
import { DEFAULT_DATA_BUDGET_USD, LANDING_SOURCES, usd2, usd3, type LandingSource } from "./signals-data";
import "./landing.css";
import "./landing-hero.css";
import "./landing-how.css";
import "./landing-feed.css";
import "./landing-sections.css";

/**
 * Tocker landing: a black ground, near-black surfaces, off-white
 * type, the neon "T" mark as the one colour that means "brand", and green/red
 * only on P&L. Every visual below the hero is the app's own UI (Spectrum
 * components) drawn in DOM on labelled sample data.
 *
 * A server component. The interactive parts are client islands: the hero's run
 * card, AgentConsole, PublicFeed, PerformancePanel's chart, GoLiveDemo, the FAQ
 * card. Getting in is a plain link to sign-in; there is no form on this page.
 *
 * `hasSession` is the route's read of the session cookie. It is a hint and
 * nothing more: it turns "Sign in" and "Get started" into "Open the app" for
 * someone who is probably signed in already. Nothing is hidden or redirected on
 * it; the app does the real check.
 *
 * SmoothScroll (a client provider around the page) sets up Lenis, GSAP's ticker and
 * ScrollTrigger together, and MotionConfig's reduced-motion policy; see smooth-scroll.tsx.
 *
 * Section order: Nav, Hero, 01 How, 02 Feed, 03 Data, 04 Performance,
 * 05 Guardrails, 06 Questions, closing call to action, Footer.
 */

const BUDGET = usd2(DEFAULT_DATA_BUDGET_USD);

/**
 * The questions, built per render because one answer states what Tocker charges. That
 * number is the server's own (`platformFeeUsd()`), never one typed here: the page said
 * "a flat fee" with no amount, and an amount written in by hand would outlive a change.
 *
 * Two more answers are the server's for the same reason: whether an agent needs an API
 * key at all depends on a switch (`thinkingAnswers`). With that switch anywhere but fully
 * on, which is how it ships, they read exactly as they always have. The providers they
 * name are the ones a key can be added for today, read from the registry here, on the
 * server, so the page cannot name one that is not switched on.
 */
const faqTabs = (feeUsd: number, thinking: { model: string; start: string }): FaqTab[] => [
  {
    label: "FAQ",
    faqs: [
      {
        question: "What does the agent trade?",
        answer:
          "Any token on Solana and Base that clears ten hard gates (mint and freeze authority, honeypot, sell check, tax, liquidity, holders, age, top-ten share and your blocklist) and scores at or above your floor. No score overrides a gate, and every threshold is yours to set.",
      },
      {
        question: "How do exits work?",
        answer:
          "In code, not in the prompt. Stop loss, take profit, a collapsing score and a draining pool are checked every five minutes, model awake or not, and entry rules never block a sell.",
      },
      {
        question: "How often does it run, and does it ask first?",
        answer:
          "As often as you like: every five minutes, once a week, or only when you press Run. It can ask before each trade (a proposal you miss expires after an hour) or trade on its own, and you can switch either way at any time.",
      },
      {
        question: "Who controls the agent’s wallet?",
        answer:
          "Each agent gets its own wallet on Solana and Base, separate from yours. Tocker signs its trades so it can act while you are away, the keys can't be exported, and withdrawals are yours alone.",
      },
      {
        question: "What does it cost, and what do I need?",
        answer: `Data is on us: Tocker pays the vendors per call in USDC over x402, up to ${BUDGET} a run by default.${feeSentence(feeUsd)} To start: ${thinking.start.charAt(0).toLowerCase()}${thinking.start.slice(1)}`,
      },
    ],
  },
];

export function LiquidLanding({ hasSession }: { hasSession: boolean }) {
  return (
    <SmoothScroll>
      <div className="lp">
        <Nav hasSession={hasSession} />
        <main id="main" tabIndex={-1}>
          <Hero hasSession={hasSession} />
          <How />
          <PublicFeed eyebrow="02 — Feed" />
          <Sources />
          <Performance />
          <Guardrails />
          <Faq />
          <CloseCta hasSession={hasSession} />
        </main>
        <Footer />
      </div>
    </SmoothScroll>
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
        lede="The run from the top of the page, as its owner sees it: what it scored, the data it bought, and the two buys waiting for approval."
      />
      <AgentConsole />
    </section>
  );
}

/** How many sources the table shows; the rest are counted in its last line. */
const SHOWN_SOURCES = 6;
/** Defaults first, then the safety sources, then the rest in registry order. */
const sourceRank = (s: LandingSource) => (s.tier === "default" ? 0 : s.guard ? 1 : 2);

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
        lede={`${total} paid sources to choose from, ${defaults} on by default. Tocker pays each source per call in USDC over x402, up to the per-run budget you set (${BUDGET} by default).`}
      />
      <div className="lp-src lp-frame">
        <div className="lp-src-table" role="table" aria-label={`Paid data sources, ${rows.length} of ${total}`}>
          <div role="rowgroup">
            <div className="lp-src-row lp-src-head lp-label" role="row">
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
                  {usd3(s.priceUsd)}
                </span>
              </div>
            ))}
          </div>
        </div>
        <p className="lp-src-foot lp-label">
          <span>+ {total - rows.length} more sources</span>
          <span className="lp-src-legend">guard: safety data</span>
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
        lede="Equity, open positions and what each run spends on data. Trades are public by default; your strategy never is."
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
        lede="Stop loss, take profit, a collapsing score and a draining pool are checked in code every five minutes, between runs too. Blocklist a token you hold, spend the day’s trades, hit the kill switch: the sell still goes through."
      />
      <GuardrailsBento />
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
        lede="What it trades, what it costs and who holds the wallet."
      />
      <FaqList tabs={faqTabs(feeEnabled() ? platformFeeUsd() : 0, thinkingAnswers(inferenceFlags().stage === "on", PROVIDER_ORDER.map(providerLabel)))} />
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
            Not investment advice. Token names are real; every token price, score, P&amp;L and trade on this page is
            an illustrative sample. Data prices and defaults are the product’s own. Trading crypto can lose everything
            you put in an agent’s wallet.
          </p>
          <p className="lp-mono lp-footer-copy">© 2026 Tocker</p>
        </div>
      </div>
      <FooterWordmark />
    </footer>
  );
}
