import "server-only";
import type { Session } from "@/server/types";

/**
 * Returns the current user's session (verified Privy access token → users row), or null.
 * OWNER: foundation. Implementation notes in SPEC.md → Auth flow.
 */
export async function getSession(): Promise<Session | null> {
  throw new Error("getSession not implemented (foundation workstream)");
}

/** Throws a redirect to `/` (landing) when logged out. */
export async function requireSession(): Promise<Session> {
  const s = await getSession();
  if (!s) throw new Error("UNAUTHENTICATED");
  return s;
}
