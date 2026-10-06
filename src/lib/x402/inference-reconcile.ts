/**
 * Pay-per-use thinking: the reconciler.
 *
 * A paid request can end without this server knowing whether money moved: the answer
 * timed out, or the process died after the signature was sent. Such a row is left
 * `signed` or `unconfirmed` and is counted as charged. This pass asks the chain what
 * actually happened and settles the row either way.
 *
 * How a payment is found. The transaction's id is the FEE PAYER's signature, and the fee
 * payer is the gateway, not the agent, so looking up the agent's signature finds nothing
 * whether or not the payment landed. What identifies a payment is its memo, a random
 * 128-bit value this server chose and stored before sending. The pass reads the history
 * of the agent's own USDC token account and looks for that memo.
 *
 * The two verdicts are not symmetrical, on purpose:
 *
 *  - Charged needs one sighting: a successful transaction carrying the memo that took
 *    USDC out of the agent's account. The row becomes `paid_no_answer`.
 *  - Not charged gives an amount back to the caps, so it needs proof that the payment
 *    can never land: the whole window of history was read and every transaction in it
 *    accounted for; OUR node, judging from a finalized block later than the signature,
 *    says the blockhash is no longer valid (the gateway's own word for when it expires is
 *    never used); and a SECOND read of the history, no older than that block, still
 *    finds nothing. "Nothing" means more than "not this memo": neither read may show ANY
 *    transfer from the wallet to the gateway that the ledger does not already count, so
 *    a payment whose memo was stored wrongly is still not mistaken for no payment.
 *    Anything short of all that leaves the row as it is, still counted.
 *
 * It also watches for the thing that must not exist: USDC that went from an agent to the
 * gateway with no ledger row behind it. One such transfer halts pay-per-use for everyone
 * until an admin has looked.
 *
 * Bounded work per pass (rows, wallets, RPC calls, transactions fetched, wall-clock time)
 * and no chain access at all in mock mode or without `SOLANA_RPC_URL`.
 */
import { PublicKey } from "@solana/web3.js";
import { and, desc, eq, gte, inArray, isNotNull, lt, ne, notInArray, sql } from "drizzle-orm";
import { getDb, inferencePayments } from "@/db";
import { redactSecrets } from "@/lib/security/redact";
import { associatedTokenAddress } from "@/lib/wallets/solana-transfer";
import { haltInferenceOnce, readInferenceControl, releaseStaleReserved, resolveInferencePayment } from "./inference-ledger";
import { INFERENCE_GATEWAY, type InferencePaymentStatus } from "./inference-types";

// ---------- timing and bounds ----------

/** A row is left alone this long after its signature: its own request may still be resolving it. */
export const RECONCILE_AFTER_MS = 2 * 60_000;
/**
 * No row is called not charged sooner than this after its signature. A blockhash lives
 * about a minute, so this is several lifetimes, and it leaves an RPC provider's history
 * index time to catch up with its own chain head.
 */
export const NOT_CHARGED_AFTER_MS = 5 * 60_000;
/** A row still `reserved` after this long belongs to a process that is gone. Longer than any invocation. */
export const STALE_RESERVED_MS = 10 * 60_000;
/** Past this age an open row is no longer looked up by the cron. It stays counted as charged; the audit script reads further back. */
export const GIVE_UP_AFTER_MS = 6 * 60 * 60_000;
/** History is read back to this long before the oldest row in hand, to absorb clock differences. */
const WINDOW_SLACK_MS = 5 * 60_000;
/** The block our node judges a blockhash from must be this much later than the signature. */
const JUDGE_MARGIN_MS = 60_000;
/** Wallets that paid within this long are sampled for transfers the ledger does not know. */
const SAMPLE_WINDOW_MS = 10 * 60_000;
/** The payment client writes a 32-character memo. One shorter than this could match by accident, so it is not searched for. */
const MIN_MEMO_LENGTH = 16;

