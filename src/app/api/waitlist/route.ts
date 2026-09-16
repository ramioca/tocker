import { appendFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Landing-page waitlist capture. Deliberately tiny: email + monthly volume are
 * the only hard requirements (volume is how we prioritize onboarding), the rest
 * is segmentation. Best-effort append to a local JSONL for now.
 *
 * TODO: swap the file append for a real store — a `waitlist` table or an ESP
 * (Resend/Loops) — before this goes to production traffic.
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
    await appendFile(path.join(process.cwd(), ".waitlist.jsonl"), JSON.stringify(entry) + "\n");
  } catch {
    // Read-only FS (serverless) — the log still captures the signal until a
    // real store is wired. Don't fail the user's submission over storage.
    console.log("[waitlist]", JSON.stringify(entry));
  }

  return NextResponse.json({ ok: true });
}
