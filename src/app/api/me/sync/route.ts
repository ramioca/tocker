import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { isPrivyConfigured } from "@/lib/privy";
import { syncUserEmbeddedWallets } from "@/lib/wallets";

export const dynamic = "force-dynamic";

/** The answer lists the caller's wallet addresses: no shared cache, and none in the browser. */
const PRIVATE = { "cache-control": "private, no-store" } as const;

/**
 * Called by the client right after login, and again whenever Privy finishes creating
 * an embedded wallet (`use-session.ts` watches the count). Records the user's Privy
 * *embedded* wallets in `wallets` (kind `user_embedded`) so the funding UI knows where
 * the user can send from.
 *
 * The wallet list is read from Privy server-side — never from the request body — so
 * nobody can register an address they do not control. The work itself lives in
 * `syncUserEmbeddedWallets`, because `GET /api/me/wallets` self-heals with the same
 * call when a chain is missing (W7 M5).
 */
export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401, headers: PRIVATE });

  if (!isPrivyConfigured()) {
    return NextResponse.json({ ok: true, wallets: [], note: "privy not configured" }, { headers: PRIVATE });
  }

  const recorded = await syncUserEmbeddedWallets(session.userId);
  return NextResponse.json({ ok: true, wallets: recorded }, { headers: PRIVATE });
}
