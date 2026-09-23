/**
 * Sponsored USDC on Solana: the app pays the fee, the user pays the USDC.
 *
 * ## Why this exists
 *
 * An operator's Privy embedded Solana wallet holds USDC and no SOL, so it cannot sign
 * anything for itself. We used to hand Privy `options: { sponsor: true }` and hope. That
 * is not how Privy's Solana gas docs describe sponsorship: the **app** runs a fee-payer
 * wallet, builds the transaction with `payerKey` set to it, the user partially signs,
 * and the backend adds the fee payer's signature and broadcasts. Tocker already runs
 * exactly such a wallet — the platform Solana wallet that pays for x402 data, drips gas
 * and pre-creates token accounts — so moving USDC depends on nothing but our own SOL.
 *
 * Two transaction shapes are sponsored, and nothing else is:
 *
 *  - **Funding** an agent the user owns: an idempotent create of the agent's USDC
 *    account (the platform pays that rent — it is the cost of making an agent fundable)
 *    and a `TransferChecked` from the user to the agent.
 *  - **Withdrawal** to any Solana address: a `TransferChecked` from the user to the
 *    recipient and, only when the recipient has never held USDC, an idempotent create of
 *    its account *plus* a second `TransferChecked` from the user to the platform that
 *    reimburses that rent in USDC. The platform fronts the SOL; the user pays it back in
 *    the same transaction, so a stranger cannot have the platform open token accounts
 *    (and later close them and keep the rent) for free.
 *
 * ## The protocol
 *
 *  1. `prepare…` (server) builds a v0 transaction whose fee payer is the platform wallet.
 *  2. The browser has the user sign it — `signTransaction`, never `signAndSend`: the
 *     user's wallet cannot broadcast a transaction it cannot pay for.
 *  3. `submit…` (server) runs the validator for that shape over the bytes that come
 *     back, and only then has the platform co-sign through `cosignAsPlatform` (which
 *     simulates the exact bytes and refuses when the platform would lose more than the
 *     fee and the rent it agreed to front) and broadcasts the result.
 *
 * ## The validator is the security boundary
 *
 * Step 3 receives arbitrary bytes from a browser and is about to co-sign them with a
 * wallet that holds the platform's money. Everything the platform must never sign — a
 * `SystemProgram.transfer` draining the fee payer, an extra instruction, the fee payer
 * named as the *authority* of a token transfer, a different amount or destination,
 * address-lookup tables that hide which accounts are really involved — is rejected here.
 * The check is not a heuristic: the expected message is **rebuilt from the expected
 * inputs and compared byte for byte**, so anything we did not author fails by
 * construction. The user's own ed25519 signature is verified over the message too, so a
 * transaction nobody agreed to cannot be pushed through.
 *
 * ## Why this file and not `solana-transfer.ts`
 *
 * The signature check needs ed25519 verification. `tweetnacl` is *not* in this project's
 * `node_modules` (`@solana/web3.js` 1.99 verifies with `@noble/curves`, which pnpm does
 * not hoist either), and adding a package was out of scope — so it uses `node:crypto`,
 * which every supported Node has. `solana-transfer.ts` is imported by a `"use client"`
 * module, and a `node:crypto` import anywhere in that graph breaks the browser bundle.
 * Hence a sibling marked `server-only`. The instruction encoders stay shared.
 */
import "server-only";
import { createPublicKey, verify, type KeyObject } from "node:crypto";
import { base58 } from "@scure/base";
import {
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import type { CosignInput } from "./solana-cosign";
import type { SignatureConfirmation } from "./solana-rpc";
import {
  ATA_RENT_LAMPORTS,
  LAMPORTS_PER_SOL,
  MIN_PLATFORM_SOL,
  SIGNATURE_FEE_LAMPORTS,
  SPONSOR_MARGIN_LAMPORTS,
} from "./gas";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  SOLANA_USDC_DECIMALS,
  SOLANA_USDC_MINT,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  associatedTokenAddress,
  createAtaIdempotentInstruction,
  toBaseUnits,
  transferCheckedInstruction,
} from "./solana-transfer";

/** A v0 transaction is capped at one packet. Anything larger is not worth deserialising. */
const MAX_TRANSACTION_BYTES = 1232;

/** Every sponsored transaction has exactly two signers: the platform (fee payer) and the user. */
export const SPONSORED_SIGNERS = 2;

/** The smallest withdrawal the platform pays the fee for. Below this the fee is the point. */
export const MIN_SPONSORED_WITHDRAWAL_USDC = 1;

/**
 * The smallest funding transfer the platform pays the fee for: one cent.
 *
 * Not the withdrawal's $1. A funding plan puts its $5 minimum on the *total* and splits
 * it across chains in proportion to what the user holds, so a real Solana leg can be
 * $0.24 — and a dollar floor here would strand a freshly created agent in the retry
 * dialog with a transfer it can never send. Every leg a plan produces is whole cents,
 * so a cent floor refuses only dust (0.000001 USDC, sent to make the platform pay a fee
 * for nothing). The per-user rate limits on the funding actions are the real ceiling.
 */
export const MIN_SPONSORED_FUNDING_USDC = 0.01;

/**
 * The floor on the one-time fee for opening a recipient's USDC account: $0.25.
 *
 * It covers the rent outright up to a SOL price of about $168 (0.00148844 SOL at the
 * 2026 rent), and it keeps "open an account, close it, keep the rent" unprofitable even
 * when the price feed is behind.
 */
export const MIN_NEW_ACCOUNT_FEE_USDC = 0.25;
/** A fee above this means the price feed is wrong, not that rent went up. Refused. */
export const MAX_NEW_ACCOUNT_FEE_USDC = 5;
/** Margin on the rent's dollar value: price drift between prepare and submit, and the fee's own signature. */
export const NEW_ACCOUNT_FEE_MARGIN = 0.2;
/**
 * The margin a fee echoed back at submit must *still* carry over the rent's dollar value
 * at the submit-time price. Not zero: a fee of exactly the rent's value lets anyone open
 * a fresh account, close it, keep the rent and leave the platform paying the signatures
 * and the refuel swap for nothing. The 20% quoted minus this 5% is the drift tolerated —
 * SOL can rise about 14% between the quote and the hold-to-confirm.
 */
export const NEW_ACCOUNT_FEE_MIN_MARGIN = 0.05;
/** Bytes in a legacy SPL token account — what the ATA program allocates for USDC. */
export const TOKEN_ACCOUNT_BYTES = 165;

/**
 * The user-facing sentence for "the platform cannot pay right now". Deliberately says
 * nothing about SOL: the user cannot fix it and should not be asked to.
 */
