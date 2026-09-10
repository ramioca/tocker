"use server";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { agents, getDb, wallets } from "@/db";
import { getSession } from "@/lib/auth";
import {
  getAgentWalletBalances as loadBalances,
  withdrawFromAgent as sendWithdrawal,
} from "@/lib/wallets";
import type { ActionResult, Chain, WalletBalance } from "@/server/types";

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

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
  if (agent.ownerId !== session.userId && !agent.isPublic) return fail("This agent is private");

  try {
    return { ok: true, data: await loadBalances(agentId) };
  } catch (err) {
    console.error("[getAgentWalletBalances]", err);
    return fail("Could not read wallet balances");
  }
}

/** Move funds from the agent server wallet back to the owner's embedded wallet. */
export async function withdrawFromAgent(input: {
  agentId: string;
  chain: Chain;
  asset: "usdc" | "native";
  amount: number;
  toAddress: string;
}): Promise<ActionResult<{ txHash: string }>> {
  const session = await getSession();
  if (!session) return fail("Sign in first");

  if (!(input.amount > 0)) return fail("Enter an amount greater than zero");
  const to = input.toAddress?.trim();
  if (!to) return fail("Enter a destination address");
  if (input.chain === "base" && !/^0x[a-fA-F0-9]{40}$/.test(to)) return fail("That is not a valid Base address");
  if (input.chain === "solana" && !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(to)) {
    return fail("That is not a valid Solana address");
  }

  const db = await getDb();
  const [agent] = await db
    .select({ id: agents.id, ownerId: agents.ownerId, slug: agents.slug, mode: agents.mode })
    .from(agents)
    .where(eq(agents.id, input.agentId))
    .limit(1);
  if (!agent) return fail("Agent not found");
  if (agent.ownerId !== session.userId) return fail("You do not own this agent");
  if (agent.mode === "paper") return fail("Paper agents hold no real funds");

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
