/**
 * The reconciler against a stubbed chain and a real (in-memory) ledger: what it takes to
 * call a payment charged, what it takes to call it not charged, and everything in
 * between, which must leave the row exactly as it was.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Keypair } from "@solana/web3.js";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { Db } from "@/db";
import { inferenceBudgetDays, inferenceControl, inferencePayments } from "@/db/schema";
import { setupTestDb } from "@/lib/agent/test-support";
import { createInferenceLedger, readInferenceControl, setInferenceHalt } from "./inference-ledger";
import {
  GIVE_UP_AFTER_MS,
  NOT_CHARGED_AFTER_MS,
  RECONCILE_AFTER_MS,
  STALE_RESERVED_MS,
  baseUnitsOf,
  compareLedgerWithChain,
  createSolanaChainReader,
  payerTokenAccount,
  readGatewayPayments,
  reconcileInferencePayments,
  transactionMemos,
  usdcMovement,
  type InferenceChainReader,
  type SignatureEntry,
} from "./inference-reconcile";
import { INFERENCE_GATEWAY, type InferenceCaps } from "./inference-types";

const MINUTE = 60_000;
const NOW = new Date("2031-03-10T12:00:00.000Z");
const DAY = "2031-03-10";
const GATEWAY = INFERENCE_GATEWAY.solana;
const PAY_TO = GATEWAY.payTo[0];
const MINT = GATEWAY.asset;

const CAPS: InferenceCaps = {
  stepUsd: 0.25,
  runUsd: 5,
  agentDayUsd: 50,
  ownerDayUsd: 50,
  platformDayUsd: 100,
  agentDayRequests: 600,
  maxRequestsPerRun: 21,
};

let db: Db;
const ledger = createInferenceLedger();

const ago = (minutes: number) => new Date(NOW.getTime() - minutes * MINUTE);
const seconds = (at: Date) => Math.floor(at.getTime() / 1000);
/** A public address made at run time. Only ever the public half. */
const newAddress = () => Keypair.generate().publicKey.toBase58();
const newMemo = () => Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join("");

interface Fixture {
  id: string;
  payer: string;
  account: string;
  memo: string;
  blockhash: string;
}

/**
 * A row as a dead or timed-out request leaves it: reserved through the ledger (so the
 * counters hold its amount), then put in `status` with the given signature time.
 */
async function openRow(
  options: {
    status?: "signed" | "unconfirmed";
    signedAt?: Date;
    payer?: string;
    memo?: string | null;
    blockhash?: string | null;
    quotedUsd?: number;
    agentId?: string;
  } = {},
): Promise<Fixture> {
  const signedAt = options.signedAt ?? ago(6);
  const payer = options.payer ?? newAddress();
  const memo = options.memo === undefined ? newMemo() : options.memo;
  const blockhash = options.blockhash === undefined ? `Blockhash${nanoid(8)}` : options.blockhash;
  const reserved = await ledger.reserve({
    ownerId: "owner-1",
    agentId: options.agentId ?? "agent-1",
    runId: `run-${nanoid(8)}`,
    seq: 0,
    requestHash: "ab".repeat(32),
    chain: "solana",
    network: GATEWAY.network,
    host: GATEWAY.host,
    model: "google/gemini-2.5-flash",
    payerWalletId: "wallet-1",
    payerAddress: payer,
    payTo: PAY_TO,
    asset: MINT,
    quotedUsd: options.quotedUsd ?? 0.01,
    caps: CAPS,
    runSpentUsd: 0,
    now: signedAt,
  });
  if (!reserved.ok) throw new Error(`reserve refused: ${reserved.reason}`);
  await db
    .update(inferencePayments)
    .set({ status: options.status ?? "unconfirmed", signedAt, memo, blockhash })
    .where(eq(inferencePayments.id, reserved.paymentId));
  return { id: reserved.paymentId, payer, account: payerTokenAccount(payer, MINT)!, memo: memo ?? "", blockhash: blockhash ?? "" };
}

async function rowOf(id: string) {
  const [row] = await db.select().from(inferencePayments).where(eq(inferencePayments.id, id));
  return row;
}

async function heldUsd(scope: string, scopeId: string, day = DAY): Promise<number> {
  const [row] = await db
    .select()
    .from(inferenceBudgetDays)
    .where(and(eq(inferenceBudgetDays.scope, scope), eq(inferenceBudgetDays.scopeId, scopeId), eq(inferenceBudgetDays.day, day)));
  return Number(row?.usd ?? 0);
}

