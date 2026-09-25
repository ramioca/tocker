import { Suspense } from "react";
import { cookies } from "next/headers";
import { LoginFlow } from "./login-flow";

/** Set by the auth client after sign-in; the same cookie `src/lib/auth.ts` verifies. */
const SESSION_COOKIE = "privy-token";

/**
 * The way in.
 *
 * Sign-in is Tocker's own surface, start to finish — `SignInCard` runs the headless
 * auth hooks and nothing from the auth vendor is drawn here. This page only reads
 * whether an auth cookie came with the request, so a visitor who is probably signed
 * in already is not shown a sign-in form first (see LoginFlow), and holds the
 * Suspense boundary `useSearchParams` needs.
 */
export default async function LoginPage() {
  const sessionCookie = (await cookies()).has(SESSION_COOKIE);
  return (
    <Suspense fallback={null}>
      <LoginFlow sessionCookie={sessionCookie} />
    </Suspense>
  );
}
