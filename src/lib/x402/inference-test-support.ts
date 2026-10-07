/**
 * Shared by the pay-per-use tests: recorded 402s, an in-memory ledger, a wallet made at
 * run time, a stand-in for the Solana RPC, and a payment transaction builder.
 *
 * Nothing here can pay. The keys are generated in the test process and hold nothing; the
 * "network" is whatever function a test hands in. The 402 bodies are public data,
 * recorded from unpaid requests on 2026-10-06.
 */
import { base58 } from "@scure/base";
import {
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { encodePaymentRequiredHeader } from "@x402/core/http";
import type { PaymentRequired } from "@x402/core/types";
import { COMPUTE_BUDGET_PROGRAM, MEMO_PROGRAM, SPL_TOKEN_PROGRAM, usdcAccountOf } from "./inference-pins";
import {
  INFERENCE_GATEWAY,
  type InferenceCaps,
  type InferenceLedger,
  type InferencePayContext,
  type InferencePaymentStatus,
  type InferenceReserveInput,
  type InferenceReserveResult,
  type InferenceStopReason,
  newPayCounters,
} from "./inference-types";

// ---------- recorded 402s ----------

const SOLANA = INFERENCE_GATEWAY.solana;

/** The two fee payers BlockRun's Solana gateway alternates between. */
export const BLOCKRUN_FEE_PAYERS = [
  "93syNmtT1tTd5ZtPwHqzGf6CM7fKhMmArpv4AM4FtyNX",
  "2wKupLR9q6wXYppw8Gr2NvWxKBUqm4PPJKkQfoxHDBg4",
] as const;

/**
 * BlockRun, Solana host, `anthropic/claude-haiku-4.5`, a 24,000-character prompt with 12
 * tools, `max_tokens` 1024. The capture trimmed a few long fields; they are filled here
 * from the same response (the mint and pay-to it repeats), and the `bazaar` extension is
 * cut to a stub.
 */
export function blockrunSolana402(): PaymentRequired {
  return {
    x402Version: 2,
    resource: {
      url: "https://sol.blockrun.ai/api/v1/chat/completions",
      description: "Claude Haiku 4.5 API call (~11566 input, 1024 max output tokens)",
      mimeType: "application/json",
    },
    accepts: [
      {
        scheme: "exact",
        network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
        amount: "11961",
        payTo: "AQqnMFBwGZEoti85aTVRy8XYpKrho7GaMDx9ZB3CEeKA",
        maxTimeoutSeconds: 300,
        asset: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        extra: {
          feePayer: "93syNmtT1tTd5ZtPwHqzGf6CM7fKhMmArpv4AM4FtyNX",
          description: "Claude Haiku 4.5 API call (~11566 input, 1024 max output tokens)",
          mimeType: "application/json",
          resource: "https://sol.blockrun.ai/api/v1/chat/completions",
          recentBlockhash: "2Etc9q7omPrAu16uFNbM3fwUH7ygCFKkToN4YCXym1nK",
          lastValidBlockHeight: "431992176",
        },
      },
      {
        scheme: "batch-settlement",
        network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
        amount: "16686",
        asset: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        payTo: "AQqnMFBwGZEoti85aTVRy8XYpKrho7GaMDx9ZB3CEeKA",
        maxTimeoutSeconds: 3600,
        extra: {
          minDeposit: "50058",
          feePayer: "2wKupLR9q6wXYppw8Gr2NvWxKBUqm4PPJKkQfoxHDBg4",
          experimental: true,
          batchPolicy: { minInitialDeposit: "10000", maxInitialDeposit: "100000000", maxWithdrawDelay: 86400 },
          withdrawDelay: 86400,
          receiverAuthorizer: "5YKPQUFjw5WQqhSUkEGKNNfYYVqnRRNbpYyL71qQ1vm3",
          operator: "5YKPQUFjw5WQqhSUkEGKNNfYYVqnRRNbpYyL71qQ1vm3",
          voucherSigner: "server",
        },
      },
    ],
    error: "Payment required",
    extensions: { bazaar: { info: { trimmed: true } } },
  };
}

/**
 * BlockRun, Solana host, `openai/gpt-4o-mini`, one short message, `max_tokens` 16: the
 * gateway's floor price. The `exact` offer is verbatim; the other fee payer signed it.
 */
export function blockrunSolanaSmall402(): PaymentRequired {
  return {
    x402Version: 2,
    resource: {
      url: "https://sol.blockrun.ai/api/v1/chat/completions",
      description: "GPT-4o Mini API call (~17 input, 16 max output tokens)",
      mimeType: "application/json",
    },
    accepts: [
      {
        scheme: "exact",
        network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
        amount: "1000",
        payTo: "AQqnMFBwGZEoti85aTVRy8XYpKrho7GaMDx9ZB3CEeKA",
        maxTimeoutSeconds: 300,
        asset: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        extra: {
          feePayer: "93syNmtT1tTd5ZtPwHqzGf6CM7fKhMmArpv4AM4FtyNX",
          description: "GPT-4o Mini API call (~17 input, 16 max output tokens)",
          mimeType: "application/json",
          resource: "https://sol.blockrun.ai/api/v1/chat/completions",
          recentBlockhash: "7Fy41AwHz9RSnHpXFuoawWo3ZBox49MqZL7LDweh3oZD",
          lastValidBlockHeight: "431992830",
        },
      },
      {
        scheme: "batch-settlement",
        network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
        amount: "1000",
        asset: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        payTo: "AQqnMFBwGZEoti85aTVRy8XYpKrho7GaMDx9ZB3CEeKA",
        maxTimeoutSeconds: 3600,
        extra: { experimental: true, minDeposit: "10000" },
      },
    ],
    error: "Payment required",
  };
}

/** BlockRun, Base host, the same request: `exact` and `upto`, both on Base. Verbatim body. */
export function blockrunBase402(): Record<string, unknown> {
  return {
    x402Version: 2,
    accepts: [
      {
        scheme: "exact",
        network: "eip155:8453",
        amount: "13081",
        asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        payTo: "0xe9030014F5DAe217d0A152f02A043567b16c1aBf",
        maxTimeoutSeconds: 300,
        extra: { name: "USD Coin", version: "2" },
      },
      {
        scheme: "upto",
        network: "eip155:8453",
        amount: "17686",
        asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        payTo: "0xe9030014F5DAe217d0A152f02A043567b16c1aBf",
        maxTimeoutSeconds: 300,
        extra: { name: "USD Coin", version: "2", facilitatorAddress: "0x14fDa13953Fc30428938E6BF950d036e77214e52" },
      },
    ],
    error: "Payment Required",
    message: "This endpoint requires x402 payment",
    price: { amount: "0.017686", currency: "USD" },
    paymentInfo: { network: "base", asset: "USDC", x402Version: 2 },
  };
}

/** Another gateway (tx402.ai): `exact` in real USDC on Solana mainnet, to its own treasury. Trimmed. */
export function otherGateway402(): Record<string, unknown> {
  return {
    x402Version: 2,
    resource: { url: "https://tx402.ai/v1/chat/completions", description: "minimax/minimax-m3 inference" },
    accepts: [
      {
        scheme: "exact",
        network: "eip155:8453",
        asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        amount: "6935",
        payTo: "0x26338aD8Ef7DA7DBaEeCE6e16aBd916Baf132223",
        maxTimeoutSeconds: 300,
        extra: { name: "USD Coin", version: "2" },
      },
      {
        scheme: "exact",
        network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
        asset: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        amount: "6935",
        payTo: "SoRaFGuCpgBqpXJ6KKeA5cx6zZZpUwaBKQzt7nsy5yq",
        maxTimeoutSeconds: 300,
        extra: { feePayer: "2wKupLR9q6wXYppw8Gr2NvWxKBUqm4PPJKkQfoxHDBg4" },
      },
    ],
  };
}

/** A third gateway (BridgeNode): it dictates the memo and pays its own fees. Trimmed. */
export function memoGateway402(): Record<string, unknown> {
  return {
    x402Version: 2,
    error: "PAYMENT-SIGNATURE header is required",
    accepts: [
      {
        scheme: "exact",
        network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
        asset: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        amount: "2000",
        payTo: "BHMDv3ri3LBEZjEzJgDZeUiguVX7LmsCstTXbM3dL8rN",
        maxTimeoutSeconds: 30,
        extra: { memo: "pi_0b8e", lastValidBlockHeight: "431995305", feePayer: "BHMDv3ri3LBEZjEzJgDZeUiguVX7LmsCstTXbM3dL8rN" },
      },
    ],
  };
}

/** The 402 as the gateway sends it: the requirements in the header, mirrored in the body. */
export function quoteResponse(paymentRequired: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(paymentRequired), {
    status: 402,
    headers: {
      "content-type": "application/json",
      "payment-required": encodePaymentRequiredHeader(paymentRequired as PaymentRequired),
      "x-blockrun-gateway-request-id": "req-test-1",
      ...headers,
    },
  });
}

