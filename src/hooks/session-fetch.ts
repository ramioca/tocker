/**
 * Reading the session from `/api/me`, including the one case where "no" is not the
 * answer yet.
 *
 * The server's only credential is the cookie the auth client writes, and that cookie
 * expires with the access token, about an hour in. A 401 from a browser that is still
 * signed in therefore usually means "the cookie ran out", not "signed out". So a 401 is
 * followed by asking the auth client to renew (which is what rewrites the cookie) and,
 * if it hands back a token, by one more read. One, not a loop: a second 401 is a real
 * no. A signed-out visitor has no token to renew, so they cost no second request.
 *
 * Kept apart from the hook so the rule can be tested without a browser
 * (`session-fetch.test.ts`). Nothing here loosens what the server accepts; it only
 * gets the client to present a credential the server would already take.
 */

/** As much of a `Response` as this reads. */
export type SessionResponse = Pick<Response, "status" | "ok" | "json">;

export async function readSession<T>(
  /** One request to `/api/me`. */
  ask: () => Promise<SessionResponse>,
  /**
   * Ask the auth client for a current access token, renewing it if it has run out.
   * Resolves null when nobody is signed in or the renewal could not be made. Pass null
   * where there is no auth client at all (local dev without one).
   */
  renew: (() => Promise<string | null>) | null,
): Promise<T | null> {
  let res = await ask();
  if (res.status === 401 && renew) {
    const token = await renew();
    if (token) res = await ask();
  }
  if (res.status === 401) return null;
  if (!res.ok) throw new Error(`/api/me failed: ${res.status}`);
  return (await res.json()) as T;
}
