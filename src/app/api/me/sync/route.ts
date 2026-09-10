import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getDb, wallets } from "@/db";
import { getSession } from "@/lib/auth";
import { isPrivyConfigured, privy } from "@/lib/privy";
import type { Chain } from "@/server/types";

export const dynamic = "force-dynamic";

/**
 * Called by the client right after login. Records the user's Privy *embedded*
 * wallets in `wallets` (kind `user_embedded`) so the funding UI knows where the
 * user can send from.
 *
 * The wallet list is read from Privy server-side — never from the request body —
 * so nobody can register an address they do not control.
 */
export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  if (!isPrivyConfigured()) {
    return NextResponse.json({ ok: true, wallets: [], note: "privy not configured" });
  }

  const db = await getDb();
  let recorded: Array<{ id: string; chain: Chain; address: string }> = [];

  try {
    const user = await privy().users()._get(session.userId);
    for (const account of user.linked_accounts ?? []) {
      if (account.type !== "wallet") continue;
      if (!("connector_type" in account) || account.connector_type !== "embedded") continue;
      const chain: Chain | null =
        account.chain_type === "solana" ? "solana" : account.chain_type === "ethereum" ? "base" : null;
      if (!chain) continue;
      const id = ("id" in account ? account.id : null) ?? `${chain}:${account.address}`;
      recorded.push({ id, chain, address: account.address });
    }

    if (recorded.length > 0) {
      await db
        .insert(wallets)
        .values(
          recorded.map((w) => ({
            id: w.id,
            kind: "user_embedded" as const,
            chain: w.chain,
            address: w.address,
            userId: session.userId,
            agentId: null,
          })),
        )
        .onConflictDoNothing();

      // an address can only belong to one user — keep the stored rows honest
      const stored = await db
        .select({ id: wallets.id, chain: wallets.chain, address: wallets.address })
        .from(wallets)
        .where(and(eq(wallets.userId, session.userId), eq(wallets.kind, "user_embedded")));
      recorded = stored.map((s) => ({ id: s.id, chain: s.chain as Chain, address: s.address }));
    }
  } catch (err) {
    console.error("[/api/me/sync]", err);
    return NextResponse.json({ error: "sync failed" }, { status: 502 });
  }

  return NextResponse.json({ ok: true, wallets: recorded });
}