/** A chat completion the way an OpenAI-compatible gateway answers. */
export function completionResponse(
  overrides: { status?: number; headers?: Record<string, string>; body?: unknown } = {},
): Response {
  const body = overrides.body ?? {
    id: "chatcmpl-test",
    object: "chat.completion",
    model: "anthropic/claude-haiku-4.5",
    choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
    usage: { prompt_tokens: 120, completion_tokens: 7, total_tokens: 127 },
  };
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status: overrides.status ?? 200,
    headers: { "content-type": "application/json", ...(overrides.headers ?? {}) },
  });
}

// ---------- an in-memory ledger ----------

export interface FakeLedgerRow {
  id: string;
  status: InferencePaymentStatus;
  input: InferenceReserveInput;
  memo: string | null;
  blockhash: string | null;
  payerSignature: string | null;
  detail: string | null;
  txHash: string | null;
  settledUsd: number | null;
  servedModel: string | null;
  httpStatus: number | null;
  gatewayRequestId: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
}

type LedgerMethod = keyof InferenceLedger;

/**
 * The ledger's contract, held in a map. `refuse` makes the next reserve refuse with a
 * reason; `failing` makes a method throw, the way a database that cannot be reached
 * does. `events` is every call in order, which is how a test proves what happened
 * before what.
 */
