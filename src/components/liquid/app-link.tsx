import type { ReactNode } from "react";
import { LOGIN_HREF } from "@/lib/contact";

/** The signed-in home. It does the real session check and sends a stale cookie to sign-in. */
export const APP_HREF = "/home";

/**
 * The page's primary pill (hero and close): "Get started", which goes to sign-in, where
 * a new email address makes an account; or "Open the app" for a visitor who arrived
 * with a session cookie. A server component.
 *
 * A plain anchor, not `Link`, like every link from this page into the app or sign-in:
 * those routes mount the client providers with the nonce of the request that rendered
 * them, so they are entered by a full page load, never by a client-side transition from
 * a document that was served with a different one.
 */
export function AppLink({ hasSession, className }: { hasSession: boolean; className?: string }) {
  return (
    <PrimaryLink href={hasSession ? APP_HREF : LOGIN_HREF} className={className}>
      {hasSession ? "Open the app" : "Get started"}
    </PrimaryLink>
  );
}

function PrimaryLink({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  return (
    <a href={href} className={className ? `lp-btn-primary ${className}` : "lp-btn-primary"}>
      {children}
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden className="lp-btn-arrow">
        <path d="M2 8h11M8.5 3.5 13 8l-4.5 4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </a>
  );
}
