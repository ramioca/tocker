import { Suspense } from "react";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { LoginFlow } from "./login-flow";

// The root layout appends " · Tocker". Not indexed: there is nothing here to find.
export const metadata: Metadata = { title: "Sign in", robots: { index: false } };

/**
 * The two cookies the auth client writes after sign-in. The first is the access token,
 * the one `src/lib/auth.ts` verifies; it expires with the token, about an hour in. The
 * second is the client's thirty-day "this browser has a session that can be renewed"
 * marker, which is still there the next morning when the first has lapsed.
 */
const SESSION_COOKIES = ["privy-token", "privy-session"];

/**
 * The way in.
 *
 * Sign-in is Tocker's own surface, start to finish — `SignInCard` runs the headless
 * auth hooks and nothing from the auth vendor is drawn here. This page only reads
 * whether an auth cookie came with the request, so a visitor who is probably signed
 * in already is not shown a sign-in form first (see LoginFlow), and holds the
 * Suspense boundary `useSearchParams` needs.
 *
 * Either cookie is only ever a hint about what to draw while the client finds out.
 * Neither is read here as a session, and nothing is allowed or redirected on it.
 */
export default async function LoginPage() {
  const jar = await cookies();
  const sessionCookie = SESSION_COOKIES.some((name) => jar.has(name));
  return (
    <Suspense fallback={null}>
      <LoginFlow sessionCookie={sessionCookie} />
    </Suspense>
  );
}
