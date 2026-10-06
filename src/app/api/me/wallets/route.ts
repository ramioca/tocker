import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getUserWalletBalances, syncUserEmbeddedWallets } from "@/lib/wallets";
import { readAgentCash } from "@/lib/wallets/agent-cash";
import { CHAINS, unifiedCash } from "@/lib/wallets/funding";

export const dynamic = "force-dynamic";

/** Addresses and balances are the owner's: no shared cache, and none in the browser. */
const PRIVATE = { "cache-control": "private, no-store" } as const;

/**
 * The signed-in user's embedded wallets with live balances — what the top-bar
 * wallet chip, the deposit sheet and the builder's funding step render.
 * Owner-only by nature: the session decides whose wallets, nothing is taken
 * from the request.
 *
 * `cash` is the product's one number (USDC across every chain) plus the
 * breakdown behind it; `cashUsd` is kept as the same number at the top level so
 * older callers do not have to change.
 *
 * `cash.agents` is what the user's agents hold of their money: live agents' equity, and
 * the USDC in funded agents that are not live yet (see `readAgentCash`).
 *
 * `partial` is true when a wallet or an agent could not be read. The answer is still a
 * 200 with everything that could: the wallets carry `readFailed`, an unread agent is
 * left out, and `cash.partial` tells every reader that the totals are missing something
 * and must not be printed as the balance.
 */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401, headers: PRIVATE });

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

  const inAgents = await readAgentCash(session.userId);
  const cash = unifiedCash(wallets, inAgents.agents, { agentsUnread: inAgents.unread });
  return NextResponse.json(
    { wallets, cash, cashUsd: cash.totalUsd, partial: cash.partial === true },
    { headers: PRIVATE },
  );
}
