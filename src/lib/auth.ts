import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { verifyAccessToken, type LinkedAccount } from "@privy-io/node";
import { getDb, users } from "@/db";
import { isPrivyConfigured, privy } from "@/lib/privy";
import { isReservedHandle, isStaffLikeName } from "@/lib/reserved-handles";
import { isHandleTaken } from "@/server/queries/handles";
import type { Session } from "@/server/types";

/** Cookie react-auth sets on the client after login. */
const TOKEN_COOKIE = "privy-token";

/**
 * Dev-only impersonation backdoor so the app (and the seed data) is usable
 * without Privy credentials. Guarded three ways: env var set, not production,
 * and Privy not configured. See .env.example → DEV_IMPERSONATE_USER_ID.
 */
function devImpersonationId(): string | null {
  if (process.env.NODE_ENV === "production") return null;
  if (isPrivyConfigured()) return null;
  const id = process.env.DEV_IMPERSONATE_USER_ID?.trim();
  return id ? id : null;
}

async function readAccessToken(): Promise<string | null> {
  const jar = await cookies();
  const fromCookie = jar.get(TOKEN_COOKIE)?.value;
  if (fromCookie) return fromCookie;
  const h = await headers();
  const auth = h.get("authorization") ?? h.get("Authorization");
  if (auth?.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim() || null;
  return null;
}

/**
 * Verify a Privy access token → Privy DID.
 *
 * Uses `verifyAccessToken` from `@privy-io/node` with an explicit
 * `PRIVY_VERIFICATION_KEY` (SPKI PEM from the Privy dashboard) when one is set —
 * it avoids a JWKS round-trip on every request. Otherwise falls back to
 * `privy().utils().auth().verifyAccessToken(token)`, which resolves the app's
 * JWKS itself.
 */
async function verifyToken(token: string): Promise<string | null> {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID?.trim();
  if (!appId) return null;
  try {
    const verificationKey = process.env.PRIVY_VERIFICATION_KEY?.trim();
    if (verificationKey) {
      const claims = await verifyAccessToken({
        access_token: token,
        app_id: appId,
        verification_key: normalizeSpki(verificationKey),
      });
      return claims.user_id;
    }
    const claims = await privy().utils().auth().verifyAccessToken(token);
    return claims.user_id;
  } catch {
    return null;
  }
}

/** Accept the dashboard's bare base64 key as well as a full PEM block. */
function normalizeSpki(key: string): string {
  const trimmed = key.replace(/\\n/g, "\n").trim();
  if (trimmed.includes("BEGIN PUBLIC KEY")) return trimmed;
  return `-----BEGIN PUBLIC KEY-----\n${trimmed}\n-----END PUBLIC KEY-----`;
}

function toSession(row: typeof users.$inferSelect): Session {
  return {
    userId: row.id,
    handle: row.handle,
    displayName: row.displayName,
    avatarUrl: row.avatarUrl,
    avatarSeed: row.avatarSeed,
    // Null is what opens the first-run screen (`src/components/onboarding`).
    onboardedAt: row.onboardedAt ? row.onboardedAt.toISOString() : null,
    email: row.email,
  };
}

/** Strip a candidate down to `[a-z0-9_]{1,20}`. */
function sanitizeHandle(raw: string): string {
  const cleaned = raw
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "")
    .slice(0, 20);
  return cleaned.length >= 2 ? cleaned : "";
}

/**
 * The handle a new account starts with: its X username when it signed in with one,
 * otherwise `user` and six characters of its account id.
 *
 * A handle is public from the first second: it is the address of `/u/<handle>` and the
 * name on every post. So only a name the person already made public is reused. The email
 * local part and the wallet address are not: the first is often a real name and, for a
 * distinctive address, let anyone holding a list of emails test which ones had an
 * account; the second tied the profile to a wallet. `email` and `walletAddress` stay in
 * the signature because the caller spreads the whole Privy profile in; neither is read.
 */
