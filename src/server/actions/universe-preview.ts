"use server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { agents, getDb } from "@/db";
import { agentConfigSchema, chainSchema } from "@/lib/agent/config";
import { getSession } from "@/lib/auth";
import { previewUniverse, type UniversePreview } from "@/server/queries/universe-preview";
import type { ActionResult } from "@/server/types";

/**
 * Preview a universe the operator has not saved yet, against the last 24 hours of
 * score history — and, in the same call, the same window under the agent's *saved*
 * universe, so the form can say "14 would clear this bar (9 with your saved
 * settings)" without a second round trip and without the client holding a baseline
 * that goes stale the moment Save lands.
 *
 * Owner-only, like everything that touches a strategy: the thresholds are the
 * operator's IP, and so is the fact that a particular bar lets fourteen tokens
 * through. Nothing here is reachable for another user's agent, and nothing it
 * returns echoes the universe back.
 */

/** Reused rather than restated: one definition of a universe, in `lib/agent/config`. */
const universeSchema = agentConfigSchema.shape.universe;

const argsSchema = z.object({
  agentId: z.string().min(1),
  universe: universeSchema,
  /**
   * The chains the form currently has selected. Optional: without it the preview
   * scans the agent's saved chains, which would quietly ignore a chain the operator
   * just toggled on in the same session.
   */
  chains: z.array(chainSchema).min(1).max(2).optional(),
});

export interface UniversePreviewPair {
  /** The universe the operator is looking at right now. */
  proposed: UniversePreview;
  /** The same window under what is actually saved — the number to compare against. */
  saved: UniversePreview;
}

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

export async function previewUniverseAction(
  agentId: string,
  universe: unknown,
  chains?: unknown,
): Promise<ActionResult<UniversePreviewPair>> {
  const session = await getSession();
  if (!session) return fail("Sign in to preview a universe");

  const parsed = argsSchema.safeParse({ agentId, universe, chains });
  if (!parsed.success) return fail("Those universe settings are not valid");

  const db = await getDb();
  const [agent] = await db
    .select({ ownerId: agents.ownerId, config: agents.config })
    .from(agents)
    .where(eq(agents.id, parsed.data.agentId))
    .limit(1);
  // Same answer for "no such agent" and "not yours": an owner-only surface should not
  // confirm that someone else's agent id exists.
  if (!agent || agent.ownerId !== session.userId) return fail("That agent is not yours");

  try {
    const [proposed, saved] = await Promise.all([
      previewUniverse({
        agentId: parsed.data.agentId,
        universe: parsed.data.universe,
        chains: parsed.data.chains,
      }),
      // The baseline is what the agent actually runs: its saved universe *and* its
      // saved chains, whatever the form has staged.
      previewUniverse({
        agentId: parsed.data.agentId,
        universe: agent.config.universe,
        chains: agent.config.chains,
      }),
    ]);
    return { ok: true, data: { proposed, saved } };
  } catch (error) {
    console.error("[universe-preview] could not read score history", error);
    return fail("Could not read the last 24 hours of scores");
  }
}
