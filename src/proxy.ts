/**
 * Proxy — Next.js 16's renamed Middleware (`src/proxy.ts`, one per project, Node
 * runtime by default; the `runtime` segment option is not available here).
 *
 * It does two things, both of which have to happen before anything else touches
 * the request:
 *
 *  1. **Security headers on every response**, including a nonce-based CSP. The
 *     nonce is set on the *request* headers as well, because that is how Next
 *     picks it up and stamps its own bootstrap scripts (see the CSP guide in
 *     `node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md`).
 *     Setting a per-request nonce opts those routes into dynamic rendering; every
 *     route in this app already reads cookies for the session, so nothing is lost.
 *
 *  2. **Coarse rate limits** on `/api/me/*` and `/api/cron/*`. Coarse is the right
 *     word: the buckets are in this process's memory, so on serverless the real
 *     ceiling is `limit × instances` (see `src/lib/security/rate-limit.ts` and
 *     DEPLOY.md). The per-route checks inside the cron handlers are the ones that
 *     matter; this is the cheap first pass that keeps a loop from reaching them.
 *
 * Deliberately NOT here: authentication. Next's own docs warn that a matcher
 * change silently removes Proxy coverage from Server Functions, so every action
 * and route handler checks `getSession()` itself. This file only ever adds
 * headers or refuses — it never grants anything.
 */
import { NextResponse, type NextRequest } from "next/server";
import { createNonce, securityHeaders } from "@/lib/security/headers";
import { RATE_LIMITS, clientKey, limiter, rateLimitHeaders } from "@/lib/security/rate-limit";

export const config = {
  // Everything except Next's own static output and the files in public/. Without
  // this the CSP would also be computed for every chunk and image, which is waste,
  // and a nonce on a static asset means nothing.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|apple-icon.png|.*\\.(?:png|jpg|svg|ico|webp)$).*)"],
};

function limitFor(pathname: string): { rule: (typeof RATE_LIMITS)[keyof typeof RATE_LIMITS]; prefix: string } | null {
  if (pathname.startsWith("/api/cron/")) return { rule: RATE_LIMITS.cron, prefix: `cron${pathname}` };
  if (pathname.startsWith("/api/me")) return { rule: RATE_LIMITS.me, prefix: "me" };
  // Starting a run spends the owner's LLM key and can place a trade. Match the route
  // exactly: `includes("/run")` also caught `/agents/[slug]/runs/[runId]` — pages people
  // browse, plus Next's link prefetches — and ten of those a minute is a normal visit.
  if (/^\/api\/agents\/[^/]+\/run$/.test(pathname)) return { rule: RATE_LIMITS.sensitive, prefix: "run" };
  return null;
}

export function proxy(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;
  const isDev = process.env.NODE_ENV === "development";
  const isHttps = request.nextUrl.protocol === "https:" || request.headers.get("x-forwarded-proto") === "https";

  const nonce = createNonce();
  const headers = securityHeaders({ nonce, isDev, isHttps });

  const applicable = limitFor(pathname);
  if (applicable) {
    const verdict = limiter.consume(clientKey(request.headers, applicable.prefix), applicable.rule);
    if (!verdict.ok) {
      const refused = NextResponse.json(
        { error: "rate limited", retryAfterSeconds: verdict.retryAfterSeconds },
        { status: 429 },
      );
      for (const [key, value] of Object.entries(rateLimitHeaders(verdict))) refused.headers.set(key, value);
      for (const [key, value] of headers) refused.headers.set(key, value);
      return refused;
    }
  }

  // The request copy carries the CSP so Next can read the nonce out of it.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  for (const [key, value] of headers) requestHeaders.set(key, value);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  for (const [key, value] of headers) response.headers.set(key, value);
  return response;
}

export default proxy;