export class FakeLedger implements InferenceLedger {
  rows = new Map<string, FakeLedgerRow>();
  events: string[] = [];
  refuse: InferenceStopReason | null = null;
  failing = new Set<LedgerMethod>();
  /** Runs inside `reserve`, before it answers. For tests that need something to happen mid-reserve. */
  duringReserve: (() => void | Promise<void>) | null = null;
  /**
   * Runs inside `markSigned`, before the row moves: a ledger that is slow to answer, or
   * a clock that moves while it writes. A promise that never resolves is a ledger that
   * never answers.
   */
  duringMarkSigned: (() => void | Promise<void>) | null = null;
  /** Called on every event, so a test can record sends and ledger writes on one timeline. */
  onEvent: ((event: string) => void) | null = null;
  private next = 1;

  private note(event: string): void {
    this.events.push(event);
    this.onEvent?.(event);
  }

  private check(method: LedgerMethod): void {
    if (this.failing.has(method)) throw new Error(`Failed query: update "inference_payments" set ... params: secret-param`);
  }

  row(id: string): FakeLedgerRow {
    const row = this.rows.get(id);
    if (!row) throw new Error(`no row ${id}`);
    return row;
  }

  get only(): FakeLedgerRow {
    if (this.rows.size !== 1) throw new Error(`expected one row, found ${this.rows.size}`);
    return [...this.rows.values()][0];
  }

  async reserve(input: InferenceReserveInput): Promise<InferenceReserveResult> {
    this.note("reserve");
    await this.duringReserve?.();
    this.check("reserve");
    if (this.refuse) return { ok: false, reason: this.refuse };
    const id = `pay_${this.next++}`;
    this.rows.set(id, {
      id,
      status: input.simulated ? "simulated" : "reserved",
      input,
      memo: null,
      blockhash: null,
      payerSignature: null,
      detail: null,
      txHash: null,
      settledUsd: null,
      servedModel: null,
      httpStatus: null,
      gatewayRequestId: null,
      inputTokens: null,
      outputTokens: null,
    });
    return { ok: true, paymentId: id, budgetDay: input.now.toISOString().slice(0, 10) };
  }

  async release(paymentId: string, detail: string): Promise<void> {
    this.note("release");
    this.check("release");
    const row = this.row(paymentId);
    // Before any signature only, as the real ledger has it.
    if (row.status !== "reserved") return;
    row.status = "released";
    row.detail = detail;
  }

  async markSigned(
    paymentId: string,
    signed: { memo: string | null; blockhash: string | null; payerSignature: string | null },
  ): Promise<void> {
    this.note("markSigned");
    await this.duringMarkSigned?.();
    this.check("markSigned");
    const row = this.row(paymentId);
    if (row.status !== "reserved") throw new Error(`markSigned on a ${row.status} row`);
    Object.assign(row, { status: "signed", ...signed });
  }

