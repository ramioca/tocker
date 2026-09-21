import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getUserWalletBalances, syncUserEmbeddedWallets } from "@/lib/wallets";
import { CHAINS, unifiedCash } from "@/lib/wallets/funding";

export const dynamic = "force-dynamic";

/**
 * The signed-in user's embedded wallets with live balances — what the top-bar
 * wallet chip, the deposit sheet and the builder's funding step render.
 * Owner-only by nature: the session decides whose wallets, nothing is taken
 * from the request.
 *
 * `cash` is the product's one number (USDC across every chain) plus the
 * breakdown behind it; `cashUsd` is kept as the same number at the top level so
 * older callers do not have to change.
 */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  let wallets = await getUserWalletBalances(session.userId);

  // Self-heal (W7 M5). Privy creates the two embedded wallets *after* authentication
  // resolves, so a `/api/me/sync` that ran a moment too early recorded one of them, or
  // neither — and nothing ever asked again. Rather than leave the user staring at a
  // deposit sheet with no Solana address, re-read the wallet list from Privy here, once,
  // whenever a chain is missing. `syncUserEmbeddedWallets` is idempotent and never
  // throws, so the worst case is the same answer we already had.
  if (wallets.length < CHAINS.length) {
    const recorded = await syncUserEmbeddedWallets(session.userId);
    if (recorded.length > wallets.length) wallets = await getUserWalletBalances(session.userId);
  }

  const cash = unifiedCash(wallets);
  return NextResponse.json({ wallets, cash, cashUsd: cash.totalUsd });
}
