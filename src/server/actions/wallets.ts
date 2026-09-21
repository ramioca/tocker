"use server";
import { revalidatePath } from "next/cache";
import { and, desc, eq } from "drizzle-orm";
import { agentFundingIntents, agents, getDb, wallets } from "@/db";
import { getSession } from "@/lib/auth";
import { addressHintForChain, isValidAddressForChain } from "@/lib/wallet-address";
import {
  applyAgentBudgetPolicy,
  getAgentWallets,
  getAgentWalletBalances as loadBalances,
  getUserWalletBalances,
  withdrawFromAgent as sendWithdrawal,
  type WithdrawResult,
} from "@/lib/wallets";
import { unifiedCash, type UnifiedCash } from "@/lib/wallets/funding";
import { toNumeric } from "@/lib/money";
import { newId } from "@/server/queries/_shared";
import type {
  ActionResult,
  Chain,
  PreparedSponsoredFunding,
  WalletBalance,
} from "@/server/types";

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

/**
 * Owner-only. The public record is the equity curve and the trades; the per-asset wallet
 * breakdown (how much gas it holds, how much dry powder is parked where) is operating
 * detail, and the only screen that renders it is the owner's settings page.
 */
export async function getAgentWalletBalances(agentId: string): Promise<ActionResult<WalletBalance[]>> {
  const session = await getSession();
  if (!session) return fail("Sign in first");

  const db = await getDb();
  const [agent] = await db
    .select({ id: agents.id, ownerId: agents.ownerId, isPublic: agents.isPublic })
    .from(agents)
    .where(eq(agents.id, agentId))
    .limit(1);
  if (!agent) return fail("Agent not found");
  if (agent.ownerId !== session.userId) return fail("You do not own this agent");

  try {
    return { ok: true, data: await loadBalances(agentId) };
  } catch (err) {
    console.error("[getAgentWalletBalances]", err);
    return fail("Could not read wallet balances");
  }
}

// -------------------------------------------------------------- unified cash

/**
 * The signed-in user's own cash: USDC across their embedded wallets, presented
 * as one number with a per-chain breakdown underneath. Always the session's own
 * wallets — nothing about whose money this is comes from the caller.
 */
export async function getMyCash(): Promise<ActionResult<{ wallets: WalletBalance[]; cash: UnifiedCash }>> {
  const session = await getSession();
  if (!session) return fail("Sign in first");
  try {
    const rows = await getUserWalletBalances(session.userId);
    return { ok: true, data: { wallets: rows, cash: unifiedCash(rows) } };
  } catch (err) {
    console.error("[getMyCash]", err);
    return fail("Could not read your balances");
  }
}

/**
 * The agent's own wallet addresses, so the client can sign a transfer into them.
 * Owner-only: funding someone else's agent is not a feature, and the address of
 * a stranger's wallet is not public information in this product.
 */
export async function getAgentFundingTargets(
  agentId: string,
): Promise<ActionResult<Array<{ chain: Chain; address: string; walletId: string }>>> {
  const session = await getSession();
  if (!session) return fail("Sign in first");

  const db = await getDb();
  const [agent] = await db
    .select({ id: agents.id, ownerId: agents.ownerId })
    .from(agents)
    .where(eq(agents.id, agentId))
    .limit(1);
  if (!agent) return fail("Agent not found");
  if (agent.ownerId !== session.userId) return fail("You do not own this agent");

  const rows = await getAgentWallets(agentId);

  // Last stop before the user signs: make sure the agent's USDC account exists and that
  // the platform, not the user, paid the rent for it (W7 B1). Idempotent, and a failure
  // only means the user's own transfer creates it — it must never block funding.
  const solana = rows.find((w) => w.chain === "solana");
  if (solana) {
    const { ensureAgentUsdcAta } = await import("@/lib/wallets/gas");
    await ensureAgentUsdcAta({ agentId, address: solana.address });
  }

  return {
    ok: true,
    data: rows.map((w) => ({ chain: w.chain, address: w.address, walletId: w.id })),
  };
}

