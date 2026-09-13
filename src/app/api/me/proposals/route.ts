import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getPendingProposalsSummary } from "@/server/queries/proposals";

export const dynamic = "force-dynamic";

/**
 * How many trades are waiting on this user, and the newest one. Polled every 15s by the
 * Dynamic Island, so it stays two indexed queries and never scores anything.
 *
 * Logged out is not an error here: the island simply has nothing to show.
 */
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ count: 0, latest: null }, { headers: { "cache-control": "no-store" } });
  }
  const summary = await getPendingProposalsSummary(session.userId);
  return NextResponse.json(summary, { headers: { "cache-control": "no-store" } });
}
