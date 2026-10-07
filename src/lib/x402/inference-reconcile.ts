/**
 * Pay-per-use thinking: the reconciler.
 *
 * A paid request can end without this server knowing whether money moved: the answer
 * timed out, or the process died after the signature was sent. Such a row is left
 * `signed` or `unconfirmed` and is counted as charged. A request can also be answered
 * with no receipt from the gateway: that row is `settled` with no transaction id, which
 * means "answered, settlement not yet proven". This pass asks the chain what actually
 * happened to both kinds and records it.
 *
 * How a payment is found. The transaction's id is the FEE PAYER's signature, and the fee
 * payer is the gateway, not the agent, so looking up the agent's signature finds nothing
 * whether or not the payment landed. What identifies a payment is its memo, a random
 * 128-bit value this server chose and stored before sending. The pass reads the history
 * of the agent's own USDC token account and looks for that memo.
 *
 * A memo is public the moment its payment lands, and anyone can put any memo on a
 * transaction of their own that touches the agent's token account. So a memo is where to
 * look, never the proof: the proof is that the transaction carrying it took USDC OUT of
 * the agent's wallet, which only the wallet's own signature can do. Every transaction
 * carrying the memo is read, oldest first; one that took nothing from the wallet is a
 * decoy, counted and otherwise ignored. It never halts anything and never hides the real
 * payment behind it.
 *
 * The two verdicts are not symmetrical, on purpose:
 *
 *  - Charged needs one sighting: a successful transaction carrying the memo that took
 *    USDC out of the agent's account. An open row becomes `paid_no_answer`; an answered
 *    row keeps `settled` and gets its transaction id.
 *  - Not charged gives an amount back to the caps, so it needs proof that the payment
 *    can never land:
 *      1. the row is at least `NOT_CHARGED_AFTER_MS` old (it stays counted meanwhile, so
 *         waiting costs cap room and nothing else);
 *      2. the whole window of history was read and every transaction in it accounted
 *         for, and the read is not empty (a funded token account always has history, so
 *         an empty list is a node that does not know, not an account with no payments);
 *      3. the same read shows the wallet's other payments that the ledger already holds
 *         a transaction id for: a read that cannot show what is known to be there cannot
 *         show that something is not;
 *      4. OUR node, judging from a finalized block later than the signature, says the
 *         blockhash is no longer valid (the gateway's own word for when it expires is
 *         never used);
 *      5. a SECOND read of the history, no older than that block, passes 2 and 3 again,
 *         shows everything the first read showed, and still finds nothing.
 *    "Nothing" means more than "not this memo": neither read may show ANY transfer from
 *    the wallet to the gateway that the ledger does not already count, so a payment whose
 *    memo was stored wrongly is still not mistaken for no payment. Anything short of all
 *    that leaves the row as it is, still counted. An answered row proven unpaid this way
 *    becomes `not_charged` too: the answer was free.
 *
 * It also watches for the thing that must not exist: USDC that went from an agent to the
 * gateway with no ledger row behind it. What that does depends on what the transfer is:
 *
 *  - It has the shape of a payment this server builds (it carries a memo, and someone
 *    other than the wallet paid its fee). Then the ledger missed a payment, which is the
 *    one failure every other guarantee here rests on: pay-per-use is halted for everyone
 *    until an admin has looked.
 *  - It does not (no memo, or the wallet paid its own fee). The payment client refuses
 *    to send such a transaction, so this is the wallet's money moved some other way (an
 *    owner's withdrawal to that address, say). It says nothing about whether payments are
 *    being recorded, and an owner must not be able to stop everyone by making one. It is
 *    logged loudly and counted, the agent whose wallet it is goes on hold while the
 *    transfer is recent (`STRAY_HOLD_MS`), and none of that wallet's rows can be called
 *    not charged while the transfer is in the window.
 *
 * A halt names the transaction it was thrown over, and findings made while it is on are
 * added to its reason. Clearing the halt acknowledges the transactions that reason named,
 * by id, and nothing else: those do not halt again, and anything that was never named
 * does, whenever it landed.
 *
 * A row no verdict could be reached on within `GIVE_UP_AFTER_MS` is closed: it stays
 * counted as charged, says so, and is looked at again now and then for `LATE_LOOK_MS`
 * in case the chain can be read after all. A cap is never given back on a guess.
 *
 * Bounded work per pass (rows, wallets, RPC calls, transactions fetched, wall-clock time)
 * and no chain access at all in mock mode or without `SOLANA_RPC_URL`.
 */
import { PublicKey } from "@solana/web3.js";
import { and, desc, eq, gte, inArray, isNotNull, isNull, lt, ne, notInArray, or, sql } from "drizzle-orm";
import { getDb, inferencePayments } from "@/db";
import { dbErrorForLog, redactSecrets } from "@/lib/security/redact";
import { associatedTokenAddress } from "@/lib/wallets/solana-transfer";
import {
  closeUncheckedPayments,
  confirmSettled,
  haltInferenceOnce,
  readInferenceControl,
  releaseStaleReserved,
  resolveInferencePayment,
  syncRunInferenceSpend,
} from "./inference-ledger";
import { INFERENCE_GATEWAY, type InferencePaymentStatus, type InferenceStopReason } from "./inference-types";

// ---------- timing and bounds ----------

/** A row is left alone this long after its signature: its own request may still be resolving it. */
export const RECONCILE_AFTER_MS = 2 * 60_000;
/**
 * No row is called not charged sooner than this after its signature. A blockhash lives
 * about a minute, so the payment itself was decided long before; the wait is for the
 * node's history index, which is a separate thing from its chain head and can run
 * minutes behind it. Half an hour is far past any lag a healthy provider shows, and the
 * row stays counted as charged for all of it, so the only cost of waiting is cap room.
 */
export const NOT_CHARGED_AFTER_MS = 30 * 60_000;
/** A row still `reserved` after this long belongs to a process that is gone. Longer than any invocation. */
export const STALE_RESERVED_MS = 10 * 60_000;
/**
 * Past this age an open row is no longer looked up on every pass. It is closed (still
 * `unconfirmed`, `resolved_at` set, counted as charged: see `closeUncheckedPayments`) and
 * joins the rows looked at now and then.
 */
export const GIVE_UP_AFTER_MS = 6 * 60 * 60_000;
/**
 * How long a closed row, or an answered row whose settlement is still unproven, goes on
 * being looked at now and then (`RECONCILE_LIMITS.lateRows` of them per pass, chosen at
 * random). This is what settles the rows an RPC outage or a stopped cron left behind.
 * After it, a row stays as it is; the audit script reads further back.
 */
export const LATE_LOOK_MS = 7 * 24 * 60 * 60_000;
/** History is read back to this long before the oldest row in hand, to absorb clock differences. */
const WINDOW_SLACK_MS = 5 * 60_000;
/** The block our node judges a blockhash from must be this much later than the signature. */
const JUDGE_MARGIN_MS = 60_000;
/** An agent is held over a transfer that is not a payment only while that transfer is this recent. */
export const STRAY_HOLD_MS = GIVE_UP_AFTER_MS;
/** Wallets that paid within this long are sampled for transfers the ledger does not know. */
const SAMPLE_WINDOW_MS = 10 * 60_000;
/** The payment client writes a 32-character memo. One shorter than this could match by accident, so it is not searched for. */
const MIN_MEMO_LENGTH = 16;
/** The most ledger rows of one wallet a window is compared against. A window with more cannot be judged. */
const KNOWN_ROWS_LIMIT = 5000;

