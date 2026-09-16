/**
 * The marks loop. Vercel Cron hits this every 5 minutes (see `vercel.json`); `pnpm tick`
 * calls it over HTTP every minute in local dev, right after `/api/cron/tick`.
 *
 * It costs nothing — no LLM, no x402 — and does the work that cannot wait for the next
 * thought: refresh marks, ratchet position peaks, run the exit engine for every agent
 * holding something, and snapshot equity for every active agent. This is what makes a
 * stop loss a rule instead of a suggestion.
 *
 * Auth: `Authorization: Bearer $CRON_SECRET` only, compared in constant time and
 * refused when the secret is unset or too short (`src/lib/security/cron.ts`). The
 * `x-vercel-cron` header is not trusted: any client can send it.
 *
 * The user-level kill switch deliberately does NOT filter this loop. Pausing
 * trading stops new positions from being opened (`/api/cron/tick`); it must never
 * stop a stop loss, or the operator would be trapped in every open position at
 * exactly the moment they decided something was wrong.
 */
import { NextResponse, type NextRequest } from "next/server";
import { tickMarks } from "@/lib/agent/scheduler";
import { authorizeCron } from "@/lib/security/cron";
import { RATE_LIMITS, clientKey, limiter, rateLimitHeaders } from "@/lib/security/rate-limit";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // Hobby caps at 60s; raise to 300 on Pro.

export async function GET(req: NextRequest): Promise<NextResponse> {
  const verdict = limiter.consume(clientKey(req.headers, "cron:marks"), RATE_LIMITS.cron);
  if (!verdict.ok) {
    return NextResponse.json({ error: "rate limited" }, { status: 429, headers: rateLimitHeaders(verdict) });
  }

  const auth = authorizeCron(req.headers.get("authorization"));
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const limitParam = Number(req.nextUrl.searchParams.get("limit"));
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 200) : 100;

  try {
    const result = await tickMarks(limit);
    return NextResponse.json({
      ok: true,
      active: result.active,
      guarded: result.guarded,
      exits: result.exits,
      snapshots: result.snapshots,
      // Compact per-agent detail: what fired, and anything that could not be taken.
      agents: result.results.map((r) => ({
        agentId: r.agentId,
        positions: r.positions,
        note: r.note,
        exits: r.exits.map((e) => ({ symbol: e.symbol, reason: e.reason, status: e.status, amountUsd: e.amountUsd })),
        skipped: r.skipped,
        error: r.error,
      })),
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "marks tick failed" },
      { status: 500 },
    );
  }
}

export const POST = GET;
