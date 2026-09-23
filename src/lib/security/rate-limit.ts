/**
 * In-memory token bucket.
 *
 * WHAT THIS PROTECTS AGAINST: a signed-out or signed-in client hammering an
 * endpoint — credential-stuffing `/api/me`, brute-forcing `CRON_SECRET`, or
 * simply melting the database from one tab. It raises the cost of a loop from
 * "free" to "you have to wait", which is enough for the abuse that actually
 * shows up at this size.
 *
 * WHAT IT DOES NOT PROTECT AGAINST — and this matters, so it is stated twice
 * and in DEPLOY.md: the counters live in this process's heap. On Vercel every
 * serverless instance and every Proxy invocation gets its own copy, so the real
 * ceiling is `limit × instances`, and a cold start resets it to zero. It is a
 * speed bump, not a quota. The moment this app has real users the buckets
 * belong in Redis/Upstash behind the same `consume()` signature, which is why
 * that signature is the only thing the callers know about.
 *
 * Nothing here throws, and a bucket store that grows unbounded would itself be
 * a denial of service, so entries are swept on write.
 */

export interface RateLimitRule {
  /** Requests allowed per window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
}

export interface RateLimitVerdict {
  ok: boolean;
  limit: number;
  /** Requests left in the current window after this one. */
  remaining: number;
  /** Epoch ms when the window rolls over. */
  resetAt: number;
  /** Seconds to wait, rounded up. 0 when allowed. */
  retryAfterSeconds: number;
}

interface Bucket {
  count: number;
  resetAt: number;
}

/** Sweep idle buckets once the store gets big rather than on a timer. */
const SWEEP_THRESHOLD = 5_000;

/**
 * A bucket store. Exported so tests can build an isolated one instead of
 * fighting the module-level singleton.
 */
export class RateLimiter {
  private buckets = new Map<string, Bucket>();

  consume(key: string, rule: RateLimitRule, now: number = Date.now()): RateLimitVerdict {
    if (this.buckets.size > SWEEP_THRESHOLD) this.sweep(now);

    const existing = this.buckets.get(key);
    const bucket = existing && existing.resetAt > now ? existing : { count: 0, resetAt: now + rule.windowMs };

    bucket.count += 1;
    this.buckets.set(key, bucket);

    const ok = bucket.count <= rule.limit;
    return {
      ok,
      limit: rule.limit,
      remaining: Math.max(0, rule.limit - bucket.count),
      resetAt: bucket.resetAt,
      retryAfterSeconds: ok ? 0 : Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
    };
  }

  /** Test helper — and the only way to forget a key without waiting out its window. */
  reset(key?: string): void {
    if (key === undefined) this.buckets.clear();
    else this.buckets.delete(key);
  }

  get size(): number {
    return this.buckets.size;
  }

  private sweep(now: number): void {
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
    }
  }
}

/**
 * Process-wide limiter. Stashed on `globalThis` so Next's dev HMR does not hand
 * every reload a fresh, empty store.
 */
const g = globalThis as unknown as { __tockerRateLimiter?: RateLimiter };
export const limiter: RateLimiter = (g.__tockerRateLimiter ??= new RateLimiter());

/** The rules, in one place, so the numbers can be read without reading the handlers. */
export const RATE_LIMITS = {
  /** Session and wallet reads. Generous: the shell polls some of these. */
  me: { limit: 120, windowMs: 60_000 },
  /** Cron endpoints. A correct caller hits these twice a minute at most. */
  cron: { limit: 30, windowMs: 60_000 },
  /** Anything that spends money or starts a run. */
  sensitive: { limit: 10, windowMs: 60_000 },
  /**
   * Trades a person places or approves by hand. Every Solana one is paid for by the
   * platform's fee wallet, so a loop of failing or tiny trades is a loop of its SOL.
   */
  trade: { limit: 20, windowMs: 60_000 },
  /** Agents created. Each one gets real wallets and a token account the platform funds. */
  agentCreate: { limit: 5, windowMs: 60 * 60_000 },
} as const satisfies Record<string, RateLimitRule>;

/** The most agents one person may own. Each has real wallets and rent the platform fronted. */
export const MAX_AGENTS_PER_USER = 25;

/**
 * Best-effort client identity for a bucket key.
 *
 * `x-forwarded-for` is trivially spoofed in general, but on Vercel the platform
 * rewrites it, and `x-real-ip` is set by the proxy. We prefer the platform
 * headers and fall back to a constant so a missing header degrades to a shared
 * (stricter) bucket rather than to no limit at all.
 */
export function clientKey(headers: Headers, prefix: string): string {
  const candidate =
    headers.get("x-vercel-forwarded-for") ??
    headers.get("x-real-ip") ??
    headers.get("x-forwarded-for")?.split(",")[0] ??
    "unknown";
  return `${prefix}:${candidate.trim() || "unknown"}`;
}

/** Standard rate-limit response headers (draft-7 naming plus `retry-after`). */
export function rateLimitHeaders(verdict: RateLimitVerdict): Record<string, string> {
  const headers: Record<string, string> = {
    "ratelimit-limit": String(verdict.limit),
    "ratelimit-remaining": String(verdict.remaining),
    "ratelimit-reset": String(Math.max(0, Math.ceil((verdict.resetAt - Date.now()) / 1000))),
  };
  if (!verdict.ok) headers["retry-after"] = String(verdict.retryAfterSeconds);
  return headers;
}
