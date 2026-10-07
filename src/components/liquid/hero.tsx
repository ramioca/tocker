import type { CSSProperties } from "react";
import { AppLink } from "./app-link";
import { HeroRun } from "./hero-run";
import { HeroShader } from "./hero-shader";

/**
 * Hero: an eyebrow, the two-line promise, one sentence on how, one action and
 * one quiet link. Under them sits a single flat card, the sample agent's latest
 * run as its owner sees it (hero-run.tsx). The action goes to sign-in, where a
 * new address makes an account; with a session cookie on the request it opens
 * the app instead.
 *
 * The type rises in on load, in a short stagger. The headline only slides: it
 * is the largest text on the screen, and an element painted at opacity 0 is
 * not counted as painted, so a fade would hold back the first meaningful paint.
 */

const delay = (s: string) => ({ "--reveal-delay": s }) as CSSProperties;

export function Hero({ hasSession }: { hasSession: boolean }) {
  return (
    <section className="lp-hero" aria-labelledby="lp-hero-title">
      <HeroShader />
      <div className="lp-hero-head lp-wrap">
        <p className="lp-hero-eyebrow lp-eyebrow reveal" style={delay("0s")}>
          <span className="lp-hero-dot" aria-hidden />
          {/* One item beside the dot, so the two halves keep a word space between them. */}
          <span>
            Now open<span className="lp-hero-eyebrow-more"> · Solana and Base</span>
          </span>
        </p>
        <h1 id="lp-hero-title" className="lp-h1 reveal" style={delay("0.06s")}>
          <span className="lp-h1-line">Your agent trades</span>{" "}
          <span className="lp-h1-line">
            while you <span className="lp-mark">sleep</span>.
          </span>
        </h1>
        <p className="lp-hero-sub reveal" style={delay("0.14s")}>
          Describe a strategy in plain English. Your agent screens new tokens and trades the few that clear your bar.
        </p>
        <div className="lp-hero-ctas reveal" style={delay("0.22s")}>
          <AppLink hasSession={hasSession} />
          <a href="#how" className="lp-hero-link">
            See how it decides
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden>
              <path d="M8 2.5v11M3.5 9 8 13.5 12.5 9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </a>
        </div>
      </div>

      <HeroRun />
    </section>
  );
}
