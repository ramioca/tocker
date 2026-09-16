import "server-only";
import { desc, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { auditEvents, getDb } from "@/db";
import { newId } from "@/server/queries/_shared";

export type AuditKind = (typeof auditEvents.kind.enumValues)[number];

export interface AuditInput {
  userId: string;
  kind: AuditKind;
  /** One sentence, past tense, written for the person reading it in six months. */
  summary: string;
  agentId?: string | null;
  agentName?: string | null;
  /** Amounts, addresses, before/after values. NEVER a secret — this table is read in the UI. */
  metadata?: Record<string, unknown> | null;
}

export interface AuditRow {
  id: string;
  kind: AuditKind;
  summary: string;
  agentId: string | null;
  agentName: string | null;
  metadata: Record<string, unknown> | null;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
}

/** Keep a user agent readable in a table cell without truncating the useful part. */
const UA_MAX = 180;

/**
 * Write one audit row.
 *
 * Never throws. An audit write failing must not roll back the withdrawal the
 * operator asked for — losing the record of a thing that happened is bad, but
 * silently *not* doing the thing the operator confirmed is worse, and they would
 * have no idea which of the two occurred. Failures go to the server log instead.
 */
export async function recordAudit(input: AuditInput): Promise<void> {
  try {
    const { ip, userAgent } = await requestFingerprint();
    const db = await getDb();
    await db.insert(auditEvents).values({
      id: newId("audit"),
      userId: input.userId,
      kind: input.kind,
      agentId: input.agentId ?? null,
      agentName: input.agentName ?? null,
      summary: input.summary,
      metadata: input.metadata ?? null,
      ip,
      userAgent,
    });
  } catch (err) {
    console.error("[audit] could not record", input.kind, err);
  }
}

/** The caller's IP and user agent, as far as the platform will tell us. */
async function requestFingerprint(): Promise<{ ip: string | null; userAgent: string | null }> {
  try {
    const h = await headers();
    const ip =
      h.get("x-vercel-forwarded-for") ??
      h.get("x-real-ip") ??
      h.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      null;
    const ua = h.get("user-agent");
    return { ip: ip || null, userAgent: ua ? ua.slice(0, UA_MAX) : null };
  } catch {
    // Outside a request scope (a cron tick, a script). The row is still worth writing.
    return { ip: null, userAgent: null };
  }
}

/** Newest first. Owner-scoped by construction: the caller passes a session user id. */
export async function listAuditEvents(userId: string, limit = 60): Promise<AuditRow[]> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(auditEvents)
    .where(eq(auditEvents.userId, userId))
    .orderBy(desc(auditEvents.createdAt))
    .limit(Math.min(Math.max(limit, 1), 200));

  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    summary: r.summary,
    agentId: r.agentId,
    agentName: r.agentName,
    metadata: r.metadata ?? null,
    ip: r.ip,
    userAgent: r.userAgent,
    createdAt: r.createdAt.toISOString(),
  }));
}
