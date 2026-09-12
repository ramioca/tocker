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
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 50) : 20;

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
