"use server";
/**
 * Blocklist and on-demand scoring — the two writes a token page can make.
 *
 * The blocklist is the only list in the product, and it is subtractive: there is
 * no allowlist to add to (SPEC, rule 2). "Block on…" is therefore the one control
 * a token page offers over an agent, and it only ever *removes* permission.
 */
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { agents, getDb } from "@/db";
import type { AgentConfig } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { DEFAULT_AGENT_CONFIG } from "@/lib/agent/config";
import { getTokenScore } from "@/lib/tokens";
import type { ActionResult, Chain, TokenScore } from "@/server/types";

const MAX_BLOCKLIST = 200;

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

function normalizeSymbol(symbol: string): string {
  const trimmed = symbol.trim().replace(/^\$/, "");
  return (trimmed.length > 0 ? trimmed : "TOKEN").slice(0, 16);
}

/**
 * Add one token to one of the caller's agents' blocklists.
 *
 * Only the owner may write, and the write is a no-op when the entry is already
 * there — the UI shows "blocked" rather than failing.
 */
export async function addToBlocklist(
  agentId: string,
  chain: Chain,
  address: string,
  symbol: string,
): Promise<ActionResult<{ blocked: true; count: number }>> {
  const session = await getSession();
  if (!session) return fail("Sign in to block a token");
  if (!address || address.length < 3) return fail("That does not look like a token address");

  const db = await getDb();
  const [agent] = await db
    .select({ id: agents.id, ownerId: agents.ownerId, slug: agents.slug, config: agents.config })
    .from(agents)
    .where(eq(agents.id, agentId))
    .limit(1);
  if (!agent) return fail("Agent not found");
  if (agent.ownerId !== session.userId) return fail("That is not your agent");

  const config: AgentConfig = agent.config;
  const existing = config.universe?.blocklist ?? [];
  const wanted = address.toLowerCase();
  if (existing.some((entry) => entry.chain === chain && entry.address.toLowerCase() === wanted)) {
    return { ok: true, data: { blocked: true, count: existing.length } };
  }
  if (existing.length >= MAX_BLOCKLIST) return fail(`A blocklist holds at most ${MAX_BLOCKLIST} tokens`);

  const blocklist = [...existing, { chain, address, symbol: normalizeSymbol(symbol) }];
  await db
    .update(agents)
    .set({
      config: { ...config, universe: { ...config.universe, blocklist } },
      updatedAt: new Date(),
    })
    .where(eq(agents.id, agentId));

  revalidatePath(`/agents/${agent.slug}`);
  revalidatePath(`/tokens/${chain}/${address}`);
  return { ok: true, data: { blocked: true, count: blocklist.length } };
}

/** Take a token back off one of the caller's agents' blocklists. */
export async function removeFromBlocklist(
  agentId: string,
  chain: Chain,
  address: string,
): Promise<ActionResult<{ blocked: false; count: number }>> {
  const session = await getSession();
  if (!session) return fail("Sign in to edit a blocklist");

  const db = await getDb();
  const [agent] = await db
    .select({ id: agents.id, ownerId: agents.ownerId, slug: agents.slug, config: agents.config })
    .from(agents)
    .where(eq(agents.id, agentId))
    .limit(1);
  if (!agent) return fail("Agent not found");
  if (agent.ownerId !== session.userId) return fail("That is not your agent");

  const config: AgentConfig = agent.config;
  const wanted = address.toLowerCase();
  const blocklist = (config.universe?.blocklist ?? []).filter(
    (entry) => !(entry.chain === chain && entry.address.toLowerCase() === wanted),
  );
  await db
    .update(agents)
    .set({ config: { ...config, universe: { ...config.universe, blocklist } }, updatedAt: new Date() })
    .where(eq(agents.id, agentId));

  revalidatePath(`/agents/${agent.slug}`);
  revalidatePath(`/tokens/${chain}/${address}`);
  return { ok: true, data: { blocked: false, count: blocklist.length } };
}

/**
 * Score a token on demand, under the platform's **default** universe.
 *
 * Free: only the keyless providers are used (Jupiter, RugCheck, DexScreener,
 * GoPlus) and `deep` is never set, so this spends no x402 money and needs no
 * agent. Scoring under the default universe rather than any agent's is what
 * makes the resulting verdict publishable — an agent's gates are private.
 *
 * Requires a session purely as rate-limiting hygiene: the action reaches out to
 * third-party APIs, so it should not be an open proxy.
 */
export async function scoreTokenNow(chain: Chain, address: string): Promise<ActionResult<TokenScore>> {
  const session = await getSession();
  if (!session) return fail("Sign in to score a token");
  if (!address || address.length < 3) return fail("That does not look like a token address");

  try {
    const score = await getTokenScore({
      chain,
      address,
      universe: DEFAULT_AGENT_CONFIG.universe,
      maxTradeUsd: DEFAULT_AGENT_CONFIG.risk.maxTradeUsd,
      force: true,
    });
    revalidatePath(`/tokens/${chain}/${address}`);
    return { ok: true, data: score };
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Scoring failed");
  }
}