// ------------------------------------------------- sponsored Solana funding

/**
 * Resolve a destination address to an agent the session user owns.
 *
 * Nothing about ownership comes from the caller: the address is looked up in `wallets`,
 * it has to be an `agent_server` Solana row, and that row's agent has to belong to the
 * session. An address that is not one of the caller's agents' wallets is not a case to
 * sponsor — it is a plain transfer the user pays for, so the client falls back.
 */
async function ownedAgentSolanaWallet(
  userId: string,
  toAddress: string,
): Promise<ActionResult<{ agentId: string; agentName: string; slug: string; address: string }>> {
  const to = toAddress?.trim();
  if (!to) return fail("No destination address");

  const db = await getDb();
  const [row] = await db
    .select({ address: wallets.address, agentId: wallets.agentId })
    .from(wallets)
    .where(and(eq(wallets.address, to), eq(wallets.chain, "solana"), eq(wallets.kind, "agent_server")))
    .limit(1);
  if (!row?.agentId) return fail("That address is not one of your agents' Solana wallets.");

  const [agent] = await db
    .select({ id: agents.id, ownerId: agents.ownerId, name: agents.name, slug: agents.slug })
    .from(agents)
    .where(eq(agents.id, row.agentId))
    .limit(1);
  if (!agent) return fail("That wallet's agent no longer exists");
  if (agent.ownerId !== userId) return fail("You do not own this agent");

  return { ok: true, data: { agentId: agent.id, agentName: agent.name, slug: agent.slug, address: row.address } };
}

/** The session user's recorded embedded Solana wallet — the only wallet we will build a transfer out of. */
async function myEmbeddedSolanaAddress(userId: string): Promise<ActionResult<string>> {
  const db = await getDb();
  const [row] = await db
    .select({ address: wallets.address })
    .from(wallets)
    .where(and(eq(wallets.userId, userId), eq(wallets.chain, "solana"), eq(wallets.kind, "user_embedded")))
    .limit(1);
  if (!row) {
    return fail(
      "Tocker has no Solana wallet on record for you, so it cannot build a transfer out of one. Sync your wallets from Settings and try again.",
    );
  }
  return { ok: true, data: row.address };
}

/**
 * Step 1 of sponsored funding: build the transaction the user is asked to sign.
 *
 * The operator's embedded Solana wallet holds USDC and no SOL, so it cannot pay a
 * network fee. Tocker's platform Solana wallet — the same one that pays for x402 data
 * and drips gas — is the fee payer, and it also pays the rent on the agent's USDC
 * account. Nothing here is signed: it returns bytes, and the browser decides.
 *
 * When the platform wallet cannot cover the fee this succeeds with `sponsored: false`
 * and a message naming the wallet and its address. That is deliberate. It is the
 * operator's own wallet, they are the only person who can fix it, and turning it into a
 * generic error would hide the one sentence that says what to do.
 */