export function handleCandidate(input: {
  email?: string | null;
  username?: string | null;
  walletAddress?: string | null;
  userId?: string | null;
}): string {
  const fromUsername = input.username ? sanitizeHandle(input.username) : "";
  if (fromUsername) return fromUsername;
  const tail = (input.userId ?? "").replace(/[^a-zA-Z0-9]/g, "").slice(-6).toLowerCase();
  return tail ? `user${tail}` : `user${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Append a numeric suffix until the handle is free. A reserved name (`support`,
 * `tocker…`, the founder's) is never the root, whatever the X username was. Free means
 * what it means everywhere a name is checked: no account has it, and no account gave it
 * up in a rename and still holds it (`src/server/queries/handles.ts`).
 */
export async function uniqueHandle(base: string): Promise<string> {
  const db = await getDb();
  const clean = sanitizeHandle(base);
  // Checked whole and as the 17 characters a suffix leaves of it, so cutting a long
  // root to make room for the number cannot leave a reserved word behind.
  const usable = clean && !isReservedHandle(clean) && !isReservedHandle(clean.slice(0, 17));
  const root = usable ? clean : "trader";
  for (let i = 0; i < 60; i++) {
    const candidate = i === 0 ? root : `${root.slice(0, 17)}${i}`;
    if (!(await isHandleTaken(db, candidate, null))) return candidate;
  }
  return `${root.slice(0, 12)}${Date.now().toString(36)}`.slice(0, 20);
}

/** What sign-up reads from the sign-in provider's record of a new account. */
export interface ProfileHints {
  email: string | null;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  walletAddress: string | null;
}

const NO_HINTS: ProfileHints = { email: null, username: null, displayName: null, avatarUrl: null, walletAddress: null };

/**
 * The hints in a provider record's linked accounts.
 *
 * The username, the display name and the photo come from X only: its owner made all
 * three public there. Google's `name` is not read. It is usually a real name, nobody was
 * asked whether to show it, and the feed prints a display name above the handle: the
 * reasoning that took the email's local part out of handles.
 */
export function profileHints(accounts: readonly LinkedAccount[]): ProfileHints {
  const hints = { ...NO_HINTS };
  for (const acct of accounts) {
    if (acct.type === "email") hints.email ??= acct.address;
    else if (acct.type === "google_oauth") hints.email ??= acct.email;
    else if (acct.type === "twitter_oauth") {
      hints.username ??= acct.username;
      hints.displayName ??= acct.name;
      hints.avatarUrl ??= acct.profile_picture_url;
    } else if (acct.type === "wallet") {
      hints.walletAddress ??= acct.address;
    }
  }
  return hints;
}

/**
 * The display name and photo a new account's row keeps.
 *
 * The name on an X account is whatever its owner typed there, so one that reads as staff
 * ("Tocker Support") is dropped, as `updateProfile` refuses it. The photo goes with it,
 * and also when the X username is one nobody may take: an account that arrived dressed
 * as the product would otherwise keep the product's logo beside a neutral handle.
 */
export function identityToStore(hints: Pick<ProfileHints, "username" | "displayName" | "avatarUrl">): {
  displayName: string | null;
  avatarUrl: string | null;
} {
  const staffName = Boolean(hints.displayName) && isStaffLikeName(hints.displayName ?? "");
  const reservedUsername = Boolean(hints.username) && isReservedHandle(hints.username ?? "");
  return {
    displayName: staffName ? null : hints.displayName || null,
    avatarUrl: staffName || reservedUsername ? null : hints.avatarUrl || null,
  };
}

/** Pull profile hints out of the Privy user record (first login only). */
async function privyProfile(userId: string): Promise<ProfileHints> {
  if (!isPrivyConfigured()) return NO_HINTS;
  try {
    const user = await privy().users()._get(userId);
    return profileHints(user.linked_accounts ?? []);
  } catch {
    return NO_HINTS;
  }
}

async function upsertUser(userId: string): Promise<Session> {
  const db = await getDb();
  const [existing] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (existing) return toSession(existing);

  const profile = await privyProfile(userId);
  const handle = await uniqueHandle(handleCandidate({ ...profile, userId }));
  const [created] = await db
    .insert(users)
    .values({
      id: userId,
      handle,
      ...identityToStore(profile),
      email: profile.email ?? null,
      // `avatar_seed` and `onboarded_at` start null: every new account is asked once to
      // choose its username and avatar, an X sign-in included.
    })
    .onConflictDoNothing()
    .returning();
  if (created) return toSession(created);

  // lost the race — read the row the other request wrote
  const [row] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!row) throw new Error("failed to create user row");
  return toSession(row);
}

/**
 * Current session (verified Privy access token → `users` row), or null.
 * Memoized per request with React `cache()`, so calling it in a layout, a page
 * and three server actions costs one verification.
 */
export const getSession = cache(async (): Promise<Session | null> => {
  const impersonate = devImpersonationId();
  if (impersonate) {
    try {
      return await upsertUser(impersonate);
    } catch (err) {
      console.error("[auth] dev impersonation failed", err);
      return null;
    }
  }
  const token = await readAccessToken();
  if (!token) return null;
  const userId = await verifyToken(token);
  if (!userId) return null;
  try {
    return await upsertUser(userId);
  } catch (err) {
    console.error("[auth] could not load the user row", err);
    return null;
  }
});

/**
 * For owner-only pages: the session, or a redirect to `/login` that returns the
 * visitor to `next` once Privy has signed them in. The public record (feed,
 * discover, an agent's public page, profiles, tokens) never calls this.
 */
export async function requireSession(next = "/home"): Promise<Session> {
  const session = await getSession();
  if (!session) redirect(`/login?next=${encodeURIComponent(next)}`);
  return session;
}
