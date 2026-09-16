"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth";
import { isAdminEmail } from "@/lib/admin";
import { getAdminBalances, resetAdminBalanceCache } from "@/server/queries/admin";
import type { ActionResult } from "@/server/types";

/**
 * Re-read every agent wallet from Privy and drop the cached snapshot.
 *
 * The dashboard shows balances "as of HH:MM" rather than pretending they are live,
 * because reading them costs two Privy calls per wallet. This is the button next to
 * that timestamp: it is the only way the page issues those calls outside the 60-second
 * cache, so an operator decides when to pay for a fresh reading.
 *
 * The error message for a non-admin is deliberately the same nothing the route gives
 * them. A server action cannot 404, but it must not confirm the surface exists either.
 */
export async function refreshAdminBalancesAction(): Promise<ActionResult<{ readAt: string }>> {
  const session = await getSession();
  if (!session || !isAdminEmail(session.email)) return { ok: false, error: "Not found." };

  try {
    resetAdminBalanceCache();
    const snapshot = await getAdminBalances({ force: true });
    revalidatePath("/settings/admin");
    return { ok: true, data: { readAt: snapshot.readAt } };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Could not read the wallet balances.",
    };
  }
}
