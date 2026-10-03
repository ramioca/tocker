"use client";

import { useEffect, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { SignInCard } from "@/components/auth/sign-in-card";
import { POST_LOGIN_HOME, useSession } from "@/hooks/use-session";
import { safeNext } from "./safe-next";

/**
 * Work out where the visitor was heading, forward them there when they turn out to
 * be signed in already, and otherwise show the sign-in card.
 *
 * `sessionCookie` is the server's read of the auth cookie. It is a hint, not a
 * session: it only decides what shows while the client is still finding out, so a
 * signed-in visitor sees a neutral line instead of an email form that is about to
 * vanish, and a signed-out one (no cookie) gets the form straight away.
 */
export function LoginFlow({ sessionCookie }: { sessionCookie: boolean }) {
  const router = useRouter();
  const params = useSearchParams();
  const { ready, session } = useSession();
  const raw = params.get("next");
  // Resolved against this page's own origin — see safe-next.ts. `window` is undefined on
  // the server pass, which falls back to the home path; the effect below runs on the
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

  // Already in: the effect above is a tick behind the render, so say what is happening
  // rather than flashing a sign-in form at someone who is signed in.
  const status = ready && session ? "Signed in — taking you back." : !ready && sessionCookie ? "Checking your session…" : null;

  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      {status ? (
        <div role="status" className="glass-panel w-full max-w-[360px] rounded-2xl p-6 text-center">
          <p className="text-sm text-muted-foreground">{status}</p>
        </div>
      ) : (
        <SignInCard next={next} returningFromOAuth={returningFromOAuth} />
      )}
    </main>
  );
}
