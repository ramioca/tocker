import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getUserWalletBalances } from "@/lib/wallets";

export const dynamic = "force-dynamic";

/**
 * The signed-in user's embedded wallets with live balances — what the top-bar
 * wallet chip and the deposit/withdraw modals render. Owner-only by nature:
 * the session decides whose wallets, nothing is taken from the request.
 */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const wallets = await getUserWalletBalances(session.userId);
  const cashUsd = wallets.reduce((sum, w) => {
    const usdc = w.balances.find((b) => b.asset === "usdc");
    // USDC is a dollar; fall back to face value when Privy omits the USD quote.
    return sum + (usdc ? (usdc.usd ?? usdc.amount) : 0);
  }, 0);

  return NextResponse.json({ wallets, cashUsd });
}