  async settle(
    paymentId: string,
    result: {
      txHash: string | null;
      settledUsd: number;
      servedModel: string | null;
      httpStatus: number;
      gatewayRequestId: string | null;
      inputTokens: number | null;
      outputTokens: number | null;
    },
  ): Promise<void> {
    this.note("settle");
    this.check("settle");
    const row = this.row(paymentId);
    // A simulated row keeps its status and takes the answer's details, as the real ledger has it.
    if (row.status === "simulated") {
      Object.assign(row, { ...result, settledUsd: row.settledUsd });
      return;
    }
    if (row.status !== "signed") throw new Error(`settle on a ${row.status} row`);
    Object.assign(row, { status: "settled", ...result });
  }

  async markPaidNoAnswer(paymentId: string, result: { txHash: string | null; httpStatus: number | null; detail: string }): Promise<void> {
    this.note("markPaidNoAnswer");
    this.check("markPaidNoAnswer");
    const row = this.row(paymentId);
    if (row.status !== "signed") throw new Error(`markPaidNoAnswer on a ${row.status} row`);
    Object.assign(row, { status: "paid_no_answer", ...result });
  }

  async markUnconfirmed(paymentId: string, result: { httpStatus: number | null; detail: string }): Promise<void> {
    this.note("markUnconfirmed");
    this.check("markUnconfirmed");
    const row = this.row(paymentId);
    if (row.status !== "signed") throw new Error(`markUnconfirmed on a ${row.status} row`);
    Object.assign(row, { status: "unconfirmed", ...result });
  }
}

export const TEST_CAPS: InferenceCaps = {
  stepUsd: 0.25,
  runUsd: 0.3,
  agentDayUsd: 3,
  ownerDayUsd: 25,
  platformDayUsd: 2,
  agentDayRequests: 600,
  maxRequestsPerRun: 21,
};

/** A run's pay context around a ledger and a wallet address, with plenty of time left. */
export function payContext(
  ledger: InferenceLedger,
  payerAddress: string,
  overrides: Partial<InferencePayContext> = {},
): InferencePayContext {
  return {
    ownerId: "owner_1",
    agentId: "agent_1",
    runId: "run_1",
    model: "anthropic/claude-haiku-4.5",
    chain: "solana",
    payer: { walletId: "wallet_1", address: payerAddress },
    caps: { ...TEST_CAPS },
    deadlineAt: Date.now() + 240_000,
    ledger,
    ...newPayCounters(),
    ...overrides,
  };
}

/** The request an AI SDK provider makes: a URL string, a JSON string body, a bearer header, a signal. */
export function chatRequest(
  overrides: { model?: string; body?: Record<string, unknown>; signal?: AbortSignal; headers?: Record<string, string> } = {},
): [string, RequestInit] {
  const body = {
    model: overrides.model ?? "anthropic/claude-haiku-4.5",
    messages: [
      { role: "system", content: "You are a careful trading agent." },
      { role: "user", content: "x".repeat(24_000) },
    ],
    temperature: 0.2,
    max_completion_tokens: 9000,
    tools: [{ type: "function", function: { name: "finish", parameters: { type: "object" } } }],
    ...(overrides.body ?? {}),
  };
  return [
    SOLANA.url,
    {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer x402", ...(overrides.headers ?? {}) },
      body: JSON.stringify(body),
      ...(overrides.signal ? { signal: overrides.signal } : {}),
    },
  ];
}

// ---------- a stand-in for the Solana RPC ----------

export const TEST_RPC_URL = "https://rpc.test.invalid";

/**
 * What the x402 Solana scheme asks the RPC for: the USDC mint account, to learn which
 * token program owns it and how many decimals it has. Returns `null` for any other
 * request, so a test can fail on a call it did not expect.
 */
