/**
 * Pay-per-use thinking: the checks that decide what may be paid. Pure.
 *
 * Three questions are answered here, each before money can move, and none of them by
 * trusting the gateway:
 *
 *  1. Is this request the one we mean to buy? ({@link guardInferenceBody}) The model is
 *     the agent's own, the answer is capped at the size the quote is priced on, and
 *     nothing is streamed.
 *  2. Is this 402 asking to be paid the way we pay? ({@link pinInferenceRequirement})
 *     Scheme `exact`, Solana mainnet, real USDC, the gateway's published pay-to, a fee
 *     payer that is not the agent, and no memo of the gateway's choosing. The pins are
 *     constants in `inference-types.ts`; the 402 is only ever compared against them.
 *  3. Is the transaction the wallet signed the payment we priced? ({@link verifySignedPayment})
 *     The bytes are decoded again, with a different library from the one that built
 *     them, and must hold exactly one USDC transfer of the quoted amount from the
 *     agent's token account to the pay-to's, one memo, compute-budget settings, and
 *     nothing else.
 *
 * Every function returns a verdict instead of throwing, and its `reason` is for a log or
 * a ledger row. A reason can quote a few characters of what the gateway sent, so the
 * caller passes it through `redactSecrets` like any other outside text.
 *
 * No database, no network, no signer and no secret is reachable from this file, which is
 * why `scripts/inference-quote.ts` can import it and still be unable to pay.
 */
import { createHash, createPublicKey, verify } from "node:crypto";
import { base58 } from "@scure/base";
import { PublicKey, VersionedTransaction } from "@solana/web3.js";
import { decodePaymentRequiredHeader } from "@x402/core/http";
import type { PaymentRequired, PaymentRequirements } from "@x402/core/types";
import { INFERENCE_GATEWAY, INFERENCE_MAX_OUTPUT_TOKENS, roundUsd, type InferenceChain } from "./inference-types";

// ---------- the programs a payment may touch ----------

/**
 * The only programs a payment transaction may call. USDC lives on the original SPL
 * Token program, so Token-2022 is not on the list: a transfer through it would be a
 * transfer of some other token.
 */
export const SPL_TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export const ASSOCIATED_TOKEN_PROGRAM = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
export const MEMO_PROGRAM = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";
export const COMPUTE_BUDGET_PROGRAM = "ComputeBudget111111111111111111111111111111";

/** `TransferChecked` on the SPL Token program: one byte of tag, a u64 amount, one byte of decimals. */
const TRANSFER_CHECKED_TAG = 12;
const TRANSFER_CHECKED_BYTES = 10;
/** Compute-budget instructions the payment may carry: the unit limit and the unit price. */
const SET_COMPUTE_UNIT_LIMIT_TAG = 2;
const SET_COMPUTE_UNIT_PRICE_TAG = 3;

/**
 * The memo the x402 client writes when the seller names none: 16 random bytes in hex.
 * The reconciler finds a payment on chain by this memo, so a memo of any other shape
 * (empty, short, or chosen by somebody else) is a payment that could not be told apart
 * from another one, and is refused before it is sent.
 */
const MEMO_NONCE = /^[0-9a-f]{32}$/;

// ---------- 1. the request ----------

/** A request body larger than this is not sent. The whole prompt is in it. */
export const INFERENCE_MAX_REQUEST_BYTES = 1_000_000;

export type GuardedBody =
  | {
      ok: true;
      /** The body to send, on both legs: the caller's, with the output cap forced. */
      body: string;
      /** sha256 of `body`, hex. The ledger keeps this, never the body. */
      requestHash: string;
      /** What the gateway's price is built from: characters of message content, and messages. */
      contentChars: number;
      messages: number;
    }
  | { ok: false; reason: string };

/**
 * Pure: the chat-completions body as it will be sent, or why it will not be.
 *
 * The gateway prices a request on `max_tokens` and nothing else: with the field missing
 * it assumes 8192, and it ignores `max_completion_tokens`, which is the name newer SDKs
 * send. So the cap is written here, under the one name that counts, whatever the caller
 * sent. A streamed answer is refused because a stream cannot be read inside the paid
 * request's clock and checked before the SDK sees it.
 */
