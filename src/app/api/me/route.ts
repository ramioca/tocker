import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Whose answer this is depends on the cookie, so no cache may keep it: not a shared one
 * (`private`) and not the browser's (`no-store`). Said on the 401 too, or that branch
 * goes out with the host's default `public, max-age=0`.
 */
const PRIVATE = { "cache-control": "private, no-store" } as const;

/** Current session for `useSession()`. 401 when logged out. */
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401, headers: PRIVATE });
  }
  return NextResponse.json(session, { headers: PRIVATE });
}
