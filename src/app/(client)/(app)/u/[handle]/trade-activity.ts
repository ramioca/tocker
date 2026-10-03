import "server-only";
import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { getDb, trades } from "@/db";
import { fillActivityDays } from "@/components/profile/activity-days";

/**
 * Filled trades per UTC day across the agents a profile shows, for the Activity tab.
 *
 * `agentIds` is the profile's own agent list, so visibility is whatever
 * `getUserProfile` already decided: public agents for a visitor, every agent for the
 * owner. Daily counts only — no tokens, sizes or reasoning, which would start to read
 * as a strategy.
 *
 * Belongs in `src/server/queries/users.ts` as `getUserTradeActivity`; it lives next to
 * the page until that file's owner moves it.
 */
export async function tradeActivity(
  agentIds: readonly string[],
  days = 365,
): Promise<Array<{ t: number; value: number }>> {
  if (agentIds.length === 0) return fillActivityDays([], days);
  const db = await getDb();
  const since = new Date(Date.now() - days * 86_400_000);
  const at = sql`coalesce(${trades.filledAt}, ${trades.createdAt})`;
  // Days since the epoch. Epoch seconds are absolute, so this is the UTC day whatever
  // the session's time zone is.
  const day = sql<number>`floor(extract(epoch from ${at}) / 86400)::int`;
  const rows = await db
    .select({ day, n: sql<number>`count(*)::int` })
    .from(trades)
    .where(and(inArray(trades.agentId, [...agentIds]), eq(trades.status, "filled"), gte(at, since)))
    .groupBy(day);
  return fillActivityDays(
    rows.map((row) => ({ day: Number(row.day), n: Number(row.n ?? 0) })),
    days,
  );
}