export const RECONCILE_LIMITS = {
  /** Rows looked at per pass: open ones first, then answered ones whose settlement is unproven. */
  rows: 25,
  /** Rows past the give-up age looked at again per pass. */
  lateRows: 2,
  /** Recently active wallets, beyond those with open rows, checked for unknown transfers. */
  samplePayers: 3,
  /** History pages per read, and entries per page. */
  pages: 3,
  pageSize: 200,
  /** RPC calls of every kind, and of those, whole transactions fetched. */
  rpcCalls: 150,
  txFetches: 40,
  /** After this many failed calls the RPC is treated as down and the pass stops asking. */
  rpcErrors: 3,
  /** No new RPC call starts after this much wall-clock time. */
  deadlineMs: 60_000,
} as const;

export type ReconcileLimits = { -readonly [K in keyof typeof RECONCILE_LIMITS]: number };

// ---------- the chain, as this pass reads it ----------

export interface SignatureEntry {
  signature: string;
  slot: number | null;
  /** Non-null when the transaction ran and failed. A failed transaction moved nothing. */
  err: unknown;
  /** The memo text as the node reports it (`"[32] 0f0f…"`), or null when it reports none. */
  memo: string | null;
  /** Unix seconds, or null when the node does not know. */
  blockTime: number | null;
}

/** The four questions the reconciler asks a Solana node. Stubbed in tests. */
export interface InferenceChainReader {
  /** Transactions that touched `address`, newest first. */
  signaturesFor(address: string, options: { limit: number; before?: string; minContextSlot?: number }): Promise<SignatureEntry[]>;
  /** One transaction, `jsonParsed`. Null when the node does not have it. */
  transaction(signature: string): Promise<unknown | null>;
  /** Whether a blockhash can still be used, judged at a finalized block, and which block that was. */
  blockhashValid(blockhash: string): Promise<{ valid: boolean; slot: number }>;
  /** Unix seconds of a block. Null when the node does not know. */
  blockTime(slot: number): Promise<number | null>;
}

/**
 * The reader over a real node. `rpcUrl` is the operator's own endpoint; there is no
 * public fallback here, because a verdict that returns money to a cap must not rest on
 * an endpoint nobody answers for. Errors are redacted: an RPC client's own message can
 * carry the endpoint, and the endpoint carries the provider key.
 */
export function createSolanaChainReader(rpcUrl: string, fetchImpl: typeof fetch = fetch): InferenceChainReader {
  async function call<T>(method: string, params: unknown[]): Promise<T> {
    let body: { result?: T; error?: { message?: unknown } };
    try {
      const res = await fetchImpl(rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      body = (await res.json()) as typeof body;
    } catch (err) {
      throw new Error(redactSecrets(`Solana RPC ${method} failed: ${err instanceof Error ? err.message : "no answer"}`).slice(0, 300));
    }
    if (body.error) {
      const message = typeof body.error.message === "string" ? body.error.message : "unknown error";
      throw new Error(redactSecrets(`Solana RPC ${method} failed: ${message}`).slice(0, 300));
    }
    if (body.result === undefined) throw new Error(`Solana RPC ${method} returned no result`);
    return body.result;
  }

  return {
    async signaturesFor(address, options) {
      const config: Record<string, unknown> = { limit: options.limit, commitment: "confirmed" };
      if (options.before) config.before = options.before;
      if (options.minContextSlot !== undefined) config.minContextSlot = options.minContextSlot;
      const result = await call<unknown>("getSignaturesForAddress", [address, config]);
      if (!Array.isArray(result)) throw new Error("Solana RPC getSignaturesForAddress returned no list");
      return result.flatMap((raw): SignatureEntry[] => {
        const entry = raw as { signature?: unknown; slot?: unknown; err?: unknown; memo?: unknown; blockTime?: unknown };
        if (typeof entry?.signature !== "string") return [];
        return [
          {
            signature: entry.signature,
            slot: typeof entry.slot === "number" ? entry.slot : null,
            err: entry.err ?? null,
            memo: typeof entry.memo === "string" ? entry.memo : null,
            blockTime: typeof entry.blockTime === "number" ? entry.blockTime : null,
          },
        ];
      });
    },
    async transaction(signature) {
      return call<unknown | null>("getTransaction", [signature, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0, commitment: "confirmed" }]);
    },
    async blockhashValid(blockhash) {
      // Finalized, not the newest block: a blockhash that has aged out of a finalized
      // block has aged out of every block that will ever follow it.
      const result = await call<{ context?: { slot?: unknown }; value?: unknown }>("isBlockhashValid", [blockhash, { commitment: "finalized" }]);
      const slot = result?.context?.slot;
      if (typeof slot !== "number" || typeof result?.value !== "boolean") throw new Error("Solana RPC isBlockhashValid returned no verdict");
      return { valid: result.value, slot };
    },
    async blockTime(slot) {
      const result = await call<unknown>("getBlockTime", [slot]);
      return typeof result === "number" ? result : null;
    },
  };
}

function defaultReader(): InferenceChainReader | null {
  const url = process.env.SOLANA_RPC_URL?.trim();
  return url ? createSolanaChainReader(url) : null;
}

/** Mock mode, as the paid-data path reads it (`isMockMode` in paidFetch.ts): no network, no wallet. */
function inferenceMockMode(): boolean {
  return process.env.X402_MOCK === "1";
}

// ---------- reading a transaction (pure) ----------

const MEMO_PROGRAMS = new Set(["MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr", "Memo1UhkJRfHyvLMcVucJwxXeuD728EV2ZqaNPZeLq"]);

/** The account `owner` holds `mint` in. Null when either is not an address. */
export function payerTokenAccount(owner: string, mint: string): string | null {
  try {
    return associatedTokenAddress(new PublicKey(owner), new PublicKey(mint)).toBase58();
  } catch {
    return null;
  }
}

/** Every memo a `jsonParsed` transaction carries, from its instructions and from its logs. */
export function transactionMemos(tx: unknown): string[] {
  const t = tx as {
    meta?: { logMessages?: unknown; innerInstructions?: unknown } | null;
    transaction?: { message?: { instructions?: unknown } };
  } | null;
  const memos: string[] = [];
  const top = Array.isArray(t?.transaction?.message?.instructions) ? (t.transaction.message.instructions as unknown[]) : [];
  const inner = Array.isArray(t?.meta?.innerInstructions)
    ? (t.meta.innerInstructions as Array<{ instructions?: unknown }>).flatMap((group) => (Array.isArray(group?.instructions) ? (group.instructions as unknown[]) : []))
    : [];
  for (const raw of [...top, ...inner]) {
    const ix = raw as { program?: unknown; programId?: unknown; parsed?: unknown };
    const isMemo = ix?.program === "spl-memo" || (typeof ix?.programId === "string" && MEMO_PROGRAMS.has(ix.programId));
    if (isMemo && typeof ix.parsed === "string") memos.push(ix.parsed);
  }
  for (const line of Array.isArray(t?.meta?.logMessages) ? (t.meta.logMessages as unknown[]) : []) {
    // The memo program logs what it was given: `Program log: Memo (len 32): "…"`.
    if (typeof line === "string" && line.includes("Memo (len")) memos.push(line);
  }
  return memos;
}

export interface UsdcMovement {
  /** The transaction ran and failed: nothing moved. */
  failed: boolean;
  /** Base units of `mint` that left accounts owned by the payer. Zero or more. */
  paid: bigint;
  /** Base units of `mint` that arrived in accounts owned by the recipient. Zero or more. */
  received: bigint;
}

/**
 * What a `jsonParsed` transaction did to two owners' holdings of one mint, read from the
 * token balances the node recorded before and after. Balances, not instructions: they are
 * what actually happened, whatever program moved the tokens.
 */