export const FEE_WALLET_REFILLING = "Tocker's fee wallet is refilling — try again in a minute.";
const FEE_WALLET_UNREACHABLE = "Tocker couldn't reach the Solana network just now — try again in a minute.";

// ------------------------------------------------------------- instructions

/**
 * The two instructions of a sponsored funding transfer, in the only order they are ever
 * built in. Both the builder and the validator call this, which is what makes the
 * byte-for-byte comparison meaningful rather than circular: the validator rebuilds from
 * the *expectation* the server derived from the session, never from the submitted bytes.
 */
function sponsoredUsdcInstructions(input: {
  from: PublicKey;
  to: PublicKey;
  feePayer: PublicKey;
  amount: number;
}): TransactionInstruction[] {
  return [
    // The platform pays the token-account rent for the agent's USDC account. Idempotent,
    // so it is a no-op on every funding after the first.
    createAtaIdempotentInstruction({ payer: input.feePayer, owner: input.to, mint: SOLANA_USDC_MINT }),
    transferCheckedInstruction({
      source: associatedTokenAddress(input.from, SOLANA_USDC_MINT),
      destination: associatedTokenAddress(input.to, SOLANA_USDC_MINT),
      // The user, and only ever the user. The platform wallet signs this transaction as
      // its fee payer; it is never the authority that moves somebody's tokens.
      owner: input.from,
      mint: SOLANA_USDC_MINT,
      amount: toBaseUnits(input.amount, SOLANA_USDC_DECIMALS),
      decimals: SOLANA_USDC_DECIMALS,
    }),
  ];
}

/**
 * The instructions of a sponsored withdrawal, in the only order they are ever built in.
 *
 * Recipient already holds USDC: one `TransferChecked`, user → recipient. The platform is
 * the fee payer and nothing else — it appears in no instruction.
 *
 * Recipient has never held USDC: the platform opens the account (it is the `payer` on
 * the idempotent create), the user sends, and the user reimburses the rent in USDC to
 * the platform's own USDC account. All three or none: the reimbursement is what makes
 * the create acceptable, so a message with the create and without it does not validate.
 */
function sponsoredWithdrawalInstructions(input: {
  from: PublicKey;
  to: PublicKey;
  feePayer: PublicKey;
  amount: number;
  createRecipientAccount: boolean;
  reimbursementUsdc: number;
}): TransactionInstruction[] {
  const source = associatedTokenAddress(input.from, SOLANA_USDC_MINT);
  const send = transferCheckedInstruction({
    source,
    destination: associatedTokenAddress(input.to, SOLANA_USDC_MINT),
    owner: input.from,
    mint: SOLANA_USDC_MINT,
    amount: toBaseUnits(input.amount, SOLANA_USDC_DECIMALS),
    decimals: SOLANA_USDC_DECIMALS,
  });
  if (!input.createRecipientAccount) return [send];
  return [
    createAtaIdempotentInstruction({ payer: input.feePayer, owner: input.to, mint: SOLANA_USDC_MINT }),
    send,
    transferCheckedInstruction({
      source,
      destination: associatedTokenAddress(input.feePayer, SOLANA_USDC_MINT),
      owner: input.from,
      mint: SOLANA_USDC_MINT,
      amount: toBaseUnits(input.reimbursementUsdc, SOLANA_USDC_DECIMALS),
      decimals: SOLANA_USDC_DECIMALS,
    }),
  ];
}

async function compile(feePayer: PublicKey, instructions: TransactionInstruction[], blockhash?: string) {
  let recentBlockhash = blockhash;
  if (!recentBlockhash) {
    const { getLatestBlockhash } = await import("./solana-rpc");
    recentBlockhash = await getLatestBlockhash();
  }
  const message = new TransactionMessage({ payerKey: feePayer, recentBlockhash, instructions }).compileToV0Message();
  return new VersionedTransaction(message).serialize();
}

// ------------------------------------------------------------------ builders

export interface SponsoredTransferInput {
  /** The user's embedded Solana wallet — holds the USDC, signs, pays no fee. */
  from: string;
  /** The agent's server wallet. */
  to: string;
  /** The platform Solana wallet. Fee payer, and payer of the token account's rent. */
  feePayer: string;
  /** Human units of USDC. */
  amount: number;
  /** Blockhash to build against. Fetched from `SOLANA_RPC_URL` when omitted. */
  blockhash?: string;
}

/**
 * Build the unsigned v0 funding transaction the user is asked to sign. Needs the network
 * for a blockhash unless one is supplied (which is what the tests do).
 */
export async function buildSponsoredUsdcTransfer(input: SponsoredTransferInput): Promise<Uint8Array> {
  const from = new PublicKey(input.from);
  const to = new PublicKey(input.to);
  const feePayer = new PublicKey(input.feePayer);
  if (feePayer.equals(from)) throw new Error("The fee payer cannot be the wallet the USDC comes from.");
  if (!(input.amount >= MIN_SPONSORED_FUNDING_USDC)) {
    throw new Error(`The amount must be at least $${MIN_SPONSORED_FUNDING_USDC}.`);
  }
  return compile(feePayer, sponsoredUsdcInstructions({ from, to, feePayer, amount: input.amount }), input.blockhash);
}

export interface SponsoredWithdrawalInput {
  /** The user's embedded Solana wallet — holds the USDC, signs, pays no fee. */
  from: string;
  /** Any Solana wallet address — the *owner* of the USDC account that receives it. */
  to: string;
  /** The platform Solana wallet. Fee payer, and payer of a new account's rent. */
  feePayer: string;
  /** Human units of USDC the recipient gets. */
  amount: number;
  /** True when the recipient's USDC account does not exist yet and this transaction opens it. */
  createRecipientAccount: boolean;
  /** USDC the user pays the platform back for that account's rent. 0 when nothing is opened. */
  reimbursementUsdc: number;
  blockhash?: string;
}

/** Build the unsigned v0 withdrawal transaction. Refuses any shape the validator would refuse. */
export async function buildSponsoredUsdcWithdrawal(input: SponsoredWithdrawalInput): Promise<Uint8Array> {
  const problem = withdrawalExpectationProblem(input);
  if (problem) throw new Error(`Tocker will not build this withdrawal: ${problem}.`);
  const from = new PublicKey(input.from);
  const to = new PublicKey(input.to);
  const feePayer = new PublicKey(input.feePayer);
  return compile(
    feePayer,
    sponsoredWithdrawalInstructions({
      from,
      to,
      feePayer,
      amount: input.amount,
      createRecipientAccount: input.createRecipientAccount,
      reimbursementUsdc: input.reimbursementUsdc,
    }),
    input.blockhash,
  );
}

// ---------------------------------------------------------------- validators

