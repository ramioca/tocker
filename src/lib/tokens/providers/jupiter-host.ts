/**
 * Which Jupiter host to talk to, and how to authenticate.
 *
 * Jupiter runs two API tiers: `api.jup.ag` for keyed apps (a key from portal.jup.ag,
 * higher rate limits) and `lite-api.jup.ag`, the keyless tier with lower limits. Both
 * serve the same paths (`/ultra/v1/*`, `/price/v3`, `/tokens/v2/*`). Without a key the
 * keyless tier is the honest choice: unkeyed calls to the keyed host answer 200 while
 * quiet and 429 under load, which used to surface as "no route".
 *
 * No imports on purpose — `src/lib/trading/tokens.ts` and the token providers both
 * need this, and one imports the other.
 */
export function jupiterApiKey(): string | null {
  const key = process.env.JUPITER_API_KEY?.trim();
  return key ? key : null;
}

/** Base URL, no trailing slash. */
export function jupiterBase(): string {
  return jupiterApiKey() ? "https://api.jup.ag" : "https://lite-api.jup.ag";
}

export function jupiterHeaders(): Record<string, string> {
  const key = jupiterApiKey();
  return key ? { "x-api-key": key } : {};
}