export function usdcMovement(tx: unknown, who: { payer: string; payTo: string; mint: string }): UsdcMovement {
  const t = tx as { meta?: { err?: unknown; preTokenBalances?: unknown; postTokenBalances?: unknown } | null } | null;
  if (!t?.meta) return { failed: true, paid: BigInt(0), received: BigInt(0) };
  if (t.meta.err) return { failed: true, paid: BigInt(0), received: BigInt(0) };

  const total = (balances: unknown, owner: string): bigint => {
    let sum = BigInt(0);
    for (const raw of Array.isArray(balances) ? balances : []) {
      const entry = raw as { mint?: unknown; owner?: unknown; uiTokenAmount?: { amount?: unknown } };
      if (entry?.mint !== who.mint || entry?.owner !== owner) continue;
      const amount = entry.uiTokenAmount?.amount;
      if (typeof amount === "string" && /^\d+$/.test(amount)) sum += BigInt(amount);
    }
    return sum;
  };
  const zero = BigInt(0);
  const payerDelta = total(t.meta.postTokenBalances, who.payer) - total(t.meta.preTokenBalances, who.payer);
  const payToDelta = total(t.meta.postTokenBalances, who.payTo) - total(t.meta.preTokenBalances, who.payTo);
  return { failed: false, paid: payerDelta < zero ? -payerDelta : zero, received: payToDelta > zero ? payToDelta : zero };
}

/** A ledger amount (`numeric(18,6)` as a string) in USDC base units. USDC has six decimals, so they are micro-dollars. */
export function baseUnitsOf(usd: string | number): bigint {
  const [whole, fraction = ""] = String(usd).trim().split(".");
  if (!/^\d+$/.test(whole) || !/^\d*$/.test(fraction)) return BigInt(0);
  return BigInt(whole) * BigInt(1_000_000) + BigInt(fraction.slice(0, 6).padEnd(6, "0"));
}

/** When a `jsonParsed` transaction's block was produced, unix seconds. Null when the node does not say. */
export function transactionBlockTime(tx: unknown): number | null {
  const time = (tx as { blockTime?: unknown } | null)?.blockTime;
  return typeof time === "number" && Number.isFinite(time) ? time : null;
}

/** Who paid a `jsonParsed` transaction's fee: its first account. Null when the transaction does not show its accounts. */
export function transactionFeePayer(tx: unknown): string | null {
  const keys = (tx as { transaction?: { message?: { accountKeys?: unknown } } } | null)?.transaction?.message?.accountKeys;
  const first: unknown = Array.isArray(keys) ? keys[0] : undefined;
  if (typeof first === "string") return first;
  const pubkey = (first as { pubkey?: unknown } | null | undefined)?.pubkey;
  return typeof pubkey === "string" ? pubkey : null;
}

/**
 * Whether a transfer has the shape of a payment this server's client builds: it carries
 * a memo, and the wallet did not pay its own fee (the gateway does). The client verifies
 * both on the signed bytes before it sends anything, so a transfer that lacks either was
 * not sent by it. Everything else about a payment is left out on purpose, and a
 * transaction that does not show who paid its fee counts as one that might be a payment:
 * the doubt goes toward halting.
 */
export function looksLikePayment(tx: unknown, payerAddress: string, reportedMemo: string | null = null): boolean {
  const hasMemo = (reportedMemo !== null && reportedMemo.trim() !== "") || transactionMemos(tx).length > 0;
  return hasMemo && transactionFeePayer(tx) !== payerAddress;
}

// ---------- one pass ----------

export interface ReconcileCounts {
  /** Why the chain was not asked at all, when it was not. */
  skipped: "mock" | "no_rpc" | null;
  /** Rows left `reserved` by a dead process, released. */
  staleReleased: number;
  /** Open rows past the give-up age that this pass closed: still counted as charged, no longer looked up every pass. */
  gaveUp: number;
  /** Rows looked at this pass: open ones, answered ones with no transaction id, and the few past the give-up age. */
  examined: number;
  /** Open rows found on chain: now `paid_no_answer`. */
  charged: number;
  /** Answered rows found on chain: still `settled`, now with their transaction id. */
  confirmed: number;
  /** Proven never to have landed: now `not_charged`, the amount returned to its day. */
  notCharged: number;
  /** Runs whose recorded thinking spend was written again because one of their rows became `not_charged`. */
  runsResynced: number;
  /** Looked at and left as they are, still counted as charged. */
  waiting: number;
  /** Open rows this pass does not look up as a matter of course: no memo to find them by, or older than the give-up age. */
  stuck: number;
  /** Answered rows past the give-up age that still have no transaction id. Counted as charged; the audit script checks them. */
  unproven: number;
  /** Transfers to the gateway with no ledger row behind them that have the shape of a payment. Any at all halts pay-per-use. */
  unknownTransfers: number;
  /** Transfers to the gateway with no ledger row that are NOT shaped like a payment (an owner's own transfer). Logged; the agent is held; no halt. */
  strayTransfers: number;
  /** Agents put on hold over such a transfer this pass. */
  heldAgents: number;
  /** Transactions carrying a row's memo that took nothing from its wallet. Anyone can make one, so they are counted and ignored. */
  decoys: number;
  /** A payment found for a row, but not the payment the row describes. */
  mismatches: number;
  /** Transactions that could not be checked for an unknown transfer within this pass's bounds. */
  unchecked: number;
  rpcCalls: number;
  rpcErrors: number;
  /** Whether this pass threw the halt. */
  halted: boolean;
}

function emptyCounts(): ReconcileCounts {
  return {
    skipped: null,
    staleReleased: 0,
    gaveUp: 0,
    examined: 0,
    charged: 0,
    confirmed: 0,
    notCharged: 0,
    runsResynced: 0,
    waiting: 0,
    stuck: 0,
    unproven: 0,
    unknownTransfers: 0,
    strayTransfers: 0,
    heldAgents: 0,
    decoys: 0,
    mismatches: 0,
    unchecked: 0,
    rpcCalls: 0,
    rpcErrors: 0,
    halted: false,
  };
}

/** Put one agent on hold. The pass calls it for a wallet that made a transfer the ledger cannot explain and the payment client cannot have sent. */
export type HoldAgent = (agentId: string, now: Date) => Promise<void>;

/**
 * The run loop's own hold, in the words it already has for "stopped while a problem is
 * checked": the owner is told once and the agent is looked at again on the usual clock.
 * Imported at call time and by name, as the cron route does, so this file loads (for the
 * audit script, for a build without that export) whether or not it is there.
 */
async function holdThroughRunLoop(agentId: string, now: Date): Promise<void> {
  let apply: unknown;
  try {
    const gate: Record<string, unknown> = await import("@/lib/agent/inference-gate");
    apply = gate.applyInferenceHold;
  } catch {
    return;
  }
  if (typeof apply !== "function") return;
  await (apply as (agentId: string, reason: InferenceStopReason, now: Date) => Promise<unknown>)(agentId, "paused", now);
}

/** The pass cannot go on asking the chain: out of calls, out of time, or the RPC is down. */
class NoMoreChain extends Error {}

/** A row this pass looks for on chain. */
interface CheckedRow {
  id: string;
  /** The run the step belongs to, whose recorded spend is written again when the row stops counting. */
  runId: string | null;
  /** `open`: signed or unconfirmed, no answer. `answered`: settled, with no transaction id yet. */
  kind: "open" | "answered";
  payerAddress: string;
  payTo: string;
  asset: string;
  quotedUsd: string;
  memo: string;
  blockhash: string | null;
  /** When the signature was made (or the row written, if that was not recorded). */
  at: Date;
}

/** One transaction in a wallet's history, with what could be learned about it. */
interface Seen {
  signature: string;
  failed: boolean;
  /** Every memo it carries, joined. Null when that could not be learned this pass. */
  memoText: string | null;
  /** Unix seconds, when the node says. */
  blockTime: number | null;
}

/** What a finding rests on: the transaction, and when it landed if anyone knows. */
interface Evidence {
  signature: string;
  blockTime: number | null;
}

type Tally = "unknownTransfers" | "strayTransfers" | "unchecked" | "decoys";