export interface SponsoredTransferExpectation {
  from: string;
  to: string;
  feePayer: string;
  amount: number;
}

export interface SponsoredWithdrawalExpectation {
  from: string;
  to: string;
  feePayer: string;
  amount: number;
  createRecipientAccount: boolean;
  reimbursementUsdc: number;
}

export type SponsoredTransferCheck = { ok: true } | { ok: false; reason: string };

const bad = (reason: string): SponsoredTransferCheck => ({ ok: false, reason });

/**
 * Every ed25519 SPKI key is this 12-byte header followed by the raw 32 bytes, so a
 * Solana public key becomes a `KeyObject` `node:crypto` will verify with, with no
 * dependency and no allocation worth naming.
 */
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

function ed25519Key(key: PublicKey): KeyObject {
  return createPublicKey({
    key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(key.toBytes())]),
    format: "der",
    type: "spki",
  });
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

type CompiledMessage = VersionedTransaction["message"];

/** One instruction, flattened into the things that decide what it does on chain. */
function describe(message: CompiledMessage, index: number) {
  const ix = message.compiledInstructions[index];
  const keys = message.staticAccountKeys;
  return {
    programId: keys[ix.programIdIndex]?.toBase58() ?? `<index ${ix.programIdIndex}>`,
    accounts: ix.accountKeyIndexes.map((i) => ({
      key: keys[i]?.toBase58() ?? `<index ${i}>`,
      signer: message.isAccountSigner(i),
      writable: message.isAccountWritable(i),
    })),
    data: Buffer.from(ix.data).toString("hex"),
  };
}

const ORDINAL = ["first", "second", "third", "fourth"] as const;
const COUNT = ["no", "one", "two", "three", "four"] as const;

/**
 * Compare one instruction against the one we authored and say, in words, what differs.
 *
 * The byte-for-byte message comparison below would catch every one of these on its own;
 * this exists so the server can log *which* thing was wrong instead of "the bytes
 * differ", and so the tests assert on the specific failure rather than a catch-all.
 */
function instructionMismatch(
  actual: CompiledMessage,
  expected: CompiledMessage,
  index: number,
): string | null {
  const a = describe(actual, index);
  const e = describe(expected, index);
  const which = ORDINAL[index] ?? `instruction ${index + 1}`;

  if (a.programId !== e.programId) {
    return `its ${which} instruction calls ${a.programId}, not ${e.programId}`;
  }
  if (a.accounts.length !== e.accounts.length) {
    return `its ${which} instruction passes ${a.accounts.length} accounts, not ${e.accounts.length}`;
  }
  for (let i = 0; i < a.accounts.length; i += 1) {
    const got = a.accounts[i];
    const want = e.accounts[i];
    if (got.key !== want.key) {
      return `account ${i} of its ${which} instruction is ${got.key}, not ${want.key}`;
    }
    if (got.signer !== want.signer) {
      return `account ${i} of its ${which} instruction is ${got.signer ? "" : "not "}a signer, and should be${
        want.signer ? "" : " not"
      }`;
    }
    if (got.writable !== want.writable) {
      return `account ${i} of its ${which} instruction is ${got.writable ? "" : "not "}writable, and should be${
        want.writable ? "" : " not"
      }`;
    }
  }
  if (a.data !== e.data) {
    return `the data of its ${which} instruction is ${a.data}, not ${e.data} — a different amount, or a different operation`;
  }
  return null;
}

/** What Tocker authored, for {@link validateAuthored} to hold the submitted bytes against. */
interface Authored {
  /** "a sponsored funding transfer" — reads in the refusal sentences. */
  label: string;
  feePayer: PublicKey;
  /** The user: the only other signer, and the authority of every token transfer. */
  from: PublicKey;
  instructions: TransactionInstruction[];
}

/**
 * The shared boundary under both validators: is this exactly the transaction Tocker
 * built for `authored`, signed by `authored.from`, and nothing else?
 *
 *  - it deserialises as a v0 transaction of at most one packet;
 *  - it carries no address-lookup tables, so every account is visible in the message;
 *  - static account 0 — the fee payer — is `authored.feePayer`;
 *  - exactly two signatures are required, and `authored.from` is one of the signers;
 *  - it has exactly the authored instructions, with their program ids, account keys,
 *    signer and writable flags and data bytes;
 *  - the fee payer is never the `owner` of a token transfer — only `from` is;
 *  - the whole serialised message equals the rebuilt one byte for byte;
 *  - and the signature in `from`'s slot is a real ed25519 signature over that message.
 */
