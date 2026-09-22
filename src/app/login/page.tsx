"use client";

import { Suspense, useEffect, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { SignInCard } from "@/components/auth/sign-in-card";
import { POST_LOGIN_HOME, useSession } from "@/hooks/use-session";
import { safeNext } from "./safe-next";

/**
 * The way in.
 *
 * Sign-in is Tocker's own surface, start to finish — `SignInCard` runs the headless
 * auth hooks and nothing from the auth vendor is drawn here. This page's own job is
 * small: work out where the visitor was heading, forward them there when they turn
 * out to be signed in already, and hold the Suspense boundary `useSearchParams`
 * needs on a prerendered route.
 */
export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginFlow />
    </Suspense>
  );
}

function LoginFlow() {
  const router = useRouter();
  const params = useSearchParams();
  const { ready, session } = useSession();
  const raw = params.get("next");
  // Resolved against this page's own origin — see safe-next.ts. `window` is undefined on
  // the prerender pass, which falls back to the home path; the effect below runs on the
  // client, where the real origin is available.
  const next = useMemo(
    () => safeNext(raw, typeof window === "undefined" ? null : window.location.origin, POST_LOGIN_HOME),
    [raw],
  );

  // An OAuth provider sends the visitor back to this exact URL with its authorization
  // code on the query string, which is why `?next=` has to travel in the URL: a ref
  // would not survive the round trip. The card reads this to show a finishing state
  // rather than the form while the code is exchanged.
  const returningFromOAuth = params.has("privy_oauth_code");

  useEffect(() => {
    if (ready && session) router.replace(next);
  }, [ready, session, next, router]);

  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      {ready && session ? (
        // Already in. The effect above is a tick behind the render, so say what is
        // happening rather than flashing a sign-in form at someone who is signed in.
        <div className="glass-panel w-full max-w-[360px] rounded-2xl p-6 text-center">
          <p className="text-sm text-muted-foreground">Signed in — taking you back.</p>
        </div>
      ) : (
        <SignInCard next={next} returningFromOAuth={returningFromOAuth} />
      )}
    </main>
  );
}
