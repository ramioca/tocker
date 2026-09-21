"use client";

import { Suspense, useEffect, useMemo, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { POST_LOGIN_HOME, useSession } from "@/hooks/use-session";
import { safeNext } from "./safe-next";

/**
 * The only way in. Not linked from the landing page on purpose: opening /login
 * (or being sent here by an owner-only page) opens Privy at once, and the session
 * hook returns the visitor to `next` when it completes. A signed-in visitor is
 * simply forwarded.
 */
export default function LoginPage() {
  // `useSearchParams` needs a Suspense boundary on a prerendered page, or the build fails.
  return (
    <Suspense fallback={null}>
      <LoginFlow />
    </Suspense>
  );
}

function LoginFlow() {
  const router = useRouter();
  const params = useSearchParams();
  const { ready, session, login } = useSession();
  const raw = params.get("next");
  // Resolved against this page's own origin — see safe-next.ts. `window` is undefined on
  // the prerender pass, which falls back to the home path; the effect below runs on the
  // client, where the real origin is available.
  const next = useMemo(
    () => safeNext(raw, typeof window === "undefined" ? null : window.location.origin, POST_LOGIN_HOME),
    [raw],
  );
  const opened = useRef(false);

  useEffect(() => {
    if (!ready) return;
    if (session) {
      router.replace(next);
      return;
    }
    if (!opened.current) {
      opened.current = true;
      login({ redirectTo: next });
    }
  }, [ready, session, next, router, login]);

  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <div className="glass-panel w-full max-w-sm rounded-2xl p-6 text-center">
        <p className="text-sm text-muted-foreground">
          {ready && session ? "Signed in — taking you back." : "Sign in to continue."}
        </p>
        {ready && !session ? (
          <Button type="button" className="mt-4" onClick={() => login({ redirectTo: next })}>
            Open sign in
          </Button>
        ) : null}
      </div>
    </main>
  );
}
