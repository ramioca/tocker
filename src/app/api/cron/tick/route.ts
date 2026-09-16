/**
 * Scheduler entry point. Vercel Cron hits this every 5 minutes (see `vercel.json`);
 * `pnpm tick` calls it over HTTP every minute in local dev.
 *
 * Auth: `Authorization: Bearer $CRON_SECRET` only. Vercel Cron sends exactly that header
 * when CRON_SECRET is set in the project. The `x-vercel-cron` header is not trusted:
 * any client can send it.
 */
import { NextResponse, type NextRequest } from "next/server";
import { tickDueAgents } from "@/lib/agent/scheduler";
import { cronAuthorized as authorized } from "@/lib/cron-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // Hobby caps at 60s; raise to 300 on Pro.

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const limitParam = Number(req.nextUrl.searchParams.get("limit"));
  // Every due agent runs inside this one invocation, so the batch has to fit the
  // function's duration cap (60s on Vercel Hobby). CRON_MAX_AGENTS tunes it per deploy.
  const configured = Number(process.env.CRON_MAX_AGENTS);
  const fallback = Number.isFinite(configured) && configured > 0 ? Math.min(configured, 50) : 5;
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 50) : fallback;

  try {
    const result = await tickDueAgents(limit);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "tick failed" },
      { status: 500 },
    );
  }
}

export const POST = GET;