export async function prepareSponsoredFunding(input: {
  toAddress: string;
  amount: number;
}): Promise<ActionResult<PreparedSponsoredFunding>> {
  const session = await getSession();
  if (!session) return fail("Sign in first");

  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) return fail("Enter an amount greater than zero");

  const target = await ownedAgentSolanaWallet(session.userId, input.toAddress);
  if (!target.ok) return target;

  const from = await myEmbeddedSolanaAddress(session.userId);
  if (!from.ok) return from;
  if (from.data === target.data.address) return fail("That is the agent's own wallet, not yours");

  const { PlatformWalletError, ensurePlatformWallet } = await import("@/lib/platform/wallets");
  const cannotPay = (message: string): ActionResult<PreparedSponsoredFunding> => ({
    ok: true,
    data: { sponsored: false, blocker: "platform_cannot_pay", message },
  });

  let platform: { walletId: string; address: string };
  try {
    platform = await ensurePlatformWallet("solana");
  } catch (err) {
    return cannotPay(
      err instanceof PlatformWalletError
        ? err.message
        : `Tocker's platform Solana wallet could not be reached, so it cannot pay this network fee: ${
            err instanceof Error ? err.message : String(err)
          }`,
    );
  }

  const { PublicKey } = await import("@solana/web3.js");
  const { SOLANA_USDC_MINT, associatedTokenAddress } = await import("@/lib/wallets/solana-transfer");
  const { accountExists, getSolBalance } = await import("@/lib/wallets/solana-rpc");
  const { LAMPORTS_PER_SOL, MIN_PLATFORM_SOL, sponsoredFundingLamports } = await import("@/lib/wallets/gas");

  const ata = associatedTokenAddress(new PublicKey(target.data.address), SOLANA_USDC_MINT).toBase58();
  // An unreadable account is assumed missing: that only ever makes the check stricter,
  // and being wrong the other way would mean promising to pay rent we cannot cover.
  const ataExists = await accountExists(ata).catch(() => false);
  const needLamports = sponsoredFundingLamports({ ataExists });
  const needSol = needLamports / LAMPORTS_PER_SOL;

  let platformSol: number;
  try {
    platformSol = await getSolBalance(platform.address);
  } catch (err) {
    return cannotPay(
      `Tocker could not read the platform Solana wallet (${platform.address}) to confirm it can pay this network fee: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  if (platformSol * LAMPORTS_PER_SOL < needLamports) {
    return cannotPay(
      `Tocker's platform Solana wallet (${platform.address}) holds ${platformSol.toFixed(6)} SOL and needs at least ` +
        `${needSol.toFixed(6)} SOL to pay the network fee${
          ataExists ? "" : " and the token-account rent"
        } on this funding transfer. Send that wallet at least ${MIN_PLATFORM_SOL} SOL and try again.`,
    );
  }

  try {
    const { buildSponsoredUsdcTransfer } = await import("@/lib/wallets/solana-sponsored");
    const transaction = await buildSponsoredUsdcTransfer({
      from: from.data,
      to: target.data.address,
      feePayer: platform.address,
      amount,
    });
    return {
      ok: true,
      data: {
        sponsored: true,
        transaction: Buffer.from(transaction).toString("base64"),
        feePayer: platform.address,
        from: from.data,
        expectedAmount: amount,
      },
    };
  } catch (err) {
    console.error("[prepareSponsoredFunding]", err);
    return fail(
      `Tocker could not build the funding transaction: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * Step 2 of sponsored funding: co-sign what the user signed, and broadcast it.
 *
 * This is a public POST endpoint that ends in the platform wallet putting its signature
 * on bytes from a browser, so the order here is the whole design:
 *
 *  1. session, then ownership, then the expectation rebuilt **from the session** — the
 *     caller says which agent and how much, never who is sending or who is paying;
 *  2. `validateSponsoredUsdcTransfer`, which accepts only the exact transaction this
 *     server authored, signed by the wallet on record. A failure returns here. Nothing
 *     is signed;
 *  3. Privy adds the platform's signature, and the result is validated **again** — the
 *     user's signature must still verify over the same message, and both slots must be
 *     filled. A backend that dropped the partial signature would otherwise produce a
 *     transaction that broadcasts and fails;
 *  4. only then, broadcast and confirm.
 */
export async function submitSponsoredFunding(input: {
  toAddress: string;
  amount: number;
  /** The transaction from `prepareSponsoredFunding`, with the user's signature on it. */
  signedTransaction: string;
}): Promise<ActionResult<{ hash: string; confirmed: boolean }>> {
  const session = await getSession();
  if (!session) return fail("Sign in first");

  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) return fail("Enter an amount greater than zero");
  if (!input.signedTransaction) return fail("No signed transaction was submitted");

  const target = await ownedAgentSolanaWallet(session.userId, input.toAddress);
  if (!target.ok) return target;

  const from = await myEmbeddedSolanaAddress(session.userId);
  if (!from.ok) return from;

  const { PlatformWalletError, ensurePlatformWallet } = await import("@/lib/platform/wallets");
  let platform: { walletId: string; address: string };
  try {
    platform = await ensurePlatformWallet("solana");
  } catch (err) {
    return fail(err instanceof PlatformWalletError ? err.message : "Tocker's platform Solana wallet is unavailable");
  }

  let submitted: Uint8Array;
  try {
    submitted = new Uint8Array(Buffer.from(input.signedTransaction, "base64"));
  } catch {
    return fail("The signed transaction was not valid base64");
  }

  const expected = {
    from: from.data,
    to: target.data.address,
    feePayer: platform.address,
    amount,
  };

  const { isFullySigned, validateSponsoredUsdcTransfer } = await import("@/lib/wallets/solana-sponsored");
  const check = validateSponsoredUsdcTransfer(submitted, expected);
  if (!check.ok) {
    console.warn(`[submitSponsoredFunding] refused to co-sign for ${session.userId}: ${check.reason}`);
    return fail(
      `Tocker will not sign this transaction because ${check.reason}. Nothing was sent. Start the transfer again.`,
    );
  }

  const { authorizationContext, privy } = await import("@/lib/privy");
  let signedBase64: string;
  try {
    const signed = await privy()
      .wallets()
      .solana()
      .signTransaction(platform.walletId, {
        transaction: input.signedTransaction,
        authorization_context: authorizationContext(),
      });
    signedBase64 = signed.signed_transaction;
  } catch (err) {
    console.error("[submitSponsoredFunding] platform signature failed", err);
    return fail(
      `Tocker's platform wallet (${platform.address}) could not sign this transfer: ${
        err instanceof Error ? err.message : String(err)
      }. Nothing was sent.`,
    );
  }

  const fullySigned = new Uint8Array(Buffer.from(signedBase64, "base64"));
  if (!isFullySigned(fullySigned)) {
    return fail(
      "The platform signed this transfer but the result is missing a signature — your own signature did not survive. Nothing was sent; tell the operator.",
    );
  }
  // The same boundary, run again on the bytes that are about to be broadcast: the
  // platform's signature is the only thing that may have changed.
  const after = validateSponsoredUsdcTransfer(fullySigned, expected);
  if (!after.ok) {
    return fail(
      `The platform's signature changed this transfer (${after.reason}). Nothing was sent; tell the operator.`,
    );
  }

  const { confirmSignature, sendRawTransaction } = await import("@/lib/wallets/solana-rpc");
  let hash: string;
  try {
    hash = await sendRawTransaction(signedBase64);
  } catch (err) {
    return fail(`The network rejected this transfer: ${err instanceof Error ? err.message : String(err)}`);
  }

  const status = await confirmSignature(hash, { timeoutMs: 25_000 });
  const confirmed = status === "confirmed";

  const { recordAudit } = await import("@/lib/security/audit");
  await recordAudit({
    userId: session.userId,
    // Borrowing the nearest honest existing kind, exactly as the gas drip does: the
    // audit enum belongs to another workstream's schema block, and this is a wallet
    // funding event the platform paid for.
    kind: "budget_change",
    agentId: target.data.agentId,
    agentName: target.data.agentName,
    summary: `Tocker's platform Solana wallet paid the network fee so ${amount} USDC could be funded into this agent's Solana wallet.`,
    metadata: {
      reason: "sponsored_funding",
      chain: "solana",
      amountUsdc: amount,
      fromAddress: expected.from,
      toAddress: expected.to,
      feePayer: platform.address,
      signature: hash,
      confirmed,
    },
  });

  revalidatePath(`/agents/${target.data.slug}/settings`);
  return { ok: true, data: { hash, confirmed } };
}

