/**
 * Proxy — Next.js 16's renamed Middleware (`src/proxy.ts`, one per project, Node
 * runtime by default; the `runtime` segment option is not available here).
 *
 * It does three things, all of which have to happen before anything else touches
 * the request:
 *
 *  1. **Security headers on every response**, including a nonce-based CSP. The
 *     nonce is set on the *request* headers as well, because that is how Next
 *     picks it up and stamps its own bootstrap scripts (see the CSP guide in
 *     `node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md`).
 *     A nonce only works on a page rendered per request, and setting one does not
 *     make a route dynamic; the root layout's `await connection()`
 *     (`src/app/layout.tsx`) does that for every route, the landing page included,
 *     which reads no request data of its own. Do not remove that call.
 *
 *  2. **Coarse rate limits** on `/api/me/*`, `/api/cron/*` and the public endpoints
 *     that cost something per call (the Solana RPC relay, the waitlist, token search;
 *     the full list is `limitForPath`). Coarse is the right word: the buckets are
 *     in this process's memory, so on serverless the real ceiling is
 *     `limit × instances` (see `src/lib/security/rate-limit.ts` and DEPLOY.md). The per-route checks inside the cron handlers are the ones that
 *     matter; this is the cheap first pass that keeps a loop from reaching them.
 *
 *  3. **A same-origin check on `/api/solana/rpc`** — public, so no session can
 *     guard it, but another site's page must not spend our RPC credits.
 *
 * Deliberately NOT here: authentication. Next's own docs warn that a matcher
 * change silently removes Proxy coverage from Server Functions, so every action
 * and route handler checks `getSession()` itself. This file only ever adds
 * headers or refuses — it never grants anything.
 */
import { NextResponse, type NextRequest } from "next/server";
import { createNonce, securityHeaders } from "@/lib/security/headers";
import { clientKey, isCrossOrigin, limitForPath, limiter, rateLimitHeaders } from "@/lib/security/rate-limit";

export const config = {
  // Everything except Next's own static output and the files in public/. Without
  // this the CSP would also be computed for every chunk and image, which is waste,
  // and a nonce on a static asset means nothing.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|apple-icon.png|.*\\.(?:png|jpg|svg|ico|webp)$).*)"],
};

export function proxy(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;
  const isDev = process.env.NODE_ENV === "development";
  const isHttps = request.nextUrl.protocol === "https:" || request.headers.get("x-forwarded-proto") === "https";

  const nonce = createNonce();
  const headers = securityHeaders({ nonce, isDev, isHttps });

  // The RPC relay spends our Helius credits and has no session to check; a browser on
  // another site always sends its Origin, so that is where it is refused.
  if (pathname === "/api/solana/rpc" && isCrossOrigin(request.headers)) {
    const refused = NextResponse.json({ error: "cross-origin request refused" }, { status: 403 });
    for (const [key, value] of headers) refused.headers.set(key, value);
    return refused;
  }

  const applicable = limitForPath(pathname);
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
