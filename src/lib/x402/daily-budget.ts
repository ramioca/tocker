/**
 * The daily ceilings on data the platform pays for.
 *
 * A run's own budget (`MAX_DATA_SPEND_PER_RUN_USD`) bounds one run. It says nothing about
 * how many runs there are, and a run costs its owner nothing: the platform wallet pays,
 * for paper agents too. So two more bounds, both over the last 24 hours and both counted
 * from the payments table rather than from memory:
 *
 *  - one owner, across all their agents;
 *  - the whole platform.
 *
 * Past either, a paid call is refused before anything is signed, the same way a call past
 * the run's budget is, and the agent carries on with the free providers.
 *
 * Payment rows are deleted with their agent, so deleting an agent would hand its owner a
 * fresh day. `deleteAgent` writes what the agent spent in the last 24 hours to the audit
 * log (rows there outlive the agent), and the sums below count it.
 */

/** What one owner's agents may spend on data in 24 hours, unless `X402_OWNER_DAILY_USD` says otherwise. */
export const DEFAULT_OWNER_DAILY_DATA_USD = 5;
/** What every agent together may spend on data in 24 hours, unless `X402_PLATFORM_DAILY_USD` says otherwise. */
export const DEFAULT_PLATFORM_DAILY_DATA_USD = 100;

/** The `metadata.reason` of the audit row a deleted agent's spend is carried in. */
export const DATA_SPEND_CARRYOVER = "data_spend_carryover";

const DAY_MS = 86_400_000;

function usdFrom(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  // A value that is not a number is a typo, not a wish for no limit.
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export function dailyDataCaps(env: Record<string, string | undefined> = process.env): { ownerUsd: number; platformUsd: number } {
  return {
    ownerUsd: usdFrom(env.X402_OWNER_DAILY_USD, DEFAULT_OWNER_DAILY_DATA_USD),
    platformUsd: usdFrom(env.X402_PLATFORM_DAILY_USD, DEFAULT_PLATFORM_DAILY_DATA_USD),
  };
}

/**
 * Which ceiling, if either, a payment of `amountUsd` would cross. Pure, so the rule is
 * tested without a database.
 */
export function dailyCapCrossed(
  spent: { ownerUsd: number; platformUsd: number },
  amountUsd: number,
  caps: { ownerUsd: number; platformUsd: number },
): "owner" | "platform" | null {
  // The same tolerance the per-run check has none of; sums of six-decimal amounts are exact enough.
  if (spent.ownerUsd + amountUsd > caps.ownerUsd + 1e-9) return "owner";
  if (spent.platformUsd + amountUsd > caps.platformUsd + 1e-9) return "platform";
  return null;
}

/**
 * Real (not simulated) data spend in the 24 hours before `now`: by the owner of `agentId`
 * across all their agents, and by everyone. Includes what deleted agents spent.
 */
export async function realDataSpend24h(agentId: string, now: Date = new Date()): Promise<{ ownerUsd: number; platformUsd: number }> {
  const { and, eq, gte, sql } = await import("drizzle-orm");
  const { agents, auditEvents, getDb, x402Payments } = await import("@/db");
  const db = await getDb();
  const since = new Date(now.getTime() - DAY_MS);

  const [me] = await db.select({ ownerId: agents.ownerId }).from(agents).where(eq(agents.id, agentId)).limit(1);
  const ownerId = me?.ownerId ?? "";

  const real = and(eq(x402Payments.simulated, false), gte(x402Payments.createdAt, since));
  const paid = sql<string>`coalesce(sum(${x402Payments.amountUsd}), 0)`;
  const carried = sql<string>`coalesce(sum((${auditEvents.metadata}->>'dataSpendUsd')::numeric), 0)`;
  const isCarry = and(gte(auditEvents.createdAt, since), sql`${auditEvents.metadata}->>'reason' = ${DATA_SPEND_CARRYOVER}`);

  const [[mine], [all], [mineGone], [allGone]] = await Promise.all([
    db
      .select({ usd: paid })
      .from(x402Payments)
      .innerJoin(agents, eq(agents.id, x402Payments.agentId))
      .where(and(real, eq(agents.ownerId, ownerId))),
    db.select({ usd: paid }).from(x402Payments).where(real),
    db.select({ usd: carried }).from(auditEvents).where(and(isCarry, eq(auditEvents.userId, ownerId))),
    db.select({ usd: carried }).from(auditEvents).where(isCarry),
  ]);
  return {
    ownerUsd: Number(mine?.usd ?? 0) + Number(mineGone?.usd ?? 0),
    platformUsd: Number(all?.usd ?? 0) + Number(allGone?.usd ?? 0),
  };
}

/** What one agent really paid for data in the 24 hours before `now`. For the carry-over row. */
export async function agentRealDataSpend24h(agentId: string, now: Date = new Date()): Promise<number> {
  const { and, eq, gte, sql } = await import("drizzle-orm");
  const { getDb, x402Payments } = await import("@/db");
  const db = await getDb();
  const [row] = await db
    .select({ usd: sql<string>`coalesce(sum(${x402Payments.amountUsd}), 0)` })
    .from(x402Payments)
    .where(
      and(
        eq(x402Payments.agentId, agentId),
        eq(x402Payments.simulated, false),
        gte(x402Payments.createdAt, new Date(now.getTime() - DAY_MS)),
      ),
    );
  return Number(row?.usd ?? 0);
}