// ----------------------------------------------------------- funding intents

export interface FundingIntentRow {
  id: string;
  agentId: string;
  chain: Chain;
  asset: "usdc" | "native";
  amount: number;
  amountUsd: number | null;
  status: "pending" | "sent" | "failed" | "cancelled";
  toAddress: string;
  txHash: string | null;
  error: string | null;
  onCreate: boolean;
  createdAt: string;
}

/**
 * Record what the user agreed to send before they are asked to sign it.
 *
 * The transfer itself is signed client-side — the server has no key and cannot
 * make it happen. What it can do is remember the promise, so an agent whose
 * second leg was rejected in the wallet popup shows up as half-funded instead of
 * quietly looking fine.
 */
export async function recordFundingIntents(input: {
  agentId: string;
  onCreate?: boolean;
  transfers: Array<{ chain: Chain; asset: "usdc" | "native"; amount: number; amountUsd?: number }>;
}): Promise<ActionResult<{ ids: string[] }>> {
  const session = await getSession();
  if (!session) return fail("Sign in first");
  if (input.transfers.length === 0) return { ok: true, data: { ids: [] } };
  if (input.transfers.length > 8) return fail("That is more transfers than a funding plan can have");

  const db = await getDb();
  const [agent] = await db
    .select({ id: agents.id, ownerId: agents.ownerId, slug: agents.slug })
    .from(agents)
    .where(eq(agents.id, input.agentId))
    .limit(1);
  if (!agent) return fail("Agent not found");
  if (agent.ownerId !== session.userId) return fail("You do not own this agent");

  const targets = await getAgentWallets(input.agentId);
  const values = [];
  for (const transfer of input.transfers) {
    if (!(transfer.amount > 0)) return fail("Every transfer must be greater than zero");
    const target = targets.find((t) => t.chain === transfer.chain);
    if (!target) return fail(`This agent has no ${transfer.chain} wallet`);
    values.push({
      id: newId("fund"),
      agentId: input.agentId,
      userId: session.userId,
      chain: transfer.chain,
      asset: transfer.asset,
      amount: toNumeric(transfer.amount, 18),
      amountUsd: transfer.amountUsd === undefined ? null : toNumeric(transfer.amountUsd, 6),
      toAddress: target.address,
      onCreate: input.onCreate === true,
    });
  }

  await db.insert(agentFundingIntents).values(values);
  revalidatePath(`/agents/${agent.slug}/settings`);
  return { ok: true, data: { ids: values.map((v) => v.id) } };
}

