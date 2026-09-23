import { appendFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse, after } from "next/server";
import { nanoid } from "nanoid";
import { getDb, waitlistSignups } from "@/db";
import { notifyWaitlistSignup } from "@/lib/waitlist/notify";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

  const b = body as Record<string, unknown>;
  const email = typeof b.email === "string" ? b.email.trim() : "";
  const volume = typeof b.volume === "string" ? b.volume : null;

  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ ok: false, error: "Enter a valid email." }, { status: 400 });
  }
  if (!volume) {
    return NextResponse.json({ ok: false, error: "Pick your monthly volume." }, { status: 400 });
  }

  const entry = {
    email,
    volume,
    chains: Array.isArray(b.chains) ? b.chains.filter((c) => typeof c === "string").slice(0, 8) : [],
    style: typeof b.style === "string" ? b.style : null,
    at: new Date().toISOString(),
  };

  try {
    const db = await getDb();
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
