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
 *
 * ## Gas for the sweep itself (W8)
 *
 * On Solana the sweep is a sponsored transaction: the platform Solana wallet is its fee
 * payer, the agent signs only the `TransferChecked` of its own USDC into the platform's
 * USDC account (which exists, so nothing is opened and the platform's budget is exactly
 * two signatures). No SOL is dripped into the agent for it — see
 * `src/lib/wallets/solana-agent-transfer.ts`, the same path an owner's withdrawal takes,
 * so a withdrawal and a sweep cannot disagree about what a transfer costs. A sweep over
 * the agent's per-trade cap is split into transfers at or under it: the platform is a
 * destination the cap does not guard.
 *
 * ## A sweep still in flight (W8)
 *
 * The sweep runs inside the guardian's pass, so it must not sit waiting for a slow
 * confirmation while other agents' stop losses queue behind it. It also must not be
 * read as "not settled" and swept again if it lands a minute late — that charges the
 * agent twice. So the transaction's signature (known before the broadcast) is written
 * onto its fee rows first, as `tx_hash = "inflight:<signature>:<lastValidBlockHeight>"`
 * with the rows still `accrued` ({@link inflightMarker}). A sweep that confirms within
 * {@link SWEEP_CONFIRM_MS} settles at once; one that does not is left to the next pass,
 * which asks the chain ({@link resolveInflight}): landed → settled, failed or past its
 * blockhash → released and swept again, still possible → left alone. Claiming the rows is
 * conditional, so two passes can never sweep the same fee.
 *
 * If the agent's wallet policy refuses the sponsored signature, or the sweep needs more
 * cap-sized pieces than one packet carries, the transfer falls back to Privy's `transfer`
 * endpoint with the old SOL drip (no marker: Privy's action has no signature up front).
 * That fallback exists for sweeps only — the recipient is the platform. Base is
 * unchanged: Privy's `transfer`, with Privy sponsoring the gas. Any failure lands in
 * `settleBatch`'s catch: the fees stay accrued and the next pass tries again.
 * "Settlement never throws" holds.
 *
 * ## Fees collected by an owner's withdrawal (W8)
 *
 * Fees are swept every five minutes once they reach the threshold, so an owner could
 * trade and then withdraw everything before the sweep, leaving fee rows no sweep can ever
 * collect. An owner's Solana USDC withdrawal therefore carries the agent's free accrued
 * fees to the platform in the same transaction (`withdrawFromAgentSolana`), using the
 * same in-flight marker a sweep uses: {@link solanaFeesOwed} says what is owed,
 * {@link claimFeesForTransfer} marks the rows before the broadcast,
 * {@link settleCollectedFees} settles them on confirmation, and
 * {@link releaseFeesFromTransfer} gives them back when the transfer is known not to have
 * moved. A withdrawal left pending is resolved here, like any sweep in flight.
 *
 * Base has no transaction of ours to put the fees in (the withdrawal is Privy's
 * `transfer`), so there the same hole is closed in two steps, in `./withdrawal-fees.ts`:
 * a USDC withdrawal may not take the fees owed with it, and the sweep runs straight
 * after it, and again when the agent is deleted, with `minUsd` set to a cent.
 */
import { and, eq, inArray, isNull, notLike, or } from "drizzle-orm";
import { getDb, platformFees } from "@/db";
import { toNum } from "@/lib/money";
import { platformFeeUsd, planSettlement, settleMinUsd, sumFees, type FeeRow, type SettlementBatch } from "./fee";
import { markFeesSettled } from "./fees";
import { PlatformWalletError, ensurePlatformWallet } from "./wallets";
import type { Chain } from "@/server/types";

/** How long a Solana sweep waits for its confirmation before leaving it to the next pass. */
export const SWEEP_CONFIRM_MS = 15_000;

/** What `tx_hash` on an `accrued` fee row starts with while a sweep carrying it is on its way. */
const INFLIGHT_PREFIX = "inflight:";

/** Pure: the `tx_hash` an in-flight sweep writes onto its fee rows. */
export function inflightMarker(signature: string, lastValidBlockHeight: number): string {
  return `${INFLIGHT_PREFIX}${signature}:${lastValidBlockHeight}`;
}

/** Pure: an in-flight marker's signature and expiry height; null for anything else (a real hash, null, junk). */
export function parseInflightMarker(
  txHash: string | null | undefined,
): { signature: string; lastValidBlockHeight: number } | null {
  if (!txHash?.startsWith(INFLIGHT_PREFIX)) return null;
  const [signature, height, ...rest] = txHash.slice(INFLIGHT_PREFIX.length).split(":");
  const lastValidBlockHeight = Number(height);
  if (!signature || rest.length > 0 || !Number.isSafeInteger(lastValidBlockHeight) || lastValidBlockHeight <= 0) return null;
  return { signature, lastValidBlockHeight };
}

/** An accrued fee row, with whatever its `tx_hash` holds. */
export interface LedgerRow extends FeeRow {
  txHash: string | null;
}

/** One sweep sent on an earlier pass: its marker, and the rows it carries. */
export interface InflightSweep {
  marker: string;
  /** Null when the marker does not parse — it is released, never trusted. */
  signature: string | null;
  lastValidBlockHeight: number;
  chain: Chain;
  rows: FeeRow[];
}

/**
 * Pure: split an agent's accrued rows into the ones free to sweep and the sweeps already
 * in flight (grouped by marker). A `tx_hash` that is not a marker at all is ignored —
 * accrued rows carry none.
 */
export function partitionAccrued(rows: readonly LedgerRow[]): { free: FeeRow[]; inflight: InflightSweep[] } {
  const free: FeeRow[] = [];
  const byMarker = new Map<string, InflightSweep>();
  for (const row of rows) {
    const fee: FeeRow = { id: row.id, chain: row.chain, amountUsd: row.amountUsd };
    if (!row.txHash?.startsWith(INFLIGHT_PREFIX)) {
      free.push(fee);
      continue;
    }
    const parsed = parseInflightMarker(row.txHash);
    const sweep = byMarker.get(row.txHash) ?? {
      marker: row.txHash,
      signature: parsed?.signature ?? null,
      lastValidBlockHeight: parsed?.lastValidBlockHeight ?? 0,
      chain: row.chain,
      rows: [],
    };
    sweep.rows.push(fee);
    byMarker.set(row.txHash, sweep);
  }
  return { free, inflight: [...byMarker.values()] };
}

export interface SettleFeesInput {
  agentId: string;
  ownerId: string;
  agentName: string;
  mode: "paper" | "live";
  now?: Date;
  /**
   * Sweep once this much is owed, in place of `PLATFORM_FEE_SETTLE_MIN_USD`. The batch
   * threshold exists so the marks pass does not send ten-cent transfers; a caller that
   * is about to lose its chance to collect (the owner is taking the money out, or
   * deleting the agent) passes a cent. See `./withdrawal-fees.ts`.
   */
  minUsd?: number;
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

    const ledger = await accruedLedger(input.agentId);
    if (ledger.length === 0) return result({ note: "nothing accrued" });
    const accruedUsd = sumFees(ledger);

    // Sweeps sent on an earlier pass first: settle what landed, release what never will.
    const { free, inflight } = partitionAccrued(ledger);
    const resolved = await resolveInflight(inflight, input, now);
    const resolvedUsd = resolved.batches.reduce((sum, b) => sum + (b.error === null && b.txHash ? b.amountUsd : 0), 0);

    const minUsd =
      typeof input.minUsd === "number" && Number.isFinite(input.minUsd) && input.minUsd >= 0
        ? input.minUsd
        : settleMinUsd();
    const plan = planSettlement([...free, ...resolved.released], minUsd);
    if (plan.batches.length === 0) {
      const waiting = resolved.batches.filter((b) => b.error !== null).length;
      return result({
        attempted: resolved.batches.length > 0,
        note:
          (resolvedUsd > 0 ? `settled $${resolvedUsd.toFixed(2)} from an earlier sweep; ` : "") +
          (waiting > 0 ? `${waiting} sweep(s) still in flight; ` : "") +
          `$${plan.totalUsd.toFixed(2)} free to sweep, under the $${minUsd.toFixed(2)} threshold`,
        accruedUsd,
        settledUsd: Math.round(resolvedUsd * 1e6) / 1e6,
        batches: resolved.batches,
      });
    }

    // `@/lib/wallets` is `server-only`; imported here so a plain tsx script (`pnpm demo`,
    // `pnpm tick`) can still load the guardian without tripping over the marker module.
    // On Solana the platform pays the sweep's fee — see the note at the top of this file.
    const { withdrawFromAgent } = await import("@/lib/wallets");
    const { withdrawFromAgentSolana } = await import("@/lib/wallets/solana-agent-transfer");
    const send = sweepSender({
      solana: (sweep) =>
        withdrawFromAgentSolana({
          ...sweep,
          purpose: "platform fee sweep",
          exact: true,
          feeSweep: true,
          confirmTimeoutMs: SWEEP_CONFIRM_MS,
        }),
      base: withdrawFromAgent,
    });

    const batches: SettledBatch[] = [...resolved.batches];
    let settledUsd = resolvedUsd;

    for (const batch of plan.batches) {
      const settled = await settleBatch(batch, input, send, now);
      batches.push(settled);
      if (settled.txHash && settled.error === null) settledUsd += settled.amountUsd;
    }

    const failed = batches.filter((b) => b.error !== null);
    return {
      attempted: true,
      accruedUsd,
      settledUsd: Math.round(settledUsd * 1e6) / 1e6,
      batches,
      note:
        failed.length === 0
          ? `settled $${settledUsd.toFixed(2)} of fees across ${batches.length} sweep(s)`
          : `settled $${settledUsd.toFixed(2)}; ${failed.length} sweep(s) failed or still in flight and will be retried or resolved next pass`,
    };
  } catch (err) {
    // Belt and braces: anything unforeseen is a note, not an exception in the guardian.
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[platform-fee] settlement for ${input.agentId} failed: ${message}`);
    return result({ note: `settlement failed: ${message}` });
  }
}

/** Every accrued fee row for an agent, oldest first, with its `tx_hash` (an in-flight marker, or null). */
async function accruedLedger(agentId: string): Promise<LedgerRow[]> {
  const db = await getDb();
  const rows = await db
    .select({ id: platformFees.id, chain: platformFees.chain, amountUsd: platformFees.amountUsd, txHash: platformFees.txHash })
    .from(platformFees)
    .where(and(eq(platformFees.agentId, agentId), eq(platformFees.status, "accrued")))
    .orderBy(platformFees.createdAt);
  return rows.map((r) => ({ id: r.id, chain: r.chain as Chain, amountUsd: toNum(r.amountUsd), txHash: r.txHash }));
}

/**
 * Write `marker` onto every row of a batch, before its transaction is broadcast. Only
 * rows still `accrued` and not already carried by another sweep are taken; unless every
 * row is, the claim is undone and this throws — and the transfer is never sent.
 */
async function claimForSweep(feeIds: readonly string[], marker: string): Promise<void> {
  const db = await getDb();
  const claimed = await db
    .update(platformFees)
    .set({ txHash: marker })
    .where(
      and(
        inArray(platformFees.id, [...feeIds]),
        eq(platformFees.status, "accrued"),
        or(isNull(platformFees.txHash), notLike(platformFees.txHash, `${INFLIGHT_PREFIX}%`)),
      ),
    )
    .returning({ id: platformFees.id });
  if (claimed.length !== feeIds.length) {
    await releaseSweep(feeIds, marker);
    throw new Error("another settlement pass is already sweeping some of these fees; nothing was sent");
  }
}

/** Clear an in-flight marker from its rows: that sweep is known not to have moved anything. */
async function releaseSweep(feeIds: readonly string[], marker: string): Promise<void> {
  const db = await getDb();
  await db
    .update(platformFees)
    .set({ txHash: null })
    .where(and(inArray(platformFees.id, [...feeIds]), eq(platformFees.status, "accrued"), eq(platformFees.txHash, marker)));
}

/**
 * Ask the chain about each sweep an earlier pass left in flight. Landed → settled and
 * audited; failed, or past its blockhash unseen → released, its rows swept again this
 * pass; anything else (including an RPC that does not answer) → left for the next pass.
 * Never throws.
 */
async function resolveInflight(
  sweeps: readonly InflightSweep[],
  input: SettleFeesInput,
  now: Date,
): Promise<{ batches: SettledBatch[]; released: FeeRow[] }> {
  const batches: SettledBatch[] = [];
  const released: FeeRow[] = [];
  if (sweeps.length === 0) return { batches, released };
  let inflightStatus: ((signature: string, lastValidBlockHeight: number) => Promise<string>) | null = null;
  try {
    inflightStatus = (await import("@/lib/wallets/solana-agent-transfer")).inflightStatus;
  } catch {
    inflightStatus = null;
  }

  for (const sweep of sweeps) {
    const feeIds = sweep.rows.map((r) => r.id);
    const amountUsd = Math.round(sumFees(sweep.rows) * 1e6) / 1e6;
    const base = { chain: sweep.chain, amountUsd, feeIds };
    try {
      let status = "pending";
      if (sweep.signature === null) status = "expired";
      else if (inflightStatus) status = await inflightStatus(sweep.signature, sweep.lastValidBlockHeight).catch(() => "pending");

      if (status === "confirmed" && sweep.signature) {
        await markFeesSettled(feeIds, sweep.signature, now);
        await audit(input, { chain: sweep.chain, amountUsd, feeIds }, null, sweep.signature);
        batches.push({ ...base, txHash: sweep.signature, error: null });
      } else if (status === "failed" || status === "expired") {
        await releaseSweep(feeIds, sweep.marker);
        released.push(...sweep.rows);
        console.warn(`[platform-fee] ${input.agentId}: sweep ${sweep.signature ?? sweep.marker} ${status}; its fees are swept again`);
      } else {
        batches.push({
          ...base,
          txHash: sweep.signature,
          error: `sweep ${sweep.signature} is still in flight — its fees stay accrued until it lands or expires`,
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      batches.push({ ...base, txHash: sweep.signature, error: `could not resolve an earlier sweep: ${message}` });
    }
  }
  return { batches, released };
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

// ------------------------------------------------- fees an owner's withdrawal collects

/** What an owner's withdrawal out of an agent's Solana wallet owes Tocker first. */
export interface FeesOwed {
  /** Accrued rows no transfer carries yet: the withdrawal collects these. */
  free: FeeRow[];
  freeUsd: number;
  /** Carried by a sweep still in flight: already on its way, so held back from the owner. */
  inflightUsd: number;
}

/**
 * Pure: the fees owed once the sweeps in flight have been asked about. Rows a resolved
 * sweep released are free again; a sweep that is still in flight (or could not be
 * resolved) keeps its amount held back; one that landed is settled and owes nothing.
 */
export function feesOwedAfter(free: readonly FeeRow[], resolved: { batches: readonly SettledBatch[]; released: readonly FeeRow[] }): FeesOwed {
  const all = [...free, ...resolved.released];
  const inflightUsd = resolved.batches.filter((b) => b.error !== null).reduce((sum, b) => sum + b.amountUsd, 0);
  return { free: all, freeUsd: sumFees(all), inflightUsd: Math.round(inflightUsd * 1e6) / 1e6 };
}

/**
 * What an owner's Solana withdrawal must pay Tocker before anything else leaves the
 * agent. Resolves the agent's sweeps in flight first (settling what landed, releasing
 * what never will), so a withdrawal neither pays a fee twice nor races a sweep for it.
 * Throws when the ledger cannot be read — the withdrawal refuses rather than guess zero.
 */
export async function solanaFeesOwed(input: { agentId: string; ownerId: string; agentName: string; now?: Date }): Promise<FeesOwed> {
  const now = input.now ?? new Date();
  const ledger = (await accruedLedger(input.agentId)).filter((row) => row.chain === "solana");
  if (ledger.length === 0) return { free: [], freeUsd: 0, inflightUsd: 0 };
  const { free, inflight } = partitionAccrued(ledger);
  const resolved = await resolveInflight(inflight, { ...input, mode: "live", now }, now);
  return feesOwedAfter(free, resolved);
}

/**
 * Mark fee rows as carried by a transfer, before it is broadcast: the transfer's marker,
 * exactly as a sweep writes it. Throws — and the caller sends nothing — unless every row
 * was still free. Returns the marker.
 */
export async function claimFeesForTransfer(feeIds: readonly string[], signature: string, lastValidBlockHeight: number): Promise<string> {
  const marker = inflightMarker(signature, lastValidBlockHeight);
  await claimForSweep(feeIds, marker);
  return marker;
}

/** The transfer carrying these rows is known not to have moved anything: they are free again. */
export async function releaseFeesFromTransfer(feeIds: readonly string[], marker: string): Promise<void> {
  await releaseSweep(feeIds, marker);
}

/**
 * The transfer carrying these rows confirmed: mark them settled against its signature and
 * write the same audit line a sweep writes. Never throws — the money has moved; a row that
 * cannot be marked now keeps its marker, and the next pass settles it from the chain.
 */
export async function settleCollectedFees(input: {
  agentId: string;
  ownerId: string;
  agentName: string;
  chain: Chain;
  feeIds: readonly string[];
  amountUsd: number;
  txHash: string;
  toAddress: string;
  now?: Date;
}): Promise<void> {
  try {
    await markFeesSettled(input.feeIds, input.txHash, input.now ?? new Date());
    await audit(
      { agentId: input.agentId, ownerId: input.ownerId, agentName: input.agentName, mode: "live" },
      { chain: input.chain, amountUsd: input.amountUsd, feeIds: [...input.feeIds] },
      input.toAddress,
      input.txHash,
    );
  } catch (err) {
    console.warn(`[platform-fee] ${input.agentId}: fees collected by ${input.txHash} not marked yet: ${err instanceof Error ? err.message : err}`);
  }
}

/** Called once a sweep's transaction is fully signed, before it is broadcast. Throw to send nothing. */
type OnSigned = (signature: string, lastValidBlockHeight: number) => Promise<void>;

interface SweepInput {
  agentId: string;
  chain: Chain;
  asset: "usdc" | "native";
  amount: number;
  toAddress: string;
  onSigned?: OnSigned;
}

type TransferOutcome = { txHash: string | null; status?: "pending" | "succeeded" | "rejected" | "failed" };
type Withdraw = (input: SweepInput) => Promise<TransferOutcome>;

/**
 * Pure: one transfer function for the sweep, dispatching on the batch's chain — the
 * sponsored agent transfer on Solana (the platform pays the fee, and `onSigned` records
 * the signature before the broadcast), Privy's `transfer` on Base (Privy sponsors the
 * gas; no signature exists up front). Chain-first so a Solana sweep can never take the
 * Base path's assumptions, or the reverse.
 */
export function sweepSender(senders: {
  solana: (sweep: Omit<SweepInput, "chain">) => Promise<TransferOutcome>;
  base: (sweep: Omit<SweepInput, "onSigned">) => Promise<TransferOutcome>;
}): Withdraw {
  return (sweep) => {
    if (sweep.chain === "solana") {
      return senders.solana({
        agentId: sweep.agentId,
        asset: sweep.asset,
        amount: sweep.amount,
        toAddress: sweep.toAddress,
        ...(sweep.onSigned ? { onSigned: sweep.onSigned } : {}),
      });
    }
    return senders.base({ agentId: sweep.agentId, chain: sweep.chain, asset: sweep.asset, amount: sweep.amount, toAddress: sweep.toAddress });
  };
}

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
  // Set once the rows carry this sweep's signature (see the note at the top of the file).
  const claim: { marker: string | null } = { marker: null };
  try {
    const platform = await ensurePlatformWallet(batch.chain);
    const transfer = await withdrawFromAgent({
      agentId: input.agentId,
      chain: batch.chain,
      asset: "usdc",
      amount: batch.amountUsd,
      toAddress: platform.address,
      onSigned: async (signature, lastValidBlockHeight) => {
        const marker = inflightMarker(signature, lastValidBlockHeight);
        await claimForSweep(batch.feeIds, marker);
        claim.marker = marker;
      },
    });

    // Only now, and only on a confirmed transfer. See `settlementOutcome`.
    const outcome = settlementOutcome(transfer);
    if (!outcome.settle || outcome.txHash === null) {
      return {
        ...base,
        txHash: outcome.txHash,
        error:
          claim.marker !== null && transfer.status === "pending"
            ? `sweep ${outcome.txHash} is in flight — the next pass settles it once it lands`
            : outcome.error,
      };
    }
    const txHash = outcome.txHash;
    await markFeesSettled(batch.feeIds, txHash, now);
    await audit(input, batch, platform.address, txHash);
    return { ...base, txHash, error: null };
  } catch (err) {
    // A sweep known not to have moved anything gives its rows back now. Any other error
    // after the claim leaves the marker for the next pass to resolve against the chain.
    if (claim.marker !== null && err instanceof Error && err.name === "TransferNotSent") {
      await releaseSweep(batch.feeIds, claim.marker).catch(() => undefined);
    }
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
  toAddress: string | null,
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