export function guardInferenceBody(raw: string, model: string): GuardedBody {
  if (typeof raw !== "string" || raw.length === 0) return { ok: false, reason: "the request has no JSON body" };
  // Characters are at most four bytes each, so a short string needs no encoding to pass.
  if (raw.length > INFERENCE_MAX_REQUEST_BYTES || byteLength(raw) > INFERENCE_MAX_REQUEST_BYTES) {
    return { ok: false, reason: `the request body is over ${INFERENCE_MAX_REQUEST_BYTES} bytes` };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "the request body is not JSON" };
  }
  if (!isRecord(parsed)) return { ok: false, reason: "the request body is not a JSON object" };
  if (parsed.model !== model) {
    return { ok: false, reason: `the request names model ${show(parsed.model)}, not this agent's ${show(model)}` };
  }
  if (parsed.stream !== undefined && parsed.stream !== false && parsed.stream !== null) {
    return { ok: false, reason: "streamed answers are not paid for" };
  }
  if (!Array.isArray(parsed.messages) || parsed.messages.length === 0) {
    return { ok: false, reason: "the request has no messages" };
  }

  const forced: Record<string, unknown> = { ...parsed, max_tokens: INFERENCE_MAX_OUTPUT_TOKENS };
  delete forced.max_completion_tokens;
  const body = JSON.stringify(forced);
  if (byteLength(body) > INFERENCE_MAX_REQUEST_BYTES) {
    return { ok: false, reason: `the request body is over ${INFERENCE_MAX_REQUEST_BYTES} bytes` };
  }
  const size = measureChatMessages(parsed.messages);
  return { ok: true, body, requestHash: sha256Hex(body), contentChars: size.contentChars, messages: size.messages };
}

/**
 * Pure: the two numbers the gateway's quote is made from. It counts characters of
 * message `content` (tool results included) and the number of messages; tool
 * definitions and tool-call arguments are not counted. A content part that is not text
 * is counted at its JSON length, so the figure errs high.
 */
export function measureChatMessages(messages: readonly unknown[]): { contentChars: number; messages: number } {
  let contentChars = 0;
  for (const message of messages) {
    const content: unknown = isRecord(message) ? message.content : undefined;
    if (typeof content === "string") {
      contentChars += content.length;
    } else if (Array.isArray(content)) {
      for (const part of content) {
        if (typeof part === "string") contentChars += part.length;
        else if (isRecord(part) && typeof part.text === "string") contentChars += part.text.length;
        else if (part !== null && part !== undefined) contentChars += safeJsonLength(part);
      }
    }
  }
  return { contentChars, messages: messages.length };
}

// ---------- 2. the 402 ----------

/** A 402's requirements header larger than this is not decoded. BlockRun's is under 4 KB. */
const MAX_PAYMENT_REQUIRED_CHARS = 64_000;

/**
 * Pure: the payment requirements a 402 carries in its `PAYMENT-REQUIRED` header, or
 * `null` when there is no header or it cannot be read. Version 2 of x402 always sends
 * the header; the JSON body repeats it and is not consulted.
 */
export function readPaymentRequired(header: string | null | undefined): PaymentRequired | null {
  if (typeof header !== "string" || header.length === 0 || header.length > MAX_PAYMENT_REQUIRED_CHARS) return null;
  try {
    const decoded: unknown = decodePaymentRequiredHeader(header);
    return isRecord(decoded) ? (decoded as PaymentRequired) : null;
  } catch {
    return null;
  }
}

/** The one requirement of a 402 that may be signed, with the fields the rest of the path reads. */
export interface PinnedRequirement {
  /**
   * The very object the gateway sent, untouched. It is handed to the x402 client as it
   * stands and echoed back in the payment header, where the gateway compares it with
   * what it offered.
   */
  requirement: PaymentRequirements;
  network: string;
  asset: string;
  payTo: string;
  /** The gateway's fee payer for this payment. Never the agent. */
  feePayer: string;
  /** Atomic units of the asset, as the 402 wrote them. */
  amount: string;
  amountUsd: number;
}

export type PinResult = { ok: true; pinned: PinnedRequirement } | { ok: false; reason: string };

