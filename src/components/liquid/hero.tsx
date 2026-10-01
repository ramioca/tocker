"use client";

import { type CSSProperties } from "react";
import { AgentPreview } from "./agent-preview";
import { useWaitlist } from "./waitlist";
import "./landing.css";

/**
 * The hero. No canvas: the light is a static radial glow and a horizon arc,
 * the texture a masked hairline grid, all plain CSS that paints once. The
 * motion budget goes to the entrance and the product preview beneath the
 * copy, which is the thing a visitor actually wants to see.
 */
export function Hero() {
  const { open: openWaitlist } = useWaitlist();

  return (
    <section className="hero">
      <div className="hero-bg" aria-hidden>
        <div className="hero-grid" />
        <div className="hero-glow" />
        <div className="hero-limb" />
        <div className="hero-horizon" />
      </div>

      <div className="hero-copy">
        <p className="reveal hero-badge" style={{ "--reveal-delay": "0.05s" } as CSSProperties}>
          <span className="hero-badge-dot" aria-hidden />
          Private beta · Solana and Base
        </p>
        <h1 className="reveal hero-h1" style={{ "--reveal-delay": "0.12s" } as CSSProperties}>
          Your agent trades
          <span className="hero-h1-soft"> while you sleep.</span>
        </h1>
        <p className="reveal hero-sub" style={{ "--reveal-delay": "0.2s" } as CSSProperties}>
          Describe a strategy in plain English. Tocker builds an agent that scores every launch and
          trades it, 24/7 — on its own wallet, out in the open.
        </p>
        <div className="reveal hero-ctas" style={{ "--reveal-delay": "0.28s" } as CSSProperties}>
          <button type="button" className="cta-primary" onClick={openWaitlist}>
            Join the waitlist
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="cta-arrow" aria-hidden>
              <path d="M2 8h11M8.5 3.5 13 8l-4.5 4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <a className="cta-secondary" href="#mechanics">
            How it works
          </a>
        </div>
      </div>

      <div className="reveal hero-stage" style={{ "--reveal-delay": "0.42s" } as CSSProperties}>
        <AgentPreview />
      </div>
    </section>
  );
}