/** Close out one intent once the wallet has answered — a hash, or the reason it did not. */
export async function settleFundingIntent(input: {
  id: string;
  status: "sent" | "failed" | "cancelled";
  txHash?: string;
  error?: string;
}): Promise<ActionResult> {
  const session = await getSession();
  if (!session) return fail("Sign in first");

  const db = await getDb();
  const [intent] = await db
    .select({ id: agentFundingIntents.id, userId: agentFundingIntents.userId, agentId: agentFundingIntents.agentId })
    .from(agentFundingIntents)
    .where(eq(agentFundingIntents.id, input.id))
    .limit(1);
  if (!intent) return fail("That funding record no longer exists");
  if (intent.userId !== session.userId) return fail("That funding record is not yours");

  await db
    .update(agentFundingIntents)
    .set({
      status: input.status,
      txHash: input.txHash?.slice(0, 200) ?? null,
      error: input.error?.slice(0, 300) ?? null,
      settledAt: new Date(),
    })
    .where(eq(agentFundingIntents.id, input.id));

  const [agent] = await db
    .select({ slug: agents.slug })
    .from(agents)
    .where(eq(agents.id, intent.agentId))
    .limit(1);
  if (agent) revalidatePath(`/agents/${agent.slug}/settings`);
  return { ok: true, data: undefined };
}

/** Owner-only funding history for one agent — the settings page's honest status. */
export async function getFundingIntents(agentId: string): Promise<ActionResult<FundingIntentRow[]>> {
  const session = await getSession();
  if (!session) return fail("Sign in first");

  const db = await getDb();
  const [agent] = await db
    .select({ id: agents.id, ownerId: agents.ownerId })
    .from(agents)
    .where(eq(agents.id, agentId))
    .limit(1);
  if (!agent) return fail("Agent not found");
  if (agent.ownerId !== session.userId) return fail("You do not own this agent");

  const rows = await db
    .select()
    .from(agentFundingIntents)
    .where(eq(agentFundingIntents.agentId, agentId))
    .orderBy(desc(agentFundingIntents.createdAt))
    .limit(20);

  return {
    ok: true,
    data: rows.map((r) => ({
      id: r.id,
      agentId: r.agentId,
      chain: r.chain as Chain,
      asset: r.asset === "native" ? "native" : "usdc",
      amount: Number(r.amount),
      amountUsd: r.amountUsd === null ? null : Number(r.amountUsd),
      status: r.status,
      toAddress: r.toAddress,
      txHash: r.txHash,
      error: r.error,
      onCreate: r.onCreate,
      createdAt: r.createdAt.toISOString(),
    })),
  };
}

