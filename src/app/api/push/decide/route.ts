/**
 * One-tap approve / reject, from a notification.
 *
 * **No session, on purpose.** This is called by the service worker when someone taps
 * Approve or Reject on a lock screen. The token in the request IS the credential: it
 * is HMAC-signed over `{tradeId, ownerId, decision, exp}` with a key derived from
 * `ENCRYPTION_KEY`, so it authorises one decision, on one trade, for one owner, until
 * the proposal expires — and nothing else. Owner identity comes out of the verified
 * token and is handed to `decideProposal`, which independently refuses a trade the
 * caller does not own.
 *
 * Tapping Approve still does not guarantee a fill. `decideProposal` re-scores the
 * token, re-runs the risk guard against the live portfolio and takes a fresh quote
 * before anything routes. The token buys a tap, not a trade.
 *
 * The token may arrive in the JSON body (what the service worker sends) or as the `t`
 * query parameter (what the payload's `approveUrl` carries, and what a bare
 * `fetch(approveUrl, { method: "POST" })` would use). The body is preferred so the
 * credential stays out of access logs; the query form exists so the URL in the payload
 * is self-contained and works on its own.
 */
import { NextResponse, type NextRequest } from "next/server";
import { verifyDecision } from "@/lib/notifications/push";
import { decideProposal } from "@/lib/trading/proposals";
import { RATE_LIMITS, clientKey, limiter, rateLimitHeaders } from "@/lib/security/rate-limit";

export const dynamic = "force-dynamic";
// Approving places a real order: quote, sign, submit, reconcile. The manual-trade path
// gets the same headroom.
export const maxDuration = 120;

const REFUSAL: Record<"malformed" | "signature" | "expired" | "unconfigured", { status: number; message: string }> = {
  malformed: { status: 400, message: "That link is not a valid approval." },
  signature: { status: 401, message: "That link is not a valid approval." },
  expired: {
    status: 410,
    message: "This proposal expired. The agent will re-propose if it still likes the trade.",
  },
  unconfigured: { status: 503, message: "One-tap approval is not configured on this deployment." },
};

export async function POST(req: NextRequest): Promise<NextResponse> {
  // A decision spends money, so it shares the bucket with everything else that does.
  const verdict = limiter.consume(clientKey(req.headers, "push:decide"), RATE_LIMITS.sensitive);
  if (!verdict.ok) {
    return NextResponse.json(
      { ok: false, message: "Too many taps in a row — try again in a moment." },
      { status: 429, headers: rateLimitHeaders(verdict) },
    );
  }

  let token: unknown = req.nextUrl.searchParams.get("t") ?? req.nextUrl.searchParams.get("token");
  try {
    const body = (await req.json()) as { token?: unknown } | null;
    if (body && typeof body === "object" && body.token !== undefined) token = body.token;
  } catch {
    // No body, or not JSON. The query parameter is then the only source, which is fine.
  }

  const verified = verifyDecision(token);
  if (!verified.ok) {
    const refusal = REFUSAL[verified.reason];
    return NextResponse.json({ ok: false, message: refusal.message }, { status: refusal.status });
  }

  const { tradeId, ownerId, decision } = verified.claims;

  try {
    const result = await decideProposal({ tradeId, ownerId, decision });
    // A refusal here is a real answer, not an error: "already approved", "no longer
    // allowed", "expired". The service worker shows it verbatim, so it goes back with
    // a 200 — the request succeeded; the trade did not.
    return NextResponse.json(
      result.ok
        ? { ok: true, message: result.message, tradeId, status: result.status }
        : { ok: false, message: result.error, tradeId, status: result.status ?? null },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (err) {
    console.warn(`[push] decide ${decision} for ${tradeId} failed: ${err instanceof Error ? err.message : String(err)}`);
    return NextResponse.json(
      { ok: false, message: "Something went wrong deciding this trade. Open Tocker to check." },
      { status: 500 },
    );
  }
}
