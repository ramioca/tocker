/**
 * Batched fee settlement — the sweep that actually moves the money.
 *
 * It runs in the guardian's non-tick pass (every five minutes per agent, see
 * `maybeSendDigest` for the same pattern) and **never on the trade path**. That is the
 * whole design: a fill must never wait on, or be failed by, a USDC transfer. A fee is
 * accrued at fill in milliseconds and collected later, in one transfer per chain, once
 * the agent owes at least `PLATFORM_FEE_SETTLE_MIN_USD` — ten separate ten-cent
 * transfers would cost more in latency and gas than they collect.
 *
 * Properties this module guarantees:
 *  - **It never throws.** Every failure is caught and reported on the result; the
 *    guardian logs it and tries again in five minutes. A settlement that cannot happen
 *    is a bookkeeping delay, and it must never cost anyone an exit.
 *  - **It runs after exits.** The guardian calls it from `finish()`, which runs after
 *    every exit has been executed. Selling first and sweeping second is the only order
 *    that can never turn "your stop loss fired" into "your stop loss was skipped because
 *    we were collecting a dime".
 *  - **Paper agents settle nothing.** Their fee rows were written `settled` at accrual
 *    with `tx_hash: "simulated"`; there is no chain to move anything on.
 *  - **A row is only ever marked settled after the transfer returned a hash.** A failed
 *    transfer leaves every row `accrued`, so the next pass retries the same money rather
 *    than losing it.
 */
import { platformFeeUsd, planSettlement, settleMinUsd, type SettlementBatch } from "./fee";
import { accruedFees, markFeesSettled } from "./fees";
import { PlatformWalletError, ensurePlatformWallet } from "./wallets";
import type { Chain } from "@/server/types";

export interface SettleFeesInput {
  agentId: string;
  ownerId: string;
  agentName: string;
  mode: "paper" | "live";
  now?: Date;
}

export interface SettledBatch {
  chain: Chain;
  amountUsd: number;
  feeIds: string[];
  txHash: string | null;
  error: string | null;
}

export interface SettlementResult {
  /** False when the pass did not try: a paper agent, nothing owed, or under the threshold. */
  attempted: boolean;
  /** Why it did not try, or what it did. Always set. */
  note: string;
  /** Everything accrued and unsettled when the pass started. */
  accruedUsd: number;
  /** What actually moved. */
  settledUsd: number;
  batches: SettledBatch[];
}

function result(partial: Partial<SettlementResult> & { note: string }): SettlementResult {
  return {
    attempted: false,
    accruedUsd: 0,
    settledUsd: 0,
    batches: [],
    ...partial,
  };
}

/**
 * Sweep one agent's accrued fees into the platform wallets. Never throws.
 *
 * Returns a description of what happened, which the guardian puts on its result so the
 * cron route and the tests can see it without reading the ledger.
 */
