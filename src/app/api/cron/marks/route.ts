/**
 * The marks loop. Vercel Cron hits this every 5 minutes (see `vercel.json`); `pnpm tick`
 * calls it over HTTP every minute in local dev, right after `/api/cron/tick`.
 *
 * It costs nothing — no LLM, no x402 — and does the work that cannot wait for the next
 * thought: refresh marks, ratchet position peaks, run the exit engine for every agent
 * holding something, and snapshot equity for every active agent. This is what makes a
 * stop loss a rule instead of a suggestion.
 *
 * Auth: `Authorization: Bearer $CRON_SECRET` only, exactly like `/api/cron/tick`. The
 * `x-vercel-cron` header is not trusted: any client can send it.
 */
import { NextResponse, type NextRequest } from "next/server";
import { tickMarks } from "@/lib/agent/scheduler";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  const header = req.headers.get("authorization") ?? "";
  return header === `Bearer ${secret}`;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
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
