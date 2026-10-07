import "server-only";
import { eq } from "drizzle-orm";
import { agents, getDb } from "@/db";
import type { AgentConfig } from "@/db/schema";
import { withMock } from "@/lib/data";
import { thinkSource } from "@/lib/agent/inference";
import { isLlmMock } from "@/lib/agent/mock-model";
import { holdChipLabel, stopWords } from "@/components/agents/thinking";

/** What stops one of the viewer's own agents from ticking, in a chip's worth of words. */
export interface AgentBlocker {
  /** No wider than the status chip above it, or the card's meta line pays for it. */
  label: string;
  /** The sentence behind it, for the chip's title. The agent page's banner says it in full. */
  detail: string;
}

/**
 * Pure: the chip for one agent, or null when nothing stops it.
 *
 * An agent that pays for its own thinking has no key on purpose, so it never reads "No
 * key"; what can stop it is a hold, which is named instead. A key agent's answer is what
 * it always was: no key, no thinking (unless the scripted model is standing in for one).
 */
export function blockerFor(
  row: { llmKeyId: string | null; config: Pick<AgentConfig, "llm"> | null; inferenceHold: string | null },
  options: { llmMock: boolean },
): AgentBlocker | null {
  if (thinkSource(row.config) === "usdc") {
    if (!row.inferenceHold) return null;
    const words = stopWords(row.inferenceHold);
    return { label: holdChipLabel(row.inferenceHold), detail: `${words.title}. ${words.detail}` };
  }
  if (row.llmKeyId === null && !options.llmMock) {
    return {
      label: "No key",
      detail: "No LLM key attached: every tick fails before it starts.",
    };
  }
  return null;
}

/**
 * The owner's fleet view, "is anything stuck?", answered cheaply: one read of the
 * viewer's own agents, no portfolio, no RPC. The agent page's status banner is the
 * full answer; this is the part of it that means *every* tick fails, so a card can stop
 * reading ACTIVE with nothing else to say.
 *
 * Owner-only by construction: it reads `owner_id = userId` and nothing else.
 * `LLM_MOCK=1` runs think without a key, so no key is missed there; a pay-per-use hold
 * is still a hold.
 *
 * Belongs in `src/server/queries/agents.ts` (as `AgentCard.blocker` from
 * `listMyAgents`); it lives next to the card until that file's owner moves it.
 */
export async function agentBlockers(userId: string | null): Promise<Map<string, AgentBlocker>> {
  const none = new Map<string, AgentBlocker>();
  if (!userId) return none;
  const llmMock = isLlmMock();
  // A label, never a gate: a failed read shows the cards as they were.
  return withMock(async () => {
    const db = await getDb();
    const rows = await db
      .select({
        id: agents.id,
        llmKeyId: agents.llmKeyId,
        config: agents.config,
        inferenceHold: agents.inferenceHold,
      })
      .from(agents)
      .where(eq(agents.ownerId, userId));
    const blockers = new Map<string, AgentBlocker>();
    for (const row of rows) {
      const blocker = blockerFor(row, { llmMock });
      if (blocker) blockers.set(row.id, blocker);
    }
    return blockers;
  }, () => none).catch(() => none);
}