function validateAuthored(txBytes: Uint8Array, authored: Authored): SponsoredTransferCheck {
  const { feePayer, from, label, instructions } = authored;

  if (txBytes.length === 0) return bad("it is empty");
  if (txBytes.length > MAX_TRANSACTION_BYTES) {
    return bad(`it is ${txBytes.length} bytes, larger than a Solana transaction can be`);
  }

  let tx: VersionedTransaction;
  try {
    tx = VersionedTransaction.deserialize(txBytes);
  } catch (err) {
    return bad(`it is not a Solana transaction: ${err instanceof Error ? err.message : String(err)}`);
  }
  const message = tx.message;

  if (message.version !== 0) return bad("it is a legacy transaction, not the v0 transaction Tocker builds");
  if ((message.addressTableLookups?.length ?? 0) > 0) {
    return bad("it uses address lookup tables, which hide which accounts it really touches");
  }

  const keys = message.staticAccountKeys;
  if (keys.length === 0 || !keys[0].equals(feePayer)) {
    return bad(
      `its fee payer is ${keys[0]?.toBase58() ?? "missing"}, not the platform wallet ${feePayer.toBase58()}`,
    );
  }
  if (message.header.numRequiredSignatures !== SPONSORED_SIGNERS) {
    return bad(`it needs ${message.header.numRequiredSignatures} signatures; ${label} needs exactly two`);
  }

  const fromIndex = keys.findIndex((key) => key.equals(from));
  if (fromIndex < 0) return bad(`the sending wallet ${from.toBase58()} is not in the transaction at all`);
  if (fromIndex >= message.header.numRequiredSignatures) {
    return bad(`the sending wallet ${from.toBase58()} is not one of its signers`);
  }

  if (message.compiledInstructions.length !== instructions.length) {
    return bad(
      `it has ${message.compiledInstructions.length} instructions; ${label} has exactly ${
        COUNT[instructions.length] ?? instructions.length
      }`,
    );
  }

  // Rebuild what we would have authored for this expectation, against the blockhash the
  // submission carries — the blockhash is the one field we do not pin, and the chain
  // enforces it for us by refusing an expired one.
  let rebuilt: CompiledMessage;
  try {
    rebuilt = new TransactionMessage({
      payerKey: feePayer,
      recentBlockhash: message.recentBlockhash,
      instructions,
    }).compileToV0Message();
  } catch (err) {
    return bad(`Tocker could not rebuild the transaction to compare it: ${err instanceof Error ? err.message : String(err)}`);
  }

  for (let i = 0; i < instructions.length; i += 1) {
    const want = instructions[i].programId;
    const programId = keys[message.compiledInstructions[i].programIdIndex];
    if (!programId || !programId.equals(want)) {
      return bad(
        `its ${ORDINAL[i] ?? `instruction ${i + 1}`} instruction calls ${
          programId?.toBase58() ?? "an account that is not in the message"
        }, not ${want.toBase58()}`,
      );
    }
    const mismatch = instructionMismatch(message, rebuilt, i);
    if (mismatch) return bad(mismatch);
  }

  // Said explicitly because it is the thing that would cost the most: the platform
  // wallet is a signer on this transaction, and a `TransferChecked` whose authority is
  // the fee payer would move the *platform's* tokens under the user's instruction.
  // (`instructionMismatch` already catches it; a rule this expensive gets its own line.)
  for (let i = 0; i < instructions.length; i += 1) {
    if (!instructions[i].programId.equals(TOKEN_PROGRAM_ID)) continue;
    const authority = keys[message.compiledInstructions[i].accountKeyIndexes[3]];
    if (!authority || !authority.equals(from)) {
      return bad(
        `the token transfer is authorised by ${authority?.toBase58() ?? "an account that is not in the message"}, not by the sending wallet`,
      );
    }
  }

  if (!sameBytes(message.serialize(), rebuilt.serialize())) {
    return bad("it does not match the transaction Tocker built, byte for byte");
  }

  const signature = tx.signatures[fromIndex];
  if (!signature || signature.length !== 64 || signature.every((byte) => byte === 0)) {
    return bad("the sending wallet has not signed it");
  }
  let verified = false;
  try {
    verified = verify(null, Buffer.from(message.serialize()), ed25519Key(from), Buffer.from(signature));
  } catch (err) {
    return bad(`its signature could not be checked: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!verified) return bad("the sending wallet's signature does not match this transaction");

  return { ok: true };
}

function parseWallets(expected: { from: string; to: string; feePayer: string }):
  | { ok: true; from: PublicKey; to: PublicKey; feePayer: PublicKey }
  | { ok: false; reason: string } {
  let from: PublicKey;
  let to: PublicKey;
  let feePayer: PublicKey;
  try {
    from = new PublicKey(expected.from);
    to = new PublicKey(expected.to);
    feePayer = new PublicKey(expected.feePayer);
  } catch {
    return { ok: false, reason: "one of the three wallet addresses it should involve is not a Solana address" };
  }
  if (feePayer.equals(from)) return { ok: false, reason: "the fee payer and the sending wallet are the same wallet" };
  if (feePayer.equals(to)) return { ok: false, reason: "the fee payer and the receiving wallet are the same wallet" };
  if (from.equals(to)) return { ok: false, reason: "the sending and receiving wallets are the same wallet" };
  return { ok: true, from, to, feePayer };
}

/**
 * PURE. Is this exactly the funding transaction Tocker built, signed by the person it
 * was built for, and nothing else?
 *
 * On top of {@link validateAuthored}: the three wallets are distinct Solana addresses and
 * the amount is at least {@link MIN_SPONSORED_FUNDING_USDC}. Every other outcome is
 * `{ ok: false, reason }`.
 * It never throws, never reads the network and never touches the database: give it the
 * same bytes and the same expectation and it gives the same answer.
 */
export function validateSponsoredUsdcTransfer(
  txBytes: Uint8Array,
  expected: SponsoredTransferExpectation,
): SponsoredTransferCheck {
  const wallets = parseWallets(expected);
  if (!wallets.ok) return bad(wallets.reason);
  if (!(expected.amount > 0)) return bad("the amount to transfer is not a positive number");
  if (!(expected.amount >= MIN_SPONSORED_FUNDING_USDC)) {
    return bad(`the amount is under the $${MIN_SPONSORED_FUNDING_USDC} minimum for a transfer Tocker pays the fee on`);
  }
  if (toBaseUnits(expected.amount, SOLANA_USDC_DECIMALS) <= BigInt(0)) {
    return bad("the amount to transfer rounds to zero USDC");
  }
  const { from, to, feePayer } = wallets;
  return validateAuthored(txBytes, {
    label: "a sponsored funding transfer",
    feePayer,
    from,
    instructions: sponsoredUsdcInstructions({ from, to, feePayer, amount: expected.amount }),
  });
}

/**
 * The rules a withdrawal *expectation* has to satisfy before any bytes are looked at.
 * Shared by the builder (which refuses to author a bad shape) and the validator.
 */
function withdrawalExpectationProblem(expected: SponsoredWithdrawalExpectation): string | null {
  const wallets = parseWallets(expected);
  if (!wallets.ok) return wallets.reason;
  if (!(expected.amount >= MIN_SPONSORED_WITHDRAWAL_USDC)) {
    return `the amount is under the $${MIN_SPONSORED_WITHDRAWAL_USDC} minimum for a withdrawal Tocker pays the fee on`;
  }
  const fee = expected.reimbursementUsdc;
  if (!Number.isFinite(fee) || fee < 0) return "its account fee is not a number of USDC";
  if (expected.createRecipientAccount) {
    if (!(fee >= MIN_NEW_ACCOUNT_FEE_USDC)) {
      return `it opens a USDC account for the recipient without reimbursing Tocker at least $${MIN_NEW_ACCOUNT_FEE_USDC.toFixed(2)} for it`;
    }
    if (fee > MAX_NEW_ACCOUNT_FEE_USDC) {
      return `its account fee of $${fee.toFixed(2)} is more than Tocker ever charges`;
    }
  } else if (fee !== 0) {
    return "it charges an account fee, but the recipient's USDC account already exists";
  }
  return null;
}

/**
 * PURE. Is this exactly the withdrawal Tocker built for `expected`, signed by the user?
 *
 * On top of {@link validateAuthored}: the amount is at least
 * {@link MIN_SPONSORED_WITHDRAWAL_USDC}; when the recipient's account has to be opened the
 * transaction must carry the create *and* a reimbursement of at least
 * {@link MIN_NEW_ACCOUNT_FEE_USDC} to the platform's own USDC account; when it does not,
 * it must carry neither. Whether the account exists is the *server's* reading of the
 * chain, never the caller's claim.
 */
export function validateSponsoredUsdcWithdrawal(
  txBytes: Uint8Array,
  expected: SponsoredWithdrawalExpectation,
): SponsoredTransferCheck {
  const problem = withdrawalExpectationProblem(expected);
  if (problem) return bad(problem);
  const from = new PublicKey(expected.from);
  const to = new PublicKey(expected.to);
  const feePayer = new PublicKey(expected.feePayer);
  return validateAuthored(txBytes, {
    label: "a sponsored withdrawal",
    feePayer,
    from,
    instructions: sponsoredWithdrawalInstructions({
      from,
      to,
      feePayer,
      amount: expected.amount,
      createRecipientAccount: expected.createRecipientAccount,
      reimbursementUsdc: expected.reimbursementUsdc,
    }),
  });
}

/**
 * True when every required signature slot is filled. Run after the platform adds its
 * signature: a backend that returned the transaction with the user's signature dropped
 * would produce a transaction that broadcasts and fails, and this turns that into a
 * loud, specific failure before anything is sent.
 */
export function isFullySigned(txBytes: Uint8Array): boolean {
  try {
    const tx = VersionedTransaction.deserialize(txBytes);
    const required = tx.message.header.numRequiredSignatures;
    if (tx.signatures.length < required) return false;
    return tx.signatures
      .slice(0, required)
      .every((sig) => sig.length === 64 && sig.some((byte) => byte !== 0));
  } catch {
    return false;
  }
}

// -------------------------------------------------------------------- pricing

const cents = (usd: number): number => Math.ceil(usd * 100 - 1e-9) / 100;

/**
 * PURE. The one-time USDC fee for opening a recipient's USDC account: the rent's dollar
 * value at `solPriceUsd`, plus {@link NEW_ACCOUNT_FEE_MARGIN}, rounded up to the cent,
 * never under {@link MIN_NEW_ACCOUNT_FEE_USDC}.
 *
 * Null when there is no usable price, or when the answer is above
 * {@link MAX_NEW_ACCOUNT_FEE_USDC} — a price that implies that is a broken feed, and
 * charging a user $12 for an account is worse than asking them to try again.
 */
export function newAccountFeeUsdc(input: { rentLamports: number; solPriceUsd: number | null }): number | null {
  const { rentLamports, solPriceUsd } = input;
  if (!Number.isFinite(rentLamports) || !(rentLamports > 0)) return null;
  if (solPriceUsd === null || !Number.isFinite(solPriceUsd) || !(solPriceUsd > 0)) return null;
  const usd = (rentLamports / LAMPORTS_PER_SOL) * solPriceUsd * (1 + NEW_ACCOUNT_FEE_MARGIN);
  const fee = Math.max(MIN_NEW_ACCOUNT_FEE_USDC, cents(usd));
  return fee > MAX_NEW_ACCOUNT_FEE_USDC ? null : fee;
}

/**
 * PURE. Is a fee the client echoes back at submit time still enough?
 *
 * The fee is the one number in a withdrawal the caller supplies, so it is checked as if
 * the caller chose it — because it can. It was priced at prepare with a 20% margin; SOL
 * can move before the user holds to confirm. It is accepted only when it is within the
 * fee bounds and still covers the rent at **today's** price *plus*
 * {@link NEW_ACCOUNT_FEE_MIN_MARGIN}. With no price at submit it is refused: the floor
 * alone covers the rent only up to ~$168/SOL, and "the feed is down" must not be the
 * moment opening accounts gets cheaper than the rent.
 */
export function reimbursementCoversRent(input: {
  feeUsdc: number;
  rentLamports: number;
  solPriceUsd: number | null;
}): SponsoredTransferCheck {
  const { feeUsdc, rentLamports, solPriceUsd } = input;
  if (!Number.isFinite(feeUsdc) || feeUsdc < MIN_NEW_ACCOUNT_FEE_USDC) {
    return bad(`the account fee is under the $${MIN_NEW_ACCOUNT_FEE_USDC.toFixed(2)} minimum`);
  }
  if (feeUsdc > MAX_NEW_ACCOUNT_FEE_USDC) return bad("the account fee is more than Tocker ever charges");
  if (!Number.isFinite(rentLamports) || !(rentLamports > 0)) {
    return bad("Tocker could not read what opening the account costs");
  }
  if (solPriceUsd === null || !Number.isFinite(solPriceUsd) || !(solPriceUsd > 0)) {
    return bad("Tocker has no live SOL price to check the account fee against");
  }
  const floor = (rentLamports / LAMPORTS_PER_SOL) * solPriceUsd * (1 + NEW_ACCOUNT_FEE_MIN_MARGIN);
  if (feeUsdc + 1e-9 < floor) {
    return bad("prices moved since the account fee was quoted, and it no longer covers opening the account");
  }
  return { ok: true };
}

/**
 * PURE. The most lamports the platform may lose co-signing one sponsored transaction:
 * two signatures (no compute-budget instructions, so no priority fee) plus the rent of
 * the one token account it agreed to open, if any. This is `cosignAsPlatform`'s budget,
 * and it is exact — `getFeeForMessage` answers 10,000 for these messages.
 *
 * Exact has a cost: `cosignAsPlatform` reads the platform's balance and simulates in
 * parallel with nothing pinning the two to one slot, and the platform pays for every
 * agent trade too, so another of its transactions landing between the reads shows up as
 * this one costing more. That is answered by {@link cosignSponsored} looking once more,
 * not by loosening the budget.
 */
export function sponsoredCosignBudgetLamports(input: { opensAccount: boolean; rentLamports: number }): number {
  return SPONSORED_SIGNERS * SIGNATURE_FEE_LAMPORTS + (input.opensAccount ? input.rentLamports : 0);
}

/**
 * PURE. What the platform should *hold* before offering to sponsor: the budget plus a
 * margin, so it stays rent-exempt itself and a busier block does not tip it over.
 */
export function sponsorReserveLamports(input: { opensAccount: boolean; rentLamports: number }): number {
  return sponsoredCosignBudgetLamports(input) + SPONSOR_MARGIN_LAMPORTS;
}

// ------------------------------------------------------------ recipient shape

export type RecipientKind = "wallet" | "token_account" | "program";

/**
 * PURE. What a destination address *is*, from its account info.
 *
 * The footgun this catches: pasting a USDC *token account* address (what an explorer
 * shows under "token accounts") instead of the wallet address. The withdrawal would open
 * a USDC account owned by that token account, which nobody can ever sign for — the
 * money is gone. A program id is the same mistake. Anything else — a system-owned
 * wallet, an address that has never been used, a multisig vault — is a wallet.
 */
export function classifyRecipient(info: { owner: string; executable: boolean } | null): RecipientKind {
  if (!info) return "wallet";
  if (info.executable) return "program";
  if (info.owner === TOKEN_PROGRAM_ID.toBase58() || info.owner === TOKEN_2022_PROGRAM_ID.toBase58()) {
    return "token_account";
  }
  return "wallet";
}

async function rpcCall<T>(method: string, params: unknown[]): Promise<T> {
  const { solanaRpcUrl } = await import("./solana-rpc");
  const res = await fetch(solanaRpcUrl(), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Solana RPC ${method} failed (HTTP ${res.status})`);
  const body = (await res.json()) as { result?: T; error?: { message?: string } };
  if (body.error) throw new Error(`Solana RPC ${method} failed: ${body.error.message ?? "unknown error"}`);
  if (body.result === undefined) throw new Error(`Solana RPC ${method} returned no result`);
  return body.result;
}

/** Read a destination's account and classify it. Throws when the RPC is unreachable. */
export async function readRecipientKind(address: string): Promise<RecipientKind> {
  const result = await rpcCall<{ value: { owner?: string; executable?: boolean } | null }>("getAccountInfo", [
    address,
    { commitment: "confirmed", encoding: "base64", dataSlice: { offset: 0, length: 0 } },
  ]);
  const value = result?.value;
  return classifyRecipient(
    value ? { owner: String(value.owner ?? ""), executable: value.executable === true } : null,
  );
}

let rentCache: { lamports: number; at: number } | null = null;
const RENT_CACHE_MS = 10 * 60_000;

/**
 * The rent-exempt minimum of a USDC token account, live: 1,488,440 lamports in
 * September 2026, down from the 2,039,280 {@link ATA_RENT_LAMPORTS} still records.
 * Pricing the fee and the co-sign budget from the live number is what keeps both
 * tight. Falls back to the old, higher constant when the RPC does not answer —
 * a looser bound, never a smaller one.
 */
export async function tokenAccountRentLamports(): Promise<number> {
  if (rentCache && Date.now() - rentCache.at < RENT_CACHE_MS) return rentCache.lamports;
  try {
    const lamports = await rpcCall<number>("getMinimumBalanceForRentExemption", [TOKEN_ACCOUNT_BYTES]);
    if (typeof lamports === "number" && Number.isFinite(lamports) && lamports > 0 && lamports < ATA_RENT_LAMPORTS * 10) {
      rentCache = { lamports, at: Date.now() };
      return lamports;
    }
  } catch (err) {
    console.warn("[sponsored] rent read failed; using the old constant", err);
  }
  return ATA_RENT_LAMPORTS;
}

/** How long a live SOL price is reused before the feeds are asked again. */
export const SOL_PRICE_FRESH_MS = 30_000;
/** The oldest live SOL price the account fee may still be priced from while both feeds are down. */
export const SOL_PRICE_MAX_AGE_MS = 5 * 60_000;

let lastLiveSolPrice: { price: number; at: number } | null = null;

/** Forget the last live SOL price. For tests. */
export function resetSolPriceCache(): void {
  lastLiveSolPrice = null;
}

const usablePrice = (price: unknown): price is number =>
  typeof price === "number" && Number.isFinite(price) && price > 0;

/**
 * SOL from the live feeds only: Jupiter, then DexScreener for whatever Jupiter refused.
 * Deliberately *not* `getPriceUsd`, which falls back to `tokens.lastPriceUsd` (of any
 * age) and then to the hard-coded `fallbackPriceUsd` — marks that keep a PnL chart
 * drawing, and exactly the numbers that would let a new account be sold below its rent.
 */
async function fetchLiveSolPrice(): Promise<number | null> {
  const [{ fetchDexScreenerPrices, fetchSolanaPrices }, { SOL_MINT }] = await Promise.all([
    import("@/lib/trading/prices"),
    import("@/lib/trading/tokens"),
  ]);
  const jupiter = (await fetchSolanaPrices([SOL_MINT])).get(SOL_MINT);
  if (usablePrice(jupiter)) return jupiter;
  const dex = (await fetchDexScreenerPrices("solana", [SOL_MINT])).get(SOL_MINT);
  return usablePrice(dex) ? dex : null;
}

/**
 * The SOL price for pricing — and re-checking — the new-account fee. A live price, or
 * the last live price for up to {@link SOL_PRICE_MAX_AGE_MS}; otherwise null, and the
 * callers refuse to open an account rather than price it from a stale mark.
 */
export async function solPriceUsd(
  deps: { fetchLive?: () => Promise<number | null>; now?: number } = {},
): Promise<number | null> {
  const now = deps.now ?? Date.now();
  if (lastLiveSolPrice && now - lastLiveSolPrice.at < SOL_PRICE_FRESH_MS) return lastLiveSolPrice.price;
  let live: number | null = null;
  try {
    live = await (deps.fetchLive ?? fetchLiveSolPrice)();
  } catch (err) {
    console.warn("[sponsored] SOL price read failed", err);
  }
  if (usablePrice(live)) {
    lastLiveSolPrice = { price: live, at: now };
    return live;
  }
  if (lastLiveSolPrice && now - lastLiveSolPrice.at <= SOL_PRICE_MAX_AGE_MS) return lastLiveSolPrice.price;
  return null;
}

// ------------------------------------------------- agent account openings

/**
 * How many agent USDC accounts the platform will open, on its own SOL, through one
 * user's sponsored funding transfers in {@link AGENT_ACCOUNT_OPEN_WINDOW_MS}.
 *
 * Opening an agent's USDC account is the one thing a sponsored *funding* transfer does
 * that the user does not pay back: ~1.49M lamports of rent that stays in an account only
 * the agent's server wallet can close. Agents are free to create, so without a count a
 * create → fund a cent → create loop strands one rent per lap. Five a day is more new
 * funded agents than anyone makes, and caps what one account can strand at ~0.0075 SOL.
 */
export const MAX_SPONSORED_AGENT_ACCOUNT_OPENS = 5;
export const AGENT_ACCOUNT_OPEN_WINDOW_MS = 24 * 60 * 60_000;

/** The refusal when the day's openings are used up. Asks for nothing the user can't do. */
export const AGENT_ACCOUNT_OPENS_USED_UP =
  `Tocker sets up Solana for up to ${MAX_SPONSORED_AGENT_ACCOUNT_OPENS} new agents a day, and yours have used that today. ` +
  "Nothing was sent — fund this agent on Solana again tomorrow.";
/** The refusal when the count could not be read. */
export const AGENT_ACCOUNT_OPENS_UNCHECKED =
  "Tocker couldn't set up this agent's Solana account just now. Nothing was sent — try again in a minute.";

/**
 * PURE. The sentence refusing this sponsored funding transfer because it would have the
 * platform open one agent USDC account too many — or null when it may go ahead. A
 * transfer into an account that already exists always may. An unreadable count is a
 * refusal: the cap exists for the case where someone is trying.
 */
export function agentAccountOpeningRefusal(input: {
  opensAccount: boolean;
  openedInWindow: number | null;
}): string | null {
  if (!input.opensAccount) return null;
  const opened = input.openedInWindow;
  if (opened === null || !Number.isFinite(opened) || opened < 0) return AGENT_ACCOUNT_OPENS_UNCHECKED;
  if (opened >= MAX_SPONSORED_AGENT_ACCOUNT_OPENS) return AGENT_ACCOUNT_OPENS_USED_UP;
  return null;
}

/**
 * How many agent USDC accounts this user's sponsored funding opened in the window, from
 * the audit log (`submitSponsoredFunding` records `openedAgentAccount` on every transfer
 * it sends). Database-backed on purpose: the in-process rate limiters reset with every
 * serverless instance, and this is the count that has to hold across them. Null when the
 * database does not answer.
 */
export async function sponsoredAgentAccountOpens(userId: string, now = Date.now()): Promise<number | null> {
  try {
    const [{ and, count, eq, gte, sql }, { auditEvents, getDb }] = await Promise.all([
      import("drizzle-orm"),
      import("@/db"),
    ]);
    const db = await getDb();
    const [row] = await db
      .select({ n: count() })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.userId, userId),
          gte(auditEvents.createdAt, new Date(now - AGENT_ACCOUNT_OPEN_WINDOW_MS)),
          sql`${auditEvents.metadata}->>'reason' = 'sponsored_funding'`,
          sql`${auditEvents.metadata}->>'openedAgentAccount' = 'true'`,
        ),
      );
    return Number(row?.n ?? 0);
  } catch (err) {
    console.error("[sponsored] could not count agent account openings", err);
    return null;
  }
}

