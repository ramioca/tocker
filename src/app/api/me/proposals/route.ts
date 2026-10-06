import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { unreadNotifications } from "@/components/common/data-access";
import { getPendingProposalsSummary } from "@/server/queries/proposals";

export const dynamic = "force-dynamic";

/** Pending trades and the unread count are the owner's: no shared cache, and none in the browser. */
const PRIVATE = { "cache-control": "private, no-store" } as const;

/**
 * How many trades are waiting on this user, the newest one, and how many notifications
 * are unread (so the bell updates while the app is open). Polled every 15s by the
 * Dynamic Island, so it stays a few indexed queries and never scores anything.
 *
 * Logged out is not an error here: the island simply has nothing to show.
 */
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ count: 0, latest: null, unreadNotifications: 0 }, { headers: PRIVATE });
  }
  const [summary, unread] = await Promise.all([
    getPendingProposalsSummary(session.userId),
    unreadNotifications(session.userId).catch(() => 0),
  ]);
  return NextResponse.json({ ...summary, unreadNotifications: unread }, { headers: PRIVATE });
}
