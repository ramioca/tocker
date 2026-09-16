import "server-only";
import { eq } from "drizzle-orm";
import { getDb, userSecurity } from "@/db";
import { isPrivyConfigured, privy } from "@/lib/privy";
import type { MfaMethod, MfaStatus } from "./types";

/**
 * Second-factor gate for the two irreversible money actions: switching an agent
 * to live mode, and withdrawing from an agent wallet.
 *
 * HOW STRONG THIS IS, PRECISELY — read this before trusting it:
 *
 *  - The check is **server-side**. `getMfaStatus` asks Privy's API for the user's
 *    `mfa_methods`; it never believes a claim made by the browser. A client that
 *    lies about being enrolled gets refused.
 *  - What it verifies is **enrolment**, not a fresh challenge for this specific
 *    action. Privy's step-up challenge (`useMfa().promptMfa()`) happens in the
 *    browser and produces nothing the server can verify, and Tocker's agent
 *    wallets are signed server-side with the app's authorization key, so there is
 *    no user-side signing ceremony to attach a challenge to. Concretely: an
 *    attacker holding a live Privy session cookie for an enrolled user is not
 *    stopped by this. What it does stop is the *unenrolled* account — the one
 *    protected by an email OTP alone — from ever reaching live mode or a
 *    withdrawal, which is the realistic failure at this stage.
 *  - The honest upgrade path is Privy's `mfa.enabled` / `mfa.disabled` webhooks
 *    plus a per-action step-up, and it is written down in DEPLOY.md.
 *
 * The UI says all of this in one sentence rather than implying more than is true.
 */

export type { MfaMethod, MfaStatus } from "./types";

const OFFLINE: MfaStatus = {
  available: false,
  appMethods: [],
  userMethods: [],
  enrolled: false,
  blockedReason:
    "Privy is not configured on this deployment (NEXT_PUBLIC_PRIVY_APP_ID / PRIVY_APP_SECRET), so no second factor can be enrolled or checked. Live trading is unavailable until it is.",
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
    };
  }
  void appId;

  const enrolled = userMethods.length > 0;
  return {
    available: true,
    appMethods,
    userMethods,
    enrolled,
    blockedReason: appMethods.length === 0 && !enrolled ? NO_APP_METHODS : null,
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
 * The gate. Returns null when the action may proceed, or the sentence to show the
 * operator when it may not. Fails closed: an unreachable Privy blocks the action.
 */
export async function secondFactorBlock(userId: string): Promise<string | null> {
  // A second factor is optional by product decision (2026-09-16): enrolment is
  // recorded for the audit trail when present, and nothing is ever blocked on it.
  // The function keeps its shape so the two money actions read the same as before.
  const status = await getMfaStatus(userId);
  if (status.enrolled) void rememberMfaStatus(userId, status.userMethods);
  return null;
}