// ------------------------------------------------------------ platform capacity

export type SponsorCapacity =
  | { ok: true; walletId: string; address: string }
  | { ok: false; error: string };

/**
 * Can the platform pay `needLamports` right now? When it is short, refuel it from its own
 * USDC (`ensurePlatformSol`) and look once more. Never asks the user for anything: when
 * the answer is still no, it is {@link FEE_WALLET_REFILLING}, and the numbers go to the
 * server log where the operator reads them.
 *
 * When it can pay but is below its comfortable floor, a refuel is scheduled after the
 * response rather than awaited — a Jupiter swap is seconds the user should not wait for.
 */
export async function ensureSponsorCapacity(input: { needLamports: number; why: string }): Promise<SponsorCapacity> {
  const [{ platformFeePayer }, { getLamports }] = await Promise.all([
    import("./solana-cosign"),
    import("./solana-rpc"),
  ]);

  let platform: { walletId: string; address: string };
  try {
    platform = await platformFeePayer();
  } catch (err) {
    console.error(`[sponsored] ${input.why}: the platform Solana wallet is unavailable`, err);
    return { ok: false, error: FEE_WALLET_REFILLING };
  }

  const read = () => getLamports(platform.address).catch(() => null);
  const first = await read();
  if (first !== null && first >= input.needLamports) {
    if (first < MIN_PLATFORM_SOL * LAMPORTS_PER_SOL) void refuelAfterResponse(input.why);
    return { ok: true, ...platform };
  }

  const { ensurePlatformSol } = await import("@/lib/platform/sol");
  const refuel = await ensurePlatformSol(input.why);
  const second = await read();
  if (second !== null && second >= input.needLamports) return { ok: true, ...platform };

  console.warn(
    `[sponsored] ${input.why}: platform ${platform.address} holds ${second ?? "an unreadable number of"} lamports, ` +
      `needs ${input.needLamports}; refuel: ${refuel.reason}`,
  );
  return { ok: false, error: second === null && first === null ? FEE_WALLET_UNREACHABLE : FEE_WALLET_REFILLING };
}

