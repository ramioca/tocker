"use client";

import { Mark } from "./mark";
import { useWaitlist } from "./waitlist";
import "./landing.css";

/**
 * The closing invite and footer. The hero's horizon returns low behind the
 * footer, in CSS, so the page ends on the same object it opened with.
 */
export function Contact() {
  const { open: openWaitlist } = useWaitlist();

  return (
    <section id="contact" className="ctc">
      <div className="ctc-bg" aria-hidden>
        <div className="ctc-limb" />
        <div className="ctc-horizon" />
      </div>

      <div className="ctc-invite rise">
        <p className="ctc-eyebrow">04 — Private beta</p>
        <h2 className="ctc-title">Ready to give a strategy a wallet?</h2>
        <p className="ctc-sub">We onboard by trading size, largest books first.</p>
        <button className="cta-primary ctc-cta" type="button" onClick={openWaitlist}>
          Join the waitlist
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="cta-arrow" aria-hidden>
            <path d="M2 8h11M8.5 3.5 13 8l-4.5 4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      <footer className="ctc-footer">
        <p className="ctc-brand">
          <Mark size={15} />
          <span>tocker · solana and base · paper by default</span>
        </p>
        <p className="ctc-legal">not investment advice</p>
      </footer>
    </section>
  );
}
