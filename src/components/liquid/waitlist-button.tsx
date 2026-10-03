"use client";

import type { ReactNode } from "react";
import { useWaitlist } from "./waitlist";

/**
 * The page's waitlist buttons as tiny client islands, so the server-rendered
 * sections (and the nav) can open the waitlist without becoming client
 * components themselves.
 */

/** The primary pill: "Join the waitlist" with a nudging arrow. */
export function WaitlistButton({ children = "Join the waitlist", className }: { children?: ReactNode; className?: string }) {
  const { open } = useWaitlist();
  return (
    <button type="button" className={className ? `lp-btn-primary ${className}` : "lp-btn-primary"} onClick={open}>
      {children}
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden className="lp-btn-arrow">
        <path d="M2 8h11M8.5 3.5 13 8l-4.5 4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}

/** The nav's quiet ghost pill, "Join" on phones. */
export function NavWaitlistPill() {
  const { open } = useWaitlist();
  return (
    <button type="button" className="lp-nav-cta lp-btn-ghost" aria-label="Join the waitlist" onClick={open}>
      <span className="lp-nav-cta-lg" aria-hidden>
        Join the waitlist
      </span>
      <span className="lp-nav-cta-sm" aria-hidden>
        Join
      </span>
    </button>
  );
}