/**
 * Pure: the single requirement in a 402 that matches every pin, or why there is none.
 *
 * The x402 client's own choice is "the first offer I can pay", and the gateway lists
 * other schemes beside `exact` (`batch-settlement` on Solana, `upto` on Base), one of
 * which lets its operator claim a whole deposit. So the choice is made here, by
 * comparing each offer with constants: an offer that is not `exact`, on Solana mainnet,
 * in USDC, to the published pay-to is never a candidate, wherever it sits in the list.
 * Exactly one candidate must remain. Two would mean two prices for one request, and
 * that is a 402 we do not understand.
 *
 * Two further refusals concern the transaction the offer would produce. The fee payer
 * is taken from the 402 (it alternates between two gateway addresses, so it cannot be
 * pinned to one), but it must be a real address and must not be the agent: an agent
 * that pays its own fees needs SOL the wallet rules do not cover. And an offer that
 * dictates the memo is refused, because the memo is how a payment is later found on
 * chain and a memo chosen by the gateway need not be unique.
 */
export function pinInferenceRequirement(
  paymentRequired: unknown,
  payer: { address: string },
  chain: InferenceChain = "solana",
): PinResult {
  const gateway = INFERENCE_GATEWAY[chain];
  if (!gateway) return { ok: false, reason: "this chain has no inference gateway" };
  if (!isSolanaAddress(payer.address)) return { ok: false, reason: "the paying wallet's address is not a Solana address" };

  if (!isRecord(paymentRequired)) return { ok: false, reason: "the 402 carries no payment requirements" };
  if (paymentRequired.x402Version !== 2) {
    return { ok: false, reason: `the 402 speaks x402 version ${show(paymentRequired.x402Version)}, not 2` };
  }
  const accepts: unknown = paymentRequired.accepts;
  if (!Array.isArray(accepts) || accepts.length === 0) return { ok: false, reason: "the 402 lists no payment offers" };

  const payTos: readonly string[] = gateway.payTo;
  const candidates = accepts.filter(
    (offer): offer is Record<string, unknown> =>
      isRecord(offer) &&
      offer.scheme === "exact" &&
      offer.network === gateway.network &&
      offer.asset === gateway.asset &&
      typeof offer.payTo === "string" &&
      payTos.includes(offer.payTo),
  );
  if (candidates.length === 0) {
    // Say what the nearest offer got wrong, so the log line explains the refusal.
    const exact = accepts.filter((offer): offer is Record<string, unknown> => isRecord(offer) && offer.scheme === "exact");
    if (exact.length === 0) {
      const schemes = accepts.map((offer) => (isRecord(offer) ? show(offer.scheme) : "?")).join(", ");
      return { ok: false, reason: `the 402 offers no exact payment (schemes offered: ${schemes})` };
    }
    const onNetwork = exact.filter((offer) => offer.network === gateway.network);
    if (onNetwork.length === 0) return { ok: false, reason: `the exact offer is on network ${show(exact[0].network)}, not Solana mainnet` };
    const inUsdc = onNetwork.filter((offer) => offer.asset === gateway.asset);
    if (inUsdc.length === 0) return { ok: false, reason: `the exact offer is priced in asset ${show(onNetwork[0].asset)}, not USDC` };
    return { ok: false, reason: `the exact offer pays ${show(inUsdc[0].payTo)}, not the gateway's published address` };
  }
  if (candidates.length > 1) return { ok: false, reason: "the 402 makes more than one exact USDC offer to the gateway" };

  const offer = candidates[0];
  const amount = offer.amount;
  // Unsigned digits only, and few enough of them to be an exact number.
  if (typeof amount !== "string" || !/^\d{1,15}$/.test(amount) || Number(amount) <= 0) {
    return { ok: false, reason: `the exact offer's amount ${show(amount)} is not a positive whole number of units` };
  }
  const extra: unknown = offer.extra;
  if (!isRecord(extra)) return { ok: false, reason: "the exact offer names no fee payer" };
  const feePayer = extra.feePayer;
  if (typeof feePayer !== "string" || !isSolanaAddress(feePayer)) {
    return { ok: false, reason: `the exact offer's fee payer ${show(feePayer)} is not a Solana address` };
  }
  if (feePayer === payer.address) return { ok: false, reason: "the exact offer makes the agent's own wallet the fee payer" };
  if (extra.memo !== undefined && extra.memo !== null) return { ok: false, reason: "the exact offer dictates its own memo" };

  return {
    ok: true,
    pinned: {
      requirement: offer as unknown as PaymentRequirements,
      network: gateway.network,
      asset: gateway.asset,
      payTo: offer.payTo as string,
      feePayer,
      amount,
      amountUsd: roundUsd(Number(amount) / 10 ** gateway.decimals),
    },
  };
}