class Pass {
  readonly counts = emptyCounts();
  private readonly transactions = new Map<string, unknown | null>();
  private readonly judged = new Map<string, { expired: boolean; slot: number }>();
  /** Transactions already counted, so two reads of one history count each once. */
  private readonly counted = new Set<string>();
  /** Wallets already held this pass. */
  private readonly held = new Set<string>();
  private txFetches = 0;
  private readonly deadlineAt: number;

  constructor(
    readonly reader: InferenceChainReader,
    readonly limits: ReconcileLimits,
    readonly now: Date,
    /** When an admin last cleared a halt, epoch ms. Only what a hold is weighed against: see `holdOver`. */
    private readonly clearedAt: number,
    /** The transactions an admin has had named in a halt's reason and has cleared. */
    private readonly acknowledgedIds: ReadonlySet<string>,
    private readonly holdAgent: HoldAgent,
  ) {
    this.deadlineAt = Date.now() + limits.deadlineMs;
  }

  /** One RPC call, counted. Throws `NoMoreChain` instead of calling when the pass is out of bounds. */
  async ask<T>(question: () => Promise<T>): Promise<T> {
    if (this.counts.rpcCalls >= this.limits.rpcCalls || this.counts.rpcErrors >= this.limits.rpcErrors || Date.now() >= this.deadlineAt) {
      throw new NoMoreChain();
    }
    this.counts.rpcCalls += 1;
    try {
      return await question();
    } catch {
      // What the RPC said is not kept: a count is enough, and its text is not ours to trust.
      this.counts.rpcErrors += 1;
      throw new NoMoreChain();
    }
  }

  get rpcDown(): boolean {
    return this.counts.rpcErrors >= this.limits.rpcErrors;
  }

  /** A transaction, fetched at most once per pass. Undefined when the pass may not fetch another; null when the node has none. */
  async transaction(signature: string): Promise<unknown | null | undefined> {
    if (this.transactions.has(signature)) return this.transactions.get(signature);
    if (this.txFetches >= this.limits.txFetches) return undefined;
    this.txFetches += 1;
    const tx = await this.ask(() => this.reader.transaction(signature));
    this.transactions.set(signature, tx ?? null);
    return tx ?? null;
  }

  /**
   * Read `address`'s history back to `sinceSec`. `complete` is true only when the read
   * returned something, reached the start of the window (or the start of the account's
   * history) AND the memo of every transaction in the window is known. Only a complete
   * read can show absence.
   *
   * `wanted` are the memos being looked for. An entry carrying one of them is kept
   * whatever its block time: the window is cut by this server's clock, the block time is
   * the chain's, and a 128-bit memo is the payment's whichever clock is right.
   *
   * `first` are the memos of the rows in hand. The oldest transaction carrying each is
   * read before any other: a pass may fetch only so many transactions, anyone can fill
   * an account's history with transfers that report no memo, and those must not use up
   * the allowance before the one transaction that can settle a row has been read.
   */
  async history(
    address: string,
    sinceSec: number,
    wanted: readonly string[],
    minContextSlot?: number,
    first: readonly string[] = [],
  ): Promise<{ seen: Seen[]; complete: boolean }> {
    const seen: Seen[] = [];
    let complete = false;
    let before: string | undefined;
    for (let page = 0; page < this.limits.pages; page += 1) {
      const entries = await this.ask(() => this.reader.signaturesFor(address, { limit: this.limits.pageSize, before, minContextSlot }));
      // A token account that has paid, or been funded so that it could, has history. A
      // node that returns none for it does not know the account: that is not a read.
      if (page === 0 && entries.length === 0) break;
      let reachedStart = entries.length < this.limits.pageSize;
      for (const entry of entries) {
        const failed = entry.err !== null && entry.err !== undefined;
        // A transaction with no time on it cannot be placed outside the window, so it is in it.
        if (entry.blockTime !== null && entry.blockTime < sinceSec) {
          reachedStart = true;
          const memo = entry.memo;
          if (failed || memo === null || !wanted.some((candidate) => memo.includes(candidate))) continue;
        }
        seen.push({ signature: entry.signature, failed, memoText: entry.memo, blockTime: entry.blockTime });
      }
      if (reachedStart) {
        complete = true;
        break;
      }
      before = entries[entries.length - 1]?.signature;
      if (!before) break;
    }

    // Oldest first: the payment is the first transaction to carry a memo nobody else knew.
    for (const memo of first) {
      for (let index = seen.length - 1; index >= 0; index -= 1) {
        const entry = seen[index];
        if (entry.failed || entry.memoText === null || !entry.memoText.includes(memo)) continue;
        await this.transaction(entry.signature);
        break;
      }
    }

    // A node may report no memo because there is none, or because it does not index
    // memos. The two look the same here, so the transaction itself is read.
    for (const entry of seen) {
      if (entry.failed || entry.memoText !== null) continue;
      const tx = await this.transaction(entry.signature);
      if (tx === undefined || tx === null) {
        complete = false;
        continue;
      }
      entry.memoText = transactionMemos(tx).join(" ");
    }
    return { seen, complete };
  }

  /** Whether OUR node says `blockhash` can no longer be used, judged from a block later than `signedAt`. */
  async blockhashExpired(blockhash: string, signedAt: Date): Promise<{ expired: boolean; slot: number }> {
    const key = `${blockhash}:${signedAt.getTime()}`;
    const known = this.judged.get(key);
    if (known) return known;
    const verdict = await this.ask(() => this.reader.blockhashValid(blockhash));
    let expired = false;
    if (!verdict.valid) {
      // "Not valid" is also what a node that is behind says about a blockhash newer than
      // the block it is judging from. Only a block later than the signature can tell
      // expired from not yet seen.
      const judgedAt = await this.ask(() => this.reader.blockTime(verdict.slot));
      expired = judgedAt !== null && judgedAt * 1000 >= signedAt.getTime() + JUDGE_MARGIN_MS;
    }
    const result = { expired, slot: verdict.slot };
    this.judged.set(key, result);
    return result;
  }

  /** Add one to a tally for a transaction, once per pass. */
  count(what: Tally, signature: string): void {
    const key = `${what}:${signature}`;
    if (this.counted.has(key)) return;
    this.counted.add(key);
    this.counts[what] += 1;
  }

  /**
   * Halt pay-per-use over a transaction, unless an admin has already been shown it: a
   * halt whose reason named this very transaction was cleared. Halting again every five
   * minutes over the same evidence would only stop the admin from switching back on.
   *
   * By the transaction's id, never by its time. "It landed before the last clear" is not
   * "someone looked at it": a transfer in a wallet this pass did not reach, or that a
   * node's history showed late, or that had no room left in the reason, was never in
   * front of anyone, and clearing a halt over something else must not wave it through.
   * It also means a transaction the node reports with no time on it needs no special
   * case. While a halt is already on, the ledger adds the finding to its reason instead.
   */
  async halt(reason: string, evidence: Evidence): Promise<void> {
    if (this.acknowledgedIds.has(evidence.signature)) return;
    if (await haltInferenceOnce(reason, "reconciler")) this.counts.halted = true;
  }

  /**
   * A row of a run stopped counting as charged. The run wrote what it spent when it
   * finished, while this row still counted, so that one figure (`agent_runs.
   * inference_spend_usd`, and nothing else on the run) is written again from the ledger.
   * Best effort: the ledger is the record either way, and a verdict already applied must
   * not be reported as failed over a figure on a screen.
   */
  async spendChanged(row: CheckedRow): Promise<void> {
    if (!row.runId) return;
    try {
      if (await syncRunInferenceSpend(row.runId)) this.counts.runsResynced += 1;
    } catch (err) {
      console.error(`[inference] the spend of run ${row.runId} could not be written again after payment ${row.id} was found not charged: ${dbErrorForLog(err)}`);
    }
  }

