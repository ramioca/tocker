import { describe, expect, it } from "vitest";
import { RATE_LIMITS, RateLimiter, clientKey, isCrossOrigin, limitForPath, rateLimitHeaders } from "./rate-limit";

const rule = { limit: 3, windowMs: 1_000 };

describe("RateLimiter", () => {
  it("allows exactly `limit` requests, then refuses", () => {
    const rl = new RateLimiter();
    const now = 1_000_000;

    expect(rl.consume("a", rule, now).ok).toBe(true);
    expect(rl.consume("a", rule, now).ok).toBe(true);
    const third = rl.consume("a", rule, now);
    expect(third.ok).toBe(true);
    expect(third.remaining).toBe(0);

    const fourth = rl.consume("a", rule, now);
    expect(fourth.ok).toBe(false);
    expect(fourth.retryAfterSeconds).toBe(1);
  });

  it("keys are independent — one noisy client cannot lock out another", () => {
    const rl = new RateLimiter();
    const now = 1_000_000;
    for (let i = 0; i < 10; i++) rl.consume("noisy", rule, now);
    expect(rl.consume("quiet", rule, now).ok).toBe(true);
  });

  it("rolls the window over once it has elapsed", () => {
    const rl = new RateLimiter();
    const now = 1_000_000;
    for (let i = 0; i < 4; i++) rl.consume("a", rule, now);
    expect(rl.consume("a", rule, now).ok).toBe(false);
    expect(rl.consume("a", rule, now + rule.windowMs + 1).ok).toBe(true);
  });

  it("a refused request does not extend the window", () => {
    const rl = new RateLimiter();
    const now = 1_000_000;
    for (let i = 0; i < 6; i++) rl.consume("a", rule, now + i);
    // still the original window, not pushed out by the extra attempts
    expect(rl.consume("a", rule, now + rule.windowMs + 1).ok).toBe(true);
  });

  /** An attempt that failed on our side is handed back, so a retry is not a strike. */
  it("refund gives one unit back and never more than was taken", () => {
    const rl = new RateLimiter();
    const now = 1_000_000;
    for (let i = 0; i < 3; i++) rl.consume("a", rule, now);
    expect(rl.consume("a", rule, now).ok).toBe(false);

    // Four were counted; two back leaves room for exactly one more.
    rl.refund("a", now);
    rl.refund("a", now);
    expect(rl.consume("a", rule, now).ok).toBe(true);
    expect(rl.consume("a", rule, now).ok).toBe(false);

    // A key nobody has used is left alone, and a count never goes below zero: ten
    // refunds against one unit taken do not buy nine extra requests.
    rl.refund("never", now);
    expect(rl.consume("never", rule, now).remaining).toBe(2);
    rl.consume("b", rule, now);
    for (let i = 0; i < 10; i++) rl.refund("b", now);
    expect(rl.consume("b", rule, now).remaining).toBe(2);
  });

  it("refund does not reach into a window that has already rolled over", () => {
    const rl = new RateLimiter();
    const now = 1_000_000;
    rl.consume("a", rule, now);
    const later = now + rule.windowMs + 1;
    rl.refund("a", later);
    const next = rl.consume("a", rule, later);
    expect(next.remaining).toBe(2);
    expect(next.resetAt).toBe(later + rule.windowMs);
  });
});

describe("clientKey", () => {
  it("prefers the platform header over the spoofable one", () => {
    const headers = new Headers({
      "x-vercel-forwarded-for": "1.2.3.4",
      "x-forwarded-for": "9.9.9.9",
    });
    expect(clientKey(headers, "me")).toBe("me:1.2.3.4");
  });

  it("takes the first hop of x-forwarded-for", () => {
    const headers = new Headers({ "x-forwarded-for": "1.2.3.4, 5.6.7.8" });
    expect(clientKey(headers, "cron")).toBe("cron:1.2.3.4");
  });

  /** A missing header must collapse to one shared bucket, never to "no limit". */
  it("falls back to a shared bucket when nothing identifies the caller", () => {
    expect(clientKey(new Headers(), "me")).toBe("me:unknown");
  });
});

