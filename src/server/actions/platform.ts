"use server";

import { getSession } from "@/lib/auth";
import { recordAudit } from "@/lib/security/audit";
import { ensurePlatformWallet, type PlatformWalletRow } from "@/lib/platform/wallets";
import type { ActionResult } from "@/server/types";

/**
 * Create the platform wallets (one per chain) if they do not exist yet, and return
 * them. Idempotent — a unique index on `chain` makes a second call a read. Single-
 * operator today, so any signed-in user may do this; see the Platform card's note.
 */
export async function ensurePlatformWalletsAction(): Promise<ActionResult<PlatformWalletRow[]>> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Sign in first." };
  try {
    const rows = await Promise.all((["base", "solana"] as const).map((chain) => ensurePlatformWallet(chain)));
    await recordAudit({
      userId: session.userId,
      kind: "withdraw",
      summary: "Created or verified the platform wallets",
      metadata: { reason: "platform_wallets", addresses: rows.map((r) => `${r.chain}:${r.address}`) },
    });
    return { ok: true, data: rows };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not create the platform wallets." };
  }
}
