import "server-only";
import { eq } from "drizzle-orm";
import { agents, getDb } from "@/db";
import { withMock } from "@/lib/data";
import { isLlmMock } from "@/lib/agent/mock-model";

/** What stops one of the viewer's own agents from ticking, in a chip's worth of words. */
export interface AgentBlocker {
  /** No wider than the status chip above it, or the card's meta line pays for it. */
  label: string;
  /** The sentence behind it, for the chip's title. The agent page's banner says it in full. */
  detail: string;
}

/**
 * The owner's fleet view, "is anything stuck?", answered cheaply: one read of the
 * viewer's own agents, no portfolio, no RPC. The agent page's status banner is the
 * full answer; this is the part of it that means *every* tick fails, so a card can stop
 * reading ACTIVE with nothing else to say.
 *
 * Owner-only by construction: it reads `owner_id = userId` and nothing else.
 * `LLM_MOCK=1` runs think without a key, so nothing is blocked there.
 *
 * Belongs in `src/server/queries/agents.ts` (as `AgentCard.blocker` from
 * `listMyAgents`); it lives next to the card until that file's owner moves it.
 */
export async function agentBlockers(userId: string | null): Promise<Map<string, AgentBlocker>> {
  const none = new Map<string, AgentBlocker>();
  if (!userId || isLlmMock()) return none;
  // A label, never a gate: a failed read shows the cards as they were.
  return withMock(async () => {
    const db = await getDb();
    const rows = await db
      .select({ id: agents.id, llmKeyId: agents.llmKeyId })
      .from(agents)
      .where(eq(agents.ownerId, userId));
    const blockers = new Map<string, AgentBlocker>();
    for (const row of rows) {
      if (row.llmKeyId === null) {
        blockers.set(row.id, {
          label: "No key",
          detail: "No LLM key attached: every tick fails before it starts.",
        });
      }
    }
    return blockers;
  }, () => none).catch(() => none);
}
