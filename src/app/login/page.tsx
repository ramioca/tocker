"use client";

import { useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { POST_LOGIN_HOME, useSession } from "@/hooks/use-session";

/**
 * The only way in. Not linked from the landing page on purpose: opening /login
 * (or being sent here by an owner-only page) opens Privy at once, and the session
 * hook returns the visitor to `next` when it completes. A signed-in visitor is
 * simply forwarded.
 */
export default function LoginPage() {
  const router = useRouter();
  const params = useSearchParams();
  const { ready, session, login } = useSession();
  const next = safeNext(params.get("next"));
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

/** Only same-origin paths: never bounce a visitor to another site after login. */
function safeNext(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return POST_LOGIN_HOME;
  return value;
}