  /**
   * A transfer to the gateway that no ledger row explains and that the payment client
   * cannot have sent. Not a reason to stop anyone else: say it loudly and hold the agent
   * whose wallet made it. Never lets its own failure reach the pass.
   *
   * A hold is for a transfer that is recent. One known to have landed more than
   * `STRAY_HOLD_MS` ago holds nobody: a late look reads a window days long, and one old
   * transfer must not keep an agent off its schedule for as long as that window lasts.
   * Nor does one that landed before an admin last cleared a halt. (Such a transfer is
   * never named in a halt's reason, so that moment is the only way an admin has of
   * saying it was dealt with.) Either way it is still counted, and it still stops the
   * wallet's rows from being called not charged. One with no time on it cannot be placed
   * and goes on holding while it is in view.
   */
  async holdOver(payerAddress: string, evidence: Evidence): Promise<void> {
    if (evidence.blockTime !== null) {
      const landedAt = evidence.blockTime * 1000;
      if (landedAt <= this.clearedAt || landedAt < this.now.getTime() - STRAY_HOLD_MS) return;
    }
    if (this.held.has(`${payerAddress}:${evidence.signature}`)) return;
    this.held.add(`${payerAddress}:${evidence.signature}`);
    console.error(
      redactSecrets(
        `[inference] USDC went from agent wallet ${payerAddress} to the gateway in transaction ${evidence.signature} with no ledger row. ` +
          "It is not a payment this server builds (no memo, or the wallet paid its own fee), so pay-per-use is NOT halted. " +
          "The agent is put on hold and none of that wallet's open payments is released while the transfer is in view.",
      ),
    );
    if (this.held.has(payerAddress)) return;
    this.held.add(payerAddress);
    try {
      const db = await getDb();
      const [latest] = await db
        .select({ agentId: inferencePayments.agentId })
        .from(inferencePayments)
        .where(and(eq(inferencePayments.payerAddress, payerAddress), isNotNull(inferencePayments.agentId)))
        .orderBy(desc(inferencePayments.createdAt))
        .limit(1);
      if (!latest?.agentId) return;
      await this.holdAgent(latest.agentId, this.now);
      this.counts.heldAgents += 1;
    } catch (err) {
      console.error(`[inference] the agent behind that wallet could not be put on hold: ${dbErrorForLog(err)}`);
    }
  }
}

const ACCOUNTED: readonly InferencePaymentStatus[] = ["signed", "settled", "paid_no_answer", "unconfirmed"];

interface KnownRow {
  id: string;
  memo: string;
  status: string;
}

/** The memos the ledger knows for one wallet, recent enough to appear in the window being read. */
async function knownMemos(payerAddress: string, since: Date): Promise<KnownRow[]> {
  const db = await getDb();
  const rows = await db
    .select({ id: inferencePayments.id, memo: inferencePayments.memo, status: inferencePayments.status })
    .from(inferencePayments)
    .where(and(eq(inferencePayments.payerAddress, payerAddress), isNotNull(inferencePayments.memo), gte(inferencePayments.createdAt, since)))
    .limit(KNOWN_ROWS_LIMIT);
  return rows.flatMap((row) => (row.memo ? [{ id: row.id, memo: row.memo, status: row.status }] : []));
}

/** A payment of this wallet's that the ledger holds a transaction id for: it is on chain, so a read of the window must show it. */
interface ProvenPayment {
  txHash: string;
  memo: string | null;
}

/**
 * The wallet's payments inside the window that are known to have landed. They are the
 * test of a read: one that does not show them is behind, or partial, and its silence
 * about another payment means nothing.
 */
async function provenPayments(payerAddress: string, since: Date, before: Date): Promise<ProvenPayment[]> {
  const db = await getDb();
  const rows = await db
    .select({ txHash: inferencePayments.txHash, memo: inferencePayments.memo, signedAt: inferencePayments.signedAt, createdAt: inferencePayments.createdAt })
    .from(inferencePayments)
    .where(
      and(
        eq(inferencePayments.payerAddress, payerAddress),
        eq(inferencePayments.chain, "solana"),
        inArray(inferencePayments.status, ["settled", "paid_no_answer"]),
        isNotNull(inferencePayments.txHash),
        gte(inferencePayments.createdAt, new Date(since.getTime() - 3 * WINDOW_SLACK_MS)),
      ),
    )
    .limit(KNOWN_ROWS_LIMIT);
  return rows.flatMap((row) => {
    const at = (row.signedAt ?? row.createdAt).getTime();
    // Inside the window, and old enough that any node should have indexed it.
    return row.txHash && at >= since.getTime() && at <= before.getTime() ? [{ txHash: row.txHash, memo: row.memo }] : [];
  });
}

/** Whether a read shows every payment that is known to be on chain. */
function shows(seen: readonly Seen[], proven: readonly ProvenPayment[]): boolean {
  return proven.every((payment) =>
    seen.some((entry) => !entry.failed && (entry.signature === payment.txHash || (payment.memo !== null && entry.memoText !== null && entry.memoText.includes(payment.memo)))),
  );
}

/** Whether a later read shows everything an earlier one did. A read that has lost transactions came from a node that is behind. */
function covers(later: readonly Seen[], earlier: readonly Seen[]): boolean {
  const signatures = new Set(later.map((entry) => entry.signature));
  return earlier.every((entry) => signatures.has(entry.signature));
}

/**
 * Look through one wallet's recent transactions for USDC that went to the gateway
 * without a ledger row to account for it.
 *
 * Returns whether the window is clean: every successful transaction in it is either a
 * payment the ledger already counts, or was read and is not a payment to the gateway.
 * Only a clean window can support a not-charged verdict.
 */
async function watchForUnknownTransfers(pass: Pass, payerAddress: string, seen: readonly Seen[], since: Date): Promise<boolean> {
  const known = await knownMemos(payerAddress, new Date(since.getTime() - 3 * WINDOW_SLACK_MS));
  // More rows than were read: a memo that matches none of them may still be the ledger's.
  const partial = known.length >= KNOWN_ROWS_LIMIT;
  const gateway = INFERENCE_GATEWAY.solana;
  let clean = true;
  for (const entry of seen) {
    if (entry.failed) continue;
    const row = entry.memoText === null ? undefined : known.find((candidate) => entry.memoText!.includes(candidate.memo));
    // The usual case: a payment the ledger already counts as charged. (A decoy carrying
    // that memo is passed over here too, which is right: it is not a payment at all.)
    if (row && (ACCOUNTED as readonly string[]).includes(row.status)) continue;

    const tx = partial && !row ? undefined : await pass.transaction(entry.signature);
    if (tx === undefined || tx === null) {
      pass.count("unchecked", entry.signature);
      clean = false;
      continue;
    }
    const paysGateway = gateway.payTo.some((payTo) => {
      const moved = usdcMovement(tx, { payer: payerAddress, payTo, mint: gateway.asset });
      return !moved.failed && moved.paid > BigInt(0) && moved.received > BigInt(0);
    });
    if (!paysGateway) continue;

    clean = false;
    const evidence: Evidence = { signature: entry.signature, blockTime: entry.blockTime ?? transactionBlockTime(tx) };
    if (row) {
      // The wallet paid under a memo of a row whose amount the ledger gave back, or
      // never marked signed. Only the wallet's own signature can do that: the books are wrong.
      pass.count("unknownTransfers", entry.signature);
      await pass.halt(`A payment landed on chain for ledger row ${row.id}, which the ledger holds as ${row.status}. Transaction ${entry.signature}, wallet ${payerAddress}.`, evidence);
    } else if (looksLikePayment(tx, payerAddress, entry.memoText)) {
      pass.count("unknownTransfers", entry.signature);
      await pass.halt(`USDC went from an agent wallet to the gateway with no ledger row. Transaction ${entry.signature}, wallet ${payerAddress}.`, evidence);
    } else {
      pass.count("strayTransfers", entry.signature);
      await pass.holdOver(payerAddress, evidence);
    }
  }
  return clean;
}

