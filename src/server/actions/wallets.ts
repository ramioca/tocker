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
import type { ActionResult, Chain, WalletBalance } from "@/server/types";

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
