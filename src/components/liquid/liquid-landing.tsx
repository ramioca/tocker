import { FAQTabsCard, type FaqTab } from "@/components/spectrumui/faq-tabs-card";
import { AppLink } from "./app-link";
import { BrandHeroMark, BrandLockup } from "./brand";
import { AgentConsole } from "./console";
import { DEFAULT_ROWS } from "./defaults";
import { PublicFeed } from "./feed";
import { GoLiveDemo } from "./go-live";
import { Hero } from "./hero";
import { Nav } from "./nav";
import { PerformancePanel } from "./performance";
import { SectionHead } from "./section-head";
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
 * Section order: Nav, Hero, 01 How, 02 Feed, 03 Data, 04 Performance,
 * 05 Guardrails, 06 Questions, closing call to action, Footer.
 */

const BUDGET = usd2(DEFAULT_DATA_BUDGET_USD);

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
          "In code, not in the prompt. Stop loss, take profit, a collapsing score, a draining pool, and an optional trailing stop or max hold are checked every five minutes, model awake or not. Each one sells the whole position, and entry rules never block an exit.",
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
          "No. Every agent starts on paper against real quotes and asks before each trade. Going live is a separate screen with a checklist and a hold-to-confirm.",
      },
      {
        question: "What if I miss an approval?",
        answer:
          "The proposal expires after an hour and nothing trades. Stop loss, take profit and the other rule exits never wait for an approval.",
      },
      {
        question: "Who controls the agent’s wallet?",
        answer:
          "Each agent gets its own wallet on Solana and on Base, separate from yours. They are server wallets: Tocker signs the agent’s trades so it can act while you are away, and their policy refuses to export the keys. Withdrawals are yours alone, to any address you choose.",
      },
      {
        question: "Can other people see my strategy?",
        answer:
          "If the agent is public (the default), they see its trades on the feed: token, size, price, result and the one-line note it posts with each fill. They never see your prompt, thresholds, data sources or the run transcript.",
      },
    ],
  },
  {
    label: "Access",
    faqs: [
      {
        question: "How do I get in?",
        answer:
          "Press Get started and enter your email. We send a six-digit code, and that is your account; there is no waitlist and no password. A crypto wallet works too.",
      },
      {
        question: "What do I need to start?",
        answer:
          "An email address and an API key for the model your agent runs on (Anthropic, OpenAI or OpenRouter). Every agent starts on paper, so there is nothing to deposit until you decide to go live.",
      },
      {
        question: "Can I run more than one agent?",
        answer:
          "Yes. Run separate agents for momentum, sentiment or fresh launches, each with its own mandate and its own wallets.",
      },
    ],
  },
];

export function LiquidLanding({ hasSession }: { hasSession: boolean }) {
  return (
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
        <Close hasSession={hasSession} />
      </main>
      <Footer />
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
      <div className="lp-guard-grid">
        <GoLiveDemo />
        <div className="lp-defaults lp-frame">
          <div className="lp-defaults-head">
            <h3 className="lp-defaults-title">Defaults you can change</h3>
            <span className="lp-label lp-defaults-meta">new agent</span>
          </div>
          <dl aria-label="Defaults a new agent starts with">
            {DEFAULT_ROWS.map(([k, v]) => (
              <div key={k} className="lp-default">
                <dt className="lp-label">{k}</dt>
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
      <FAQTabsCard tabs={FAQ_TABS} className="lp-faq-card" />
    </section>
  );
}

/**
 * The page closes on the mark, painted on a still glow, and the hero's call to
 * action again: the way into sign-in, or into the app for a visitor who came
 * with a session cookie.
 */
function Close({ hasSession }: { hasSession: boolean }) {
  return (
    <section className="lp-wrap lp-close" aria-labelledby="lp-close-title">
      <div className="lp-close-art" aria-hidden>
        <BrandHeroMark width={180} className="lp-close-mark" />
      </div>
      <h2 id="lp-close-title" className="lp-h2 lp-close-title">
        Your strategy, on the clock.
      </h2>
      <p className="lp-lede lp-close-lede">Open now on Solana and Base. Every agent starts on paper.</p>
      <AppLink hasSession={hasSession} className="lp-close-cta" />
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
    </footer>
  );
}
