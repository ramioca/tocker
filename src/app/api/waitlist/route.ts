import { appendFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse, after } from "next/server";
import { nanoid } from "nanoid";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { getDb, waitlistSignups } from "@/db";
import { notifyWaitlistSignup } from "@/lib/waitlist/notify";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Bounded strings rather than enums of the landing form's chip labels: the form owns
 * that copy and may reword it, and a signup must never be lost to a label change. The
 * bounds are what matter — this is an unauthenticated write into our database and into
 * the founder's inbox, so nothing in it may be arbitrarily large. 254 is the longest a
 * deliverable address can be (RFC 5321).
 */
const signupSchema = z.object({
  email: z.string().trim().max(254).regex(EMAIL_RE),
  volume: z.string().trim().min(1).max(64),
  chains: z.array(z.string().trim().min(1).max(16)).max(5).optional().default([]),
  style: z.string().trim().max(64).nullish(),
});

/**
 * Landing-page waitlist capture. Deliberately tiny: email + monthly volume are
 * the only hard requirements (volume is how we prioritize onboarding), the rest
 * is segmentation. Stored in `waitlist_signups`; when there is no database yet
 * (a first deploy) it falls back to a local JSONL append, then to a log line —
 * a signup is never answered with a 500 over storage.
 *
 * Each signup is also emailed to the founder over Resend (`src/lib/waitlist/
 * notify.ts`), after the response has been sent, so the visitor never waits
 * on the mail and a mail failure never fails the signup.
 */
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  }

  const parsed = signupSchema.safeParse(body);
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0];
    const error =
      field === "email" ? "Enter a valid email." : field === "volume" ? "Pick your monthly volume." : "Invalid request.";
    return NextResponse.json({ ok: false, error }, { status: 400 });
  }

  const entry = {
    email: parsed.data.email,
    volume: parsed.data.volume,
    chains: parsed.data.chains,
    style: parsed.data.style || null,
    at: new Date().toISOString(),
  };

  try {
    const db = await getDb();
    // Select-before-insert rather than a unique index (which would need a migration).
    // A repeat signup gets the same answer as a first one — no insert, no second email —
    // so the endpoint neither spams the inbox nor tells anyone which addresses are on it.
    const [already] = await db
      .select({ id: waitlistSignups.id })
      .from(waitlistSignups)
      .where(sql`lower(${waitlistSignups.email}) = ${entry.email.toLowerCase()}`)
      .limit(1);
    if (already) return NextResponse.json({ ok: true });

    await db.insert(waitlistSignups).values({
      id: nanoid(),
      email: entry.email,
      volume: entry.volume,
      chains: entry.chains as string[],
      style: entry.style,
    });
  } catch (err) {
    console.warn("[waitlist] database unavailable, falling back:", err instanceof Error ? err.message : err);
    try {
      await appendFile(path.join(process.cwd(), ".waitlist.jsonl"), JSON.stringify(entry) + "\n");
    } catch {
      // Read-only FS (serverless) with no database: the log is the last resort.
      console.log("[waitlist]", JSON.stringify(entry));
    }
  }

  after(() => notifyWaitlistSignup(entry));

  return NextResponse.json({ ok: true });
}
