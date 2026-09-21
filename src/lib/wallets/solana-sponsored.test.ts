import { describe, expect, it } from "vitest";
import { createPrivateKey, sign } from "node:crypto";
import {
  AddressLookupTableAccount,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  SOLANA_USDC_DECIMALS,
  SOLANA_USDC_MINT,
  associatedTokenAddress,
  createAtaIdempotentInstruction,
  toBaseUnits,
  transferCheckedInstruction,
} from "./solana-transfer";
import {
  buildSponsoredUsdcTransfer,
  isFullySigned,
  validateSponsoredUsdcTransfer,
} from "./solana-sponsored";

/**
 * Real keypairs and real signatures throughout. The validator is the only thing standing
 * between a browser and the platform wallet co-signing whatever it is handed, so a test
 * that mocks the signing proves nothing: every fixture here is signed with the actual
 * ed25519 key (`VersionedTransaction.sign`) and verified with `node:crypto`.
 */
const user = Keypair.generate();
const agent = Keypair.generate();
const platform = Keypair.generate();
const stranger = Keypair.generate();

const BLOCKHASH = "GHtXQBsoZHVnNFa9YevAzFr17DJjgHXk3ycTKD5xD3Zi";
const AMOUNT = 10;

const expected = {
  from: user.publicKey.toBase58(),
  to: agent.publicKey.toBase58(),
  feePayer: platform.publicKey.toBase58(),
  amount: AMOUNT,
};

/** The instructions Tocker authors, as the fixtures' starting point. */
function authored(): TransactionInstruction[] {
  return [
    createAtaIdempotentInstruction({
      payer: platform.publicKey,
      owner: agent.publicKey,
      mint: SOLANA_USDC_MINT,
    }),
    transferCheckedInstruction({
      source: associatedTokenAddress(user.publicKey, SOLANA_USDC_MINT),
      destination: associatedTokenAddress(agent.publicKey, SOLANA_USDC_MINT),
      owner: user.publicKey,
      mint: SOLANA_USDC_MINT,
      amount: toBaseUnits(AMOUNT, SOLANA_USDC_DECIMALS),
      decimals: SOLANA_USDC_DECIMALS,
    }),
  ];
}

interface TamperOptions {
  instructions?: TransactionInstruction[];
  payerKey?: PublicKey;
  signers?: Keypair[];
  lookupTables?: AddressLookupTableAccount[];
}

/** Build and sign a fixture. Defaults to exactly what the server would have produced. */
function fixture(options: TamperOptions = {}): Uint8Array {
  const message = new TransactionMessage({
    payerKey: options.payerKey ?? platform.publicKey,
    recentBlockhash: BLOCKHASH,
    instructions: options.instructions ?? authored(),
  }).compileToV0Message(options.lookupTables);
  const tx = new VersionedTransaction(message);
  tx.sign(options.signers ?? [user]);
  return tx.serialize();
}

/**
 * A genuine ed25519 signature over `message` by `keypair`, made outside web3.js — which
 * refuses to sign with a key the message does not list as a signer, and that is exactly
 * the case a forgery test needs. A Solana secret key is `seed || publicKey`; the first
 * 32 bytes wrapped in the fixed PKCS8 header are the private key `node:crypto` wants.
 */
function signAs(keypair: Keypair, message: Uint8Array): Uint8Array {
  const pkcs8 = Buffer.concat([
    Buffer.from("302e020100300506032b657004220420", "hex"),
    Buffer.from(keypair.secretKey.slice(0, 32)),
  ]);
  const key = createPrivateKey({ key: pkcs8, format: "der", type: "pkcs8" });
  return new Uint8Array(sign(null, Buffer.from(message), key));
}

function reasonFor(bytes: Uint8Array): string {
  const result = validateSponsoredUsdcTransfer(bytes, expected);
  expect(result.ok).toBe(false);
  return result.ok ? "" : result.reason;
}

describe("buildSponsoredUsdcTransfer", () => {
  it("makes the platform the fee payer and the user the token authority", async () => {
    const bytes = await buildSponsoredUsdcTransfer({ ...expected, blockhash: BLOCKHASH });
    const tx = VersionedTransaction.deserialize(bytes);

    expect(tx.message.staticAccountKeys[0].toBase58()).toBe(platform.publicKey.toBase58());
    expect(tx.message.header.numRequiredSignatures).toBe(2);
    expect(tx.message.compiledInstructions).toHaveLength(2);
    expect(tx.message.addressTableLookups).toHaveLength(0);

    // Nobody has signed it yet — that is the user's job, in their own browser.
    expect(isFullySigned(bytes)).toBe(false);
  });

  it("refuses to build a transfer the platform would pay itself", async () => {
    await expect(
      buildSponsoredUsdcTransfer({ ...expected, from: expected.feePayer, blockhash: BLOCKHASH }),
    ).rejects.toThrow(/fee payer cannot be/i);
  });

  it("produces bytes the validator accepts once the user signs them", async () => {
    const unsigned = await buildSponsoredUsdcTransfer({ ...expected, blockhash: BLOCKHASH });
    const tx = VersionedTransaction.deserialize(unsigned);
    tx.sign([user]);
    expect(validateSponsoredUsdcTransfer(tx.serialize(), expected)).toEqual({ ok: true });
  });
});

