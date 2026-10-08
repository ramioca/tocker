/**
 * The fee ledger: one row per executed fill, written at fill time.
 *
 * `chargePlatformFee` is called from all four execution paths — the agent's own
 * `place_trade`, an approved proposal, a guardian exit and a manual trade — immediately
 * after a fill comes back, and *before* the position and the receipt are written, so
 * both can account for it.
 *
 * Two properties it must have, and has:
 *
 *  - **It never throws.** A fee is the platform's problem; a fill is the operator's
 *    money. Losing the fee is annoying, turning a filled trade into a failed one
 *    because the fee ledger hiccuped is unforgivable. Failures log and return 0, and the
 *    receipt then honestly says the fill carried no platform fee.
 *  - **It is idempotent.** `platform_fees_trade_idx` is unique on `trade_id`, so a
 *    retried write charges nothing twice; the existing row's amount is returned instead.
 *
 * Paper agents are charged too — the row is written already `settled` with
 * `tx_hash: "simulated"`, and paper cash is reduced by it (see `trading/paper.ts`).
 * A paper agent that does not feel the fee is a paper agent whose PnL is a lie.
 */
import { nanoid } from "nanoid";
import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb, platformFees } from "@/db";
import { toNum, toNumeric } from "@/lib/money";
import type { Chain } from "@/server/types";
import { SIMULATED_SETTLEMENT_TX, feeForFill, platformFeeBps, sumFees, type FeeRow } from "./fee";

export interface ChargeFeeInput {
  agentId: string;
  tradeId: string;
  chain: Chain;
  /**
   * What the fill actually moved, in USD: the USDC spent on a buy, the USDC received on
   * a sell. The fee is a share of this, never of the size that was asked for: an exit
   * that fills under its mark pays on what it brought in.
   */
  fillUsd: number;
  /** Paper fills settle instantly and simulated; live fills accrue for the sweep. */
  isPaper: boolean;
  now?: Date;
}

/**
 * Records the fee for one fill and returns what was actually charged in USD.
 *
 * Returns 0 when the fee is disabled (`PLATFORM_FEE_BPS=0`), when the fill is too small
 * for its fee to reach the ledger's sixth decimal, or when the write failed. In all
 * three nothing is written and nothing downstream should pretend a fee exists.
 */
export async function chargePlatformFee(input: ChargeFeeInput): Promise<number> {
  const now = input.now ?? new Date();
  try {
    const amountUsd = feeForFill(input.fillUsd, platformFeeBps());
    if (!(amountUsd > 0)) return 0;

    const db = await getDb();
    const inserted = await db
      .insert(platformFees)
      .values({
        id: nanoid(),
        agentId: input.agentId,
        tradeId: input.tradeId,
        chain: input.chain,
        amountUsd: toNumeric(amountUsd, 6),
        status: input.isPaper ? "settled" : "accrued",
        txHash: input.isPaper ? SIMULATED_SETTLEMENT_TX : null,
        createdAt: now,
        settledAt: input.isPaper ? now : null,
      })
      .onConflictDoNothing()
      .returning({ amountUsd: platformFees.amountUsd });

    if (inserted.length > 0) return toNum(inserted[0]?.amountUsd);

    // Already charged for this trade. Report the amount on the ledger, not one worked
    // out again at the current rate — the receipt must agree with what the agent was
    // actually billed.
    const [existing] = await db
      .select({ amountUsd: platformFees.amountUsd })
      .from(platformFees)
      .where(eq(platformFees.tradeId, input.tradeId))
      .limit(1);
    return toNum(existing?.amountUsd);
  } catch (err) {
    console.warn(
      `[platform-fee] could not record the fee for trade ${input.tradeId}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return 0;
  }
}

/** Every unsettled fee this agent owes, oldest first, as the batching math wants them. */
export async function accruedFees(agentId: string): Promise<FeeRow[]> {
  const db = await getDb();
  const rows = await db
    .select({ id: platformFees.id, chain: platformFees.chain, amountUsd: platformFees.amountUsd })
    .from(platformFees)
    .where(and(eq(platformFees.agentId, agentId), eq(platformFees.status, "accrued")))
    .orderBy(platformFees.createdAt);
  return rows.map((r) => ({ id: r.id, chain: r.chain as Chain, amountUsd: toNum(r.amountUsd) }));
}

/**
 * What this agent owes right now. Subtracted from its live wallet balance to give the
 * cash figure the UI and the risk guard use — see `netLiveCashUsd`.
 *
 * Never throws: an unreadable ledger reports zero owed rather than blanking a portfolio.
 */
export async function accruedFeesUsd(agentId: string): Promise<number> {
  try {
    return sumFees(await accruedFees(agentId));
  } catch (err) {
    console.warn(
      `[platform-fee] could not read accrued fees for ${agentId}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return 0;
  }
}

/**
 * Total fees an agent has been charged, settled or not. This is the number that makes
 * paper cash and paper PnL net of fees, so it counts *every* row — a paper agent's are
 * written pre-settled.
 */
export async function chargedFeesUsd(agentId: string): Promise<number> {
  try {
    const db = await getDb();
    const [row] = await db
      .select({ total: sql<string>`coalesce(sum(${platformFees.amountUsd}), 0)` })
      .from(platformFees)
      .where(eq(platformFees.agentId, agentId));
    return toNum(row?.total);
  } catch {
    return 0;
  }
}

/** Marks a batch settled with the transfer that paid it. Returns how many rows moved. */
export async function markFeesSettled(feeIds: readonly string[], txHash: string, now: Date = new Date()): Promise<number> {
  if (feeIds.length === 0) return 0;
  const db = await getDb();
  const updated = await db
    .update(platformFees)
    .set({ status: "settled", txHash, settledAt: now })
    // Conditional on `accrued` so a row another pass already settled is left alone.
    .where(and(inArray(platformFees.id, [...feeIds]), eq(platformFees.status, "accrued")))
    .returning({ id: platformFees.id });
  return updated.length;
}