// ---------- 3. the signed bytes ----------

export interface SignedPaymentInput {
  /** The transaction as it travels in the payment header: base64 of the wire bytes. */
  transaction: string;
  /** The agent's wallet address: the owner of the USDC and the one signature we hold. */
  payer: string;
  /** What the transaction must pay, from {@link pinInferenceRequirement}. */
  pinned: Pick<PinnedRequirement, "asset" | "payTo" | "feePayer" | "amount">;
  /**
   * `false` checks a transaction the wallet has not signed yet, which is how the wallet
   * is kept from ever signing a wrong one. Defaults to `true`: before anything is sent,
   * the agent's signature must be there and must be a real signature over these bytes.
   */
  requireSignature?: boolean;
  chain?: InferenceChain;
}

export type SignedPaymentCheck =
  | {
      ok: true;
      /** The memo the payment carries: how the reconciler finds it on chain. */
      memo: string;
      /** The blockhash the transaction is valid under, read from the bytes, not from the 402. */
      blockhash: string;
      /** The agent's signature, base58. `null` only when `requireSignature` is false. */
      payerSignature: string | null;
      feePayer: string;
    }
  | {
      ok: false;
      reason: string;
      /**
       * `true` when the transaction is the right payment and only the agent's signature
       * is missing or wrong. That is the wallet failing to sign, not the gateway asking
       * for something else, and the two stop a run for different reasons.
       */
      signature?: true;
    };

/**
 * Pure: is this transaction exactly the payment that was priced?
 *
 * The x402 client builds the transaction from the 402, and the 402 is the gateway's
 * words. What the wallet signs is therefore read back from the bytes and compared with
 * the pins, instruction by instruction:
 *
 *  - a version 0 message with no address lookup tables (a table could hide where an
 *    account really points) and no bytes left over;
 *  - two signers and no more: the gateway's fee payer first, whose signature is still
 *    to come, and the agent, which is never the fee payer;
 *  - compute-budget settings (the unit limit and the unit price, at most one of each);
 *  - exactly one `TransferChecked` on the SPL Token program, of exactly the quoted
 *    amount at USDC's six decimals, from the agent's own USDC account, of the USDC mint,
 *    to the pay-to's USDC account, authorised by the agent;
 *  - exactly one memo, with no accounts, in the shape of the client's random nonce;
 *  - nothing else, and no account that those instructions do not account for.
 *
 * The two token accounts are derived here from the owner and the mint. Nothing about
 * them is taken from the transaction or from the 402.
 */