describe("validateSponsoredUsdcTransfer", () => {
  it("accepts the exact transaction Tocker authored, signed by the user", () => {
    expect(validateSponsoredUsdcTransfer(fixture(), expected)).toEqual({ ok: true });
  });

  it("rejects an extra instruction", () => {
    const reason = reasonFor(
      fixture({
        instructions: [
          ...authored(),
          SystemProgram.transfer({
            fromPubkey: user.publicKey,
            toPubkey: agent.publicKey,
            lamports: 1,
          }),
        ],
      }),
    );
    expect(reason).toMatch(/3 instructions/);
  });

  it("rejects a SystemProgram transfer that drains the fee payer", () => {
    // The attack this whole module exists to stop: swap the harmless idempotent ATA
    // create for a SOL transfer out of the platform wallet and hope we co-sign it.
    const reason = reasonFor(
      fixture({
        instructions: [
          SystemProgram.transfer({
            fromPubkey: platform.publicKey,
            toPubkey: stranger.publicKey,
            lamports: 500_000_000,
          }),
          authored()[1],
        ],
        signers: [user],
      }),
    );
    expect(reason).toMatch(/11111111111111111111111111111111/);
  });

  it("rejects the fee payer being named as the token transfer's authority", () => {
    const reason = reasonFor(
      fixture({
        instructions: [
          authored()[0],
          transferCheckedInstruction({
            source: associatedTokenAddress(platform.publicKey, SOLANA_USDC_MINT),
            destination: associatedTokenAddress(stranger.publicKey, SOLANA_USDC_MINT),
            // The platform wallet moving the platform's own USDC, under our signature.
            owner: platform.publicKey,
            mint: SOLANA_USDC_MINT,
            amount: toBaseUnits(AMOUNT, SOLANA_USDC_DECIMALS),
            decimals: SOLANA_USDC_DECIMALS,
          }),
        ],
        signers: [platform],
      }),
    );
    // It never gets as far as the instruction: with the user gone, only one signature
    // is required, and a sponsored funding transfer always needs two.
    expect(reason).toMatch(/needs 1 signatures|not one of its signers|is not in the transaction/);
  });

  it("rejects the fee payer as authority even when the user is still a signer", () => {
    const reason = reasonFor(
      fixture({
        instructions: [
          authored()[0],
          // Same source and destination as the real thing, but the platform is asked to
          // authorise it; the user is kept as a signer so the header still says two.
          new TransactionInstruction({
            programId: authored()[1].programId,
            keys: [
              { pubkey: associatedTokenAddress(user.publicKey, SOLANA_USDC_MINT), isSigner: false, isWritable: true },
              { pubkey: SOLANA_USDC_MINT, isSigner: false, isWritable: false },
              { pubkey: associatedTokenAddress(agent.publicKey, SOLANA_USDC_MINT), isSigner: false, isWritable: true },
              { pubkey: platform.publicKey, isSigner: true, isWritable: false },
              { pubkey: user.publicKey, isSigner: true, isWritable: false },
            ],
            data: authored()[1].data,
          }),
        ],
      }),
    );
    expect(reason).toMatch(/accounts, not 4|authorised by|account 3/);
  });

  it("rejects a different amount", () => {
    const reason = reasonFor(
      fixture({
        instructions: [
          authored()[0],
          transferCheckedInstruction({
            source: associatedTokenAddress(user.publicKey, SOLANA_USDC_MINT),
            destination: associatedTokenAddress(agent.publicKey, SOLANA_USDC_MINT),
            owner: user.publicKey,
            mint: SOLANA_USDC_MINT,
            amount: toBaseUnits(AMOUNT * 100, SOLANA_USDC_DECIMALS),
            decimals: SOLANA_USDC_DECIMALS,
          }),
        ],
      }),
    );
    expect(reason).toMatch(/a different amount/);
  });

  it("rejects a different destination", () => {
    const reason = reasonFor(
      fixture({
        instructions: [
          createAtaIdempotentInstruction({
            payer: platform.publicKey,
            owner: stranger.publicKey,
            mint: SOLANA_USDC_MINT,
          }),
          transferCheckedInstruction({
            source: associatedTokenAddress(user.publicKey, SOLANA_USDC_MINT),
            destination: associatedTokenAddress(stranger.publicKey, SOLANA_USDC_MINT),
            owner: user.publicKey,
            mint: SOLANA_USDC_MINT,
            amount: toBaseUnits(AMOUNT, SOLANA_USDC_DECIMALS),
            decimals: SOLANA_USDC_DECIMALS,
          }),
        ],
      }),
    );
    expect(reason).toMatch(/account \d of its (first|second) instruction is/);
  });

  it("rejects a transaction the user has not signed", () => {
    expect(reasonFor(fixture({ signers: [] }))).toMatch(/has not signed/);
  });

  it("rejects a signature that does not verify", () => {
    const message = new TransactionMessage({
      payerKey: platform.publicKey,
      recentBlockhash: BLOCKHASH,
      instructions: authored(),
    }).compileToV0Message();
    const tx = new VersionedTransaction(message);
    tx.sign([user]);
    const index = tx.message.staticAccountKeys.findIndex((key) => key.equals(user.publicKey));
    tx.signatures[index][0] ^= 0xff;
    expect(reasonFor(tx.serialize())).toMatch(/does not match this transaction/);
  });

  it("rejects a real signature made by somebody else over the same message", () => {
    // The sharpest version of the signature check: a well-formed, genuinely valid
    // ed25519 signature over exactly this message — by the wrong key. Only verifying
    // against the *sender's* public key catches it.
    const message = new TransactionMessage({
      payerKey: platform.publicKey,
      recentBlockhash: BLOCKHASH,
      instructions: authored(),
    }).compileToV0Message();
    const tx = new VersionedTransaction(message);
    tx.sign([user]);
    const index = tx.message.staticAccountKeys.findIndex((key) => key.equals(user.publicKey));
    tx.signatures[index] = signAs(stranger, message.serialize());
    expect(reasonFor(tx.serialize())).toMatch(/does not match this transaction/);
  });

  it("rejects a message that hides accounts in an address lookup table", () => {
    const lookup = new AddressLookupTableAccount({
      key: Keypair.generate().publicKey,
      state: {
        deactivationSlot: BigInt("18446744073709551615"),
        lastExtendedSlot: 0,
        lastExtendedSlotStartIndex: 0,
        authority: undefined,
        addresses: [
          associatedTokenAddress(agent.publicKey, SOLANA_USDC_MINT),
          associatedTokenAddress(user.publicKey, SOLANA_USDC_MINT),
        ],
      },
    });
    const bytes = fixture({ lookupTables: [lookup] });
    // Sanity: the fixture really did move accounts into the table.
    expect(VersionedTransaction.deserialize(bytes).message.addressTableLookups.length).toBeGreaterThan(0);
    expect(reasonFor(bytes)).toMatch(/address lookup tables/);
  });

  it("rejects a transaction the user pays for themselves", () => {
    const reason = reasonFor(fixture({ payerKey: user.publicKey, signers: [user] }));
    expect(reason).toMatch(/fee payer is/);
  });

  it("rejects bytes that are not a transaction at all", () => {
    expect(reasonFor(Uint8Array.from([1, 2, 3, 4, 5]))).toMatch(/not a Solana transaction/);
    expect(reasonFor(new Uint8Array(0))).toMatch(/empty/);
    expect(reasonFor(new Uint8Array(4096))).toMatch(/larger than a Solana transaction/);
  });

  it("rejects an expectation that would have the platform pay itself", () => {
    const result = validateSponsoredUsdcTransfer(fixture(), { ...expected, from: expected.feePayer });
    expect(result.ok).toBe(false);
  });

  it("rejects a zero or negative amount without looking at the bytes", () => {
    expect(validateSponsoredUsdcTransfer(fixture(), { ...expected, amount: 0 }).ok).toBe(false);
    expect(validateSponsoredUsdcTransfer(fixture(), { ...expected, amount: -1 }).ok).toBe(false);
  });
});

describe("isFullySigned", () => {
  it("is false until both signatures are on it, and true after", () => {
    const message = new TransactionMessage({
      payerKey: platform.publicKey,
      recentBlockhash: BLOCKHASH,
      instructions: authored(),
    }).compileToV0Message();

    const unsigned = new VersionedTransaction(message);
    expect(isFullySigned(unsigned.serialize())).toBe(false);

    const partial = new VersionedTransaction(message);
    partial.sign([user]);
    expect(isFullySigned(partial.serialize())).toBe(false);

    // What Privy is expected to return: the user's signature still there, the platform's
    // added. The validator must still accept it — a backend that re-serialised the
    // user's signature away would fail here rather than on chain.
    const full = VersionedTransaction.deserialize(partial.serialize());
    full.sign([platform]);
    expect(isFullySigned(full.serialize())).toBe(true);
    expect(validateSponsoredUsdcTransfer(full.serialize(), expected)).toEqual({ ok: true });
  });

  it("is false for rubbish", () => {
    expect(isFullySigned(Uint8Array.from([9, 9, 9]))).toBe(false);
  });
});
