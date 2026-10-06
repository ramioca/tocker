/**
 * When to next ask the auth client for an access token, so the server keeps recognising
 * a tab that stays open.
 *
 * The server's only credential is the cookie the auth client writes, and that cookie
 * expires with the access token (about an hour). The client renews a token only when it
 * is asked for one, and only inside the last thirty seconds of the token's life; asked
 * any earlier it hands back the one it already has. So the keep-alive
 * (`SessionKeepAlive`) has to wake inside that window, and this is the arithmetic for
 * when. Tested in `token-expiry.test.ts`.
 */

/** Wake this long before expiry: inside the client's thirty-second renewal window, with room to finish. */
const RENEW_LEAD_MS = 20_000;
/** Never spin: a token already inside the window is asked for again in five seconds at the soonest. */
const MIN_WAIT_MS = 5_000;
/** Never sleep longer than this, so a clock that jumped or a timer that drifted is caught the same hour. */
const MAX_WAIT_MS = 900_000;
/** No token, or one that cannot be read: look again in a minute. */
const UNKNOWN_WAIT_MS = 60_000;

/**
 * Milliseconds to wait before asking again, given the token just handed back and the
 * time now. The token is only read for its `exp`; it is never verified here, because
 * nothing is decided on it. A forged expiry could only make this tab ask sooner or later.
 */
export function msUntilRenewal(token: string | null | undefined, now: number): number {
  const expiresAt = expiryMs(token);
  if (expiresAt === null) return UNKNOWN_WAIT_MS;
  return Math.min(MAX_WAIT_MS, Math.max(MIN_WAIT_MS, expiresAt - now - RENEW_LEAD_MS));
}

/** The `exp` claim of a JWT as epoch milliseconds, or null when there is none to read. */
function expiryMs(token: string | null | undefined): number | null {
  if (!token) return null;
  const payload = token.split(".")[1];
  if (!payload) return null;
  try {
    // JWT segments are base64url without padding; `atob` wants plain base64 with it.
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const claims: unknown = JSON.parse(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "=")));
    const exp = claims && typeof claims === "object" ? (claims as { exp?: unknown }).exp : null;
    return typeof exp === "number" && Number.isFinite(exp) ? exp * 1000 : null;
  } catch {
    return null;
  }
}