export function verifySignedPayment(input: SignedPaymentInput): SignedPaymentCheck {
  const gateway = INFERENCE_GATEWAY[input.chain ?? "solana"];
  if (!gateway) return { ok: false, reason: "this chain has no inference gateway" };
  const requireSignature = input.requireSignature !== false;
  const { payer, pinned } = input;

  if (pinned.asset !== gateway.asset) return { ok: false, reason: "the payment is not priced in USDC" };
  if (!(gateway.payTo as readonly string[]).includes(pinned.payTo)) return { ok: false, reason: "the payment's pay-to is not the gateway's published address" };
  if (!/^\d{1,15}$/.test(pinned.amount) || Number(pinned.amount) <= 0) return { ok: false, reason: "the quoted amount is not a positive whole number of units" };
  if (!isSolanaAddress(payer) || !isSolanaAddress(pinned.feePayer)) return { ok: false, reason: "the payer or the fee payer is not a Solana address" };
  if (pinned.feePayer === payer) return { ok: false, reason: "the agent's own wallet is the fee payer" };

  let bytes: Buffer;
  let tx: VersionedTransaction;
  try {
    if (typeof input.transaction !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(input.transaction)) throw new Error("not base64");
    bytes = Buffer.from(input.transaction, "base64");
    tx = VersionedTransaction.deserialize(Uint8Array.from(bytes));
    // Decoding is forgiving about what follows a transaction. Encoding it again is not:
    // the bytes that will be sent must be this transaction and nothing more.
    if (!Buffer.from(tx.serialize()).equals(bytes)) throw new Error("not canonical");
  } catch {
    return { ok: false, reason: "the signed transaction could not be decoded" };
  }

  const message = tx.message;
  if (tx.version !== 0) return { ok: false, reason: "the transaction is not a version 0 transaction" };
  if (message.addressTableLookups.length !== 0) return { ok: false, reason: "the transaction reads accounts from a lookup table" };

  const keys = message.staticAccountKeys.map((key) => key.toBase58());
  if (new Set(keys).size !== keys.length) return { ok: false, reason: "the transaction lists an account twice" };
  if (message.header.numRequiredSignatures !== 2 || tx.signatures.length !== 2) {
    return { ok: false, reason: `the transaction asks for ${message.header.numRequiredSignatures} signatures, not the fee payer's and the agent's` };
  }
  if (keys[0] === payer) return { ok: false, reason: "the agent's own wallet is the transaction's fee payer" };
  if (keys[0] !== pinned.feePayer) return { ok: false, reason: "the transaction's fee payer is not the one the gateway named" };
  if (keys[1] !== payer) return { ok: false, reason: "the agent is not the transaction's second signer" };

  const mint = gateway.asset;
  const source = usdcAccountOf(payer, mint);
  const destination = usdcAccountOf(pinned.payTo, mint);
  // Every account the message names must be one the payment needs. An account no
  // instruction uses cannot be touched, but it has no business being there either.
  const expected = new Set([pinned.feePayer, payer, source, destination, mint, SPL_TOKEN_PROGRAM, MEMO_PROGRAM, COMPUTE_BUDGET_PROGRAM]);
  const stray = keys.find((key) => !expected.has(key));
  if (stray) return { ok: false, reason: "the transaction names an account the payment does not need" };

  let transfers = 0;
  let unitLimits = 0;
  let unitPrices = 0;
  let memo: string | null = null;
  for (const instruction of message.compiledInstructions) {
    const program = keys[instruction.programIdIndex];
    const data = Buffer.from(instruction.data);
    const accounts = instruction.accountKeyIndexes.map((index) => keys[index]);
    if (accounts.some((account) => account === undefined)) return { ok: false, reason: "an instruction names an account outside the transaction" };

    if (program === COMPUTE_BUDGET_PROGRAM) {
      if (accounts.length !== 0) return { ok: false, reason: "a compute-budget instruction names accounts" };
      if (data[0] === SET_COMPUTE_UNIT_LIMIT_TAG && data.length === 5) unitLimits += 1;
      else if (data[0] === SET_COMPUTE_UNIT_PRICE_TAG && data.length === 9) unitPrices += 1;
      else return { ok: false, reason: "the transaction carries a compute-budget instruction other than the unit limit and price" };
      continue;
    }

    if (program === SPL_TOKEN_PROGRAM) {
      transfers += 1;
      if (data.length !== TRANSFER_CHECKED_BYTES || data[0] !== TRANSFER_CHECKED_TAG) {
        return { ok: false, reason: "the token instruction is not a TransferChecked" };
      }
      // Exactly four accounts. A fifth would be a multisig co-signer, which this is not.
      if (accounts.length !== 4) return { ok: false, reason: "the transfer does not name exactly four accounts" };
      if (accounts[0] !== source) return { ok: false, reason: "the transfer does not spend from the agent's own USDC account" };
      if (accounts[1] !== mint) return { ok: false, reason: "the transfer is not of the USDC mint" };
      if (accounts[2] !== destination) return { ok: false, reason: "the transfer does not pay the gateway's USDC account" };
      if (accounts[3] !== payer) return { ok: false, reason: "the transfer is not authorised by the agent" };
      if (data.readBigUInt64LE(1) !== BigInt(pinned.amount)) return { ok: false, reason: "the transfer is not for the quoted amount" };
      if (data[9] !== gateway.decimals) return { ok: false, reason: "the transfer does not use USDC's decimals" };
      continue;
    }

    if (program === MEMO_PROGRAM) {
      if (memo !== null) return { ok: false, reason: "the transaction carries more than one memo" };
      if (accounts.length !== 0) return { ok: false, reason: "the memo names accounts" };
      const text = data.toString("utf8");
      if (!MEMO_NONCE.test(text)) return { ok: false, reason: "the memo is not the payment's random nonce" };
      memo = text;
      continue;
    }

    return { ok: false, reason: "the transaction calls a program the payment does not need" };
  }

  if (transfers !== 1) return { ok: false, reason: `the transaction carries ${transfers} token transfers, not one` };
  if (memo === null) return { ok: false, reason: "the transaction carries no memo" };
  if (unitLimits > 1 || unitPrices > 1) return { ok: false, reason: "the transaction sets a compute-budget value twice" };

  // The fee payer signs last, on the gateway's side. A signature already in its slot is
  // one we did not make and cannot check.
  if (Buffer.from(tx.signatures[0]).some((byte) => byte !== 0)) {
    return { ok: false, reason: "the transaction already carries a signature in the fee payer's place" };
  }

  let payerSignature: string | null = null;
  const signature = Buffer.from(tx.signatures[1]);
  if (signature.some((byte) => byte !== 0)) {
    let genuine = false;
    try {
      genuine = signature.length === 64 && verify(null, Buffer.from(message.serialize()), ed25519Key(payer), signature);
    } catch {
      genuine = false;
    }
    if (!genuine) return { ok: false, reason: "the agent's signature does not match the transaction", signature: true };
    payerSignature = base58.encode(Uint8Array.from(signature));
  }
  if (requireSignature && payerSignature === null) return { ok: false, reason: "the transaction is not signed by the agent", signature: true };

  return { ok: true, memo, blockhash: message.recentBlockhash, payerSignature, feePayer: keys[0] };
}