async function refuelAfterResponse(why: string): Promise<void> {
  const { ensurePlatformSol } = await import("@/lib/platform/sol");
  try {
    const { after } = await import("next/server");
    after(async () => {
      await ensurePlatformSol(why);
    });
  } catch {
    // Outside a request (a script, a test): just start it.
    void ensurePlatformSol(why);
  }
}

// ------------------------------------------------------------------- co-sign

/** How long {@link cosignSponsored} waits before its one second look. */
export const COSIGN_RETRY_DELAY_MS = 1_000;

/** PURE. True for `cosignAsPlatform`'s "would take more than its allowance" refusal. */
export function isOverBudgetRefusal(err: unknown): boolean {
  return err instanceof Error && err.name === "CosignRefused" && err.message.toLowerCase().includes("allowance");
}

/**
 * `cosignAsPlatform` for the two sponsored shapes, with one retry on an over-budget
 * refusal and on nothing else.
 *
 * Once the validator has passed, a sponsored transaction cannot cost the platform more
 * than its exact budget; an over-budget reading is the platform's own concurrent traffic
 * (an agent swap, a gas drip) landing between `cosignAsPlatform`'s unpinned balance read
 * and its simulation. A second look a moment later almost always reads one slot. The
 * budget is not widened — a retry costs nothing, since nothing is signed until the
 * check passes, whereas headroom would be lamports anyone could spend.
 */
