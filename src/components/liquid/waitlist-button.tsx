"use client";

import type { ReactNode } from "react";
import { useWaitlist } from "./waitlist";

/**
 * The page's primary pill ("Join the waitlist" with a nudging arrow) as a tiny
 * client island, so server-rendered sections can open the waitlist without
 * becoming client components themselves.
 */
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