type Found =
  /** A transaction carrying the row's memo took USDC from the wallet. `exact`: the row's amount, all of it to the row's pay-to. */
  | { outcome: "paid"; hit: Seen; tx: unknown; moved: UsdcMovement; exact: boolean }
  /** A transaction carrying the memo could not be read this pass. Nothing can be said either way. */
  | { outcome: "unread" }
  /** No transaction in this read carries the memo and took anything from the wallet. */
  | { outcome: "absent" };

/**
 * Look for a row's payment among the transactions a read returned.
 *
 * EVERY transaction carrying the memo is considered, oldest first (the real payment is
 * the first to carry a memo nobody else knew). One that took nothing from the wallet is
 * a decoy: anyone can send a dust transfer to the agent's token account with any memo on
 * it, so it is counted and passed over, and it neither halts anything nor stands in front
 * of the payment. The payment is the one that debits the wallet by the row's amount to
 * the row's pay-to. A debit under the memo that is NOT that amount cannot be made by an
 * outsider either, and is reported as found-but-inexact for the caller to raise.
 */
async function findPayment(pass: Pass, row: CheckedRow, seen: readonly Seen[]): Promise<Found> {
  const quoted = baseUnitsOf(row.quotedUsd);
  let unread = false;
  let inexact: Found | null = null;
  for (let index = seen.length - 1; index >= 0; index -= 1) {
    const hit = seen[index];
    if (hit.failed || hit.memoText === null || !hit.memoText.includes(row.memo)) continue;
    const tx = await pass.transaction(hit.signature);
    if (tx === undefined || tx === null) {
      unread = true;
      continue;
    }
    const moved = usdcMovement(tx, { payer: row.payerAddress, payTo: row.payTo, mint: row.asset });
    if (moved.failed) continue;
    if (moved.paid === BigInt(0)) {
      pass.count("decoys", hit.signature);
      continue;
    }
    if (moved.paid === quoted && moved.received === moved.paid) return { outcome: "paid", hit, tx, moved, exact: true };
    inexact ??= { outcome: "paid", hit, tx, moved, exact: false };
  }
  // An unread transaction may be the exact payment, so it is waited for before an inexact one is believed.
  if (unread) return { outcome: "unread" };
  return inexact ?? { outcome: "absent" };
}

/** A row's payment was found on chain. Record it, and raise it if it is not the payment the row describes. */
async function recordFound(pass: Pass, row: CheckedRow, found: Extract<Found, { outcome: "paid" }>): Promise<boolean> {
  const { hit, moved } = found;
  const recorded =
    row.kind === "open"
      ? await resolveInferencePayment(row.id, { charged: true, txHash: hit.signature, detail: "Found on chain by its memo. No answer was recorded." }, pass.now)
      : await confirmSettled(row.id, hit.signature);
  if (!found.exact) {
    pass.counts.mismatches += 1;
    await pass.halt(
      `Ledger row ${row.id} was quoted ${baseUnitsOf(row.quotedUsd)} base units to ${row.payTo}; transaction ${hit.signature} took ${moved.paid} from the wallet and ${moved.received} reached that address.`,
      { signature: hit.signature, blockTime: hit.blockTime ?? transactionBlockTime(found.tx) },
    );
  }
  return recorded;
}

/** Everything for one wallet: the rows in hand, and the watch for transfers the ledger does not know. */
async function reconcilePayer(pass: Pass, payerAddress: string, rows: readonly CheckedRow[]): Promise<void> {
  const undecided = new Set(rows.map((row) => row.id));
  const settle = (row: CheckedRow, outcome: "charged" | "confirmed" | "notCharged" | "waiting") => {
    if (!undecided.delete(row.id)) return;
    pass.counts[outcome] += 1;
  };
  const found = async (row: CheckedRow, hit: Extract<Found, { outcome: "paid" }>) => {
    const recorded = await recordFound(pass, row, hit);
    settle(row, !recorded ? "waiting" : row.kind === "open" ? "charged" : "confirmed");
  };

  try {
    const account = payerTokenAccount(payerAddress, rows[0].asset);
    if (!account) return;
    const since = new Date(Math.min(...rows.map((row) => row.at.getTime())) - WINDOW_SLACK_MS);
    const sinceSec = Math.floor(since.getTime() / 1000);
    // What must be visible in a read before its silence means anything. Read before the
    // chain is, so a row proven during this pass is not asked of the read that proved it.
    const proven = await provenPayments(payerAddress, since, new Date(pass.now.getTime() - RECONCILE_AFTER_MS));
    const own = rows.map((row) => row.memo);
    const wanted = [...own, ...proven.flatMap((payment) => (payment.memo && payment.memo.length >= MIN_MEMO_LENGTH ? [payment.memo] : []))];

    const first = await pass.history(account, sinceSec, wanted, undefined, own);
    const missing: CheckedRow[] = [];
    for (const row of rows) {
      const result = await findPayment(pass, row, first.seen);
      if (result.outcome === "paid") await found(row, result);
      else if (result.outcome === "absent") missing.push(row);
    }
    const firstClean = await watchForUnknownTransfers(pass, payerAddress, first.seen, since);

    // Absence can only be read from a window that is complete, shows what is known to be
    // in it, and has no transfer to the gateway the ledger cannot explain: such a
    // transfer may be the very payment looked for.
    if (!first.complete || !firstClean || !shows(first.seen, proven) || missing.length === 0) return;

    const candidates: CheckedRow[] = [];
    let judgedFrom = 0;
    for (const row of missing) {
      if (!row.blockhash) continue;
      if (pass.now.getTime() - row.at.getTime() < NOT_CHARGED_AFTER_MS) continue;
      const verdict = await pass.blockhashExpired(row.blockhash, row.at);
      if (!verdict.expired) continue;
      candidates.push(row);
      judgedFrom = Math.max(judgedFrom, verdict.slot);
    }
    if (candidates.length === 0) return;

    // The second read, which must be at least as recent as the block the blockhash was
    // judged from: a node that is behind that block refuses instead of answering. It must
    // also show everything the first read did. A provider's endpoints do not all know
    // the same history, and the one that answers second must not know less.
    const second = await pass.history(account, sinceSec, wanted, judgedFrom, own);
    const secondClean = await watchForUnknownTransfers(pass, payerAddress, second.seen, since);
    const proves = second.complete && secondClean && shows(second.seen, proven) && covers(second.seen, first.seen);
    for (const row of candidates) {
      const result = await findPayment(pass, row, second.seen);
      if (result.outcome === "paid") {
        await found(row, result);
      } else if (result.outcome === "absent" && proves) {
        const released = await resolveInferencePayment(
          row.id,
          {
            charged: false,
            detail:
              row.kind === "open"
                ? "Not on chain: its blockhash expired and two reads of the wallet's history found no payment."
                : "Answered, and never paid for: its blockhash expired and two reads of the wallet's history found no payment.",
          },
          pass.now,
        );
        settle(row, released ? "notCharged" : "waiting");
        if (released) await pass.spendChanged(row);
      }
    }
  } catch (err) {
    if (!(err instanceof NoMoreChain)) throw err;
  } finally {
    // Whatever was not decided stays exactly as it was, and is said so.
    for (const row of rows) settle(row, "waiting");
  }
}

export interface ReconcileOptions {
  now?: Date;
  reader?: InferenceChainReader;
  limits?: Partial<ReconcileLimits>;
  /** How an agent is put on hold. The run loop's own hold unless a test says otherwise. */
  holdAgent?: HoldAgent;
}

/**
 * One reconciliation pass. Returns counts only: no row, address or memo leaves this
 * function except in the halt reason, which is stored for the admin page, and in the
 * server log.
 */