export async function cosignSponsored(
  input: CosignInput,
  deps: { cosign?: (input: CosignInput) => Promise<string>; delayMs?: number } = {},
): Promise<string> {
  const cosign = deps.cosign ?? (await import("./solana-cosign")).cosignAsPlatform;
  try {
    return await cosign(input);
  } catch (err) {
    if (!isOverBudgetRefusal(err)) throw err;
    console.warn(`[sponsored] ${input.purpose}: over budget on the first look, looking again`, err);
    await new Promise((resolve) => setTimeout(resolve, deps.delayMs ?? COSIGN_RETRY_DELAY_MS));
    return cosign(input);
  }
}

/** Lower-cased "<program> failed: custom program error: <code>", matched on the exact code. */
function programFailed(lower: string, programId: PublicKey, code: string): boolean {
  const needle = `${programId.toBase58().toLowerCase()} failed: custom program error: ${code}`;
  let from = 0;
  for (;;) {
    const at = lower.indexOf(needle, from);
    if (at < 0) return false;
    // "0x1" must not be the front of "0x11" (AccountFrozen) or "0x1f".
    if (!/[0-9a-f]/.test(lower.charAt(at + needle.length))) return true;
    from = at + 1;
  }
}

/**
 * Turn a failed `cosignAsPlatform` (or the Privy signature under it) into one sentence
 * for the user. The raw reason goes to the server log; the user gets what they can act
 * on, and never a request to hold SOL.
 *
 * `cosignAsPlatform` quotes the JSON error and only the *last* failing log line, so a
 * cause logged earlier ("Transfer: insufficient lamports") is not in the message; the
 * program that failed, and its exact error code, are.
 */
