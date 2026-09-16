"use client";

import Link from "next/link";
import { POST_LOGIN_HOME, useSession } from "@/hooks/use-session";

/**
 * The landing page's way into the app. Signed in: a plain link. Signed out: opens
 * Privy right here and, once the session exists, the hook sends the browser to
 * `/home`, where onboarding is waiting for a first-time user. Same classes as the
 * other nav links so the header does not change shape between the two states.
 */
export function SignInLink({ className }: { className?: string }) {
  const { ready, session, login } = useSession();
  if (session) {
    return (
      <Link className={className} href={POST_LOGIN_HOME} data-cursor="magnetic">
        Open app
      </Link>
    );
  }
  return (
    <button
      type="button"
      className={className}
      data-cursor="magnetic"
      disabled={!ready}
      onClick={() => login({ redirectTo: POST_LOGIN_HOME })}
    >
      Sign in
    </button>
  );
}