/** A `jsonParsed` transaction that moves `units` of `mint` from `payer` to `payTo` under a memo. */
function paymentTx(input: { payer: string; payTo?: string; units: number; memo?: string | null; err?: unknown; mint?: string }): unknown {
  const mint = input.mint ?? MINT;
  const payTo = input.payTo ?? PAY_TO;
  const moved = input.err ? 0 : input.units;
  return {
    meta: {
      err: input.err ?? null,
      logMessages: input.memo ? [`Program log: Memo (len ${input.memo.length}): "${input.memo}"`] : [],
      preTokenBalances: [
        { accountIndex: 1, mint, owner: input.payer, uiTokenAmount: { amount: "5000000" } },
        { accountIndex: 2, mint, owner: payTo, uiTokenAmount: { amount: "900000000" } },
      ],
      postTokenBalances: [
        { accountIndex: 1, mint, owner: input.payer, uiTokenAmount: { amount: String(5_000_000 - moved) } },
        { accountIndex: 2, mint, owner: payTo, uiTokenAmount: { amount: String(900_000_000 + moved) } },
      ],
    },
    transaction: {
      message: {
        instructions: [
          { program: "spl-token", programId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", parsed: { type: "transferChecked" } },
          ...(input.memo ? [{ program: "spl-memo", programId: "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr", parsed: input.memo }] : []),
        ],
      },
    },
  };
}

/** A chain that answers from what the test put in it, and remembers what it was asked. */
function fakeChain() {
  const history = new Map<string, SignatureEntry[]>();
  /** What a read that insists on a recent block returns, when that differs from the first read. */
  const secondRead = new Map<string, SignatureEntry[]>();
  const transactions = new Map<string, unknown>();
  const blockhashes = new Map<string, { valid: boolean; slot: number }>();
  const blockTimes = new Map<number, number | null>();
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const failing = new Set<string>();

  const asked = (method: string, ...args: unknown[]) => {
    calls.push({ method, args });
    if (failing.has(method)) throw new Error(`rpc down: ${method}`);
  };

  const reader: InferenceChainReader = {
    async signaturesFor(address, options) {
      asked("signaturesFor", address, options);
      const all = (options.minContextSlot !== undefined ? secondRead.get(address) : undefined) ?? history.get(address) ?? [];
      const from = options.before ? all.findIndex((entry) => entry.signature === options.before) + 1 : 0;
      return all.slice(from, from + options.limit);
    },
    async transaction(signature) {
      asked("transaction", signature);
      return transactions.get(signature) ?? null;
    },
    async blockhashValid(blockhash) {
      asked("blockhashValid", blockhash);
      return blockhashes.get(blockhash) ?? { valid: true, slot: 1 };
    },
    async blockTime(slot) {
      asked("blockTime", slot);
      return blockTimes.get(slot) ?? null;
    },
  };

  return {
    reader,
    calls,
    failing,
    history,
    secondRead,
    transactions,
    count: (method: string) => calls.filter((call) => call.method === method).length,
    /** Put a transaction in an account's history (newest first) and make it fetchable. */
    land(account: string, entry: { signature?: string; at?: Date; memo?: string | null; reportedMemo?: string | null; err?: unknown; tx?: unknown }): string {
      const signature = entry.signature ?? `Sig${nanoid(10)}`;
      const reported = entry.reportedMemo === undefined ? (entry.memo ? `[${entry.memo.length}] ${entry.memo}` : null) : entry.reportedMemo;
      const list = history.get(account) ?? [];
      list.unshift({ signature, slot: 100, err: entry.err ?? null, memo: reported, blockTime: seconds(entry.at ?? ago(5)) });
      history.set(account, list);
      if (entry.tx !== undefined) transactions.set(signature, entry.tx);
      return signature;
    },
    /** Our node, judging from a finalized block at `judgedAt`, says the blockhash is no longer valid. */
    expire(blockhash: string, judgedAt: Date = ago(1), slot = 5000 + blockhashes.size) {
      blockhashes.set(blockhash, { valid: false, slot });
      blockTimes.set(slot, seconds(judgedAt));
      return slot;
    },
  };
}

beforeAll(async () => {
  db = await setupTestDb();
});

beforeEach(async () => {
  await db.delete(inferencePayments);
  await db.delete(inferenceBudgetDays);
  await db.delete(inferenceControl);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("found on chain", () => {
  it("records a payment found by its memo as paid with no answer, and keeps it in the caps", async () => {
    const chain = fakeChain();
    const row = await openRow({ signedAt: ago(3) });
    const signature = chain.land(row.account, { memo: row.memo, at: ago(3), tx: paymentTx({ payer: row.payer, units: 10_000, memo: row.memo }) });

    const counts = await reconcileInferencePayments({ now: NOW, reader: chain.reader });

    expect(counts).toMatchObject({ skipped: null, examined: 1, charged: 1, notCharged: 0, waiting: 0, unknownTransfers: 0, mismatches: 0, halted: false });
    expect(await rowOf(row.id)).toMatchObject({ status: "paid_no_answer", answered: false, txHash: signature });
    expect((await rowOf(row.id)).resolvedAt?.toISOString()).toBe(NOW.toISOString());
    expect(await heldUsd("agent", "agent-1")).toBe(0.01);
    expect(await heldUsd("platform", "all")).toBe(0.01);
    // One sighting is enough to charge: the blockhash is never asked about.
    expect(chain.count("blockhashValid")).toBe(0);
  });

  it("finds a row left signed by a process that died", async () => {
    const chain = fakeChain();
    const row = await openRow({ status: "signed", signedAt: ago(4) });
    chain.land(row.account, { memo: row.memo, at: ago(4), tx: paymentTx({ payer: row.payer, units: 10_000, memo: row.memo }) });
    expect((await reconcileInferencePayments({ now: NOW, reader: chain.reader })).charged).toBe(1);
    expect((await rowOf(row.id)).status).toBe("paid_no_answer");
  });

  it("reads the transaction itself when the node reports no memo for it", async () => {
    const chain = fakeChain();
    const row = await openRow({ signedAt: ago(3) });
    // A node that does not index memos: the history entry says null, the transaction has it.
    chain.land(row.account, { memo: row.memo, reportedMemo: null, at: ago(3), tx: paymentTx({ payer: row.payer, units: 10_000, memo: row.memo }) });
    expect((await reconcileInferencePayments({ now: NOW, reader: chain.reader })).charged).toBe(1);
    expect((await rowOf(row.id)).status).toBe("paid_no_answer");
  });

  it("finds each of several rows for one wallet with one read of its history", async () => {
    const chain = fakeChain();
    const payer = newAddress();
    const first = await openRow({ payer, signedAt: ago(4) });
    const second = await openRow({ payer, signedAt: ago(3), quotedUsd: 0.02 });
    chain.land(first.account, { memo: first.memo, at: ago(4), tx: paymentTx({ payer, units: 10_000, memo: first.memo }) });
    chain.land(first.account, { memo: second.memo, at: ago(3), tx: paymentTx({ payer, units: 20_000, memo: second.memo }) });

    const counts = await reconcileInferencePayments({ now: NOW, reader: chain.reader });
    expect(counts).toMatchObject({ examined: 2, charged: 2, mismatches: 0 });
    expect(chain.count("signaturesFor")).toBe(1);
  });

  it("does not take a failed transaction carrying the memo for a payment", async () => {
    const chain = fakeChain();
    const row = await openRow({ signedAt: ago(3) });
    chain.land(row.account, { memo: row.memo, at: ago(3), err: { InstructionError: [2, "Custom"] }, tx: paymentTx({ payer: row.payer, units: 10_000, memo: row.memo, err: {} }) });
    const counts = await reconcileInferencePayments({ now: NOW, reader: chain.reader });
    expect(counts).toMatchObject({ charged: 0, waiting: 1 });
    expect((await rowOf(row.id)).status).toBe("unconfirmed");
  });

  it("leaves the row as it is when the memo is on chain but the transaction cannot be read", async () => {
    const chain = fakeChain();
    const row = await openRow({ signedAt: ago(8) });
    chain.land(row.account, { memo: row.memo, at: ago(8) }); // no transaction to fetch
    chain.expire(row.blockhash);
    const counts = await reconcileInferencePayments({ now: NOW, reader: chain.reader });
    // Seen, so never "not charged"; unread, so not yet recorded with its transaction id.
    expect(counts).toMatchObject({ charged: 0, notCharged: 0, waiting: 1 });
    expect((await rowOf(row.id)).status).toBe("unconfirmed");
    expect(await heldUsd("agent", "agent-1")).toBe(0.01);
  });

  it("charges and halts when the payment on chain is not the one the row describes", async () => {
    const chain = fakeChain();
    const row = await openRow({ signedAt: ago(3), quotedUsd: 0.01 });
    const signature = chain.land(row.account, { memo: row.memo, at: ago(3), tx: paymentTx({ payer: row.payer, units: 250_000, memo: row.memo }) });

    const counts = await reconcileInferencePayments({ now: NOW, reader: chain.reader });
    expect(counts).toMatchObject({ charged: 1, mismatches: 1, halted: true });
    expect((await rowOf(row.id)).status).toBe("paid_no_answer");
    const control = await readInferenceControl();
    expect(control.halted).toBe(true);
    expect(control.haltReason).toContain(signature);
    expect(control.updatedBy).toBe("reconciler");
  });

  it("halts, and leaves the row counted, when the memo is on a transaction that took nothing from the wallet", async () => {
    const chain = fakeChain();
    const row = await openRow({ signedAt: ago(3) });
    chain.land(row.account, { memo: row.memo, at: ago(3), tx: paymentTx({ payer: newAddress(), units: 10_000, memo: row.memo }) });
    const counts = await reconcileInferencePayments({ now: NOW, reader: chain.reader });
    expect(counts).toMatchObject({ charged: 0, waiting: 1, mismatches: 1, halted: true });
    expect((await rowOf(row.id)).status).toBe("unconfirmed");
  });
});

describe("not found on chain", () => {
  it("leaves the row alone while our node says the blockhash is still valid", async () => {
    const chain = fakeChain();
    const row = await openRow({ signedAt: ago(6) });
    // The default answer of the fake chain is "still valid".
    const counts = await reconcileInferencePayments({ now: NOW, reader: chain.reader });
    expect(counts).toMatchObject({ examined: 1, charged: 0, notCharged: 0, waiting: 1 });
    expect(await rowOf(row.id)).toMatchObject({ status: "unconfirmed", resolvedAt: null });
    expect(await heldUsd("agent", "agent-1")).toBe(0.01);
    expect(chain.count("blockhashValid")).toBe(1);
    // No second read: there is nothing to confirm yet.
    expect(chain.count("signaturesFor")).toBe(1);
  });

  it("calls it not charged once the blockhash has expired and a second read still finds nothing", async () => {
    const chain = fakeChain();
    const row = await openRow({ signedAt: ago(6), quotedUsd: 0.04 });
    await openRow({ payer: row.payer, signedAt: ago(1), quotedUsd: 0.03 }); // too recent to look at; keeps its place
    const slot = chain.expire(row.blockhash);

    const counts = await reconcileInferencePayments({ now: NOW, reader: chain.reader });

    expect(counts).toMatchObject({ examined: 1, charged: 0, notCharged: 1, waiting: 0, halted: false });
    expect(await rowOf(row.id)).toMatchObject({ status: "not_charged", answered: false, txHash: null });
    expect((await rowOf(row.id)).detail).toMatch(/blockhash expired/);
    // The amount went back to all three counters; the other row's stayed.
    expect(await heldUsd("platform", "all")).toBe(0.03);
    expect(await heldUsd("owner", "owner-1")).toBe(0.03);
    expect(await heldUsd("agent", "agent-1")).toBe(0.03);

    // Two reads of the history, the second one pinned to the block the verdict came from.
    const reads = chain.calls.filter((call) => call.method === "signaturesFor").map((call) => (call.args[1] as { minContextSlot?: number }).minContextSlot);
    expect(reads).toEqual([undefined, slot]);
  });

  it("returns the amount to the day it was reserved on when the verdict comes after midnight", async () => {
    const chain = fakeChain();
    const signedAt = new Date("2031-03-09T23:57:00.000Z");
    const now = new Date("2031-03-10T00:04:00.000Z");
    const row = await openRow({ signedAt, quotedUsd: 0.04 });
    chain.expire(row.blockhash, new Date("2031-03-10T00:03:00.000Z"));
    expect(await heldUsd("agent", "agent-1", "2031-03-09")).toBe(0.04);

    expect((await reconcileInferencePayments({ now, reader: chain.reader })).notCharged).toBe(1);
    expect(await heldUsd("agent", "agent-1", "2031-03-09")).toBe(0);
    expect(await heldUsd("platform", "all", "2031-03-09")).toBe(0);
    expect(await db.select().from(inferenceBudgetDays).where(eq(inferenceBudgetDays.day, "2031-03-10"))).toHaveLength(0);
  });

  it("gives the amount back once, however many passes run", async () => {
    const chain = fakeChain();
    const row = await openRow({ signedAt: ago(6), quotedUsd: 0.04 });
    await openRow({ signedAt: ago(1), quotedUsd: 0.03 });
    chain.expire(row.blockhash);
    await Promise.all([reconcileInferencePayments({ now: NOW, reader: chain.reader }), reconcileInferencePayments({ now: NOW, reader: chain.reader })]);
    await reconcileInferencePayments({ now: NOW, reader: chain.reader });
    expect(await heldUsd("agent", "agent-1")).toBe(0.03);
  });

  it("waits out the minimum age even when the blockhash has already expired", async () => {
    const chain = fakeChain();
    const row = await openRow({ signedAt: new Date(NOW.getTime() - NOT_CHARGED_AFTER_MS + 1000) });
    chain.expire(row.blockhash);
    expect(await reconcileInferencePayments({ now: NOW, reader: chain.reader })).toMatchObject({ examined: 1, notCharged: 0, waiting: 1 });
    expect(chain.count("blockhashValid")).toBe(0);
    // A second later it is old enough.
    expect((await reconcileInferencePayments({ now: new Date(NOW.getTime() + 2000), reader: chain.reader })).notCharged).toBe(1);
  });

  it("does not believe a node that judges from a block no later than the signature", async () => {
    const chain = fakeChain();
    const row = await openRow({ signedAt: ago(6) });
    // A node that is behind says "not valid" about a blockhash it has not seen yet.
    chain.expire(row.blockhash, ago(6));
    expect(await reconcileInferencePayments({ now: NOW, reader: chain.reader })).toMatchObject({ notCharged: 0, waiting: 1 });
    expect((await rowOf(row.id)).status).toBe("unconfirmed");

    // Fifty-nine seconds after the signature is still not enough; sixty is.
    chain.expire(row.blockhash, new Date(ago(6).getTime() + 59_000));
    expect((await reconcileInferencePayments({ now: NOW, reader: chain.reader })).notCharged).toBe(0);
    chain.expire(row.blockhash, new Date(ago(6).getTime() + 60_000));
    expect((await reconcileInferencePayments({ now: NOW, reader: chain.reader })).notCharged).toBe(1);
  });

  it("does not decide when the node cannot say when the judging block was", async () => {
    const chain = fakeChain();
    const row = await openRow({ signedAt: ago(6) });
    const slot = chain.expire(row.blockhash);
    chain.reader.blockTime = async (asked) => {
      expect(asked).toBe(slot);
      return null;
    };
    expect(await reconcileInferencePayments({ now: NOW, reader: chain.reader })).toMatchObject({ notCharged: 0, waiting: 1 });
  });

  it("charges instead when the second read finds the payment", async () => {
    const chain = fakeChain();
    const row = await openRow({ signedAt: ago(6) });
    chain.expire(row.blockhash);
    // The first read misses it (an index that is behind); the pinned read has it.
    const signature = "SigLate";
    chain.secondRead.set(row.account, [{ signature, slot: 100, err: null, memo: `[32] ${row.memo}`, blockTime: seconds(ago(6)) }]);
    chain.transactions.set(signature, paymentTx({ payer: row.payer, units: 10_000, memo: row.memo }));

    const counts = await reconcileInferencePayments({ now: NOW, reader: chain.reader });
    expect(counts).toMatchObject({ charged: 1, notCharged: 0 });
    expect(await rowOf(row.id)).toMatchObject({ status: "paid_no_answer", txHash: signature });
    expect(await heldUsd("agent", "agent-1")).toBe(0.01);
  });

  it("treats a failed transaction carrying the memo as no payment, and still needs the blockhash to expire", async () => {
    const chain = fakeChain();
    const row = await openRow({ signedAt: ago(6) });
    chain.land(row.account, { memo: row.memo, at: ago(6), err: { InstructionError: [2, "Custom"] } });
    expect((await reconcileInferencePayments({ now: NOW, reader: chain.reader })).waiting).toBe(1);
    chain.expire(row.blockhash);
    expect((await reconcileInferencePayments({ now: NOW, reader: chain.reader })).notCharged).toBe(1);
  });

  it("never calls a row with no recorded blockhash not charged", async () => {
    const chain = fakeChain();
    const row = await openRow({ signedAt: ago(30), blockhash: null });
    expect(await reconcileInferencePayments({ now: NOW, reader: chain.reader })).toMatchObject({ examined: 1, notCharged: 0, waiting: 1 });
    expect((await rowOf(row.id)).status).toBe("unconfirmed");
    expect(chain.count("blockhashValid")).toBe(0);
  });

  describe("a transfer to the gateway that the ledger cannot explain is never read as no payment", () => {
    it("when the payment is there under a memo the row does not hold", async () => {
      const chain = fakeChain();
      const row = await openRow({ signedAt: ago(6), quotedUsd: 0.01 });
      chain.expire(row.blockhash);
      // Exactly this row's payment, except that the ledger recorded its memo wrongly.
      chain.land(row.account, { memo: "9".repeat(32), at: ago(6), tx: paymentTx({ payer: row.payer, units: 10_000, memo: "9".repeat(32) }) });

      const counts = await reconcileInferencePayments({ now: NOW, reader: chain.reader });
      expect(counts).toMatchObject({ notCharged: 0, waiting: 1, unknownTransfers: 1, halted: true });
      expect((await rowOf(row.id)).status).toBe("unconfirmed");
      expect(await heldUsd("agent", "agent-1")).toBe(0.01);
      // The blockhash is not even asked about: the window already disproves absence.
      expect(chain.count("blockhashValid")).toBe(0);
    });

    it("when a transaction with an unfamiliar memo cannot be read to rule it out", async () => {
      const chain = fakeChain();
      const row = await openRow({ signedAt: ago(6) });
      chain.expire(row.blockhash);
      const unread = chain.land(row.account, { memo: "8".repeat(32), at: ago(6) });
      expect(await reconcileInferencePayments({ now: NOW, reader: chain.reader })).toMatchObject({ notCharged: 0, waiting: 1, unchecked: 1, halted: false });
      // Read, and it went somewhere else: now the window is clean.
      chain.transactions.set(unread, paymentTx({ payer: row.payer, payTo: newAddress(), units: 10_000, memo: "8".repeat(32) }));
      expect((await reconcileInferencePayments({ now: NOW, reader: chain.reader })).notCharged).toBe(1);
    });

    it("when it only shows up in the second read", async () => {
      const chain = fakeChain();
      const row = await openRow({ signedAt: ago(6) });
      chain.expire(row.blockhash);
      const late = "SigLateUnknown";
      chain.secondRead.set(row.account, [{ signature: late, slot: 100, err: null, memo: `[32] ${"7".repeat(32)}`, blockTime: seconds(ago(5)) }]);
      chain.transactions.set(late, paymentTx({ payer: row.payer, units: 10_000, memo: "7".repeat(32) }));

      const counts = await reconcileInferencePayments({ now: NOW, reader: chain.reader });
      expect(counts).toMatchObject({ notCharged: 0, waiting: 1, unknownTransfers: 1, halted: true });
      expect((await rowOf(row.id)).status).toBe("unconfirmed");
    });

    it("counts one such transfer once, however many reads show it", async () => {
      const chain = fakeChain();
      const row = await openRow({ signedAt: ago(6) });
      const other = await openRow({ payer: row.payer, signedAt: ago(7) });
      chain.expire(row.blockhash);
      chain.expire(other.blockhash);
      const stray = { signature: "SigStray", slot: 100, err: null, memo: `[32] ${"6".repeat(32)}`, blockTime: seconds(ago(5)) };
      // Absent from the first read, present in the second, which two rows both consult.
      chain.secondRead.set(row.account, [stray]);
      chain.transactions.set(stray.signature, paymentTx({ payer: row.payer, units: 10_000, memo: "6".repeat(32) }));
      expect(await reconcileInferencePayments({ now: NOW, reader: chain.reader })).toMatchObject({ examined: 2, waiting: 2, unknownTransfers: 1 });
    });
  });

  describe("an incomplete read of the history shows nothing", () => {
    it("when the window is longer than the pages read", async () => {
      const chain = fakeChain();
      const row = await openRow({ signedAt: ago(6) });
      chain.expire(row.blockhash);
      // Six unrelated transactions, all inside the window, read two at a time for two pages.
      for (let n = 0; n < 6; n += 1) chain.land(row.account, { memo: `other-${n}`, at: ago(4), tx: paymentTx({ payer: newAddress(), units: 1, memo: `other-${n}` }) });
      const counts = await reconcileInferencePayments({ now: NOW, reader: chain.reader, limits: { pages: 2, pageSize: 2 } });
      expect(counts).toMatchObject({ notCharged: 0, waiting: 1 });
      expect((await rowOf(row.id)).status).toBe("unconfirmed");
      // With enough pages the same history is complete, and the verdict follows.
      expect((await reconcileInferencePayments({ now: NOW, reader: chain.reader, limits: { pages: 4, pageSize: 2 } })).notCharged).toBe(1);
    });

    it("when a transaction in the window has no memo reported and cannot be read", async () => {
      const chain = fakeChain();
      const row = await openRow({ signedAt: ago(6) });
      chain.expire(row.blockhash);
      const unread = chain.land(row.account, { reportedMemo: null, at: ago(5) });
      expect(await reconcileInferencePayments({ now: NOW, reader: chain.reader })).toMatchObject({ notCharged: 0, waiting: 1 });
      // Once it can be read, and is not ours, the window is complete.
      chain.transactions.set(unread, paymentTx({ payer: newAddress(), units: 5, memo: null }));
      expect((await reconcileInferencePayments({ now: NOW, reader: chain.reader })).notCharged).toBe(1);
    });

    it("when the pass may fetch no more transactions", async () => {
      const chain = fakeChain();
      const row = await openRow({ signedAt: ago(6) });
      chain.expire(row.blockhash);
      for (let n = 0; n < 3; n += 1) chain.land(row.account, { reportedMemo: null, at: ago(5), tx: paymentTx({ payer: newAddress(), units: 5, memo: null }) });
      expect(await reconcileInferencePayments({ now: NOW, reader: chain.reader, limits: { txFetches: 2 } })).toMatchObject({ notCharged: 0, waiting: 1 });
      expect(chain.count("transaction")).toBe(2);
    });

    it("when only the first read is incomplete: both reads must show absence, not one", async () => {
      const chain = fakeChain();
      const row = await openRow({ signedAt: ago(6) });
      chain.expire(row.blockhash);
      // The first read has a transaction that cannot be accounted for; the pinned read
      // does not list it at all. One clean read out of two is not two.
      chain.land(row.account, { reportedMemo: null, at: ago(5) });
      chain.secondRead.set(row.account, []);
      expect(await reconcileInferencePayments({ now: NOW, reader: chain.reader })).toMatchObject({ notCharged: 0, waiting: 1 });
      expect((await rowOf(row.id)).status).toBe("unconfirmed");
    });

    it("when only the second read is incomplete", async () => {
      const chain = fakeChain();
      const row = await openRow({ signedAt: ago(6) });
      chain.expire(row.blockhash);
      // The first read is empty and complete; by the pinned read a transaction has
      // appeared that cannot be read. It might be the payment.
      chain.secondRead.set(row.account, [{ signature: "SigUnread", slot: 100, err: null, memo: null, blockTime: seconds(ago(5)) }]);
      expect(await reconcileInferencePayments({ now: NOW, reader: chain.reader })).toMatchObject({ notCharged: 0, waiting: 1 });
      expect((await rowOf(row.id)).status).toBe("unconfirmed");
      expect(await heldUsd("agent", "agent-1")).toBe(0.01);
    });

    it("but transactions older than the window do not count against it", async () => {
      const chain = fakeChain();
      const row = await openRow({ signedAt: ago(6) });
      chain.expire(row.blockhash);
      // Read newest first: one inside the window, then one from an hour ago ends the read.
      chain.land(row.account, { reportedMemo: null, at: ago(60) });
      chain.land(row.account, { memo: "unrelated", at: ago(4), tx: paymentTx({ payer: newAddress(), units: 5, memo: "unrelated" }) });
      const counts = await reconcileInferencePayments({ now: NOW, reader: chain.reader, limits: { pages: 1, pageSize: 2 } });
      expect(counts.notCharged).toBe(1);
    });
  });
});

describe("the RPC failing", () => {
  it("changes nothing when the history cannot be read", async () => {
    const chain = fakeChain();
    const row = await openRow({ signedAt: ago(6) });
    chain.expire(row.blockhash);
    chain.failing.add("signaturesFor");
    const counts = await reconcileInferencePayments({ now: NOW, reader: chain.reader });
    expect(counts).toMatchObject({ examined: 1, charged: 0, notCharged: 0, waiting: 1, rpcErrors: 1, halted: false });
    expect(await rowOf(row.id)).toMatchObject({ status: "unconfirmed", resolvedAt: null });
    expect(await heldUsd("agent", "agent-1")).toBe(0.01);
  });

  it("changes nothing when the blockhash cannot be judged", async () => {
    const chain = fakeChain();
    const row = await openRow({ signedAt: ago(6) });
    chain.failing.add("blockhashValid");
    expect(await reconcileInferencePayments({ now: NOW, reader: chain.reader })).toMatchObject({ notCharged: 0, waiting: 1, rpcErrors: 1 });
    expect((await rowOf(row.id)).status).toBe("unconfirmed");
  });

  it("changes nothing when the second read fails, though everything before it said not charged", async () => {
    const chain = fakeChain();
    const row = await openRow({ signedAt: ago(6) });
    chain.expire(row.blockhash);
    let reads = 0;
    const read = chain.reader.signaturesFor;
    chain.reader.signaturesFor = async (address, options) => {
      reads += 1;
      // A node that is behind the judging block refuses a read pinned to it.
      if (reads === 2) throw new Error("Minimum context slot has not been reached");
      return read(address, options);
    };
    expect(await reconcileInferencePayments({ now: NOW, reader: chain.reader })).toMatchObject({ notCharged: 0, waiting: 1, rpcErrors: 1 });
    expect((await rowOf(row.id)).status).toBe("unconfirmed");
    expect(await heldUsd("agent", "agent-1")).toBe(0.01);
  });

  it("stops asking after a few failures instead of timing out on every wallet", async () => {
    const chain = fakeChain();
    for (let n = 0; n < 8; n += 1) await openRow({ signedAt: ago(6 + n) });
    chain.failing.add("signaturesFor");
    const counts = await reconcileInferencePayments({ now: NOW, reader: chain.reader });
    expect(counts).toMatchObject({ examined: 8, waiting: 8, rpcErrors: 3 });
    expect(chain.calls).toHaveLength(3);
  });

  it("keeps the error text out of the result", async () => {
    const chain = fakeChain();
    await openRow({ signedAt: ago(6) });
    chain.failing.add("signaturesFor");
    const counts = await reconcileInferencePayments({ now: NOW, reader: chain.reader });
    expect(JSON.stringify(counts)).not.toMatch(/rpc down/);
    for (const value of Object.values(counts)) expect(["number", "boolean", "object"]).toContain(typeof value);
  });
});

describe("a transfer the ledger does not know", () => {
  it("halts pay-per-use when USDC went from an agent wallet to the gateway with no ledger row", async () => {
    const chain = fakeChain();
    const row = await openRow({ signedAt: ago(3) });
    chain.land(row.account, { memo: row.memo, at: ago(3), tx: paymentTx({ payer: row.payer, units: 10_000, memo: row.memo }) });
    const stray = chain.land(row.account, { memo: "f".repeat(32), at: ago(2), tx: paymentTx({ payer: row.payer, units: 70_000, memo: "f".repeat(32) }) });

    const counts = await reconcileInferencePayments({ now: NOW, reader: chain.reader });

    expect(counts).toMatchObject({ charged: 1, unknownTransfers: 1, halted: true });
    const control = await readInferenceControl();
    expect(control.halted).toBe(true);
    expect(control.haltReason).toContain(stray);
    expect(control.haltReason).toContain("no ledger row");
    // The halt is what the very next reserve reads.
    const next = await ledger.reserve({
      ownerId: "owner-1",
      agentId: "agent-1",
      runId: "run-after-halt",
      seq: 0,
      requestHash: "ab".repeat(32),
      chain: "solana",
      network: GATEWAY.network,
      host: GATEWAY.host,
      model: "m",
      payerWalletId: "w",
      payerAddress: row.payer,
      payTo: PAY_TO,
      asset: MINT,
      quotedUsd: 0.01,
      caps: CAPS,
      runSpentUsd: 0,
      now: NOW,
    });
    expect(next).toEqual({ ok: false, reason: "halted" });
  });

  it("finds one with no memo at all", async () => {
    const chain = fakeChain();
    const row = await openRow({ signedAt: ago(3) });
    chain.land(row.account, { reportedMemo: null, at: ago(2), tx: paymentTx({ payer: row.payer, units: 70_000, memo: null }) });
    expect(await reconcileInferencePayments({ now: NOW, reader: chain.reader })).toMatchObject({ unknownTransfers: 1, halted: true });
  });

  it("is not fooled by the agent's ordinary trading: USDC that left for somewhere else", async () => {
    const chain = fakeChain();
    const row = await openRow({ signedAt: ago(3) });
    chain.land(row.account, { memo: row.memo, at: ago(3), tx: paymentTx({ payer: row.payer, units: 10_000, memo: row.memo }) });
    // A swap, a withdrawal to the owner, a deposit, a failed transfer to the gateway.
    chain.land(row.account, { reportedMemo: null, at: ago(2), tx: paymentTx({ payer: row.payer, payTo: newAddress(), units: 2_000_000, memo: null }) });
    chain.land(row.account, { memo: "withdrawal", at: ago(2), tx: paymentTx({ payer: row.payer, payTo: newAddress(), units: 500_000, memo: "withdrawal" }) });
    chain.land(row.account, { reportedMemo: null, at: ago(2), tx: paymentTx({ payer: newAddress(), payTo: row.payer, units: 9_000_000, memo: null }) });
    chain.land(row.account, { memo: "e".repeat(32), at: ago(2), err: { InstructionError: [2, "Custom"] } });
    // The right owner and amount, but another token.
    chain.land(row.account, { reportedMemo: null, at: ago(2), tx: paymentTx({ payer: row.payer, units: 70_000, memo: null, mint: newAddress() }) });

    const counts = await reconcileInferencePayments({ now: NOW, reader: chain.reader });
    expect(counts).toMatchObject({ charged: 1, unknownTransfers: 0, mismatches: 0, halted: false });
    expect((await readInferenceControl()).halted).toBe(false);
  });

  it("does not fetch payments the ledger already counts as charged", async () => {
    const chain = fakeChain();
    const payer = newAddress();
    const open = await openRow({ payer, signedAt: ago(3) });
    const settled = await openRow({ payer, signedAt: ago(4) });
    await db.update(inferencePayments).set({ status: "settled" }).where(eq(inferencePayments.id, settled.id));
    const openSignature = chain.land(open.account, { memo: open.memo, at: ago(3), tx: paymentTx({ payer, units: 10_000, memo: open.memo }) });
    chain.land(open.account, { memo: settled.memo, at: ago(4), tx: paymentTx({ payer, units: 10_000, memo: settled.memo }) });

    const counts = await reconcileInferencePayments({ now: NOW, reader: chain.reader });
    expect(counts).toMatchObject({ charged: 1, unknownTransfers: 0, halted: false });
    expect(chain.calls.filter((call) => call.method === "transaction").map((call) => call.args[0])).toEqual([openSignature]);
  });

  it("halts when a payment lands for a row the ledger already called not charged", async () => {
    const chain = fakeChain();
    const payer = newAddress();
    const open = await openRow({ payer, signedAt: ago(3) });
    const wrong = await openRow({ payer, signedAt: ago(4) });
    await db.update(inferencePayments).set({ status: "not_charged" }).where(eq(inferencePayments.id, wrong.id));
    const signature = chain.land(open.account, { memo: wrong.memo, at: ago(4), tx: paymentTx({ payer, units: 10_000, memo: wrong.memo }) });

    const counts = await reconcileInferencePayments({ now: NOW, reader: chain.reader });
    expect(counts).toMatchObject({ unknownTransfers: 1, halted: true });
    const reason = (await readInferenceControl()).haltReason ?? "";
    expect(reason).toContain(wrong.id);
    expect(reason).toContain("not_charged");
    expect(reason).toContain(signature);
  });

  it("looks at wallets that paid lately even when none of their rows is open", async () => {
    const chain = fakeChain();
    const row = await openRow({ signedAt: ago(4) });
    await db.update(inferencePayments).set({ status: "settled" }).where(eq(inferencePayments.id, row.id));
    chain.land(row.account, { memo: row.memo, at: ago(4), tx: paymentTx({ payer: row.payer, units: 10_000, memo: row.memo }) });
    expect(await reconcileInferencePayments({ now: NOW, reader: chain.reader })).toMatchObject({ examined: 0, unknownTransfers: 0, halted: false });
    expect(chain.count("signaturesFor")).toBe(1);

    chain.land(row.account, { memo: "d".repeat(32), at: ago(1), tx: paymentTx({ payer: row.payer, units: 30_000, memo: "d".repeat(32) }) });
    expect(await reconcileInferencePayments({ now: NOW, reader: chain.reader })).toMatchObject({ examined: 0, unknownTransfers: 1, halted: true });
  });

  it("samples a bounded number of wallets, and none when told to", async () => {
    const chain = fakeChain();
    for (let n = 0; n < 6; n += 1) {
      const row = await openRow({ signedAt: ago(4) });
      await db.update(inferencePayments).set({ status: "settled" }).where(eq(inferencePayments.id, row.id));
    }
    await reconcileInferencePayments({ now: NOW, reader: chain.reader });
    expect(chain.count("signaturesFor")).toBe(3);
    chain.calls.length = 0;
    await reconcileInferencePayments({ now: NOW, reader: chain.reader, limits: { samplePayers: 0 } });
    expect(chain.calls).toHaveLength(0);
  });

  it("does not halt again over a transfer an admin has already cleared, and does over a newer one", async () => {
    const chain = fakeChain();
    const row = await openRow({ signedAt: ago(4), blockhash: null });
    chain.land(row.account, { memo: "f".repeat(32), at: ago(3), tx: paymentTx({ payer: row.payer, units: 70_000, memo: "f".repeat(32) }) });
    expect((await reconcileInferencePayments({ now: NOW, reader: chain.reader })).halted).toBe(true);

    // The admin looks, and switches pay-per-use back on, two minutes after the transfer.
    vi.useFakeTimers({ now: ago(1), toFake: ["Date"] });
    try {
      await setInferenceHalt({ halted: false, reason: null, by: "admin-1" });
    } finally {
      vi.useRealTimers();
    }
    const again = await reconcileInferencePayments({ now: NOW, reader: chain.reader });
    // Still seen and still counted, but it does not take the platform down a second time.
    expect(again).toMatchObject({ unknownTransfers: 1, halted: false });
    expect((await readInferenceControl()).halted).toBe(false);

    chain.land(row.account, { memo: "c".repeat(32), at: new Date(NOW.getTime() - 30_000), tx: paymentTx({ payer: row.payer, units: 70_000, memo: "c".repeat(32) }) });
    expect(await reconcileInferencePayments({ now: NOW, reader: chain.reader })).toMatchObject({ unknownTransfers: 2, halted: true });
  });

  it("counts what it could not check within its bounds", async () => {
    const chain = fakeChain();
    const row = await openRow({ signedAt: ago(3), blockhash: null });
    for (let n = 0; n < 4; n += 1) chain.land(row.account, { memo: `swap-${n}`, at: ago(2), tx: paymentTx({ payer: row.payer, payTo: newAddress(), units: 5, memo: `swap-${n}` }) });
    const counts = await reconcileInferencePayments({ now: NOW, reader: chain.reader, limits: { txFetches: 1 } });
    expect(counts).toMatchObject({ unchecked: 3, unknownTransfers: 0 });
  });
});

describe("which rows a pass looks at", () => {
  it("leaves a row alone for the first two minutes after its signature", async () => {
    const chain = fakeChain();
    const young = await openRow({ signedAt: new Date(NOW.getTime() - RECONCILE_AFTER_MS + 5000) });
    chain.land(young.account, { memo: young.memo, at: ago(1), tx: paymentTx({ payer: young.payer, units: 10_000, memo: young.memo }) });
    const counts = await reconcileInferencePayments({ now: NOW, reader: chain.reader, limits: { samplePayers: 0 } });
    expect(counts).toMatchObject({ examined: 0, charged: 0 });
    expect((await rowOf(young.id)).status).toBe("unconfirmed");
    expect(chain.calls).toHaveLength(0);
  });

  it("measures the two minutes from the signature, not from when the row was written", async () => {
    const chain = fakeChain();
    const row = await openRow({ signedAt: ago(4) });
    // Reserved four minutes ago, signed only one minute ago: its request may still be running.
    await db.update(inferencePayments).set({ signedAt: ago(1) }).where(eq(inferencePayments.id, row.id));
    chain.land(row.account, { memo: row.memo, at: ago(1), tx: paymentTx({ payer: row.payer, units: 10_000, memo: row.memo }) });
    const counts = await reconcileInferencePayments({ now: NOW, reader: chain.reader, limits: { samplePayers: 0 } });
    expect(counts).toMatchObject({ examined: 0, charged: 0 });
    expect((await rowOf(row.id)).status).toBe("unconfirmed");
  });

  it("looks at nothing but signed and unconfirmed rows", async () => {
    const chain = fakeChain();
    for (const status of ["reserved", "released", "settled", "paid_no_answer", "not_charged", "simulated"]) {
      const row = await openRow({ signedAt: ago(6) });
      await db.update(inferencePayments).set({ status }).where(eq(inferencePayments.id, row.id));
    }
    const counts = await reconcileInferencePayments({ now: NOW, reader: chain.reader, limits: { samplePayers: 0 } });
    expect(counts).toMatchObject({ examined: 0, charged: 0, notCharged: 0, stuck: 0 });
    expect(chain.calls).toHaveLength(0);
  });

  it("counts as stuck the rows it cannot look up: no memo, or too old", async () => {
    const chain = fakeChain();
    const noMemo = await openRow({ signedAt: ago(6), memo: null });
    const ancient = await openRow({ signedAt: new Date(NOW.getTime() - GIVE_UP_AFTER_MS - MINUTE) });
    chain.expire(ancient.blockhash);
    const counts = await reconcileInferencePayments({ now: NOW, reader: chain.reader, limits: { samplePayers: 0 } });
    expect(counts).toMatchObject({ examined: 0, stuck: 2, notCharged: 0 });
    // Both stay counted as charged.
    expect((await rowOf(noMemo.id)).status).toBe("unconfirmed");
    expect((await rowOf(ancient.id)).status).toBe("unconfirmed");
    expect(chain.calls).toHaveLength(0);
  });

  it("does not search for a memo too short to be the payment client's", async () => {
    const chain = fakeChain();
    const row = await openRow({ signedAt: ago(6), memo: "ab" });
    chain.expire(row.blockhash);
    // "ab" would match a great many unrelated memos; a match must not charge the row.
    chain.land(row.account, { memo: "cabbage", at: ago(5), tx: paymentTx({ payer: newAddress(), units: 5, memo: "cabbage" }) });
    const counts = await reconcileInferencePayments({ now: NOW, reader: chain.reader, limits: { samplePayers: 0 } });
    expect(counts).toMatchObject({ examined: 0, stuck: 1, charged: 0, notCharged: 0 });
    expect((await rowOf(row.id)).status).toBe("unconfirmed");
    expect(chain.calls).toHaveLength(0);
  });

  it("looks at a bounded number of rows per pass, newest first", async () => {
    const chain = fakeChain();
    const rows: Fixture[] = [];
    for (let n = 0; n < 5; n += 1) rows.push(await openRow({ signedAt: ago(10 + n) }));
    for (const row of rows) chain.expire(row.blockhash);
    const counts = await reconcileInferencePayments({ now: NOW, reader: chain.reader, limits: { rows: 2 } });
    expect(counts).toMatchObject({ examined: 2, notCharged: 2 });
    expect((await rowOf(rows[0].id)).status).toBe("not_charged");
    expect((await rowOf(rows[1].id)).status).toBe("not_charged");
    expect((await rowOf(rows[4].id)).status).toBe("unconfirmed");
    // The next pass reaches the ones behind them.
    expect((await reconcileInferencePayments({ now: NOW, reader: chain.reader, limits: { rows: 2 } })).notCharged).toBe(2);
  });

  it("makes a bounded number of RPC calls per pass", async () => {
    const chain = fakeChain();
    for (let n = 0; n < 6; n += 1) {
      const row = await openRow({ signedAt: ago(6 + n) });
      chain.expire(row.blockhash);
    }
    const counts = await reconcileInferencePayments({ now: NOW, reader: chain.reader, limits: { rpcCalls: 7 } });
    expect(chain.calls).toHaveLength(7);
    expect(counts.rpcCalls).toBe(7);
    // Each wallet needs four calls to prove absence; seven calls prove it for one.
    expect(counts).toMatchObject({ examined: 6, notCharged: 1, waiting: 5 });
  });

  it("starts no RPC call once its time is up", async () => {
    const chain = fakeChain();
    const row = await openRow({ signedAt: ago(6) });
    chain.expire(row.blockhash);
    const counts = await reconcileInferencePayments({ now: NOW, reader: chain.reader, limits: { deadlineMs: 0 } });
    expect(counts).toMatchObject({ examined: 1, waiting: 1, rpcCalls: 0 });
    expect(chain.calls).toHaveLength(0);
  });
});

describe("rows that were never signed", () => {
  it("releases a row left reserved by a dead process and returns its amount, with no chain at all", async () => {
    const chain = fakeChain();
    const stale = await openRow({ signedAt: new Date(NOW.getTime() - STALE_RESERVED_MS - MINUTE), quotedUsd: 0.04 });
    const fresh = await openRow({ signedAt: ago(3), quotedUsd: 0.03 });
    await db.update(inferencePayments).set({ status: "reserved", signedAt: null, memo: null, blockhash: null });

    const counts = await reconcileInferencePayments({ now: NOW, reader: chain.reader, limits: { samplePayers: 0 } });
    expect(counts).toMatchObject({ staleReleased: 1, examined: 0 });
    expect((await rowOf(stale.id)).status).toBe("released");
    expect((await rowOf(fresh.id)).status).toBe("reserved");
    expect(await heldUsd("agent", "agent-1")).toBe(0.03);
    expect(chain.calls).toHaveLength(0);
  });
});

describe("when the chain must not be touched", () => {
  it("makes no call in mock mode, and still releases rows that were never signed", async () => {
    vi.stubEnv("X402_MOCK", "1");
    const chain = fakeChain();
    const open = await openRow({ signedAt: ago(6) });
    chain.expire(open.blockhash);
    const stale = await openRow({ signedAt: ago(30) });
    await db.update(inferencePayments).set({ status: "reserved", signedAt: null, memo: null }).where(eq(inferencePayments.id, stale.id));

    const counts = await reconcileInferencePayments({ now: NOW, reader: chain.reader });
    expect(counts).toMatchObject({ skipped: "mock", staleReleased: 1, examined: 0, notCharged: 0, rpcCalls: 0 });
    expect(chain.calls).toHaveLength(0);
    expect((await rowOf(open.id)).status).toBe("unconfirmed");
  });

  it("makes no call, to any endpoint, without an RPC of our own", async () => {
    vi.stubEnv("X402_MOCK", "0");
    vi.stubEnv("SOLANA_RPC_URL", "");
    const fetched = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("the network must not be touched"));
    const open = await openRow({ signedAt: ago(6) });
    const counts = await reconcileInferencePayments({ now: NOW });
    expect(counts).toMatchObject({ skipped: "no_rpc", examined: 0, rpcCalls: 0 });
    expect(fetched).not.toHaveBeenCalled();
    expect((await rowOf(open.id)).status).toBe("unconfirmed");
  });

  it("with pay-per-use never used, reads no chain and writes nothing", async () => {
    // What every deployment looks like while INFERENCE_USDC is unset: an empty ledger.
    vi.stubEnv("INFERENCE_USDC", "");
    vi.stubEnv("X402_MOCK", "0");
    const chain = fakeChain();
    const counts = await reconcileInferencePayments({ now: NOW, reader: chain.reader });
    expect(counts).toEqual({
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
    });
    expect(chain.calls).toHaveLength(0);
    expect(await db.select().from(inferencePayments)).toHaveLength(0);
    expect(await db.select().from(inferenceBudgetDays)).toHaveLength(0);
    expect(await db.select().from(inferenceControl)).toHaveLength(0);
  });
});

describe("reading a transaction", () => {
  const payer = "PayerOwner";

  it("collects memos from instructions, inner instructions and logs", () => {
    const tx = {
      meta: {
        logMessages: ["Program log: something", 'Program log: Memo (len 4): "logd"'],
        innerInstructions: [{ instructions: [{ programId: "Memo1UhkJRfHyvLMcVucJwxXeuD728EV2ZqaNPZeLq", parsed: "inner" }] }],
      },
      transaction: { message: { instructions: [{ program: "spl-memo", parsed: "top" }, { program: "spl-token", parsed: { type: "transferChecked" } }] } },
    };
    expect(transactionMemos(tx)).toEqual(["top", "inner", 'Program log: Memo (len 4): "logd"']);
    expect(transactionMemos(null)).toEqual([]);
    expect(transactionMemos({ transaction: { message: { instructions: "nonsense" } } })).toEqual([]);
  });

  it("reads what moved from the balances before and after", () => {
    expect(usdcMovement(paymentTx({ payer, units: 12_345, memo: "m" }), { payer, payTo: PAY_TO, mint: MINT })).toEqual({
      failed: false,
      paid: BigInt(12_345),
      received: BigInt(12_345),
    });
  });

  it("reports nothing moved for a failed transaction, a missing one, another mint, or other owners", () => {
    const nothing = { paid: BigInt(0), received: BigInt(0) };
    expect(usdcMovement(paymentTx({ payer, units: 10, memo: "m", err: { any: 1 } }), { payer, payTo: PAY_TO, mint: MINT })).toEqual({ failed: true, ...nothing });
    expect(usdcMovement(null, { payer, payTo: PAY_TO, mint: MINT })).toEqual({ failed: true, ...nothing });
    expect(usdcMovement({}, { payer, payTo: PAY_TO, mint: MINT })).toEqual({ failed: true, ...nothing });
    expect(usdcMovement(paymentTx({ payer, units: 10, memo: "m", mint: "OtherMint" }), { payer, payTo: PAY_TO, mint: MINT })).toEqual({ failed: false, ...nothing });
    expect(usdcMovement(paymentTx({ payer: "Someone", payTo: "Else", units: 10, memo: "m" }), { payer, payTo: PAY_TO, mint: MINT })).toEqual({ failed: false, ...nothing });
  });

  it("counts an account opened in the transaction from zero, and never reports a gain as a payment", () => {
    const opened = {
      meta: {
        err: null,
        preTokenBalances: [{ mint: MINT, owner: payer, uiTokenAmount: { amount: "500" } }],
        postTokenBalances: [
          { mint: MINT, owner: payer, uiTokenAmount: { amount: "200" } },
          { mint: MINT, owner: PAY_TO, uiTokenAmount: { amount: "300" } },
        ],
      },
    };
    expect(usdcMovement(opened, { payer, payTo: PAY_TO, mint: MINT })).toEqual({ failed: false, paid: BigInt(300), received: BigInt(300) });
    // The other way round: the "payer" gained and the "recipient" lost.
    expect(usdcMovement(opened, { payer: PAY_TO, payTo: payer, mint: MINT })).toEqual({ failed: false, paid: BigInt(0), received: BigInt(0) });
  });

  it("turns a ledger amount into base units exactly", () => {
    expect(baseUnitsOf("0.010000")).toBe(BigInt(10_000));
    expect(baseUnitsOf("0.000001")).toBe(BigInt(1));
    expect(baseUnitsOf("12.3")).toBe(BigInt(12_300_000));
    expect(baseUnitsOf("7")).toBe(BigInt(7_000_000));
    expect(baseUnitsOf(0.25)).toBe(BigInt(250_000));
    expect(baseUnitsOf("0.1234567")).toBe(BigInt(123_456));
    expect(baseUnitsOf("not a number")).toBe(BigInt(0));
    expect(baseUnitsOf("-1")).toBe(BigInt(0));
  });

  it("derives the wallet's USDC account, and nothing for something that is not an address", () => {
    const owner = newAddress();
    expect(payerTokenAccount(owner, MINT)).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
    expect(payerTokenAccount(owner, MINT)).toBe(payerTokenAccount(owner, MINT));
    expect(payerTokenAccount(owner, MINT)).not.toBe(payerTokenAccount(newAddress(), MINT));
    expect(payerTokenAccount("not an address", MINT)).toBeNull();
  });
});

describe("createSolanaChainReader", () => {
  function rpc(answers: Record<string, unknown>) {
    const requests: Array<{ url: string; method: string; params: unknown[] }> = [];
    const fetchImpl = (async (url: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { method: string; params: unknown[] };
      requests.push({ url: String(url), method: body.method, params: body.params });
      const answer = answers[body.method];
      if (answer instanceof Response) return answer;
      return new Response(JSON.stringify(answer), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    return { requests, fetchImpl };
  }

  it("asks for an address's history at confirmed, with the paging and the minimum block it was given", async () => {
    const { requests, fetchImpl } = rpc({
      getSignaturesForAddress: {
        result: [
          { signature: "S1", slot: 9, err: null, memo: "[32] abc", blockTime: 1000 },
          { signature: "S2", slot: 8, err: { InstructionError: [0, "x"] }, memo: null, blockTime: null },
          { nonsense: true },
        ],
      },
    });
    const reader = createSolanaChainReader("https://rpc.example/own", fetchImpl);
    const entries = await reader.signaturesFor("Addr", { limit: 50, before: "S0", minContextSlot: 77 });
    expect(entries).toEqual([
      { signature: "S1", slot: 9, err: null, memo: "[32] abc", blockTime: 1000 },
      { signature: "S2", slot: 8, err: { InstructionError: [0, "x"] }, memo: null, blockTime: null },
    ]);
    expect(requests).toEqual([
      { url: "https://rpc.example/own", method: "getSignaturesForAddress", params: ["Addr", { limit: 50, commitment: "confirmed", before: "S0", minContextSlot: 77 }] },
    ]);
  });

  it("judges a blockhash at finalized and reports the block it judged from", async () => {
    const { requests, fetchImpl } = rpc({ isBlockhashValid: { result: { context: { slot: 4242 }, value: false } }, getBlockTime: { result: 1_900_000_000 } });
    const reader = createSolanaChainReader("https://rpc.example/own", fetchImpl);
    expect(await reader.blockhashValid("Hash")).toEqual({ valid: false, slot: 4242 });
    expect(await reader.blockTime(4242)).toBe(1_900_000_000);
    expect(requests[0].params).toEqual(["Hash", { commitment: "finalized" }]);
    expect(requests[1].params).toEqual([4242]);
  });

  it("refuses an answer that is not a verdict rather than reading it as one", async () => {
    const { fetchImpl } = rpc({ isBlockhashValid: { result: { context: {}, value: "no" } }, getSignaturesForAddress: { result: { not: "a list" } } });
    const reader = createSolanaChainReader("https://rpc.example/own", fetchImpl);
    await expect(reader.blockhashValid("Hash")).rejects.toThrow(/no verdict/);
    await expect(reader.signaturesFor("Addr", { limit: 1 })).rejects.toThrow(/no list/);
  });

  it("returns null for a transaction the node does not have", async () => {
    const { requests, fetchImpl } = rpc({ getTransaction: { result: null } });
    const reader = createSolanaChainReader("https://rpc.example/own", fetchImpl);
    expect(await reader.transaction("Sig")).toBeNull();
    expect(requests[0].params).toEqual(["Sig", { encoding: "jsonParsed", maxSupportedTransactionVersion: 0, commitment: "confirmed" }]);
  });

  it("throws on an HTTP error or an RPC error, without the endpoint or its key in the message", async () => {
    // Built at run time: the shape of a provider key in a URL, not a real one.
    const key = ["k", "e", "y"].join("") + "1234567890abcdef";
    const url = `https://rpc.example/?api-key=${key}`;
    vi.stubEnv("SOLANA_RPC_URL", url);
    const down = createSolanaChainReader(url, (async () => new Response("nope", { status: 503 })) as typeof fetch);
    await expect(down.blockTime(1)).rejects.toThrow("Solana RPC getBlockTime failed: HTTP 503");

    const leaky = createSolanaChainReader(url, (async () => {
      throw new Error(`connect ECONNREFUSED ${url}`);
    }) as typeof fetch);
    const failure = await leaky.blockTime(1).catch((err: Error) => err.message);
    expect(failure).toContain("Solana RPC getBlockTime failed");
    expect(failure).not.toContain(key);

    const { fetchImpl } = rpc({ getBlockTime: { error: { code: -32004, message: `Block not available, see ${url}` } } });
    const refused = await createSolanaChainReader(url, fetchImpl).blockTime(1).catch((err: Error) => err.message);
    expect(refused).toContain("Block not available");
    expect(refused).not.toContain(key);
  });
});

describe("readGatewayPayments", () => {
  it("lists every transfer from the wallet to the gateway in the window, and nothing else", async () => {
    const chain = fakeChain();
    const payer = newAddress();
    const account = payerTokenAccount(payer, MINT)!;
    const first = chain.land(account, { memo: "a".repeat(32), at: ago(50), tx: paymentTx({ payer, units: 10_000, memo: "a".repeat(32) }) });
    // A node that reports no memo: it is read from the transaction.
    const second = chain.land(account, { memo: "b".repeat(32), reportedMemo: null, at: ago(20), tx: paymentTx({ payer, units: 25_000, memo: "b".repeat(32) }) });
    chain.land(account, { reportedMemo: null, at: ago(15), tx: paymentTx({ payer, payTo: newAddress(), units: 3_000_000, memo: null }) }); // a swap
    chain.land(account, { memo: "c".repeat(32), at: ago(10), err: { InstructionError: [2, "Custom"] } }); // failed: moved nothing
    chain.land(account, { memo: "d".repeat(32), at: ago(5), tx: paymentTx({ payer: newAddress(), payTo: payer, units: 1_000_000, memo: null }) }); // a deposit

    const read = await readGatewayPayments(chain.reader, payer, ago(60));
    expect(read.complete).toBe(true);
    expect(read.transactionsRead).toBe(4);
    expect(read.payments.map((payment) => [payment.signature, payment.paid])).toEqual([
      [second, BigInt(25_000)],
      [first, BigInt(10_000)],
    ]);
    expect(read.payments[0].memoText).toContain("b".repeat(32));
    expect(read.payments[1].memoText).toContain("a".repeat(32));
    // It only ever asks, never sends: the reader has no way to.
    expect(new Set(chain.calls.map((call) => call.method))).toEqual(new Set(["signaturesFor", "transaction"]));
  });

  it("leaves out what landed before the window", async () => {
    const chain = fakeChain();
    const payer = newAddress();
    const account = payerTokenAccount(payer, MINT)!;
    chain.land(account, { memo: "a".repeat(32), at: ago(90), tx: paymentTx({ payer, units: 10_000, memo: "a".repeat(32) }) });
    const inside = chain.land(account, { memo: "b".repeat(32), at: ago(30), tx: paymentTx({ payer, units: 20_000, memo: "b".repeat(32) }) });
    const read = await readGatewayPayments(chain.reader, payer, ago(60));
    expect(read.payments.map((payment) => payment.signature)).toEqual([inside]);
    expect(read.complete).toBe(true);
    expect(read.transactionsRead).toBe(1);
  });

  it("says so when it could not read the whole window", async () => {
    const chain = fakeChain();
    const payer = newAddress();
    const account = payerTokenAccount(payer, MINT)!;
    for (let n = 0; n < 5; n += 1) chain.land(account, { memo: `m${n}`, at: ago(10 + n), tx: paymentTx({ payer, units: 1000, memo: `m${n}` }) });

    expect((await readGatewayPayments(chain.reader, payer, ago(60), { pages: 2, pageSize: 2 })).complete).toBe(false);
    const capped = await readGatewayPayments(chain.reader, payer, ago(60), { transactions: 3 });
    expect(capped).toMatchObject({ complete: false, transactionsRead: 3 });
    expect(capped.payments).toHaveLength(3);

    const unread = chain.land(account, { memo: "gone", at: ago(2) });
    expect(chain.transactions.has(unread)).toBe(false);
    expect((await readGatewayPayments(chain.reader, payer, ago(60))).complete).toBe(false);
  });

  it("throws on an address that is not one, and passes an RPC failure on", async () => {
    const chain = fakeChain();
    await expect(readGatewayPayments(chain.reader, "not an address", ago(60))).rejects.toThrow(/not a Solana address/);
    chain.failing.add("signaturesFor");
    await expect(readGatewayPayments(chain.reader, newAddress(), ago(60))).rejects.toThrow(/rpc down/);
    expect(chain.count("transaction")).toBe(0);
  });
});

describe("compareLedgerWithChain", () => {
  const row = (overrides: Partial<Parameters<typeof compareLedgerWithChain>[0][number]>) => ({
    id: "row",
    status: "settled",
    quotedUsd: "0.010000",
    settledUsd: null,
    memo: "aa".repeat(16),
    txHash: null,
    ...overrides,
  });
  const payment = (overrides: Partial<Parameters<typeof compareLedgerWithChain>[1][number]>) => ({
    signature: "Sig",
    paid: BigInt(10_000),
    memoText: `[32] ${"aa".repeat(16)}`,
    blockTime: 1,
    ...overrides,
  });

  it("finds no difference when every charged row has its transfer and every transfer its row", () => {
    const result = compareLedgerWithChain(
      [row({ id: "a" }), row({ id: "b", status: "paid_no_answer", memo: "bb".repeat(16), quotedUsd: "0.020000" }), row({ id: "c", status: "released", memo: null })],
      [payment({ signature: "S1" }), payment({ signature: "S2", memoText: `[32] ${"bb".repeat(16)}`, paid: BigInt(20_000) })],
    );
    expect(result.differences).toEqual([]);
    expect(result.ledgerChargedUnits).toBe(BigInt(30_000));
    expect(result.chainPaidUnits).toBe(BigInt(30_000));
  });

  it("names a transfer no row accounts for", () => {
    const result = compareLedgerWithChain([row({ id: "a" })], [payment({ signature: "S1" }), payment({ signature: "S2", memoText: "[32] unknown", paid: BigInt(5) })]);
    expect(result.differences).toEqual([expect.objectContaining({ kind: "on_chain_not_in_ledger", signature: "S2", rowId: null })]);
    expect(result.chainPaidUnits - result.ledgerChargedUnits).toBe(BigInt(5));
  });

  it("names a charged row with no transfer, and one whose amount differs", () => {
    const result = compareLedgerWithChain(
      [row({ id: "missing", memo: "cc".repeat(16) }), row({ id: "differs", settledUsd: "0.012000" })],
      [payment({ signature: "S1", paid: BigInt(10_000) })],
    );
    expect(result.differences.map((difference) => [difference.kind, difference.rowId])).toEqual([
      ["ledger_charged_not_on_chain", "missing"],
      ["amount_differs", "differs"],
    ]);
  });

  it("names a row the ledger gave back that the chain shows paid", () => {
    const result = compareLedgerWithChain([row({ id: "wrong", status: "not_charged" })], [payment({ signature: "S1" })]);
    expect(result.differences).toEqual([expect.objectContaining({ kind: "ledger_not_charged_but_on_chain", rowId: "wrong", signature: "S1" })]);
    expect(result.ledgerChargedUnits).toBe(BigInt(0));
  });

  it("reports open rows either way, and counts them as charged", () => {
    const result = compareLedgerWithChain(
      [row({ id: "landed", status: "unconfirmed" }), row({ id: "nowhere", status: "signed", memo: "dd".repeat(16) })],
      [payment({ signature: "S1" })],
    );
    expect(result.differences.map((difference) => [difference.kind, difference.rowId, difference.signature])).toEqual([
      ["open", "landed", "S1"],
      ["open", "nowhere", null],
    ]);
    expect(result.ledgerChargedUnits).toBe(BigInt(20_000));
  });

  it("matches a row by the transaction id it recorded when it has no memo, and one transfer to one row only", () => {
    const byHash = compareLedgerWithChain([row({ id: "a", memo: null, txHash: "S1" })], [payment({ signature: "S1", memoText: "" })]);
    expect(byHash.differences).toEqual([]);
    // Two rows cannot both be paid by the same transfer.
    const twice = compareLedgerWithChain([row({ id: "a" }), row({ id: "b" })], [payment({ signature: "S1" })]);
    expect(twice.differences).toEqual([expect.objectContaining({ kind: "ledger_charged_not_on_chain", rowId: "b" })]);
  });

  it("leaves simulated and never-signed rows out of it", () => {
    const result = compareLedgerWithChain([row({ id: "sim", status: "simulated" }), row({ id: "res", status: "reserved", memo: null })], []);
    expect(result).toEqual({ differences: [], ledgerChargedUnits: BigInt(0), chainPaidUnits: BigInt(0) });
  });
});