describe("rateLimitHeaders", () => {
  it("omits retry-after while the caller is within budget", () => {
    const headers = rateLimitHeaders({
      ok: true,
      limit: 10,
      remaining: 9,
      resetAt: Date.now() + 10_000,
      retryAfterSeconds: 0,
    });
    expect(headers["retry-after"]).toBeUndefined();
    expect(headers["ratelimit-remaining"]).toBe("9");
  });

  it("adds retry-after once refused", () => {
    const headers = rateLimitHeaders({
      ok: false,
      limit: 10,
      remaining: 0,
      resetAt: Date.now() + 10_000,
      retryAfterSeconds: 10,
    });
    expect(headers["retry-after"]).toBe("10");
  });
});

describe("limitForPath", () => {
  it("covers the public endpoints that cost something per call", () => {
    expect(limitForPath("/api/solana/rpc")?.rule).toBe(RATE_LIMITS.solanaRpc);
    expect(limitForPath("/api/solana/blockhash")?.rule).toBe(RATE_LIMITS.blockhash);
    expect(limitForPath("/api/tokens/search")?.rule).toBe(RATE_LIMITS.tokenSearch);
    expect(limitForPath("/api/models/openrouter")).toEqual({ rule: RATE_LIMITS.tokenSearch, prefix: "models" });
    expect(limitForPath("/api/health")?.rule).toBe(RATE_LIMITS.cron);
  });

  /** Discover's public list runs a search and aggregates per call, and had no bucket at all. */
  it("covers the public agent list, in a bucket of its own", () => {
    const discover = limitForPath("/api/discover/agents");
    expect(discover?.rule).toBe(RATE_LIMITS.tokenSearch);
    expect(discover?.prefix).not.toBe(limitForPath("/api/tokens/search")?.prefix);
  });

  /**
   * The relay's request limit cannot see inside a batch, so the calls have a rule of
   * their own. It has to admit one full batch, or a legitimate one could never pass.
   */
  it("counts the Solana relay in calls as well as requests", () => {
    expect(RATE_LIMITS.solanaRpcCalls.windowMs).toBe(RATE_LIMITS.solanaRpc.windowMs);
    expect(RATE_LIMITS.solanaRpcCalls.limit).toBeGreaterThanOrEqual(20);
    // Twenty-call batches at the request limit would be 1,200 calls a minute.
    expect(RATE_LIMITS.solanaRpcCalls.limit).toBeLessThan(RATE_LIMITS.solanaRpc.limit * 20);
  });

  /** The run page and its prefetches must not share the run-trigger bucket. */
  it("matches the run trigger exactly", () => {
    expect(limitForPath("/api/agents/a1/run")?.rule).toBe(RATE_LIMITS.sensitive);
    expect(limitForPath("/api/agents/a1/runs/r1")).toBeNull();
  });

  it("gives each cron route its own bucket", () => {
    expect(limitForPath("/api/cron/tick")?.prefix).not.toBe(limitForPath("/api/cron/marks")?.prefix);
  });

  it("leaves pages alone", () => {
    expect(limitForPath("/feed")).toBeNull();
    expect(limitForPath("/agents/foo")).toBeNull();
  });
});

describe("isCrossOrigin", () => {
  it("lets a same-origin browser request through", () => {
    expect(isCrossOrigin(new Headers({ origin: "https://tocker.xyz", host: "tocker.xyz" }))).toBe(false);
  });

  it("prefers the forwarded host the browser actually dialled", () => {
    const headers = new Headers({ origin: "https://tocker.xyz", host: "internal:3000", "x-forwarded-host": "tocker.xyz" });
    expect(isCrossOrigin(headers)).toBe(false);
  });

  it("refuses another site, and the opaque 'null' origin", () => {
    expect(isCrossOrigin(new Headers({ origin: "https://evil.example", host: "tocker.xyz" }))).toBe(true);
    expect(isCrossOrigin(new Headers({ origin: "null", host: "tocker.xyz" }))).toBe(true);
  });

  /** No Origin is a non-browser caller; the rate limit is what bounds it. */
  it("does not require an Origin", () => {
    expect(isCrossOrigin(new Headers({ host: "tocker.xyz" }))).toBe(false);
  });
});