export async function settlePlatformFees(input: SettleFeesInput): Promise<SettlementResult> {
  const now = input.now ?? new Date();
  try {
    if (input.mode !== "live") {
      return result({ note: "paper agent — its fees were settled as simulated at accrual" });
    }

    const rows = await accruedFees(input.agentId);
    if (rows.length === 0) return result({ note: "nothing accrued" });

    const minUsd = settleMinUsd();
    const plan = planSettlement(rows, minUsd);
    if (plan.batches.length === 0) {
      return result({
        note: `$${plan.totalUsd.toFixed(2)} accrued, under the $${minUsd.toFixed(2)} sweep threshold`,
        accruedUsd: plan.totalUsd,
      });
    }

    // `@/lib/wallets` is `server-only`; imported here so a plain tsx script (`pnpm demo`,
    // `pnpm tick`) can still load the guardian without tripping over the marker module.
    const { withdrawFromAgent } = await import("@/lib/wallets");

    const batches: SettledBatch[] = [];
    let settledUsd = 0;

    for (const batch of plan.batches) {
      const settled = await settleBatch(batch, input, withdrawFromAgent, now);
      batches.push(settled);
      if (settled.txHash) settledUsd += settled.amountUsd;
    }

    const failed = batches.filter((b) => b.error !== null);
    return {
      attempted: true,
      accruedUsd: plan.totalUsd,
      settledUsd: Math.round(settledUsd * 1e6) / 1e6,
      batches,
      note:
        failed.length === 0
          ? `settled $${settledUsd.toFixed(2)} of fees across ${batches.length} chain(s)`
          : `settled $${settledUsd.toFixed(2)}; ${failed.length} chain(s) failed and will retry next pass`,
    };
  } catch (err) {
    // Belt and braces: anything unforeseen is a note, not an exception in the guardian.
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[platform-fee] settlement for ${input.agentId} failed: ${message}`);
    return result({ note: `settlement failed: ${message}` });
  }
}

/**
 * The same sweep, for a caller that has only an agent id.
 *
 * Used by the marks loop for **flat** agents: the guardian is not run for an agent with
 * nothing to guard, so without this a live agent that closed its last position while
 * owing $1.50 would wait for its next position to be collected from. Never throws; an
 * agent that no longer exists is simply nothing to do.
 */
export async function settleFeesForAgent(agentId: string, now?: Date): Promise<SettlementResult> {
  try {
    const { eq } = await import("drizzle-orm");
    const { agents, getDb } = await import("@/db");
    const db = await getDb();
    const [agent] = await db
      .select({ id: agents.id, ownerId: agents.ownerId, name: agents.name, mode: agents.mode })
      .from(agents)
      .where(eq(agents.id, agentId))
      .limit(1);
    if (!agent) return result({ note: "agent not found" });
    return settlePlatformFees({
      agentId: agent.id,
      ownerId: agent.ownerId,
      agentName: agent.name,
      mode: agent.mode,
      now,
    });
  } catch (err) {
    return result({ note: `settlement failed: ${err instanceof Error ? err.message : String(err)}` });
  }
}

type Withdraw = (input: {
  agentId: string;
  chain: Chain;
  asset: "usdc" | "native";
  amount: number;
  toAddress: string;
}) => Promise<{ txHash: string | null; status?: "pending" | "succeeded" | "rejected" | "failed" }>;

/**
 * Pure: may these fee rows be marked settled against this transfer? (W7 H12)
 *
 * Privy's `transfer` returns a wallet *action*, which starts `pending` with no hash.
 * Settling against that marked the platform's fees collected on money that had not
 * moved — and if the action then failed, the platform could never collect it and the
 * operator could never account for it. Anything short of a confirmed transfer with a
 * real signature leaves the rows accrued, and the next pass sweeps the same money.
 */
export function settlementOutcome(transfer: {
  txHash: string | null;
  status?: "pending" | "succeeded" | "rejected" | "failed";
}): { settle: boolean; txHash: string | null; error: string | null } {
  // A caller that reports no status at all (the older shape, and the test doubles) is
  // trusted on its hash alone — it had no action to poll.
  if (transfer.status !== undefined && transfer.status !== "succeeded") {
    return {
      settle: false,
      txHash: transfer.txHash,
      error: `transfer is ${transfer.status} — fees stay accrued until it confirms`,
    };
  }
  if (!transfer.txHash) {
    return { settle: false, txHash: null, error: "the transfer returned no signature — fees stay accrued" };
  }
  return { settle: true, txHash: transfer.txHash, error: null };
}

async function settleBatch(
  batch: SettlementBatch,
  input: SettleFeesInput,
  withdrawFromAgent: Withdraw,
  now: Date,
): Promise<SettledBatch> {
  const base = { chain: batch.chain, amountUsd: batch.amountUsd, feeIds: batch.feeIds };
  try {
    const platform = await ensurePlatformWallet(batch.chain);
    const transfer = await withdrawFromAgent({
      agentId: input.agentId,
      chain: batch.chain,
      asset: "usdc",
      amount: batch.amountUsd,
      toAddress: platform.address,
    });

    // Only now, and only on a confirmed transfer. See `settlementOutcome`.
    const outcome = settlementOutcome(transfer);
    if (!outcome.settle || outcome.txHash === null) {
      return { ...base, txHash: outcome.txHash, error: outcome.error };
    }
    const txHash = outcome.txHash;
    await markFeesSettled(batch.feeIds, txHash, now);
    await audit(input, batch, platform.address, txHash);
    return { ...base, txHash, error: null };
  } catch (err) {
    const message =
      err instanceof PlatformWalletError
        ? err.message
        : err instanceof Error
          ? err.message
          : String(err);
    console.warn(`[platform-fee] ${input.agentId}: could not settle ${batch.chain} fees: ${message}`);
    return { ...base, txHash: null, error: message };
  }
}

/**
 * The audit line. Recorded as `withdraw` rather than a new audit kind: from the
 * operator's point of view that is exactly what it is — USDC leaving their agent's
 * wallet, signed by this app — and the summary says who took it and why. The audit
 * enum belongs to another workstream's block in the schema; borrowing the honest
 * existing kind beats widening a shared contract for one row.
 */
async function audit(
  input: SettleFeesInput,
  batch: SettlementBatch,
  toAddress: string,
  txHash: string,
): Promise<void> {
  try {
    const { recordAudit } = await import("@/lib/security/audit");
    await recordAudit({
      userId: input.ownerId,
      kind: "withdraw",
      agentId: input.agentId,
      agentName: input.agentName,
      summary: `Settled $${batch.amountUsd.toFixed(2)} of Tocker fees (${batch.feeIds.length} fill${
        batch.feeIds.length === 1 ? "" : "s"
      } at $${platformFeeUsd().toFixed(2)}) from the ${batch.chain} wallet to the platform wallet.`,
      metadata: {
        reason: "platform_fee_settlement",
        chain: batch.chain,
        amountUsd: batch.amountUsd,
        fills: batch.feeIds.length,
        toAddress,
        txHash,
      },
    });
  } catch {
    // `recordAudit` already swallows its own failures; this guards the dynamic import.
  }
}