export async function reconcileInferencePayments(options: ReconcileOptions = {}): Promise<ReconcileCounts> {
  const now = options.now ?? new Date();
  const limits: ReconcileLimits = { ...RECONCILE_LIMITS, ...options.limits };
  const db = await getDb();

  const dueBefore = new Date(now.getTime() - RECONCILE_AFTER_MS);
  const notBefore = new Date(now.getTime() - GIVE_UP_AFTER_MS);
  const lateBefore = new Date(now.getTime() - LATE_LOOK_MS);

  // No chain needed for these two. A row that was never marked signed was never sent; a
  // row nobody could decide in all this time gets its end state, still counted as charged.
  const staleReleased = await releaseStaleReserved(new Date(now.getTime() - STALE_RESERVED_MS), 50, now);
  const gaveUp = await closeUncheckedPayments(notBefore, 50, now);

  const openStatuses = ["signed", "unconfirmed"];
  const unprovenAnswer = and(eq(inferencePayments.status, "settled"), isNull(inferencePayments.txHash));
  const [[stuck], [unproven]] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(inferencePayments)
      .where(
        and(
          inArray(inferencePayments.status, openStatuses),
          lt(inferencePayments.createdAt, dueBefore),
          sql`(${inferencePayments.memo} is null or ${inferencePayments.chain} <> 'solana' or ${inferencePayments.createdAt} < ${notBefore.toISOString()}::timestamptz)`,
        ),
      ),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(inferencePayments)
      .where(and(unprovenAnswer, lt(inferencePayments.createdAt, notBefore), gte(inferencePayments.createdAt, lateBefore))),
  ]);
  const finish = (pass: Pass | null, skipped: ReconcileCounts["skipped"]): ReconcileCounts => ({
    ...(pass?.counts ?? emptyCounts()),
    skipped,
    staleReleased,
    gaveUp,
    stuck: Number(stuck?.count ?? 0),
    unproven: Number(unproven?.count ?? 0),
  });

  if (inferenceMockMode()) return finish(null, "mock");
  const reader = options.reader ?? defaultReader();
  if (!reader) return finish(null, "no_rpc");

  const columns = {
    id: inferencePayments.id,
    runId: inferencePayments.runId,
    status: inferencePayments.status,
    payerAddress: inferencePayments.payerAddress,
    payTo: inferencePayments.payTo,
    asset: inferencePayments.asset,
    quotedUsd: inferencePayments.quotedUsd,
    memo: inferencePayments.memo,
    blockhash: inferencePayments.blockhash,
    signedAt: inferencePayments.signedAt,
    createdAt: inferencePayments.createdAt,
  };
  interface Candidate {
    id: string;
    runId: string | null;
    status: string;
    payerAddress: string;
    payTo: string;
    asset: string;
    quotedUsd: string;
    memo: string | null;
    blockhash: string | null;
    signedAt: Date | null;
    createdAt: Date;
  }
  const checked = (row: Candidate, memo: string): CheckedRow => ({
    id: row.id,
    runId: row.runId,
    kind: row.status === "settled" ? "answered" : "open",
    payerAddress: row.payerAddress,
    payTo: row.payTo,
    asset: row.asset,
    quotedUsd: row.quotedUsd,
    memo,
    blockhash: row.blockhash,
    at: row.signedAt ?? row.createdAt,
  });

  // Open rows first: they hold cap room and an owner is waiting on them. Then answered
  // rows with no transaction id. Newest first within each: a row that cannot be settled
  // yet (or ever) must not stand in front of the ones that can.
  const candidates = await db
    .select(columns)
    .from(inferencePayments)
    .where(
      and(
        or(inArray(inferencePayments.status, openStatuses), unprovenAnswer),
        eq(inferencePayments.chain, "solana"),
        isNotNull(inferencePayments.memo),
        lt(inferencePayments.createdAt, dueBefore),
        gte(inferencePayments.createdAt, notBefore),
      ),
    )
    .orderBy(sql`case when ${inferencePayments.status} = 'settled' then 1 else 0 end`, desc(inferencePayments.createdAt))
    .limit(limits.rows * 2);

  const control = await readInferenceControl();
  const pass = new Pass(reader, limits, now, control.haltClearedAt?.getTime() ?? 0, new Set(control.haltAcknowledged), options.holdAgent ?? holdThroughRunLoop);
  const byPayer = new Map<string, CheckedRow[]>();
  let unsearchable = 0;
  for (const row of candidates) {
    const at = row.signedAt ?? row.createdAt;
    if (!row.memo || at.getTime() > dueBefore.getTime()) continue;
    if (row.memo.length < MIN_MEMO_LENGTH) {
      // An answered row is not open: it is unproven, not stuck.
      if (row.status !== "settled") unsearchable += 1;
      continue;
    }
    if (pass.counts.examined >= limits.rows) break;
    pass.counts.examined += 1;
    byPayer.set(row.payerAddress, [...(byPayer.get(row.payerAddress) ?? []), checked(row, row.memo)]);
  }

  for (const [payerAddress, rows] of byPayer) {
    await reconcilePayer(pass, payerAddress, rows);
  }

  // Past the give-up age: a few rows, chosen at random so none stands in front of the
  // rest for a week. Each is read on its own, because its window reaches back to its own
  // signature and must not stretch the window of a newer row of the same wallet.
  if (!pass.rpcDown && limits.lateRows > 0) {
    const late = await db
      .select(columns)
      .from(inferencePayments)
      .where(
        and(
          or(and(eq(inferencePayments.status, "unconfirmed"), isNotNull(inferencePayments.resolvedAt)), unprovenAnswer),
          eq(inferencePayments.chain, "solana"),
          isNotNull(inferencePayments.memo),
          lt(inferencePayments.createdAt, notBefore),
          gte(inferencePayments.createdAt, lateBefore),
        ),
      )
      .orderBy(sql`random()`)
      .limit(limits.lateRows);
    for (const row of late) {
      if (!row.memo || row.memo.length < MIN_MEMO_LENGTH) continue;
      pass.counts.examined += 1;
      await reconcilePayer(pass, row.payerAddress, [checked(row, row.memo)]);
      if (pass.rpcDown) break;
    }
  }

  // Beyond the wallets with rows in hand: a few that paid lately, looked at for transfers
  // the ledger does not know. Chosen at random so a busy platform is covered over time.
  if (!pass.rpcDown && limits.samplePayers > 0) {
    const recent = new Date(now.getTime() - SAMPLE_WINDOW_MS);
    const scanned = [...byPayer.keys()];
    const sample = await db
      .select({ payerAddress: inferencePayments.payerAddress })
      .from(inferencePayments)
      .where(
        and(
          eq(inferencePayments.chain, "solana"),
          ne(inferencePayments.status, "simulated"),
          gte(inferencePayments.createdAt, recent),
          scanned.length > 0 ? notInArray(inferencePayments.payerAddress, scanned) : undefined,
        ),
      )
      .groupBy(inferencePayments.payerAddress)
      .orderBy(sql`random()`)
      .limit(limits.samplePayers);
    for (const { payerAddress } of sample) {
      const account = payerTokenAccount(payerAddress, INFERENCE_GATEWAY.solana.asset);
      if (!account) continue;
      const since = new Date(recent.getTime() - WINDOW_SLACK_MS);
      try {
        const { seen } = await pass.history(account, Math.floor(since.getTime() / 1000), []);
        await watchForUnknownTransfers(pass, payerAddress, seen, since);
      } catch (err) {
        if (!(err instanceof NoMoreChain)) throw err;
        break;
      }
    }
  }

  const counts = finish(pass, null);
  return { ...counts, stuck: counts.stuck + unsearchable };
}

// ---------- ledger against chain, for the audit script (pure) ----------

/** One transfer to the gateway found in a wallet's history. */
export interface ChainPayment {
  signature: string;
  /** Base units that left the wallet. */
  paid: bigint;
  memoText: string;
  blockTime: number | null;
}

export interface GatewayPaymentsRead {
  payments: ChainPayment[];
  /** False when the node returned no history at all, the history was longer than the bounds, or a transaction in it could not be read. */
  complete: boolean;
  transactionsRead: number;
}

