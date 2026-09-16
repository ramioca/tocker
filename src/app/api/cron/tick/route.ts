/**
 * Scheduler entry point. Vercel Cron hits this every 5 minutes (see `vercel.json`);
 * `pnpm tick` calls it over HTTP every minute in local dev.
 *
 * Auth: `Authorization: Bearer $CRON_SECRET` only, compared in constant time and
 * refused outright when the secret is unset or too short to be one
 * (`src/lib/security/cron.ts`). The `x-vercel-cron` header is not trusted: any
 * client can send it.
 *
 * Kill switch: agents owned by a user whose `tradingPaused` flag is on are never
 * selected — the filter lives in `findDueAgents`, so it applies to every caller of
 * the scheduler rather than only to this route. The skipped count is reported here
 * so a paused account is visible in the cron log instead of looking idle. Exits
 * are not affected: they run from `/api/cron/marks`, which is deliberately not
 * filtered, because a kill switch that froze stop losses would trap the operator
 * in every open position.
 */
import { NextResponse, type NextRequest } from "next/server";
import { tickDueAgents } from "@/lib/agent/scheduler";
import { authorizeCron } from "@/lib/security/cron";
import { countPausedDueAgents } from "@/lib/security/kill-switch";
import { RATE_LIMITS, clientKey, limiter, rateLimitHeaders } from "@/lib/security/rate-limit";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // Hobby caps at 60s; raise to 300 on Pro.

export async function GET(req: NextRequest): Promise<NextResponse> {
  // Rate limit before the secret check: an attacker guessing the secret must not
  // get unlimited attempts, and a correct caller hits this twice a minute at most.
  const verdict = limiter.consume(clientKey(req.headers, "cron:tick"), RATE_LIMITS.cron);
  if (!verdict.ok) {
    return NextResponse.json({ error: "rate limited" }, { status: 429, headers: rateLimitHeaders(verdict) });
  }

  const auth = authorizeCron(req.headers.get("authorization"));
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const limitParam = Number(req.nextUrl.searchParams.get("limit"));
  // Every due agent runs inside this one invocation, so the batch has to fit the
  // function's duration cap (60s on Vercel Hobby). CRON_MAX_AGENTS tunes it per deploy.
  const configured = Number(process.env.CRON_MAX_AGENTS);
  const fallback = Number.isFinite(configured) && configured > 0 ? Math.min(configured, 50) : 5;
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 50) : fallback;

  try {
    // Counted before the tick: once `runAgent` has rescheduled its agents, the
    // "would have been due" set no longer exists to be counted.
    const pausedSkipped = await countPausedDueAgents();
    const result = await tickDueAgents(limit);
    return NextResponse.json({ ok: true, ...result, pausedSkipped });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "tick failed" },
      { status: 500 },
    );
  }
}

export const POST = GET;
