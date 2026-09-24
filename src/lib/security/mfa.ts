import "server-only";
import { eq } from "drizzle-orm";
import { getDb, userSecurity } from "@/db";
import { isPrivyConfigured, privy } from "@/lib/privy";
import type { MfaMethod, MfaStatus } from "./types";

/**
 * Second-factor **status** for the two irreversible money actions: switching an agent
 * to live mode, and withdrawing from an agent wallet.
 *
 * WHAT THIS IS, PRECISELY — read this before trusting it, and before writing copy
 * about it:
 *
 *  - **A second factor is optional.** `secondFactorBlock` returns `null` in every
 *    case; it has never refused an action. That was a product decision (2026-09-16)
 *    and it is the whole truth about the gate: enrolment is read and recorded, and
 *    nothing anywhere is blocked on it. Any sentence in the UI that says live mode or
 *    a withdrawal is "required to" or "blocked without" a second factor is false, and
 *    a false security promise is worse than none — it is the promise people skip
 *    their own precautions on.
 *  - The **read** is server-side and is honest: `getMfaStatus` asks Privy's API for
 *    the user's `mfa_methods` and never believes a claim made by the browser. So the
 *    badge on the security page is true even though it gates nothing.
 *  - What it reads is **enrolment**, not a fresh challenge for a specific action.
 *    Privy's step-up (`useMfa().promptMfa()`) happens in the browser and produces
 *    nothing the server can verify, and Tocker's agent wallets are signed server-side
 *    with the app's authorization key, so there is no user-side signing ceremony to
 *    attach a challenge to. Even if the gate were switched on, it would not stop an
 *    attacker holding a live Privy session for an enrolled user.
 *  - The honest upgrade path — turning this into a real gate — is Privy's
 *    `mfa.enabled` / `mfa.disabled` webhooks plus a per-action step-up, and it is
 *    written down in DEPLOY.md.
 */

export type { MfaMethod, MfaStatus } from "./types";

/**
 * What a user is told when there is nothing to enrol in. Whether that is because Privy
 * is not configured or because the app has no methods switched on is the operator's
 * problem, and the operator's wording lives in `operatorNote`.
 */
const UNAVAILABLE_TO_USERS = "Two-factor sign-in isn't available on Tocker yet.";

const OFFLINE: MfaStatus = {
  available: false,
  appMethods: [],
  userMethods: [],
  enrolled: false,
  blockedReason: UNAVAILABLE_TO_USERS,
  operatorNote:
    "Privy is not configured on this deployment (NEXT_PUBLIC_PRIVY_APP_ID / PRIVY_APP_SECRET), so no second factor can be enrolled or checked. A second factor is optional, so nothing is blocked by this — but nothing can be enrolled either.",
};

const NO_APP_METHODS =
  "Your Privy app has no MFA methods enabled, so there is nothing to enrol in. " +
  "Open dashboard.privy.io → your app → Authentication → Advanced → Multi-factor authentication, " +
  "turn on at least one of TOTP (authenticator app) or Passkey, save, then reload this page.";

function isMfaMethod(value: unknown): value is MfaMethod {
  return value === "sms" || value === "totp" || value === "passkey" || value === "email";
}

/**
 * Read the user's enrolled factors and the app's available ones, straight from Privy.
 *
 * Never throws: a Privy outage must not make the security page 500. It reports
 * `available: false` and the gate below fails closed on it.
 */
export async function getMfaStatus(userId: string): Promise<MfaStatus> {
  if (!isPrivyConfigured()) return OFFLINE;

  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID?.trim();
  const [appMethods, userMethods] = await Promise.all([
    readAppMethods(),
    readUserMethods(userId),
  ]);

  if (appMethods === null || userMethods === null) {
    return {
      available: false,
      appMethods: appMethods ?? [],
      userMethods: userMethods ?? [],
      enrolled: false,
      blockedReason:
        "Could not reach Privy to check your second factor. It is optional, so nothing is blocked — refresh in a moment to see its status.",
      operatorNote: null,
    };
  }
  void appId;

  const enrolled = userMethods.length > 0;
  return {
    available: true,
    appMethods,
    userMethods,
    enrolled,
    blockedReason: appMethods.length === 0 && !enrolled ? UNAVAILABLE_TO_USERS : null,
    operatorNote: appMethods.length === 0 ? NO_APP_METHODS : null,
  };
}

async function readAppMethods(): Promise<MfaMethod[] | null> {
  try {
    const settings = await privy().apps().getSettings();
    return (settings.mfa_methods ?? []).filter(isMfaMethod);
  } catch (err) {
    console.warn("[mfa] could not read app settings:", err instanceof Error ? err.message : err);
    return null;
  }
}

async function readUserMethods(userId: string): Promise<MfaMethod[] | null> {
  try {
    const user = await privy().users()._get(userId);
    return (user.mfa_methods ?? []).map((m) => m.type).filter(isMfaMethod);
  } catch (err) {
    console.warn("[mfa] could not read user:", err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Cache the last-seen enrolment on our side. Purely informational — it is what the
 * audit log and the security page show when Privy is slow; the gate always re-reads.
 */
export async function rememberMfaStatus(userId: string, methods: MfaMethod[]): Promise<void> {
  try {
    const db = await getDb();
    const now = new Date();
    await db
      .insert(userSecurity)
      .values({ userId, mfaMethods: methods, mfaCheckedAt: now, updatedAt: now })
      .onConflictDoUpdate({
        target: userSecurity.userId,
        set: { mfaMethods: methods, mfaCheckedAt: now, updatedAt: now },
      });
  } catch (err) {
    console.warn("[mfa] could not cache status", err);
  }
}

export async function lastKnownMfaMethods(userId: string): Promise<MfaMethod[]> {
  const db = await getDb();
  const [row] = await db
    .select({ methods: userSecurity.mfaMethods })
    .from(userSecurity)
    .where(eq(userSecurity.userId, userId))
    .limit(1);
  return (row?.methods ?? []).filter(isMfaMethod);
}

/**
 * Not a gate. Always returns `null` — the action always proceeds.
 *
 * A second factor is optional by product decision (2026-09-16). This function exists
 * so the two money actions have one place to record enrolment for the audit trail, and
 * one place to become a real gate later without touching either call site. Until that
 * day, do not describe it as one anywhere in the product.
 */
export async function secondFactorBlock(userId: string): Promise<null> {
  const status = await getMfaStatus(userId);
  if (status.enrolled) void rememberMfaStatus(userId, status.userMethods);
  return null;
}
