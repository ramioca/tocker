import { timingSafeEqual as nodeTimingSafeEqual } from "node:crypto";

/**
 * Cron endpoint authorization.
 *
 * WHAT THIS PROTECTS AGAINST: anyone on the internet triggering the agent loop —
 * which spends the operator's LLM key, buys x402 data and can place trades — by
 * knowing a URL. The endpoints are public routes on a public domain; the secret
 * is the only thing between them and the world.
 *
 * Supersedes `src/lib/cron-auth.ts`, whose constant-time comparison this keeps and
 * whose two callers (the cron routes) now come here. It adds two things that a
 * bare comparison cannot express:
 *
 *  1. A minimum secret length, so a deploy with `CRON_SECRET=test` is refused
 *     rather than quietly protecting nothing.
 *  2. A distinguishable reason, so "I forgot to set CRON_SECRET" (503, a broken
 *     deploy) does not look identical to "someone is guessing" (401) in a cron
 *     log at 3am.
 */

/** 32 hex characters is 128 bits. `openssl rand -hex 32` gives 64. */
const MIN_SECRET_LENGTH = 32;

export type CronAuthResult = { ok: true } | { ok: false; status: 401 | 503; error: string };

/**
 * Constant-time string equality.
 *
 * `node:crypto`'s `timingSafeEqual` throws on a length mismatch, so the length is
 * compared first. That does leak the secret's *length* through timing, which is
 * not worth defending: the length is a fixed deployment property, not a secret,
 * and the alternative (padding) leaks it through the padding instead.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return nodeTimingSafeEqual(left, right);
}

export function authorizeCron(headerValue: string | null, secret = process.env.CRON_SECRET): CronAuthResult {
  const configured = secret?.trim() ?? "";

  if (!configured) {
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