// ------------------------------------------------------------------ withdraw

/** Move funds from the agent server wallet back to the owner's embedded wallet. */
export async function withdrawFromAgent(input: {
  agentId: string;
  chain: Chain;
  asset: "usdc" | "native";
  amount: number;
  toAddress: string;
}): Promise<ActionResult<WithdrawResult>> {
  const session = await getSession();
  if (!session) return fail("Sign in first");

  if (!(input.amount > 0)) return fail("Enter an amount greater than zero");
  const to = input.toAddress?.trim();
  if (!to) return fail("Enter a destination address");
  if (!isValidAddressForChain(input.chain, to)) return fail(addressHintForChain(input.chain));

  const db = await getDb();
  const [agent] = await db
    .select({ id: agents.id, ownerId: agents.ownerId, slug: agents.slug })
    .from(agents)
    .where(eq(agents.id, input.agentId))
    .limit(1);
  if (!agent) return fail("Agent not found");
  if (agent.ownerId !== session.userId) return fail("You do not own this agent");

  const [wallet] = await db
    .select({ id: wallets.id })
    .from(wallets)
    .where(and(eq(wallets.agentId, input.agentId), eq(wallets.chain, input.chain), eq(wallets.kind, "agent_server")))
    .limit(1);
  if (!wallet) return fail(`This agent has no ${input.chain} wallet`);

  try {
    const result = await sendWithdrawal(input);
    revalidatePath(`/agents/${agent.slug}/settings`);
    revalidatePath(`/agents/${agent.slug}`);
    return { ok: true, data: result };
  } catch (err) {
    console.error("[withdrawFromAgent]", err);
    return fail(err instanceof Error ? err.message : "Withdrawal failed");
  }
}

/**
 * Owner-only. Set the agent's wallet-layer budget: the per-transaction USDC cap
 * enforced by Privy policies attached to the agent's server wallets. This is the
 * hard floor under the app-level risk config — the wallet refuses to sign an
 * over-cap transfer even if every other control fails.
 */
export async function setAgentWalletBudget(input: {
  agentId: string;
  perTxUsd: number;
}): Promise<ActionResult<{ perTxUsd: number }>> {
  const session = await getSession();
  if (!session) return fail("Sign in first");

  const perTxUsd = Number(input.perTxUsd);
  if (!Number.isFinite(perTxUsd) || perTxUsd < 1 || perTxUsd > 100_000) {
    return fail("Budget must be between $1 and $100,000 per transaction");
  }

  const db = await getDb();
  const [agent] = await db
    .select({ id: agents.id, ownerId: agents.ownerId, name: agents.name, slug: agents.slug, walletBudget: agents.walletBudget })
    .from(agents)
    .where(eq(agents.id, input.agentId))
    .limit(1);
  if (!agent) return fail("Agent not found");
  if (agent.ownerId !== session.userId) return fail("You do not own this agent");

  try {
    const walletBudget = await applyAgentBudgetPolicy({
      agentId: agent.id,
      agentName: agent.name,
      perTxUsd,
      existing: agent.walletBudget,
    });
    if (!walletBudget) return fail("This agent has no real wallets to attach a policy to");

    await db.update(agents).set({ walletBudget }).where(eq(agents.id, agent.id));
    revalidatePath(`/agents/${agent.slug}/settings`);
    return { ok: true, data: { perTxUsd: walletBudget.perTxUsd } };
  } catch (err) {
    console.error("[setAgentWalletBudget]", err);
    return fail(err instanceof Error ? err.message : "Could not apply the budget policy");
  }
}