export const RECONCILE_LIMITS = {
  /** Open rows looked at per pass. */
  rows: 25,
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

// ---------- one pass ----------

export interface ReconcileCounts {
  /** Why the chain was not asked at all, when it was not. */
  skipped: "mock" | "no_rpc" | null;
  /** Rows left `reserved` by a dead process, released. */
  staleReleased: number;
  /** Open rows looked at this pass. */
  examined: number;
  /** Found on chain: now `paid_no_answer`. */
  charged: number;
  /** Proven never to have landed: now `not_charged`, the amount returned to its day. */
  notCharged: number;
  /** Looked at and left as they are, still counted as charged. */
  waiting: number;
  /** Open rows this pass does not look up: no memo to find them by, or older than the give-up age. */
  stuck: number;
  /** Transfers to the gateway that no ledger row accounts for. Any at all halts pay-per-use. */
  unknownTransfers: number;
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
    examined: 0,
    charged: 0,
    notCharged: 0,
    waiting: 0,
    stuck: 0,
    unknownTransfers: 0,
    mismatches: 0,
    unchecked: 0,
    rpcCalls: 0,
    rpcErrors: 0,
    halted: false,
  };
}

/** The pass cannot go on asking the chain: out of calls, out of time, or the RPC is down. */
class NoMoreChain extends Error {}

interface OpenRow {
  id: string;
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

class Pass {
  readonly counts = emptyCounts();
  private readonly transactions = new Map<string, unknown | null>();
  private readonly judged = new Map<string, { expired: boolean; slot: number }>();
  /** Transactions already counted as unknown or unchecked, so two reads of one history count each once. */
  private readonly counted = new Set<string>();
  private txFetches = 0;
  private readonly deadlineAt: number;

