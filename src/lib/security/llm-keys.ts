import "server-only";
import { desc, eq, sql } from "drizzle-orm";
import { agentRuns, agents, getDb, llmKeys } from "@/db";
import type { LlmKeyDetail } from "./types";

/**
 * The owner's view of their own LLM keys.
 *
 * ONLY metadata crosses this boundary: provider, label, the last four characters,
 * when it was added, how many agents use it, and when it was last used to think.
 * `llm_keys.encryptedKey` is never selected here — a column that is never read
 * cannot be serialised into a payload by accident.
 *
 * Storage, verified: `addLlmKey` writes `encryptSecret(key)` from
 * `src/lib/crypto.ts` — AES-256-GCM, `base64(iv|tag|ciphertext)`, key from
 * `ENCRYPTION_KEY` (32 raw bytes, base64). `decryptSecret` is called in exactly
 * one place in the app, `resolveModel` in `src/lib/agent/run.ts`, inside the run
 * loop. The plaintext never reaches a server component, an action result, or the
 * browser.
 *
 * "Last used" is derived rather than stored: the most recent run of any agent
 * currently pointed at the key. That means it moves if you re-point an agent, and
 * it is blank for a key that has never backed a run — which is the honest answer,
 * and it costs no extra column and no write on the hot path.
 */

export type { LlmKeyDetail } from "./types";

export async function getLlmKeyDetails(userId: string): Promise<LlmKeyDetail[]> {
  const db = await getDb();

  const rows = await db
    .select({
      id: llmKeys.id,
      provider: llmKeys.provider,
      label: llmKeys.label,
      last4: llmKeys.last4,
      createdAt: llmKeys.createdAt,
      agentCount: sql<number>`count(distinct ${agents.id})::int`,
      lastUsedAt: sql<Date | null>`max(${agentRuns.startedAt})`,
    })
    .from(llmKeys)
    .leftJoin(agents, eq(agents.llmKeyId, llmKeys.id))
    .leftJoin(agentRuns, eq(agentRuns.agentId, agents.id))
    .where(eq(llmKeys.userId, userId))
    .groupBy(llmKeys.id, llmKeys.provider, llmKeys.label, llmKeys.last4, llmKeys.createdAt)
    .orderBy(desc(llmKeys.createdAt));

  return rows.map((r) => ({
    id: r.id,
    provider: r.provider,
    label: r.label,
    last4: r.last4,
    createdAt: r.createdAt.toISOString(),
    lastUsedAt: r.lastUsedAt ? new Date(r.lastUsedAt).toISOString() : null,
    agentCount: Number(r.agentCount ?? 0),
  }));
}

/** Is `ENCRYPTION_KEY` present and the right size? Reported, never printed. */
export function encryptionConfigured(): boolean {
  const raw = process.env.ENCRYPTION_KEY?.trim();
  if (!raw) return false;
  try {
    return Buffer.from(raw, "base64").length === 32;
  } catch {
    return false;
  }
}
