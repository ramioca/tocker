/**
 * Manual run trigger. Owner-only.
 *
 * Returns `{ runId }` as soon as the row exists; the tick continues server-side, so
 * the client can poll `/api/agents/[id]/runs/[runId]` for the step log.
 */
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { agents, getDb } from "@/db";
import { requireSession } from "@/lib/auth";
import { startRun } from "@/lib/agent/run";
import { RUN_REFUSED_WHILE_PAUSED } from "@/lib/agent/run-gate";
import { isTradingPaused } from "@/lib/security/kill-switch";

export const dynamic = "force-dynamic";
export const maxDuration = 300;
// 300s needs **Fluid compute** on the Vercel project (Settings → Functions). Without it
// the platform caps the function at 60s and the build rejects this value. The old 60s
// cap is what froze a run mid-tick and left its `agent_runs` row `running` forever.

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;

  let userId: string;
  try {
    const session = await requireSession();
    userId = session.userId;
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const db = await getDb();
  const rows = await db.select().from(agents).where(eq(agents.id, id)).limit(1);
  const agent = rows[0];
  if (!agent) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (agent.ownerId !== userId) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (agent.status === "draft") {
    return NextResponse.json({ error: "This agent is still a draft. Activate it first." }, { status: 409 });
  }
  // The kill switch covers a run started by hand too. A 409, so the wizard shows the
  // sentence as written (see `runErrorMessage`).
  if (await isTradingPaused(agent.ownerId)) {
    return NextResponse.json({ error: RUN_REFUSED_WHILE_PAUSED }, { status: 409 });
  }

  try {
    const { runId } = await startRun({ agentId: id, trigger: "manual" });
    return NextResponse.json({ ok: true, runId });
  } catch (err) {
    // A database or runtime throw: the detail is for the log, not the response body.
    console.error("[api/agents/run] could not start run", err);
    return NextResponse.json(
      { ok: false, error: "The agent runtime is unavailable. Try again in a minute." },
      { status: 500 },
    );
  }
}
