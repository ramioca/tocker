import "server-only";
import { notFound } from "next/navigation";
import { getSession } from "@/lib/auth";
import type { Session } from "@/server/types";

/**
 * Who is allowed to see the admin dashboard.
 *
 * The list is `ADMIN_EMAILS` — comma-separated, trimmed, case-insensitive — matched
 * against the email on the session's `users` row. Two deliberate choices:
 *
 *  1. **An env var, not a database column.** The set of people who can read every
 *     user's balances changes when the deployment's owner changes, which is a deploy,
 *     not a row edit. Nothing in the app can grant itself admin: a compromised session
 *     cannot write to `ADMIN_EMAILS`.
 *  2. **An unset or empty variable means nobody.** There is no bootstrap admin, no
 *     "first user wins", no fallback to the single-operator assumption the Platform
 *     card used to make. A deployment with no `ADMIN_EMAILS` has no admin surface at
 *     all, and `/settings/admin` is a 404 for everyone including its owner.
 *
 * The email comes from Privy's linked accounts at first login (`src/lib/auth.ts`), so
 * an operator who signed up with a wallet only has `email: null` and must add their
 * address to Privy before this matches. That is the right failure: a null email
 * matching an empty entry would make every wallet-only user an admin.
 */

/** `ADMIN_EMAILS` as a normalised list. Empty when the variable is unset or blank. */
export function adminEmails(): string[] {
  const raw = process.env.ADMIN_EMAILS;
  if (!raw) return [];
  return raw
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);
}

/** True when this email is on the admin list. Null, blank and an empty list are all false. */
export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const candidate = email.trim().toLowerCase();
  if (candidate.length === 0) return false;
  const list = adminEmails();
  if (list.length === 0) return false;
  return list.includes(candidate);
}

/**
 * The session, if it belongs to an admin — otherwise a **404**, not a redirect.
 *
 * A redirect to `/login` tells an anonymous visitor that `/settings/admin` is a real
 * route worth coming back to with credentials, and a 403 tells them the same thing
 * more loudly. `notFound()` says the route does not exist, which is the only answer
 * that leaks nothing: a non-admin cannot distinguish this page from a typo.
 *
 * That also means a signed-in non-admin gets a 404 rather than "you are not an admin".
 * Deliberate. They have no business knowing the dashboard is there.
 */
export async function requireAdmin(): Promise<Session> {
  const session = await getSession();
  if (!session || !isAdminEmail(session.email)) notFound();
  return session;
}
