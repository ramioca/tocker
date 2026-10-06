import "server-only";
import { and, eq, inArray, isNotNull, lte, sql } from "drizzle-orm";
import { agents, getDb, userSecurity } from "@/db";
import { isLlmMock } from "@/lib/agent/mock-model";
import type { KillSwitchState } from "./types";

/**
 * The kill switch: one per-user flag that stops every agent that user owns from
 * opening anything new.
 *
 * WHAT IT PROTECTS AGAINST: the moment where something is clearly wrong — a
 * strategy misbehaving, a compromised LLM key, a market the operator wants no
 * part of — and the operator needs *one* control that stops all of it without
 * having to remember how many agents they have or find each one's settings page.
 *
 * WHAT IT DELIBERATELY DOES NOT STOP: the exit engine. `/api/cron/marks` runs
 * `runGuardian` for every active agent regardless of this flag, so stop losses,
 * take profits and trailing stops keep firing while trading is paused. A kill
 * switch that also froze exits would lock the operator into every open position
 * at the exact moment they decided something was wrong.
 *
 * It also does not withdraw funds, cancel an in-flight transaction, or revoke
 * the app's Privy authorization key. Those are separate, deliberate actions.
 */

export async function isTradingPaused(userId: string): Promise<boolean> {
  const db = await getDb();
  const [row] = await db
    .select({ paused: userSecurity.tradingPaused })
    .from(userSecurity)
    .where(eq(userSecurity.userId, userId))
    .limit(1);
  return row?.paused ?? false;
}

export type { KillSwitchState } from "./types";

export async function getKillSwitch(userId: string): Promise<KillSwitchState> {
  const db = await getDb();
  const [row] = await db
    .select({ paused: userSecurity.tradingPaused, at: userSecurity.tradingPausedAt })
    .from(userSecurity)
    .where(eq(userSecurity.userId, userId))
    .limit(1);
  return { paused: row?.paused ?? false, pausedAt: row?.at?.toISOString() ?? null };
}

/** Flip the switch. Upserts the row so a user who never touched security still works. */
export async function setTradingPaused(userId: string, paused: boolean): Promise<void> {
  const db = await getDb();
  const now = new Date();
  await db
    .insert(userSecurity)
    .values({ userId, tradingPaused: paused, tradingPausedAt: paused ? now : null, updatedAt: now })
    .onConflictDoUpdate({
      target: userSecurity.userId,
      set: { tradingPaused: paused, tradingPausedAt: paused ? now : null, updatedAt: now },
    });
}

/**
 * How many agents the scheduler *would* have run this tick but skipped because
 * their owner pulled the switch. Reported by `/api/cron/tick` so a paused
 * account is visible in the cron log rather than looking like an idle one.
 *
 * Mirrors `findDueAgents`'s due-ness test, restricted to paused owners.
 */
export async function countPausedDueAgents(now: Date = new Date()): Promise<number> {
  const db = await getDb();
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(agents)
    .innerJoin(userSecurity, eq(userSecurity.userId, agents.ownerId))
    .where(
      and(
        eq(agents.status, "active"),
        isNotNull(agents.nextRunAt),
        lte(agents.nextRunAt, now),
        // Same as `findDueAgents`: an agent with no key was not going to run anyway.
        ...(isLlmMock() ? [] : [isNotNull(agents.llmKeyId)]),
        eq(userSecurity.tradingPaused, true),
      ),
    );
  return Number(row?.n ?? 0);
}

/** Owners of the given agents whose kill switch is on. Used to explain a skip in the UI. */
export async function pausedOwnersOf(agentIds: string[]): Promise<Set<string>> {
  if (agentIds.length === 0) return new Set();
  const db = await getDb();
  const rows = await db
    .select({ agentId: agents.id })
    .from(agents)
    .innerJoin(userSecurity, eq(userSecurity.userId, agents.ownerId))
    .where(and(inArray(agents.id, agentIds), eq(userSecurity.tradingPaused, true)));
  return new Set(rows.map((r) => r.agentId));
}