/** Pure: the associated token account that holds `owner`'s balance of `mint` on the SPL Token program. */
export function usdcAccountOf(owner: string, mint: string = INFERENCE_GATEWAY.solana.asset): string {
  const [address] = PublicKey.findProgramAddressSync(
    [new PublicKey(owner).toBytes(), new PublicKey(SPL_TOKEN_PROGRAM).toBytes(), new PublicKey(mint).toBytes()],
    new PublicKey(ASSOCIATED_TOKEN_PROGRAM),
  );
  return address.toBase58();
}

// ---------- small helpers ----------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Pure: a base58 string that decodes to 32 bytes and encodes back to itself. */
export function isSolanaAddress(value: unknown): value is string {
  if (typeof value !== "string" || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value)) return false;
  try {
    return new PublicKey(value).toBase58() === value;
  } catch {
    return false;
  }
}

/**
 * Every ed25519 public key in SPKI form is this 12-byte header followed by the raw 32
 * bytes, which is all `node:crypto` needs to check a Solana signature.
 */
const ED25519_SPKI_HEADER = Buffer.from("302a300506032b6570032100", "hex");

function ed25519Key(address: string) {
  return createPublicKey({ key: Buffer.concat([ED25519_SPKI_HEADER, new PublicKey(address).toBuffer()]), format: "der", type: "spki" });
}

function byteLength(text: string): number {
  return Buffer.byteLength(text, "utf8");
}

function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function safeJsonLength(value: unknown): number {
  try {
    return JSON.stringify(value)?.length ?? 0;
  } catch {
    return 0;
  }
}

/** A few characters of something the gateway sent, quoted, for a reason line. */
function show(value: unknown): string {
  const text = typeof value === "string" ? value : value === undefined ? "undefined" : (safeJson(value) ?? String(value));
  return JSON.stringify(text.length > 64 ? `${text.slice(0, 64)}…` : text);
}

function safeJson(value: unknown): string | undefined {
  try {
    return JSON.stringify(value);
  } catch {
    return undefined;
  }
}