export function mintRpcAnswer(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  overrides: { decimals?: number; owner?: string } = {},
): Response | null {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (!url.startsWith(TEST_RPC_URL) || typeof init?.body !== "string") return null;
  const request = JSON.parse(init.body) as { id: unknown; method: string };
  if (request.method !== "getAccountInfo") return null;
  // An SPL mint account is 82 bytes: decimals at offset 44, the initialized flag at 45.
  const data = Buffer.alloc(82);
  data.writeUInt32LE(1, 0);
  data.writeBigUInt64LE(BigInt(1_000_000_000), 36);
  data[44] = overrides.decimals ?? 6;
  data[45] = 1;
  return new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      id: request.id,
      result: {
        context: { slot: 1 },
        value: {
          data: [data.toString("base64"), "base64"],
          executable: false,
          lamports: 1_461_600,
          owner: overrides.owner ?? SPL_TOKEN_PROGRAM,
          rentEpoch: 0,
          space: 82,
        },
      },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

// ---------- payment transactions, built by hand ----------

export const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
export const USDT_MINT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";

export function transferChecked(input: {
  program?: string;
  source: string;
  mint: string;
  destination: string;
  authority: string;
  amount: bigint;
  decimals?: number;
  tag?: number;
  extraSigner?: string;
}): TransactionInstruction {
  const data = Buffer.alloc(10);
  data[0] = input.tag ?? 12;
  data.writeBigUInt64LE(input.amount, 1);
  data[9] = input.decimals ?? 6;
  return new TransactionInstruction({
    programId: new PublicKey(input.program ?? SPL_TOKEN_PROGRAM),
    keys: [
      { pubkey: new PublicKey(input.source), isSigner: false, isWritable: true },
      { pubkey: new PublicKey(input.mint), isSigner: false, isWritable: false },
      { pubkey: new PublicKey(input.destination), isSigner: false, isWritable: true },
      { pubkey: new PublicKey(input.authority), isSigner: true, isWritable: false },
      ...(input.extraSigner ? [{ pubkey: new PublicKey(input.extraSigner), isSigner: true, isWritable: false }] : []),
    ],
    data,
  });
}

export function memoInstruction(text: string, signer?: string): TransactionInstruction {
  return new TransactionInstruction({
    programId: new PublicKey(MEMO_PROGRAM),
    keys: signer ? [{ pubkey: new PublicKey(signer), isSigner: true, isWritable: false }] : [],
    data: Buffer.from(text, "utf8"),
  });
}

export function computeBudgetInstruction(data: number[]): TransactionInstruction {
  return new TransactionInstruction({ programId: new PublicKey(COMPUTE_BUDGET_PROGRAM), keys: [], data: Buffer.from(data) });
}

export function lamportTransfer(from: string, to: string, lamports: number): TransactionInstruction {
  return SystemProgram.transfer({ fromPubkey: new PublicKey(from), toPubkey: new PublicKey(to), lamports });
}

export const TEST_MEMO = "0123456789abcdef0123456789abcdef";
export const TEST_BLOCKHASH = "2Etc9q7omPrAu16uFNbM3fwUH7ygCFKkToN4YCXym1nK";

/**
 * The payment the x402 Solana scheme builds, instruction for instruction, made here with
 * a different library so the verifier is checked against something it did not produce.
 * `instructions` replaces the whole list, for building the wrong transaction on purpose.
 */
export function buildPayment(input: {
  payer: Keypair;
  feePayer?: string;
  payTo?: string;
  amount?: bigint;
  memo?: string;
  instructions?: TransactionInstruction[];
  /** Who signs. Defaults to the payer; `[]` leaves the transaction unsigned. */
  signers?: Keypair[];
  blockhash?: string;
}): { transaction: string; tx: VersionedTransaction } {
  const payer = input.payer.publicKey.toBase58();
  const feePayer = input.feePayer ?? BLOCKRUN_FEE_PAYERS[0];
  const payTo = input.payTo ?? SOLANA.payTo[0];
  const instructions = input.instructions ?? [
    ComputeBudgetProgram.setComputeUnitLimit({ units: 20_000 }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1 }),
    transferChecked({
      source: usdcAccountOf(payer),
      mint: SOLANA.asset,
      destination: usdcAccountOf(payTo),
      authority: payer,
      amount: input.amount ?? BigInt(11_961),
    }),
    memoInstruction(input.memo ?? TEST_MEMO),
  ];
  const message = new TransactionMessage({
    payerKey: new PublicKey(feePayer),
    recentBlockhash: input.blockhash ?? TEST_BLOCKHASH,
    instructions,
  }).compileToV0Message();
  const tx = new VersionedTransaction(message);
  const signers = input.signers ?? [input.payer];
  if (signers.length > 0) tx.sign(signers);
  return { transaction: Buffer.from(tx.serialize()).toString("base64"), tx };
}

/**
 * The id a payment has on chain: its fee payer's signature over the message, which the
 * gateway adds before it settles. `feePayer` is a key the test made, standing in for the
 * gateway's, so a test can hand back the receipt a real settlement would carry. The
 * transaction itself is left as it was.
 */
export function transactionIdOf(transaction: string, feePayer: Keypair): string {
  const tx = VersionedTransaction.deserialize(Uint8Array.from(Buffer.from(transaction, "base64")));
  tx.sign([feePayer]);
  return base58.encode(tx.signatures[0]);
}

export { Keypair };
