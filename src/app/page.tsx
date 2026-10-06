import type { Metadata } from "next";
import { cookies } from "next/headers";
import { LiquidLanding } from "@/components/liquid/liquid-landing";

const TITLE = "Tocker — AI trading agents for Solana and Base";
const DESCRIPTION =
  "Describe a strategy in plain English. Your agent screens new tokens on Solana and Base, trades the few that clear your bar, and asks before it buys. Open now; every agent starts on paper.";

/**
 * The two cookies the auth client writes after sign-in, the same pair the sign-in page
 * reads as its hint: the access token, which lapses about an hour in, and the thirty-day
 * marker that says this browser has a session that can be renewed. Without the second,
 * someone who signed in yesterday would be offered "Get started" this morning.
 */
const SESSION_COOKIES = ["privy-token", "privy-session"];

// `absolute` so the root layout's "%s · Tocker" template does not stutter on the one
// page where the product name is already the whole title.
export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  openGraph: { title: TITLE, description: DESCRIPTION, type: "website" },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

/**
 * The landing page. The one thing it reads from the request is whether an auth cookie
 * came with it, and it only reads that it is there: a visitor who is probably signed in
 * gets "Open the app" where everyone else gets "Sign in" and "Get started".
 *
 * A hint, never a permission. Neither cookie is verified here and either may be stale,
 * so nothing is redirected or withheld on it; `/home` does the real check and sends an
 * expired session to sign-in, which renews it or shows the form. Both cookies are
 * SameSite=Strict, so a visitor who follows a link from another site arrives without
 * them and sees "Sign in", which still takes a signed-in person straight into the app.
 * The page was already rendered per request (the root layout's `connection()`), so
 * reading a cookie changes nothing about caching.
 */
export default async function LandingPage() {
  const jar = await cookies();
  const hasSession = SESSION_COOKIES.some((name) => jar.has(name));
  return <LiquidLanding hasSession={hasSession} />;
}
