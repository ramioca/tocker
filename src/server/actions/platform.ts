"use server";

import { getSession } from "@/lib/auth";
import { isAdminEmail } from "@/lib/admin";
import { recordAudit } from "@/lib/security/audit";
import { ensurePlatformWallet, type PlatformWalletRow } from "@/lib/platform/wallets";
import type { ActionResult } from "@/server/types";

/**
 * Create the platform wallets (one per chain) if they do not exist yet, and return them.
 *
 * Idempotent — a unique index on `chain` makes a second call a read.
 *
 * **Admin only.** This used to be "any signed-in user may do this; see the Platform
 * card's note", from when the card lived under general Settings. The card moved behind
 * `requireAdmin()` in W6 and the action did not follow it, which left the only *write*
 * on that page reachable by anyone who could guess the action id — creating real,
 * app-owned Privy wallets. `isAdminEmail` is the same gate the page uses, so a
 * non-admin gets the page's answer ("Not found") rather than a hint that the action
 * exists.
 */
export async function ensurePlatformWalletsAction(): Promise<ActionResult<PlatformWalletRow[]>> {
  const session = await getSession();
  if (!session || !isAdminEmail(session.email)) return { ok: false, error: "Not found." };
  try {
    const rows = await Promise.all((["base", "solana"] as const).map((chain) => ensurePlatformWallet(chain)));
    await recordAudit({
      userId: session.userId,
      // Not `withdraw`: the audit log renders that with the money-moved accent
      // (`LOUD` in `src/components/settings/security/audit-log.tsx`), and creating an
      // empty wallet moves nothing. `budget_change` is the closest honest kind in the
      // schema's enum — these are the wallets every agent's data budget is spent from —
      // and it renders neutral. A dedicated `platform_wallets` kind would be better and
      // needs a schema migration this workstream does not own.
      kind: "budget_change",
      summary: `Created or verified the platform wallets: ${rows.map((r) => `${r.chain} ${r.address}`).join(", ")}.`,
      metadata: { reason: "platform_wallets", addresses: rows.map((r) => `${r.chain}:${r.address}`) },
    });
    return { ok: true, data: rows };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not create the platform wallets." };
  }
}
