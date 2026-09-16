/**
 * Cron endpoint authorization.
 *
 * WHAT THIS PROTECTS AGAINST: anyone on the internet triggering the agent loop —
 * which spends the operator's LLM key, buys x402 data and can place trades — by
 * knowing a URL. The endpoints are public routes on a public domain; the secret
 * is the only thing between them and the world.
 *
 * Three properties the previous inline check did not have:
 *  1. Constant-time comparison, so response timing cannot be used to recover the
 *     secret byte by byte. `header === "Bearer " + secret` short-circuits on the
 *     first differing character.
 *  2. A minimum secret length, so a deploy with `CRON_SECRET=test` is refused
 *     rather than quietly protecting nothing.
 *  3. A distinguishable reason, so "I forgot to set CRON_SECRET" does not look
 *     identical to "someone is guessing".
 */

/** 32 hex characters is 128 bits. `openssl rand -hex 32` gives 64. */
const MIN_SECRET_LENGTH = 32;

export type CronAuthResult =
  | { ok: true }
  | { ok: false; status: 401 | 503; error: string };

/** Length-safe, content-constant-time string equality. */
export function timingSafeEqual(a: string, b: string): boolean {
  // Compare over the max length so the loop count does not leak which is shorter.
  const length = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < length; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

export function authorizeCron(headerValue: string | null, secret = process.env.CRON_SECRET): CronAuthResult {
  const configured = secret?.trim() ?? "";

  if (!configured) {
    // 503, not 401: the deploy is broken, and saying so out loud beats an
    // unexplained 401 in a cron log at 3am.
    return { ok: false, status: 503, error: "CRON_SECRET is not set on this deployment" };
  }
  if (configured.length < MIN_SECRET_LENGTH) {
    return {
      ok: false,
      status: 503,
      error: `CRON_SECRET is too short (${configured.length} chars); use at least ${MIN_SECRET_LENGTH} — \`openssl rand -hex 32\``,
    };
  }

  const presented = headerValue?.trim() ?? "";
  if (!presented.toLowerCase().startsWith("bearer ")) {
    return { ok: false, status: 401, error: "unauthorized" };
  }
  return timingSafeEqual(presented.slice(7).trim(), configured)
    ? { ok: true }
    : { ok: false, status: 401, error: "unauthorized" };
}
