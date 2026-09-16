import { describe, expect, it } from "vitest";
import { RateLimiter, clientKey, rateLimitHeaders } from "./rate-limit";

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
