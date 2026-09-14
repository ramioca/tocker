"use client";

/**
 * The marketing primary action. `LoginButton` is the app's account control and always
 * says "Sign in"; a landing page's first button should name what the visitor gets, so
 * this one says "Build an agent" and only falls back to the login modal when there is no
 * session. Same `useSession()` underneath — no second auth path.
 */

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { cn } from "cn";
import { useSession } from "@/hooks/use-session";

export function StartButton({
  className,
  label = "Build an agent",
  signedInLabel = "Open the app",
  signedInHref = "/feed",
}: {
  className?: string;
  label?: string;
  signedInLabel?: string;
  signedInHref?: string;
}) {
  const { ready, session, login } = useSession();

  // No skeleton: on a marketing page the logged-out action is the right default, and a
  // pulsing placeholder where the main CTA should be reads as broken.
  if (ready && session) {
    return (
      <Link href={signedInHref} className={cn("lp-cta", className)}>
        {signedInLabel}
        <ArrowRight className="size-4" aria-hidden />
      </Link>
    );
  }

  return (
    <button type="button" onClick={() => login()} className={cn("lp-cta", className)}>
      {label}
      <ArrowRight className="size-4" aria-hidden />
    </button>
  );
}