  constructor(
    readonly reader: InferenceChainReader,
    readonly limits: ReconcileLimits,
    readonly now: Date,
    /** When an admin last cleared a halt, epoch ms. Evidence from before it has been looked at. */
    private readonly acknowledgedBefore: number,
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
   * reached the start of the window (or the start of the account's history) AND the memo
   * of every transaction in the window is known. Only a complete read can show absence.
   */
  async history(address: string, sinceSec: number, minContextSlot?: number): Promise<{ seen: Seen[]; complete: boolean }> {
    const seen: Seen[] = [];
    let complete = false;
    let before: string | undefined;
    for (let page = 0; page < this.limits.pages; page += 1) {
      const entries = await this.ask(() => this.reader.signaturesFor(address, { limit: this.limits.pageSize, before, minContextSlot }));
      let reachedStart = entries.length < this.limits.pageSize;
      for (const entry of entries) {
        // A transaction with no time on it cannot be placed outside the window, so it is in it.
        if (entry.blockTime !== null && entry.blockTime < sinceSec) {
          reachedStart = true;
          continue;
        }
        seen.push({ signature: entry.signature, failed: entry.err !== null && entry.err !== undefined, memoText: entry.memo, blockTime: entry.blockTime });
      }
      if (reachedStart) {
        complete = true;
        break;
      }
      before = entries[entries.length - 1]?.signature;
      if (!before) break;
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

  /** Add one to `unknownTransfers` or `unchecked` for a transaction, once per pass. */
  count(what: "unknownTransfers" | "unchecked", signature: string): void {
    const key = `${what}:${signature}`;
    if (this.counted.has(key)) return;
    this.counted.add(key);
    this.counts[what] += 1;
  }

  /**
   * Halt pay-per-use over a transaction, unless an admin has cleared a halt since that
   * transaction landed: then it has been looked at, and halting again every five
   * minutes over the same evidence would only stop the admin from switching back on.
   * A transaction with no time on it is treated as new.
   */
  async halt(reason: string, evidence: Pick<Seen, "blockTime">): Promise<void> {
    if (evidence.blockTime !== null && evidence.blockTime * 1000 <= this.acknowledgedBefore) return;
    if (await haltInferenceOnce(reason, "reconciler")) this.counts.halted = true;
  }
}

function carries(seen: readonly Seen[], memo: string): Seen | undefined {
  return seen.find((entry) => !entry.failed && entry.memoText !== null && entry.memoText.includes(memo));
}

const ACCOUNTED: readonly InferencePaymentStatus[] = ["signed", "settled", "paid_no_answer", "unconfirmed"];

/** The memos the ledger knows for one wallet, recent enough to appear in the window being read. */
async function knownMemos(payerAddress: string, since: Date): Promise<Array<{ id: string; memo: string; status: string }>> {
  const db = await getDb();
  const rows = await db
    .select({ id: inferencePayments.id, memo: inferencePayments.memo, status: inferencePayments.status })
    .from(inferencePayments)
    .where(and(eq(inferencePayments.payerAddress, payerAddress), isNotNull(inferencePayments.memo), gte(inferencePayments.createdAt, since)))
    .limit(1000);
  return rows.flatMap((row) => (row.memo ? [{ id: row.id, memo: row.memo, status: row.status }] : []));
}

/**
 * Look through one wallet's recent transactions for USDC that went to the gateway
 * without a ledger row to account for it, and halt if there is any.
 *
 * Returns whether the window is clean: every successful transaction in it is either a
 * payment the ledger already counts, or was read and is not a payment to the gateway.
 * Only a clean window can support a not-charged verdict.
 */
async function watchForUnknownTransfers(pass: Pass, payerAddress: string, seen: readonly Seen[], since: Date): Promise<boolean> {
  const known = await knownMemos(payerAddress, new Date(since.getTime() - 3 * WINDOW_SLACK_MS));
  const gateway = INFERENCE_GATEWAY.solana;
  let clean = true;
  for (const entry of seen) {
    if (entry.failed) continue;
    const row = entry.memoText === null ? undefined : known.find((candidate) => entry.memoText!.includes(candidate.memo));
    // The usual case: a payment the ledger already counts as charged.
    if (row && (ACCOUNTED as readonly string[]).includes(row.status)) continue;

    const tx = await pass.transaction(entry.signature);
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
    pass.count("unknownTransfers", entry.signature);
    await pass.halt(
      row
        ? `A payment landed on chain for ledger row ${row.id}, which the ledger holds as ${row.status}. Transaction ${entry.signature}, wallet ${payerAddress}.`
        : `USDC went from an agent wallet to the gateway with no ledger row. Transaction ${entry.signature}, wallet ${payerAddress}.`,
      entry,
    );
  }
  return clean;
}

/** A row's payment was seen on chain. Confirm what it moved, then record it as charged. */
async function chargeFound(pass: Pass, row: OpenRow, hit: Seen): Promise<boolean> {
  const tx = await pass.transaction(hit.signature);
  // The memo is on chain but the transaction itself could not be read this pass. The
  // row stays as it is, which already counts it as charged.
  if (tx === undefined || tx === null) return false;
  const moved = usdcMovement(tx, { payer: row.payerAddress, payTo: row.payTo, mint: row.asset });
  if (moved.failed) return false;
  if (moved.paid === BigInt(0)) {
    // Our memo on a transaction that took nothing from the payer is not a payment this
    // server built. The row is left counted, and a person should look.
    pass.counts.mismatches += 1;
    await pass.halt(`Transaction ${hit.signature} carries the memo of ledger row ${row.id} but moved no USDC from wallet ${row.payerAddress}.`, hit);
    return false;
  }
  const charged = await resolveInferencePayment(row.id, { charged: true, txHash: hit.signature, detail: "Found on chain by its memo. No answer was recorded." }, pass.now);
  const quoted = baseUnitsOf(row.quotedUsd);
  if (moved.paid !== quoted || moved.received !== moved.paid) {
    pass.counts.mismatches += 1;
    await pass.halt(
      `Ledger row ${row.id} was quoted ${quoted} base units to ${row.payTo}; transaction ${hit.signature} took ${moved.paid} from the wallet and ${moved.received} reached that address.`,
      hit,
    );
  }
  return charged;
}

/** Everything for one wallet: its open rows, and the watch for transfers the ledger does not know. */
async function reconcilePayer(pass: Pass, payerAddress: string, rows: readonly OpenRow[]): Promise<void> {
  const undecided = new Set(rows.map((row) => row.id));
  const settle = (row: OpenRow, outcome: "charged" | "notCharged" | "waiting") => {
    if (!undecided.delete(row.id)) return;
    pass.counts[outcome] += 1;
  };

  try {
    const account = payerTokenAccount(payerAddress, rows[0].asset);
    if (!account) return;
    const since = new Date(Math.min(...rows.map((row) => row.at.getTime())) - WINDOW_SLACK_MS);
    const sinceSec = Math.floor(since.getTime() / 1000);

    const first = await pass.history(account, sinceSec);
    const missing: OpenRow[] = [];
    for (const row of rows) {
      const hit = carries(first.seen, row.memo);
      if (!hit) missing.push(row);
      else settle(row, (await chargeFound(pass, row, hit)) ? "charged" : "waiting");
    }
    const firstClean = await watchForUnknownTransfers(pass, payerAddress, first.seen, since);

    // Absence can only be read from a window that is complete and has no transfer to the
    // gateway the ledger cannot explain: such a transfer may be the very payment looked for.
    if (!first.complete || !firstClean || missing.length === 0) return;

    const candidates: OpenRow[] = [];
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
    // judged from: a node that is behind that block refuses instead of answering.
    const second = await pass.history(account, sinceSec, judgedFrom);
    const secondClean = await watchForUnknownTransfers(pass, payerAddress, second.seen, since);
    for (const row of candidates) {
      const hit = carries(second.seen, row.memo);
      if (hit) {
        settle(row, (await chargeFound(pass, row, hit)) ? "charged" : "waiting");
      } else if (second.complete && secondClean) {
        const released = await resolveInferencePayment(
          row.id,
          { charged: false, detail: "Not on chain: its blockhash expired and two reads of the wallet's history found no payment." },
          pass.now,
        );
        settle(row, released ? "notCharged" : "waiting");
      }
    }
  } catch (err) {
    if (!(err instanceof NoMoreChain)) throw err;
  } finally {
    // Whatever was not decided stays exactly as it was, and is said so.
    for (const row of rows) settle(row, "waiting");
  }
}

/**
 * One reconciliation pass. Returns counts only: no row, address or memo leaves this
 * function except in the halt reason, which is stored for the admin page.
 */
export async function reconcileInferencePayments(
  options: { now?: Date; reader?: InferenceChainReader; limits?: Partial<ReconcileLimits> } = {},
): Promise<ReconcileCounts> {
  const now = options.now ?? new Date();
  const limits: ReconcileLimits = { ...RECONCILE_LIMITS, ...options.limits };
  const db = await getDb();

  // No chain needed for this one: a row that was never marked signed was never sent.
  const staleReleased = await releaseStaleReserved(new Date(now.getTime() - STALE_RESERVED_MS), 50, now);

  const openStatuses = ["signed", "unconfirmed"];
  const dueBefore = new Date(now.getTime() - RECONCILE_AFTER_MS);
  const notBefore = new Date(now.getTime() - GIVE_UP_AFTER_MS);
  const [stuck] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(inferencePayments)
    .where(
      and(
        inArray(inferencePayments.status, openStatuses),
        lt(inferencePayments.createdAt, dueBefore),
        sql`(${inferencePayments.memo} is null or ${inferencePayments.chain} <> 'solana' or ${inferencePayments.createdAt} < ${notBefore.toISOString()}::timestamptz)`,
      ),
    );
  const finish = (pass: Pass | null, skipped: ReconcileCounts["skipped"]): ReconcileCounts => ({
    ...(pass?.counts ?? emptyCounts()),
    skipped,
    staleReleased,
    stuck: Number(stuck?.count ?? 0),
  });

  if (inferenceMockMode()) return finish(null, "mock");
  const reader = options.reader ?? defaultReader();
  if (!reader) return finish(null, "no_rpc");

  // Newest first: a row that cannot be settled yet (or ever) must not stand in front of
  // the ones that can.
  const candidates = await db
    .select({
      id: inferencePayments.id,
      payerAddress: inferencePayments.payerAddress,
      payTo: inferencePayments.payTo,
      asset: inferencePayments.asset,
      quotedUsd: inferencePayments.quotedUsd,
      memo: inferencePayments.memo,
      blockhash: inferencePayments.blockhash,
      signedAt: inferencePayments.signedAt,
      createdAt: inferencePayments.createdAt,
    })
    .from(inferencePayments)
    .where(
      and(
        inArray(inferencePayments.status, openStatuses),
        eq(inferencePayments.chain, "solana"),
        isNotNull(inferencePayments.memo),
        lt(inferencePayments.createdAt, dueBefore),
        gte(inferencePayments.createdAt, notBefore),
      ),
    )
    .orderBy(desc(inferencePayments.createdAt))
    .limit(limits.rows * 2);

  const control = await readInferenceControl();
  const pass = new Pass(reader, limits, now, control.haltClearedAt?.getTime() ?? 0);
  const byPayer = new Map<string, OpenRow[]>();
  let unsearchable = 0;
  for (const row of candidates) {
    const at = row.signedAt ?? row.createdAt;
    if (!row.memo || at.getTime() > dueBefore.getTime()) continue;
    if (row.memo.length < MIN_MEMO_LENGTH) {
      unsearchable += 1;
      continue;
    }
    if (pass.counts.examined >= limits.rows) break;
    pass.counts.examined += 1;
    const open: OpenRow = { id: row.id, payerAddress: row.payerAddress, payTo: row.payTo, asset: row.asset, quotedUsd: row.quotedUsd, memo: row.memo, blockhash: row.blockhash, at };
    byPayer.set(row.payerAddress, [...(byPayer.get(row.payerAddress) ?? []), open]);
  }

  for (const [payerAddress, rows] of byPayer) {
    await reconcilePayer(pass, payerAddress, rows);
  }

  // Beyond the wallets with open rows: a few that paid lately, looked at for transfers
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
        const { seen } = await pass.history(account, Math.floor(since.getTime() / 1000));
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
  /** False when the history was longer than the bounds, or a transaction in it could not be read. */
  complete: boolean;
  transactionsRead: number;
}

/**
 * Every transfer from `payerAddress` to the pinned gateway since `since`, read from the
 * wallet's own USDC account. Unlike the cron pass this fetches every transaction in the
 * window, so it is for the audit script and an operator's patience, not for a cron.
 * Read-only. RPC errors are thrown, already redacted.
 */
export async function readGatewayPayments(
  reader: InferenceChainReader,
  payerAddress: string,
  since: Date,
  bounds: { pages?: number; pageSize?: number; transactions?: number } = {},
): Promise<GatewayPaymentsRead> {
  const gateway = INFERENCE_GATEWAY.solana;
  const account = payerTokenAccount(payerAddress, gateway.asset);
  if (!account) throw new Error("That is not a Solana address.");
  const pages = bounds.pages ?? 20;
  const pageSize = bounds.pageSize ?? 500;
  const maxTransactions = bounds.transactions ?? 2000;
  const sinceSec = Math.floor(since.getTime() / 1000);

  const inWindow: SignatureEntry[] = [];
  let complete = false;
  let before: string | undefined;
  for (let page = 0; page < pages; page += 1) {
    const entries = await reader.signaturesFor(account, { limit: pageSize, before });
    let reachedStart = entries.length < pageSize;
    for (const entry of entries) {
      if (entry.blockTime !== null && entry.blockTime < sinceSec) reachedStart = true;
      else if (entry.err === null || entry.err === undefined) inWindow.push(entry);
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
}

export interface AuditDifference {
  kind: "on_chain_not_in_ledger" | "ledger_charged_not_on_chain" | "ledger_not_charged_but_on_chain" | "amount_differs" | "open";
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
 * rows are reported as open either way. A transfer no row matches is the serious one.
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

    if (row.status === "settled" || row.status === "paid_no_answer") {
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
      differences.push({
        kind: "open",
        rowId: row.id,
        signature: payment?.signature ?? null,
        detail: payment ? `still ${row.status} in the ledger; the chain shows it paid (${payment.paid} base units)` : `still ${row.status} in the ledger; no transfer found`,
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
