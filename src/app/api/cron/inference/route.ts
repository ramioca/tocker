/**
 * The pay-per-use housekeeping pass. Vercel Cron hits this every 5 minutes (see
 * `vercel.json`), on the same cadence as `/api/cron/tick` and one minute ahead of it, so
 * an agent whose hold is cleared here is due when the tick looks.
 *
 * It starts no run and pays for nothing. Three jobs, each independent of the others:
 *
 *  1. Reconcile: settle payments left `signed` or `unconfirmed` by asking the chain
 *     whether they landed (`src/lib/x402/inference-reconcile.ts`).
 *  2. Breakers: pause pay-per-use for everyone if enough runs or payments ended badly
 *     lately (`applyInferenceBreakers`).
 *  3. Holds: look again at pay-per-use agents whose hold has run its time, so a funded
 *     wallet or a new day puts them back on the schedule (`recheckInferenceHolds`,
 *     owned by the run loop; skipped when that build does not have it).
 *
 * With pay-per-use switched off and nothing in its ledger, all three find nothing to do:
 * no chain is read and nothing is written.
 *
 * Auth: `Authorization: Bearer $CRON_SECRET` only, compared in constant time and
 * refused when the secret is unset or too short (`src/lib/security/cron.ts`), exactly as
 * the other cron routes. The `x-vercel-cron` header is not trusted: any client can send it.
 *
 * The answer is counts only. No payment row, wallet address, memo or agent id is in it:
 * the body of a cron route ends up in logs.
 */
import { NextResponse, type NextRequest } from "next/server";
import { authorizeCron } from "@/lib/security/cron";
import { RATE_LIMITS, clientKey, limiter, rateLimitHeaders } from "@/lib/security/rate-limit";
import { dbErrorForLog } from "@/lib/security/redact";
import { applyInferenceBreakers } from "@/lib/x402/inference-ledger";
import { reconcileInferencePayments } from "@/lib/x402/inference-reconcile";

export const dynamic = "force-dynamic";
export const maxDuration = 300;
// 300s needs **Fluid compute** on the Vercel project, as for the other cron routes. The
// reconciler stops itself after a minute; the rest of the time is the hold re-check's.

/** The numbers in a result and nothing else: a list becomes its length, text is dropped. */
function countsOnly(value: unknown): Record<string, number | boolean> | number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) return value.length;
  if (!value || typeof value !== "object") return null;
  const out: Record<string, number | boolean> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "number" && Number.isFinite(item)) out[key] = item;
    else if (typeof item === "boolean") out[key] = item;
    else if (Array.isArray(item)) out[key] = item.length;
  }
  return out;
}

/**
 * Look again at held agents, when the run loop offers that. Imported at call time and by
 * name, so this route builds and runs whether or not that export exists yet.
 */
async function recheckHolds(): Promise<Record<string, number | boolean> | number | null> {
  const inference: Record<string, unknown> = await import("@/lib/agent/inference-gate");
  const recheck = inference.recheckInferenceHolds;
  if (typeof recheck !== "function") return null;
  return countsOnly(await (recheck as () => Promise<unknown>)());
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  // Rate limit before the secret check: an attacker guessing the secret must not get
  // unlimited attempts.
  const verdict = limiter.consume(clientKey(req.headers, "cron:inference"), RATE_LIMITS.cron);
  if (!verdict.ok) {
    return NextResponse.json({ error: "rate limited" }, { status: 429, headers: rateLimitHeaders(verdict) });
  }

  const auth = authorizeCron(req.headers.get("authorization"));
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  // Each job runs even when another fails: a chain that cannot be read must not leave
  // funded agents on hold, and a hold re-check that throws must not stop reconciliation.
  const failed: string[] = [];
  async function job<T>(name: string, work: () => Promise<T>): Promise<T | null> {
    try {
      return await work();
    } catch (err) {
      failed.push(name);
      // Never the raw error: a database error carries the statement and its parameters.
      console.error(`[cron:inference] ${name} failed: ${dbErrorForLog(err)}`);
      return null;
    }
  }

  const reconcile = await job("reconcile", () => reconcileInferencePayments());
  const breakers = await job("breakers", () => applyInferenceBreakers());
  const holds = await job("holds", recheckHolds);

  return NextResponse.json(
    {
      ok: failed.length === 0,
      reconcile,
      // The rule's name is one of four fixed words; the pause's end is a time, not a row.
      breakers: breakers ? { tripped: breakers.tripped, pausedUntil: breakers.pausedUntil?.toISOString() ?? null } : null,
      holds,
      failed,
    },
    { status: failed.length === 0 ? 200 : 500 },
  );
}

export const POST = GET;
