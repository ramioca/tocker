import { AppLink } from "./app-link";
import { HeroIntro } from "./hero-intro";
import { HeroRun } from "./hero-run";
import { HeroShader } from "./hero-shader";

/**
 * Hero: an eyebrow, the two-line promise, one sentence on how, one action and
 * one quiet link. Under them sits a single card, the sample agent's latest run
 * as its owner sees it (hero-run.tsx). The action goes to sign-in, where a new
 * address makes an account; with a session cookie on the request it opens the
 * app instead.
 *
 * Behind the type, a painted poster (always there, and all there is under reduced
 * motion or without WebGPU) and the live silk canvas, the same as the closing
 * section's, that crossfades in over it once it has drawn.
 *
 * Every word is in the server HTML. HeroIntro (a client leaf around this markup)
 * plays the load-in once: the headline and the sentence rise line by line out of
 * masks, then the actions, then the card out of depth. The parts it moves carry
 * `lp-intro`; see landing-hero.css for how they wait for it, and for how long.
 */
export function Hero({ hasSession }: { hasSession: boolean }) {
  return (
    <HeroIntro labelledBy="lp-hero-title">
      <div className="lp-hero-bg" aria-hidden>
        <div className="lp-hero-poster" />
        <HeroShader />
      </div>
      <div className="lp-hero-head lp-wrap">
        <p className="lp-hero-eyebrow lp-eyebrow lp-intro">
          <span className="lp-hero-dot" aria-hidden />
          {/* One item beside the dot, so the two halves keep a word space between them. */}
          <span>
            Now open<span className="lp-hero-eyebrow-more"> · Solana and Base</span>
          </span>
        </p>
        <h1 id="lp-hero-title" className="lp-h1 lp-intro">
          {/* Two set lines from 640px (each half keeps to one line, and both never fit on one). */}
          <span className="lp-h1-half">Your agent trades</span>{" "}
          <span className="lp-h1-half">
            while you{" "}
            {/* Word and full stop as one unit: split into lines, they would otherwise be two boxes the line can break between. */}
            <span className="lp-h1-end">
              <span className="lp-mark">sleep</span>.
            </span>
          </span>
        </h1>
        <p className="lp-hero-sub lp-intro">
          Describe a strategy in plain English. Your agent screens new tokens and trades the few that clear your bar.
        </p>
        <div className="lp-hero-ctas lp-intro">
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
    </HeroIntro>
  );
}
