/**
 * Sponsored USDC funding on Solana: the app pays the fee, the user pays the USDC.
 *
 * ## Why this exists
 *
 * An operator's Privy embedded Solana wallet holds USDC and no SOL, so it cannot sign
 * anything for itself. We used to hand Privy `options: { sponsor: true }` and hope. That
 * is not how Privy's Solana gas docs describe sponsorship: the **app** runs a fee-payer
 * wallet, builds the transaction with `payerKey` set to it, the user partially signs,
 * and the backend adds the fee payer's signature and broadcasts. Tocker already runs
 * exactly such a wallet — the platform Solana wallet that pays for x402 data, drips gas
 * and pre-creates token accounts — so funding now depends on nothing but our own SOL.
 *
 * ## The protocol
 *
 *  1. `prepareSponsoredFunding` (server) builds a v0 transaction whose fee payer is the
 *     platform wallet and whose two instructions are, in order, an idempotent
 *     create-associated-token-account for the agent (paid by the platform) and a
 *     `TransferChecked` of USDC from the user to the agent (authorised by the user).
 *  2. The browser has the user sign it — `signTransaction`, never `signAndSend`: the
 *     user's wallet cannot broadcast a transaction it cannot pay for.
 *  3. `submitSponsoredFunding` (server) runs {@link validateSponsoredUsdcTransfer} over
 *     the bytes that come back, and only then asks Privy to add the platform's
 *     signature and broadcasts the result.
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
import {
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  SOLANA_USDC_DECIMALS,
  SOLANA_USDC_MINT,
  TOKEN_PROGRAM_ID,
  associatedTokenAddress,
  createAtaIdempotentInstruction,
  toBaseUnits,
  transferCheckedInstruction,
} from "./solana-transfer";

/** A v0 transaction is capped at one packet. Anything larger is not worth deserialising. */
const MAX_TRANSACTION_BYTES = 1232;

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
    // The platform pays the ~0.00204 SOL rent for the agent's USDC account. Idempotent,
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
 * Build the unsigned v0 transaction the user is asked to sign. Needs the network for a
 * blockhash unless one is supplied (which is what the tests do).
 */
export async function buildSponsoredUsdcTransfer(input: SponsoredTransferInput): Promise<Uint8Array> {
  const from = new PublicKey(input.from);
  const to = new PublicKey(input.to);
  const feePayer = new PublicKey(input.feePayer);
  if (feePayer.equals(from)) throw new Error("The fee payer cannot be the wallet the USDC comes from.");
  if (!(input.amount > 0)) throw new Error("The amount must be greater than zero.");

  let blockhash = input.blockhash;
  if (!blockhash) {
    const { getLatestBlockhash } = await import("./solana-rpc");
    blockhash = await getLatestBlockhash();
  }

  const message = new TransactionMessage({
    payerKey: feePayer,
    recentBlockhash: blockhash,
    instructions: sponsoredUsdcInstructions({ from, to, feePayer, amount: input.amount }),
  }).compileToV0Message();

  return new VersionedTransaction(message).serialize();
}

export interface SponsoredTransferExpectation {
  from: string;
  to: string;
  feePayer: string;
  amount: number;
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

const ORDINAL = ["first", "second"] as const;

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

/**
 * PURE. Is this exactly the transaction Tocker built, signed by the person it was built
 * for, and nothing else?
 *
 * Returns `{ ok: true }` only when **all** of the following hold:
 *
 *  - it deserialises as a v0 transaction of at most one packet;
 *  - it carries no address-lookup tables, so every account is visible in the message;
 *  - static account 0 — the fee payer — is `expected.feePayer`;
 *  - exactly two signatures are required, and `expected.from` is the second signer;
 *  - it has exactly two instructions, with the program ids, account keys, signer and
 *    writable flags and data bytes of the pair {@link sponsoredUsdcInstructions} builds
 *    for `expected`;
 *  - the fee payer is never the `owner` of the token transfer, only the fee payer and
 *    the account-creation payer;
 *  - the whole serialised message equals the rebuilt one byte for byte;
 *  - and the signature in `expected.from`'s slot is a real ed25519 signature over that
 *    message.
 *
 * Every other outcome is `{ ok: false, reason }`. It never throws, never reads the
 * network and never touches the database: give it the same bytes and the same
 * expectation and it gives the same answer.
 */
export function validateSponsoredUsdcTransfer(
  txBytes: Uint8Array,
  expected: SponsoredTransferExpectation,
): SponsoredTransferCheck {
  let from: PublicKey;
  let to: PublicKey;
  let feePayer: PublicKey;
  try {
    from = new PublicKey(expected.from);
    to = new PublicKey(expected.to);
    feePayer = new PublicKey(expected.feePayer);
  } catch {
    return bad("one of the three wallet addresses it should involve is not a Solana address");
  }
  if (feePayer.equals(from)) return bad("the fee payer and the sending wallet are the same wallet");
  if (feePayer.equals(to)) return bad("the fee payer and the receiving wallet are the same wallet");
  if (from.equals(to)) return bad("the sending and receiving wallets are the same wallet");
  if (!(expected.amount > 0)) return bad("the amount to transfer is not a positive number");
  if (toBaseUnits(expected.amount, SOLANA_USDC_DECIMALS) <= BigInt(0)) {
    return bad("the amount to transfer rounds to zero USDC");
  }

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
  if (message.header.numRequiredSignatures !== 2) {
    return bad(
      `it needs ${message.header.numRequiredSignatures} signatures; a sponsored funding transfer needs exactly two`,
    );
  }

  const fromIndex = keys.findIndex((key) => key.equals(from));
  if (fromIndex < 0) return bad(`the sending wallet ${from.toBase58()} is not in the transaction at all`);
  if (fromIndex >= message.header.numRequiredSignatures) {
    return bad(`the sending wallet ${from.toBase58()} is not one of its signers`);
  }

  if (message.compiledInstructions.length !== 2) {
    return bad(
      `it has ${message.compiledInstructions.length} instructions; a sponsored funding transfer has exactly two`,
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
      instructions: sponsoredUsdcInstructions({ from, to, feePayer, amount: expected.amount }),
    }).compileToV0Message();
  } catch (err) {
    return bad(`Tocker could not rebuild the transaction to compare it: ${err instanceof Error ? err.message : String(err)}`);
  }

  const programs = [ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID];
  for (let i = 0; i < 2; i += 1) {
    const programId = keys[message.compiledInstructions[i].programIdIndex];
    if (!programId || !programId.equals(programs[i])) {
      return bad(
        `its ${ORDINAL[i]} instruction calls ${programId?.toBase58() ?? "an account that is not in the message"}, not ${programs[i].toBase58()}`,
      );
    }
    const mismatch = instructionMismatch(message, rebuilt, i);
    if (mismatch) return bad(mismatch);
  }

  // Said explicitly because it is the thing that would cost the most: the platform
  // wallet is a signer on this transaction, and a `TransferChecked` whose authority is
  // the fee payer would move the *platform's* tokens under the user's instruction.
  // (`instructionMismatch` already catches it; a rule this expensive gets its own line.)
  const authorityIndex = message.compiledInstructions[1].accountKeyIndexes[3];
  const authority = keys[authorityIndex];
  if (!authority || !authority.equals(from)) {
    return bad(
      `the token transfer is authorised by ${authority?.toBase58() ?? "an account that is not in the message"}, not by the sending wallet`,
    );
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

/**
 * True when every required signature slot is filled. Run after Privy adds the platform's
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