export function explainCosignFailure(err: unknown, what: string): string {
  const raw = err instanceof Error ? err.message : String(err ?? "");
  const lower = raw.toLowerCase();
  if (err instanceof Error && err.name !== "CosignRefused") {
    return `Tocker couldn't add its fee signature to this ${what} just now. Nothing was sent — try again in a minute.`;
  }
  // The token program's error 1 is InsufficientFunds: the *user's* USDC, the only
  // balance in these transactions the token program reads.
  if (programFailed(lower, TOKEN_PROGRAM_ID, "0x1")) {
    return "You don't have that much USDC on Solana. Nothing was sent.";
  }
  // Error 17 is AccountFrozen: Circle, USDC's issuer, has frozen the sending or the
  // receiving USDC account. Nobody here can fix that, and it is not a balance problem.
  if (programFailed(lower, TOKEN_PROGRAM_ID, "0x11")) {
    return "One of the USDC accounts in this transfer has been frozen by Circle, USDC's issuer, so it can't send or receive. Nothing was sent.";
  }
  // The fee payer, or the rent it fronts, came up short: the platform's problem, not
  // theirs. When the rent is what is short, the system program's error 1
  // (ResultWithNegativeLamports) is logged inside the token-account create, and the last
  // failing line — the one quoted — is the associated-token program's own 0x1.
  if (
    lower.includes("insufficientfundsforfee") ||
    lower.includes("insufficientfundsforrent") ||
    lower.includes("accountnotfound") ||
    lower.includes("insufficient lamports") ||
    programFailed(lower, ASSOCIATED_TOKEN_PROGRAM_ID, "0x1") ||
    programFailed(lower, SystemProgram.programId, "0x1")
  ) {
    return FEE_WALLET_REFILLING;
  }
  // Over budget twice in a row (see `cosignSponsored`): the platform's own traffic, which
  // the user neither caused nor can do anything about except try again.
  if (lower.includes("allowance")) {
    return `Tocker's fee wallet was busy with another transaction. Nothing was sent — try the ${what} again.`;
  }
  if (lower.includes("would fail on chain")) {
    return `Solana would reject this ${what} as it stands, so Tocker didn't send it. Nothing moved — check the amount and try again.`;
  }
  return raw || `Tocker could not send this ${what}. Nothing was sent.`;
}

// ----------------------------------------------------------------- broadcast

/**
 * PURE. The transaction's own id — the fee payer's signature, base58 — read from the
 * signed bytes. Known before the broadcast, so a send that errors can still be looked up.
 */
export function transactionSignature(txBytes: Uint8Array): string | null {
  try {
    const signature = VersionedTransaction.deserialize(txBytes).signatures[0];
    if (!signature || signature.length !== 64 || signature.every((byte) => byte === 0)) return null;
    return base58.encode(signature);
  } catch {
    return null;
  }
}

/**
 * PURE. Does this `sendRawTransaction` failure prove the network never got the
 * transaction?
 *
 * Only a JSON-RPC error body does: the node refused it at the door (preflight, a
 * blockhash it does not know, a bad signature) and relayed nothing. Everything else —
 * the 20-second timeout, an HTTP error from a gateway, a dropped connection, a body that
 * is not JSON, an answer with no signature — can arrive *after* the node has forwarded a
 * fully signed transaction, which then lands. Those are "unknown", never "rejected".
 */
export function sendRejectedBeforeRelay(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if (err.name === "TimeoutError" || err.name === "AbortError") return false;
  if (err instanceof TypeError || err instanceof SyntaxError) return false;
  const lower = err.message.toLowerCase();
  if (/\(http \d{3}\)/.test(lower)) return false;
  if (/no signature|timeout|timed out|aborted|socket|econnreset|network/.test(lower)) return false;
  return true;
}

/** How long to look for a transaction whose send failed without saying whether it went. */
export const UNKNOWN_SEND_LOOKUP_MS = 8_000;

export type SponsoredBroadcast =
  /** Landed, or accepted and still landing (`pending`: the RPC took it; not yet confirmed). */
  | { outcome: "confirmed" | "pending"; signature: string }
  /** Landed and failed on chain: the platform paid the fee, nobody's USDC moved. */
  | { outcome: "failed"; signature: string }
  /** The node refused it before relaying: nothing moved. */
  | { outcome: "rejected"; signature: string; reason: string }
  /**
   * The send failed in a way that does not prove it was not relayed, and the network had
   * not seen it when last asked. It can still land until its blockhash expires, about a
   * minute after it was built.
   */
  | { outcome: "unknown"; signature: string; reason: string };

/**
 * Broadcast a fully signed sponsored transaction, and never claim it did not go when
 * that is not known.
 *
 * The signature is derived from the bytes first. When the send throws, that signature is
 * looked up — once for a JSON-RPC refusal (which also catches the same bytes having been
 * sent before), for {@link UNKNOWN_SEND_LOOKUP_MS} otherwise — and only a refusal the
 * network still has not seen is reported as "nothing moved".
 */
export async function broadcastSponsored(
  signedBase64: string,
  deps: {
    sendAndConfirm?: (signed: string) => Promise<{ signature: string; status: SignatureConfirmation }>;
    confirmSignature?: (
      signature: string,
      options: { timeoutMs?: number; intervalMs?: number },
    ) => Promise<SignatureConfirmation>;
    lookupMs?: number;
  } = {},
): Promise<SponsoredBroadcast> {
  const local = transactionSignature(new Uint8Array(Buffer.from(signedBase64, "base64"))) ?? "";
  const sendAndConfirm = deps.sendAndConfirm ?? (await import("./solana-cosign")).sendAndConfirm;
  try {
    const { signature, status } = await sendAndConfirm(signedBase64);
    return { outcome: status, signature: signature || local };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    const refused = sendRejectedBeforeRelay(err);
    if (local) {
      const confirmSignature = deps.confirmSignature ?? (await import("./solana-rpc")).confirmSignature;
      const seen = await confirmSignature(local, {
        timeoutMs: refused ? 0 : (deps.lookupMs ?? UNKNOWN_SEND_LOOKUP_MS),
        intervalMs: 2_000,
      }).catch((): SignatureConfirmation => "pending");
      if (seen === "confirmed" || seen === "failed") return { outcome: seen, signature: local };
    }
    console.warn(`[sponsored] broadcast ${refused ? "refused" : "unresolved"} (${local || "no signature"}): ${reason}`);
    return refused ? { outcome: "rejected", signature: local, reason } : { outcome: "unknown", signature: local, reason };
  }
}