/**
 * Every transfer from `payerAddress` to the pinned gateway since `since`, read from the
 * wallet's own USDC account. Unlike the cron pass this fetches every transaction in the
 * window, so it is for the audit script and an operator's patience, not for a cron.
 * Read-only. RPC errors are thrown, already redacted.
 *
 * `bounds.memos` are the memos of the ledger rows being compared. A transaction carrying
 * one is read even when its block time is before `since`: the chain's clock is not this
 * server's, and a memo is the payment's whichever is right.
 */
export async function readGatewayPayments(
  reader: InferenceChainReader,
  payerAddress: string,
  since: Date,
  bounds: { pages?: number; pageSize?: number; transactions?: number; memos?: readonly string[] } = {},
): Promise<GatewayPaymentsRead> {
  const gateway = INFERENCE_GATEWAY.solana;
  const account = payerTokenAccount(payerAddress, gateway.asset);
  if (!account) throw new Error("That is not a Solana address.");
  const pages = bounds.pages ?? 20;
  const pageSize = bounds.pageSize ?? 500;
  const maxTransactions = bounds.transactions ?? 2000;
  const sinceSec = Math.floor(since.getTime() / 1000);
  const memos = (bounds.memos ?? []).filter((memo) => memo.length >= MIN_MEMO_LENGTH);

  const inWindow: SignatureEntry[] = [];
  let complete = false;
  let before: string | undefined;
  for (let page = 0; page < pages; page += 1) {
    const entries = await reader.signaturesFor(account, { limit: pageSize, before });
    // As in the cron pass: no history at all is a node that does not know the account,
    // and proves nothing about what it paid.
    if (page === 0 && entries.length === 0) break;
    let reachedStart = entries.length < pageSize;
    for (const entry of entries) {
      const failed = entry.err !== null && entry.err !== undefined;
      const old = entry.blockTime !== null && entry.blockTime < sinceSec;
      if (old) reachedStart = true;
      const memo = entry.memo;
      if (!failed && (!old || (memo !== null && memos.some((candidate) => memo.includes(candidate))))) inWindow.push(entry);
    }
    if (reachedStart) {
      complete = true;
      break;
    }
    before = entries[entries.length - 1]?.signature;
    if (!before) break;
  }

  const payments: ChainPayment[] = [];
  let transactionsRead = 0;
  for (const entry of inWindow) {
    if (transactionsRead >= maxTransactions) {
      complete = false;
      break;
    }
    const tx = await reader.transaction(entry.signature);
    transactionsRead += 1;
    if (tx === null || tx === undefined) {
      complete = false;
      continue;
    }
    let paid = BigInt(0);
    for (const payTo of gateway.payTo) {
      const moved = usdcMovement(tx, { payer: payerAddress, payTo, mint: gateway.asset });
      if (!moved.failed && moved.paid > BigInt(0) && moved.received > BigInt(0)) paid = moved.paid;
    }
    if (paid === BigInt(0)) continue;
    payments.push({ signature: entry.signature, paid, memoText: [entry.memo ?? "", ...transactionMemos(tx)].join(" "), blockTime: entry.blockTime });
  }
  return { payments, complete, transactionsRead };
}

export interface LedgerRowForAudit {
  id: string;
  status: string;
  quotedUsd: string;
  settledUsd: string | null;
  memo: string | null;
  txHash: string | null;
  /**
   * Set on an open row the cron closed without a verdict (`closeUncheckedPayments`). It
   * is still open to the chain's answer, and the audit says which rows those are: they
   * are the ones no pass will settle unless a late look happens to reach the chain.
   */
  resolvedAt?: Date | string | null;
}

export interface AuditDifference {
  kind: "on_chain_not_in_ledger" | "ledger_charged_not_on_chain" | "ledger_not_charged_but_on_chain" | "amount_differs" | "open" | "unproven";
  rowId: string | null;
  signature: string | null;
  detail: string;
}

/**
 * Compare what the ledger says a wallet paid with what the chain says it paid. Pure: the
 * script reads both sides and prints what this returns.
 *
 * A row is matched to a transfer by its memo, or failing that by the transaction id it
 * recorded. `settled` and `paid_no_answer` rows must each have a transfer of their
 * amount; `released` and `not_charged` rows must have none; `signed` and `unconfirmed`
 * rows are reported as open either way, and one the cron closed without a verdict says
 * so. A transfer no row matches is the serious one.
 *
 * A `settled` row with no transaction id is "answered, settlement not yet proven": the
 * ledger counts it as charged on the gateway's answer alone. It is a row to check, so it
 * is reported as `unproven` either way, with what the chain shows for it, and as
 * `amount_differs` too when the chain shows another amount.
 */
export function compareLedgerWithChain(
  rows: readonly LedgerRowForAudit[],
  payments: readonly ChainPayment[],
): { differences: AuditDifference[]; ledgerChargedUnits: bigint; chainPaidUnits: bigint } {
  const differences: AuditDifference[] = [];
  const claimed = new Set<string>();
  let ledgerChargedUnits = BigInt(0);

  for (const row of rows) {
    if (row.status === "simulated" || row.status === "reserved") continue;
    const payment = payments.find(
      (candidate) => !claimed.has(candidate.signature) && ((row.memo !== null && candidate.memoText.includes(row.memo)) || (row.txHash !== null && candidate.signature === row.txHash)),
    );
    if (payment) claimed.add(payment.signature);
    const quoted = baseUnitsOf(row.settledUsd ?? row.quotedUsd);

    if (row.status === "settled" && row.txHash === null) {
      ledgerChargedUnits += quoted;
      differences.push({
        kind: "unproven",
        rowId: row.id,
        signature: payment?.signature ?? null,
        detail: payment
          ? `settled in the ledger with no transaction id; the chain shows it paid (${payment.paid} base units)`
          : "settled in the ledger with no transaction id; no transfer found, so the answer may have been free",
      });
      if (payment && payment.paid !== quoted) {
        differences.push({ kind: "amount_differs", rowId: row.id, signature: payment.signature, detail: `the ledger holds ${quoted} base units; the chain shows ${payment.paid}` });
      }
    } else if (row.status === "settled" || row.status === "paid_no_answer") {
      ledgerChargedUnits += quoted;
      if (!payment) {
        differences.push({ kind: "ledger_charged_not_on_chain", rowId: row.id, signature: row.txHash, detail: `the ledger holds ${quoted} base units as ${row.status}; no such transfer is in the wallet's history` });
      } else if (payment.paid !== quoted) {
        differences.push({ kind: "amount_differs", rowId: row.id, signature: payment.signature, detail: `the ledger holds ${quoted} base units; the chain shows ${payment.paid}` });
      }
    } else if (row.status === "released" || row.status === "not_charged") {
      if (payment) {
        differences.push({ kind: "ledger_not_charged_but_on_chain", rowId: row.id, signature: payment.signature, detail: `the ledger holds this row as ${row.status}; the chain shows ${payment.paid} base units paid` });
      }
    } else {
      // signed, unconfirmed: counted as charged, not yet settled either way.
      ledgerChargedUnits += quoted;
      const state = row.resolvedAt ? `${row.status} in the ledger, closed without a verdict and counted as charged` : `still ${row.status} in the ledger`;
      differences.push({
        kind: "open",
        rowId: row.id,
        signature: payment?.signature ?? null,
        detail: payment ? `${state}; the chain shows it paid (${payment.paid} base units)` : `${state}; no transfer found`,
      });
    }
  }

  let chainPaidUnits = BigInt(0);
  for (const payment of payments) {
    chainPaidUnits += payment.paid;
    if (!claimed.has(payment.signature)) {
      differences.push({ kind: "on_chain_not_in_ledger", rowId: null, signature: payment.signature, detail: `${payment.paid} base units went to the gateway and no ledger row accounts for it` });
    }
  }
  return { differences, ledgerChargedUnits, chainPaidUnits };
}
