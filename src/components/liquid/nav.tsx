"use client";

import Link from "next/link";
import { Mark } from "./mark";
import { useWaitlist } from "./waitlist";

/**
 * The announcement strip and the page bar. Both sit in the flow at the top of
 * the page rather than floating over it: nothing to blur, nothing to track on
 * scroll.
 */
export function Nav() {
  const { open } = useWaitlist();

  return (
    <>
      <button type="button" className="lp-announce" onClick={open}>
        <span className="lp-announce-dot" aria-hidden />
        <span className="lp-mono">Private beta</span>
        <span className="lp-announce-sep" aria-hidden />
        <span className="lp-announce-msg">
          <strong>Agents that trade</strong> Solana and Base, 24/7
        </span>
        <span className="lp-announce-sep" aria-hidden />
        <span className="lp-announce-cta">
          Join the waitlist
          <span aria-hidden> →</span>
        </span>
      </button>

      <header className="lp-nav">
        <div className="lp-nav-left">
          <Link href="/" className="lp-brand" aria-label="Tocker home">
            <Mark size={28} />
            <span>tocker</span>
          </Link>
          <span className="lp-nav-rule" aria-hidden />
          <nav aria-label="Main" className="lp-nav-links">
            <a href="#how">How it works</a>
            <a href="#data">Data</a>
            <a href="#performance">Performance</a>
            <a href="#faq">FAQ</a>
          </nav>
        </div>
        <button type="button" className="lp-btn-ghost" onClick={open}>
          Join the waitlist
        </button>
      </header>
    </>
  );
}
