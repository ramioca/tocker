import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getUserWalletBalances } from "@/lib/wallets";
import { unifiedCash } from "@/lib/wallets/funding";

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

  const wallets = await getUserWalletBalances(session.userId);
  const cash = unifiedCash(wallets);

  return NextResponse.json({ wallets, cash, cashUsd: cash.totalUsd });
}
