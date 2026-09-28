"use server";

import { getSession } from "@/lib/auth";
import { isAdminEmail } from "@/lib/admin";
import { recordAudit } from "@/lib/security/audit";
import { revalidatePath } from "next/cache";
import {
  ensurePlatformWallet,
  getPlatformWallet,
  readPlatformBalance,
  withdrawFromPlatformWallet,
  type PlatformWalletRow,
} from "@/lib/platform/wallets";
import { platformWithdrawProblem } from "@/lib/platform/withdraw";
import { chainSchema } from "@/lib/agent/config";
import { addressProblemForChain, normalizeAddressForChain } from "@/lib/wallet-address";
import type { WithdrawResult } from "@/lib/wallets";
import type { ActionResult, Chain } from "@/server/types";
import { transferErrorMessage } from "./_shared";

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

/**
 * Send USDC, ETH or SOL out of a platform wallet. **Admin only**, behind the same gate
 * as the page and {@link ensurePlatformWalletsAction}.
 *
 * Everything the form checked is checked again here, against a balance read made now
 * rather than the one the page rendered with: the chain and asset (the type is gone at
 * the wire), the address against the chain (checksum included), and the amount against
 * `platformWithdrawProblem` — which keeps the Solana wallet's SOL floor, because that
 * wallet pays every fee on Solana for every user. An unreadable balance refuses rather
 * than guesses. The audit row is `withdraw`, so it renders with the money-moved accent.
 */
export async function withdrawFromPlatformAction(input: {
  chain: Chain;
  asset: "usdc" | "native";
  amount: number;
  toAddress: string;
}): Promise<ActionResult<WithdrawResult>> {
  const session = await getSession();
  if (!session || !isAdminEmail(session.email)) return { ok: false, error: "Not found." };

  if (!chainSchema.safeParse(input.chain).success) return { ok: false, error: "Unknown chain." };
  if (input.asset !== "usdc" && input.asset !== "native") return { ok: false, error: "Unknown asset." };
  const raw = typeof input.toAddress === "string" ? input.toAddress.trim() : "";
  if (!raw) return { ok: false, error: "Enter a destination address." };
  const addressProblem = addressProblemForChain(input.chain, raw);
  if (addressProblem) return { ok: false, error: addressProblem };
  const to = normalizeAddressForChain(input.chain, raw);

  const row = await getPlatformWallet(input.chain);
  if (!row) return { ok: false, error: `There is no platform ${input.chain} wallet yet.` };
  if (to.toLowerCase() === row.address.toLowerCase()) {
    return { ok: false, error: "That is the platform wallet's own address." };
  }

  const reading = await readPlatformBalance(row);
  const problem = platformWithdrawProblem({
    chain: input.chain,
    asset: input.asset,
    amount: input.amount,
    balances: { usdc: reading.usdc, native: reading.native },
  });
  if (problem) return { ok: false, error: problem };

  const symbol = input.asset === "usdc" ? "USDC" : input.chain === "solana" ? "SOL" : "ETH";
  try {
    const result = await withdrawFromPlatformWallet({ chain: input.chain, asset: input.asset, amount: input.amount, toAddress: to });
    await recordAudit({
      userId: session.userId,
      kind: "withdraw",
      summary: `Withdrew ${input.amount} ${symbol} from the platform ${input.chain} wallet to ${to.slice(0, 6)}…${to.slice(-4)}.`,
      metadata: {
        reason: "platform_withdraw",
        chain: input.chain,
        asset: input.asset,
        amount: input.amount,
        from: row.address,
        to,
        txHash: result.txHash,
        actionId: result.actionId,
        status: result.status,
      },
    });
    revalidatePath("/settings/admin");
    return { ok: true, data: result };
  } catch (err) {
    console.error("[withdrawFromPlatformAction]", err);
    return {
      ok: false,
      error: transferErrorMessage(
        err,
        "The withdrawal did not go through. Check the wallet's balance and the audit log before retrying.",
        input.chain,
        input.asset,
      ),
    };
  }
}
