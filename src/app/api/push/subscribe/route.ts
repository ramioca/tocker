/**
 * Register or forget one browser for Web Push.
 *
 * Session-gated both ways: a subscription belongs to a person, and the endpoint alone
 * must never be enough to attach a device to an account. `POST` is an upsert on the
 * endpoint — a browser hands back the same endpoint every time it re-subscribes, so a
 * user who taps "Enable alerts" on three pages ends up with one row, not three.
 *
 * Nothing here can send anything. It only records where a send would go.
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { removeSubscription, saveSubscription } from "@/lib/notifications/push";
import { RATE_LIMITS, clientKey, limiter, rateLimitHeaders } from "@/lib/security/rate-limit";

export const dynamic = "force-dynamic";

/**
 * Exactly the shape `PushSubscription.toJSON()` produces, plus the user agent the
 * client volunteers. The endpoint is bounded because it is stored and indexed, and the
 * keys are fixed-size base64url by the standard: `p256dh` is an uncompressed P-256
 * point (65 bytes → 87-88 chars) and `auth` is 16 bytes (22-24 chars). Sizes are
 * checked loosely — `web-push` is the authority on whether they actually work, and a
 * rejected key there costs one row, not a vulnerability.
 */
/**
 * https only. Every real push service is (the standard requires it), and it keeps a
 * signed-in user from registering `https://…`-shaped nonsense that would make the
 * server POST at an address of their choosing. Nothing of the response ever reaches
 * them, so this is hygiene rather than a hole being closed.
 */
const pushEndpoint = z
  .url({ protocol: /^https$/ })
  .max(2048);

const subscribeSchema = z.object({
  endpoint: pushEndpoint,
  keys: z.object({
    p256dh: z.string().min(16).max(256),
    auth: z.string().min(8).max(256),
  }),
  userAgent: z.string().max(512).optional(),
});

const unsubscribeSchema = z.object({
  endpoint: pushEndpoint,
});

async function readJson(req: NextRequest): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const verdict = limiter.consume(clientKey(req.headers, "push:subscribe"), RATE_LIMITS.me);
  if (!verdict.ok) {
    return NextResponse.json({ ok: false, error: "rate limited" }, { status: 429, headers: rateLimitHeaders(verdict) });
  }

  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const parsed = subscribeSchema.safeParse(await readJson(req));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "That is not a push subscription." }, { status: 400 });
  }

  // The client's own `navigator.userAgent` is preferred when it sends one (a PWA and
  // the same browser's tab report differently, which is the distinction an operator
  // cares about when looking at their device list); the request header is the fallback.
  const userAgent = parsed.data.userAgent ?? req.headers.get("user-agent");

  try {
    await saveSubscription(session.userId, {
      endpoint: parsed.data.endpoint,
      p256dh: parsed.data.keys.p256dh,
      auth: parsed.data.keys.auth,
      userAgent: userAgent?.slice(0, 512) ?? null,
    });
  } catch (err) {
    console.warn(`[push] subscribe failed: ${err instanceof Error ? err.message : String(err)}`);
    return NextResponse.json({ ok: false, error: "Could not save this device." }, { status: 500 });
  }

  return NextResponse.json({ ok: true }, { headers: { "cache-control": "no-store" } });
}

export async function DELETE(req: NextRequest): Promise<NextResponse> {
  const verdict = limiter.consume(clientKey(req.headers, "push:subscribe"), RATE_LIMITS.me);
  if (!verdict.ok) {
    return NextResponse.json({ ok: false, error: "rate limited" }, { status: 429, headers: rateLimitHeaders(verdict) });
  }

  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const parsed = unsubscribeSchema.safeParse(await readJson(req));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Which device?" }, { status: 400 });
  }

  try {
    await removeSubscription(session.userId, parsed.data.endpoint);
  } catch (err) {
    console.warn(`[push] unsubscribe failed: ${err instanceof Error ? err.message : String(err)}`);
    return NextResponse.json({ ok: false, error: "Could not forget this device." }, { status: 500 });
  }

  // Idempotent: forgetting a device that was never registered is a success, because
  // the caller's goal — "this browser gets no more pushes" — is satisfied either way.
  return NextResponse.json({ ok: true }, { headers: { "cache-control": "no-store" } });
}
