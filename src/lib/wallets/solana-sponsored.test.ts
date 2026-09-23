import { describe, expect, it, vi } from "vitest";
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
import { base58 } from "@scure/base";
import {
  AGENT_ACCOUNT_OPENS_UNCHECKED,
  AGENT_ACCOUNT_OPENS_USED_UP,
  FEE_WALLET_REFILLING,
  MAX_NEW_ACCOUNT_FEE_USDC,
  MAX_SPONSORED_AGENT_ACCOUNT_OPENS,
  MIN_NEW_ACCOUNT_FEE_USDC,
  MIN_SPONSORED_FUNDING_USDC,
  SOL_PRICE_FRESH_MS,
  SOL_PRICE_MAX_AGE_MS,
  agentAccountOpeningRefusal,
  broadcastSponsored,
  buildSponsoredUsdcTransfer,
  buildSponsoredUsdcWithdrawal,
  classifyRecipient,
  cosignSponsored,
  explainCosignFailure,
  isFullySigned,
  isOverBudgetRefusal,
  newAccountFeeUsdc,
  sendRejectedBeforeRelay,
  transactionSignature,
  reimbursementCoversRent,
  resetSolPriceCache,
  solPriceUsd,
  sponsoredCosignBudgetLamports,
  sponsorReserveLamports,
  validateSponsoredUsdcTransfer,
  validateSponsoredUsdcWithdrawal,
  type SponsoredWithdrawalExpectation,
} from "./solana-sponsored";
import { CosignRefused, type CosignInput } from "./solana-cosign";
import type { SignatureConfirmation } from "./solana-rpc";

type Lookup = (signature: string, options: { timeoutMs?: number; intervalMs?: number }) => Promise<SignatureConfirmation>;

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

  it("rejects dust under a cent, which only ever makes the platform pay a fee for nothing", async () => {
    const dust = validateSponsoredUsdcTransfer(fixture(), { ...expected, amount: 0.000001 });
    expect(dust.ok).toBe(false);
    expect(dust.ok ? "" : dust.reason).toMatch(/minimum/);
    await expect(buildSponsoredUsdcTransfer({ ...expected, amount: 0.001, blockhash: BLOCKHASH })).rejects.toThrow(
      /at least/,
    );
  });

  it("still sponsors a small split leg — a plan's minimum is on the total, not per chain", async () => {
    const leg = 0.24;
    expect(leg).toBeGreaterThanOrEqual(MIN_SPONSORED_FUNDING_USDC);
    const bytes = await buildSponsoredUsdcTransfer({ ...expected, amount: leg, blockhash: BLOCKHASH });
    const tx = VersionedTransaction.deserialize(bytes);
    tx.sign([user]);
    expect(validateSponsoredUsdcTransfer(tx.serialize(), { ...expected, amount: leg })).toEqual({ ok: true });
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

// ------------------------------------------------------------------ withdrawals

/**
 * A sponsored withdrawal to an arbitrary address. Same keys and the same real signatures
 * as above; `recipient` is somebody outside Tocker — an exchange deposit address.
 */
const recipient = Keypair.generate();
const WITHDRAW = 25;
const FEE = 0.36;

const toExisting: SponsoredWithdrawalExpectation = {
  from: user.publicKey.toBase58(),
  to: recipient.publicKey.toBase58(),
  feePayer: platform.publicKey.toBase58(),
  amount: WITHDRAW,
  createRecipientAccount: false,
  reimbursementUsdc: 0,
};
const toNew: SponsoredWithdrawalExpectation = {
  ...toExisting,
  createRecipientAccount: true,
  reimbursementUsdc: FEE,
};

function usdcTransfer(input: { to: PublicKey; amount: number; owner?: PublicKey; from?: PublicKey }) {
  const from = input.from ?? user.publicKey;
  return transferCheckedInstruction({
    source: associatedTokenAddress(from, SOLANA_USDC_MINT),
    destination: associatedTokenAddress(input.to, SOLANA_USDC_MINT),
    owner: input.owner ?? from,
    mint: SOLANA_USDC_MINT,
    amount: toBaseUnits(input.amount, SOLANA_USDC_DECIMALS),
    decimals: SOLANA_USDC_DECIMALS,
  });
}

/** What Tocker authors for a recipient whose USDC account already exists. */
const existingShape = () => [usdcTransfer({ to: recipient.publicKey, amount: WITHDRAW })];

/** What Tocker authors when the recipient's USDC account has to be opened. */
const newShape = () => [
  createAtaIdempotentInstruction({ payer: platform.publicKey, owner: recipient.publicKey, mint: SOLANA_USDC_MINT }),
  usdcTransfer({ to: recipient.publicKey, amount: WITHDRAW }),
  usdcTransfer({ to: platform.publicKey, amount: FEE }),
];

function withdrawalReason(bytes: Uint8Array, expectation: SponsoredWithdrawalExpectation): string {
  const result = validateSponsoredUsdcWithdrawal(bytes, expectation);
  expect(result.ok).toBe(false);
  return result.ok ? "" : result.reason;
}

describe("buildSponsoredUsdcWithdrawal", () => {
  it("is one user-authorised transfer when the recipient's account exists, and the platform only pays the fee", async () => {
    const bytes = await buildSponsoredUsdcWithdrawal({ ...toExisting, blockhash: BLOCKHASH });
    const { message } = VersionedTransaction.deserialize(bytes);

    expect(message.staticAccountKeys[0].toBase58()).toBe(platform.publicKey.toBase58());
    expect(message.header.numRequiredSignatures).toBe(2);
    expect(message.addressTableLookups).toHaveLength(0);
    expect(message.compiledInstructions).toHaveLength(1);
    // The platform is in no instruction at all: it cannot be charged anything but the fee.
    const platformIndex = 0;
    expect(message.compiledInstructions[0].accountKeyIndexes).not.toContain(platformIndex);
    // The authority of the transfer is the user.
    const authority = message.staticAccountKeys[message.compiledInstructions[0].accountKeyIndexes[3]];
    expect(authority.toBase58()).toBe(user.publicKey.toBase58());
    expect(isFullySigned(bytes)).toBe(false);
  });

  it("opens the recipient's account and reimburses the platform in USDC when it does not exist", async () => {
    const bytes = await buildSponsoredUsdcWithdrawal({ ...toNew, blockhash: BLOCKHASH });
    const { message } = VersionedTransaction.deserialize(bytes);
    const keys = message.staticAccountKeys;

    expect(message.compiledInstructions).toHaveLength(3);
    const [create, send, reimburse] = message.compiledInstructions;
    // The create is paid by the platform and opens the *recipient's* USDC account.
    expect(keys[create.accountKeyIndexes[0]].toBase58()).toBe(platform.publicKey.toBase58());
    expect(keys[create.accountKeyIndexes[2]].toBase58()).toBe(recipient.publicKey.toBase58());
    // The reimbursement goes to the platform's USDC account, authorised by the user.
    expect(keys[reimburse.accountKeyIndexes[2]].toBase58()).toBe(
      associatedTokenAddress(platform.publicKey, SOLANA_USDC_MINT).toBase58(),
    );
    expect(keys[reimburse.accountKeyIndexes[3]].toBase58()).toBe(user.publicKey.toBase58());
    const reimbursed = Buffer.from(reimburse.data).readBigUInt64LE(1);
    expect(reimbursed).toBe(BigInt(360_000));
    const sent = Buffer.from(send.data).readBigUInt64LE(1);
    expect(sent).toBe(BigInt(25_000_000));
  });

  it("produces bytes the validator accepts once the user signs them, in both shapes", async () => {
    for (const expectation of [toExisting, toNew]) {
      const tx = VersionedTransaction.deserialize(
        await buildSponsoredUsdcWithdrawal({ ...expectation, blockhash: BLOCKHASH }),
      );
      tx.sign([user]);
      expect(validateSponsoredUsdcWithdrawal(tx.serialize(), expectation)).toEqual({ ok: true });
    }
  });

  it("refuses to author a new account without a reimbursement, or a fee without a new account", async () => {
    await expect(
      buildSponsoredUsdcWithdrawal({ ...toNew, reimbursementUsdc: 0, blockhash: BLOCKHASH }),
    ).rejects.toThrow(/without reimbursing/);
    await expect(
      buildSponsoredUsdcWithdrawal({ ...toExisting, reimbursementUsdc: FEE, blockhash: BLOCKHASH }),
    ).rejects.toThrow(/already exists/);
    await expect(
      buildSponsoredUsdcWithdrawal({ ...toExisting, amount: 0.5, blockhash: BLOCKHASH }),
    ).rejects.toThrow(/minimum/);
    await expect(
      buildSponsoredUsdcWithdrawal({ ...toExisting, to: toExisting.feePayer, blockhash: BLOCKHASH }),
    ).rejects.toThrow(/same wallet/);
  });
});

describe("validateSponsoredUsdcWithdrawal", () => {
  it("accepts exactly what Tocker authored, and a fully co-signed copy of it", () => {
    expect(validateSponsoredUsdcWithdrawal(fixture({ instructions: existingShape() }), toExisting)).toEqual({ ok: true });
    expect(validateSponsoredUsdcWithdrawal(fixture({ instructions: newShape() }), toNew)).toEqual({ ok: true });

    const full = VersionedTransaction.deserialize(fixture({ instructions: newShape() }));
    full.sign([platform]);
    expect(isFullySigned(full.serialize())).toBe(true);
    expect(validateSponsoredUsdcWithdrawal(full.serialize(), toNew)).toEqual({ ok: true });
  });

  it("rejects a tampered destination", () => {
    const reason = withdrawalReason(
      fixture({ instructions: [usdcTransfer({ to: stranger.publicKey, amount: WITHDRAW })] }),
      toExisting,
    );
    expect(reason).toMatch(/account 2 of its first instruction is/);
  });

  it("rejects a tampered amount", () => {
    const reason = withdrawalReason(
      fixture({ instructions: [usdcTransfer({ to: recipient.publicKey, amount: WITHDRAW + 1 })] }),
      toExisting,
    );
    expect(reason).toMatch(/a different amount/);
  });

  it("rejects a lowered reimbursement", () => {
    const reason = withdrawalReason(
      fixture({
        instructions: [
          newShape()[0],
          newShape()[1],
          usdcTransfer({ to: platform.publicKey, amount: MIN_NEW_ACCOUNT_FEE_USDC - 0.01 }),
        ],
      }),
      toNew,
    );
    expect(reason).toMatch(/the data of its third instruction/);
  });

  it("rejects a reimbursement redirected away from the platform", () => {
    const reason = withdrawalReason(
      fixture({ instructions: [newShape()[0], newShape()[1], usdcTransfer({ to: stranger.publicKey, amount: FEE })] }),
      toNew,
    );
    expect(reason).toMatch(/account 2 of its third instruction is/);
  });

  it("rejects an extra instruction", () => {
    const reason = withdrawalReason(
      fixture({
        instructions: [
          ...existingShape(),
          SystemProgram.transfer({ fromPubkey: platform.publicKey, toPubkey: stranger.publicKey, lamports: 1 }),
        ],
      }),
      toExisting,
    );
    expect(reason).toMatch(/2 instructions; a sponsored withdrawal has exactly one/);
  });

  it("rejects a SOL drain swapped in for the account creation", () => {
    const reason = withdrawalReason(
      fixture({
        instructions: [
          SystemProgram.transfer({ fromPubkey: platform.publicKey, toPubkey: stranger.publicKey, lamports: 500_000_000 }),
          newShape()[1],
          newShape()[2],
        ],
      }),
      toNew,
    );
    expect(reason).toMatch(/11111111111111111111111111111111/);
  });

  it("rejects a different fee payer", () => {
    expect(
      withdrawalReason(fixture({ instructions: existingShape(), payerKey: stranger.publicKey, signers: [user] }), toExisting),
    ).toMatch(/fee payer is/);
    // The user paying for themselves is a different fee payer too — Tocker only co-signs
    // what it pays for, and only what it pays for is what it built.
    expect(
      withdrawalReason(fixture({ instructions: existingShape(), payerKey: user.publicKey, signers: [user] }), toExisting),
    ).toMatch(/fee payer is/);
  });

  it("rejects a new account with no reimbursement in the bytes", () => {
    // What an attacker would like: the platform opens (and pays rent on) an account that
    // they can close later and keep the rent — and pays nothing for it.
    const reason = withdrawalReason(fixture({ instructions: [newShape()[0], newShape()[1]] }), toNew);
    expect(reason).toMatch(/2 instructions; a sponsored withdrawal has exactly three/);
  });

  it("rejects an expectation that opens an account without a reimbursement", () => {
    const reason = withdrawalReason(fixture({ instructions: [newShape()[0], newShape()[1]] }), {
      ...toNew,
      reimbursementUsdc: 0,
    });
    expect(reason).toMatch(/without reimbursing/);
  });

  it("rejects a reimbursement when the recipient's account already exists", () => {
    // Bytes with the fee, expectation without the account creation: the server read the
    // chain at submit and the account is there, so no fee is owed and none may be taken.
    expect(withdrawalReason(fixture({ instructions: newShape() }), toExisting)).toMatch(
      /3 instructions; a sponsored withdrawal has exactly one/,
    );
    // And a client that echoes the fee back for an existing account is refused before
    // the bytes are even looked at.
    expect(withdrawalReason(fixture({ instructions: newShape() }), { ...toExisting, reimbursementUsdc: FEE })).toMatch(
      /already exists/,
    );
    // Nor may the fee ride along without the create.
    expect(
      withdrawalReason(fixture({ instructions: [...existingShape(), usdcTransfer({ to: platform.publicKey, amount: FEE })] }), toExisting),
    ).toMatch(/2 instructions/);
  });

  it("rejects the platform named as the authority of the transfer", () => {
    const reason = withdrawalReason(
      fixture({
        instructions: [
          usdcTransfer({ from: platform.publicKey, to: recipient.publicKey, amount: WITHDRAW, owner: platform.publicKey }),
        ],
        signers: [platform],
      }),
      toExisting,
    );
    expect(reason).toMatch(/needs 1 signatures|not one of its signers|is not in the transaction/);
  });

  it("rejects a transaction the user has not signed, or somebody else signed", () => {
    expect(withdrawalReason(fixture({ instructions: existingShape(), signers: [] }), toExisting)).toMatch(/has not signed/);

    const message = new TransactionMessage({
      payerKey: platform.publicKey,
      recentBlockhash: BLOCKHASH,
      instructions: existingShape(),
    }).compileToV0Message();
    const tx = new VersionedTransaction(message);
    const index = message.staticAccountKeys.findIndex((key) => key.equals(user.publicKey));
    tx.signatures[index] = signAs(stranger, message.serialize());
    expect(withdrawalReason(tx.serialize(), toExisting)).toMatch(/does not match this transaction/);
  });

  it("rejects an amount under the minimum, and a fee above the ceiling", () => {
    expect(withdrawalReason(fixture({ instructions: existingShape() }), { ...toExisting, amount: 0.99 })).toMatch(/minimum/);
    expect(
      withdrawalReason(fixture({ instructions: newShape() }), { ...toNew, reimbursementUsdc: MAX_NEW_ACCOUNT_FEE_USDC + 1 }),
    ).toMatch(/more than Tocker ever charges/);
  });

  it("rejects a withdrawal to the platform, or to the sender", () => {
    expect(withdrawalReason(fixture({ instructions: existingShape() }), { ...toExisting, to: toExisting.feePayer })).toMatch(
      /same wallet/,
    );
    expect(withdrawalReason(fixture({ instructions: existingShape() }), { ...toExisting, to: toExisting.from })).toMatch(
      /same wallet/,
    );
  });
});

describe("newAccountFeeUsdc", () => {
  const RENT = 1_488_440; // getMinimumBalanceForRentExemption(165), September 2026

  it("is the rent's dollar value plus 20%, rounded up to the cent", () => {
    // 0.00148844 SOL × $200 × 1.2 = $0.3572… → $0.36
    expect(newAccountFeeUsdc({ rentLamports: RENT, solPriceUsd: 200 })).toBe(0.36);
    // × $400 → $0.7144… → $0.72
    expect(newAccountFeeUsdc({ rentLamports: RENT, solPriceUsd: 400 })).toBe(0.72);
  });

  it("never goes under $0.25", () => {
    expect(newAccountFeeUsdc({ rentLamports: RENT, solPriceUsd: 50 })).toBe(MIN_NEW_ACCOUNT_FEE_USDC);
  });

  it("refuses to price without a price, or with one that implies a broken feed", () => {
    expect(newAccountFeeUsdc({ rentLamports: RENT, solPriceUsd: null })).toBeNull();
    expect(newAccountFeeUsdc({ rentLamports: RENT, solPriceUsd: 0 })).toBeNull();
    expect(newAccountFeeUsdc({ rentLamports: RENT, solPriceUsd: 10_000 })).toBeNull();
    expect(newAccountFeeUsdc({ rentLamports: 0, solPriceUsd: 200 })).toBeNull();
  });
});

describe("reimbursementCoversRent", () => {
  const RENT = 1_488_440;

  it("accepts the quoted fee after SOL moved within the margin", () => {
    // Quoted at $200 → $0.36. SOL at $220 now: the rent plus 5% is $0.344 — still covered.
    expect(reimbursementCoversRent({ feeUsdc: 0.36, rentLamports: RENT, solPriceUsd: 220 })).toEqual({ ok: true });
    // The quote itself, re-checked at the price it was quoted at.
    const quoted = newAccountFeeUsdc({ rentLamports: RENT, solPriceUsd: 200 }) ?? 0;
    expect(reimbursementCoversRent({ feeUsdc: quoted, rentLamports: RENT, solPriceUsd: 200 })).toEqual({ ok: true });
  });

  it("refuses a fee that no longer covers the rent", () => {
    const result = reimbursementCoversRent({ feeUsdc: 0.36, rentLamports: RENT, solPriceUsd: 300 });
    expect(result.ok).toBe(false);
    // Quoted at $200, SOL up 20% by the hold-to-confirm: the 5% floor margin is gone.
    expect(reimbursementCoversRent({ feeUsdc: 0.36, rentLamports: RENT, solPriceUsd: 240 }).ok).toBe(false);
  });

  it("refuses an echoed fee of the bare rent value — open, close, keep the rent, repeat", () => {
    // SOL at $200: the rent is worth $0.2977. A client that echoes max($0.25, rent) — $0.30
    // — instead of the $0.36 it was quoted leaves the platform the signatures and the
    // refuel swap, and the attacker the rent back when they close the account.
    const bare = Math.ceil((RENT / 1e9) * 200 * 100) / 100;
    expect(bare).toBe(0.3);
    const result = reimbursementCoversRent({ feeUsdc: bare, rentLamports: RENT, solPriceUsd: 200 });
    expect(result).toEqual({ ok: false, reason: expect.stringContaining("no longer covers") });
    // At $250 the $0.25 floor is below the rent itself ($0.372).
    expect(reimbursementCoversRent({ feeUsdc: MIN_NEW_ACCOUNT_FEE_USDC, rentLamports: RENT, solPriceUsd: 250 }).ok).toBe(false);
  });

  it("refuses to open an account with no live price, instead of trusting the floor", () => {
    // Before: no price at submit meant the $0.25 floor alone decided — under the rent
    // whenever SOL is above ~$168.
    const result = reimbursementCoversRent({ feeUsdc: 0.25, rentLamports: RENT, solPriceUsd: null });
    expect(result).toEqual({ ok: false, reason: expect.stringContaining("no live SOL price") });
    expect(reimbursementCoversRent({ feeUsdc: 1, rentLamports: RENT, solPriceUsd: Number.NaN }).ok).toBe(false);
    expect(reimbursementCoversRent({ feeUsdc: 1, rentLamports: 0, solPriceUsd: 200 }).ok).toBe(false);
  });

  it("refuses a fee under the floor or over the ceiling, price or no price", () => {
    expect(reimbursementCoversRent({ feeUsdc: 0.2, rentLamports: RENT, solPriceUsd: null }).ok).toBe(false);
    expect(reimbursementCoversRent({ feeUsdc: 0.2, rentLamports: RENT, solPriceUsd: 50 }).ok).toBe(false);
    expect(reimbursementCoversRent({ feeUsdc: 6, rentLamports: RENT, solPriceUsd: 200 }).ok).toBe(false);
    expect(reimbursementCoversRent({ feeUsdc: Number.NaN, rentLamports: RENT, solPriceUsd: 200 }).ok).toBe(false);
    expect(reimbursementCoversRent({ feeUsdc: 0.25, rentLamports: RENT, solPriceUsd: 50 })).toEqual({ ok: true });
  });
});

describe("solPriceUsd", () => {
  const T0 = 1_800_000_000_000;

  it("prices from the live feeds, and reuses a live price for a moment", async () => {
    resetSolPriceCache();
    const fetchLive = vi.fn(async () => 117.34);
    expect(await solPriceUsd({ fetchLive, now: T0 })).toBe(117.34);
    expect(await solPriceUsd({ fetchLive, now: T0 + SOL_PRICE_FRESH_MS - 1 })).toBe(117.34);
    expect(fetchLive).toHaveBeenCalledTimes(1);
  });

  it("is null when no feed answers and there is no recent live price — never a stored or hard-coded mark", async () => {
    // The old path went through getPriceUsd, which answers with tokens.lastPriceUsd of any
    // age and then the constant $99.86: a new account priced from that is sold under rent.
    resetSolPriceCache();
    expect(await solPriceUsd({ fetchLive: async () => null, now: T0 })).toBeNull();
    expect(
      await solPriceUsd({
        fetchLive: async () => {
          throw new Error("HTTP 429");
        },
        now: T0,
      }),
    ).toBeNull();
    expect(await solPriceUsd({ fetchLive: async () => 0, now: T0 })).toBeNull();
  });

  it("bridges a feed outage with the last live price, but only up to its maximum age", async () => {
    resetSolPriceCache();
    expect(await solPriceUsd({ fetchLive: async () => 150, now: T0 })).toBe(150);
    const down = async () => null;
    expect(await solPriceUsd({ fetchLive: down, now: T0 + SOL_PRICE_MAX_AGE_MS })).toBe(150);
    expect(await solPriceUsd({ fetchLive: down, now: T0 + SOL_PRICE_MAX_AGE_MS + 1 })).toBeNull();
  });
});

describe("agentAccountOpeningRefusal", () => {
  it("never limits a transfer into an agent account that already exists", () => {
    expect(agentAccountOpeningRefusal({ opensAccount: false, openedInWindow: 999 })).toBeNull();
    expect(agentAccountOpeningRefusal({ opensAccount: false, openedInWindow: null })).toBeNull();
  });

  it("lets a user's first few new agents through", () => {
    expect(agentAccountOpeningRefusal({ opensAccount: true, openedInWindow: 0 })).toBeNull();
    expect(
      agentAccountOpeningRefusal({ opensAccount: true, openedInWindow: MAX_SPONSORED_AGENT_ACCOUNT_OPENS - 1 }),
    ).toBeNull();
  });

  it("stops the create → fund a cent → create loop that strands one rent per lap", () => {
    expect(agentAccountOpeningRefusal({ opensAccount: true, openedInWindow: MAX_SPONSORED_AGENT_ACCOUNT_OPENS })).toBe(
      AGENT_ACCOUNT_OPENS_USED_UP,
    );
    expect(agentAccountOpeningRefusal({ opensAccount: true, openedInWindow: 130 })).toBe(AGENT_ACCOUNT_OPENS_USED_UP);
    expect(AGENT_ACCOUNT_OPENS_USED_UP).not.toMatch(/\bSOL\b|gas|rent/i);
  });

  it("refuses when the count cannot be read", () => {
    expect(agentAccountOpeningRefusal({ opensAccount: true, openedInWindow: null })).toBe(AGENT_ACCOUNT_OPENS_UNCHECKED);
    expect(agentAccountOpeningRefusal({ opensAccount: true, openedInWindow: Number.NaN })).toBe(
      AGENT_ACCOUNT_OPENS_UNCHECKED,
    );
  });
});

describe("co-sign budgets", () => {
  it("is two signatures, plus the rent only when an account is opened", () => {
    expect(sponsoredCosignBudgetLamports({ opensAccount: false, rentLamports: 1_488_440 })).toBe(10_000);
    expect(sponsoredCosignBudgetLamports({ opensAccount: true, rentLamports: 1_488_440 })).toBe(1_498_440);
  });

  it("keeps a margin on top for the balance check", () => {
    expect(sponsorReserveLamports({ opensAccount: false, rentLamports: 1_488_440 })).toBeGreaterThan(10_000);
  });
});

describe("classifyRecipient", () => {
  it("treats a never-used address and a system wallet as a wallet", () => {
    expect(classifyRecipient(null)).toBe("wallet");
    expect(classifyRecipient({ owner: "11111111111111111111111111111111", executable: false })).toBe("wallet");
  });

  it("catches a token account pasted where a wallet address belongs", () => {
    expect(classifyRecipient({ owner: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", executable: false })).toBe(
      "token_account",
    );
    expect(classifyRecipient({ owner: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb", executable: false })).toBe(
      "token_account",
    );
  });

  it("catches a program id", () => {
    expect(classifyRecipient({ owner: "BPFLoaderUpgradeab1e11111111111111111111111", executable: true })).toBe("program");
  });
});

describe("explainCosignFailure", () => {
  it("names the user's USDC when the token program says insufficient funds", () => {
    const err = new CosignRefused(
      'the sponsored withdrawal would fail on chain ({"InstructionError":[0,{"Custom":1}]}: Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA failed: custom program error: 0x1)',
    );
    expect(explainCosignFailure(err, "withdrawal")).toMatch(/don't have that much USDC/);
  });

  it("turns the platform being short into the refilling sentence, never a request for SOL", () => {
    const err = new CosignRefused('the sponsored withdrawal would fail on chain ("InsufficientFundsForFee")');
    const message = explainCosignFailure(err, "withdrawal");
    expect(message).toMatch(/refilling/);
    expect(message).not.toMatch(/SOL\b/);
  });

  it("says nothing was sent when the platform's own signature failed", () => {
    expect(explainCosignFailure(new Error("Privy 500"), "withdrawal")).toMatch(/Nothing was sent/);
  });

  /** What `cosignAsPlatform` throws for a failed simulation: the JSON error and the last failing line. */
  const simulationRefusal = (err: string, lastLine: string) =>
    new CosignRefused(`the sponsored withdrawal would fail on chain (${err}: ${lastLine})`);

  it("matches the token program's error code exactly: 0x11 is a frozen account, not a short balance", () => {
    const frozen = explainCosignFailure(
      simulationRefusal(
        '{"InstructionError":[0,{"Custom":17}]}',
        "Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA failed: custom program error: 0x11",
      ),
      "withdrawal",
    );
    expect(frozen).not.toMatch(/don't have that much/);
    expect(frozen).toMatch(/frozen/);
    expect(frozen).toMatch(/Nothing was sent/);

    for (const code of ["0x10", "0x12", "0x1f"]) {
      const message = explainCosignFailure(
        simulationRefusal(
          '{"InstructionError":[0,{"Custom":18}]}',
          `Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA failed: custom program error: ${code}`,
        ),
        "withdrawal",
      );
      expect(message).not.toMatch(/don't have that much/);
    }
  });

  it("reads the platform running short of the rent it fronts as the refilling sentence", () => {
    // The system program's "Transfer: insufficient lamports" is logged earlier; the line
    // `cosignAsPlatform` quotes is the associated-token program's own failure.
    const ata = explainCosignFailure(
      simulationRefusal(
        '{"InstructionError":[0,{"Custom":1}]}',
        "Program ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL failed: custom program error: 0x1",
      ),
      "funding transfer",
    );
    expect(ata).toBe(FEE_WALLET_REFILLING);

    const system = explainCosignFailure(
      simulationRefusal(
        '{"InstructionError":[0,{"Custom":1}]}',
        "Program 11111111111111111111111111111111 failed: custom program error: 0x1",
      ),
      "withdrawal",
    );
    expect(system).toBe(FEE_WALLET_REFILLING);
  });

  it("calls an over-budget refusal the fee wallet being busy, and never blames the recipient", () => {
    const err = new CosignRefused(
      "the sponsored funding transfer would take 1.687631 SOL from Tocker's fee wallet, over its 0.000010 SOL allowance",
    );
    const message = explainCosignFailure(err, "funding transfer");
    expect(message).toMatch(/busy/);
    expect(message).toMatch(/Nothing was sent/);
    expect(message).not.toMatch(/recipient/i);
    expect(message).not.toMatch(/SOL\b/);
  });

  it("turns any other simulation failure into a sentence, not a JSON blob", () => {
    const message = explainCosignFailure(
      simulationRefusal(
        '{"InstructionError":[1,"IncorrectProgramId"]}',
        "Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA failed: incorrect program id for instruction",
      ),
      "withdrawal",
    );
    expect(message).not.toMatch(/InstructionError|Tokenkeg/);
    expect(message).toMatch(/Nothing moved/);
  });
});

describe("cosignSponsored", () => {
  const input = { transactionBase64: "AA==", maxOutflowLamports: 10_000, purpose: "sponsored withdrawal" };
  const overBudget = () =>
    new CosignRefused("the sponsored withdrawal would take 0.000015 SOL from Tocker's fee wallet, over its 0.000010 SOL allowance");

  it("recognises only the over-budget refusal", () => {
    expect(isOverBudgetRefusal(overBudget())).toBe(true);
    expect(isOverBudgetRefusal(new CosignRefused("the sponsored withdrawal would fail on chain (x)"))).toBe(false);
    expect(isOverBudgetRefusal(new Error("allowance"))).toBe(false);
  });

  it("looks once more when the platform's own traffic made the first reading over budget", async () => {
    const cosign = vi.fn<(i: CosignInput) => Promise<string>>();
    cosign.mockRejectedValueOnce(overBudget()).mockResolvedValueOnce("signed");
    await expect(cosignSponsored(input, { cosign, delayMs: 0 })).resolves.toBe("signed");
    expect(cosign).toHaveBeenCalledTimes(2);
    expect(cosign).toHaveBeenLastCalledWith(input);
  });

  it("gives up after the second look, and never retries any other refusal", async () => {
    const twice = vi.fn<(i: CosignInput) => Promise<string>>().mockRejectedValue(overBudget());
    await expect(cosignSponsored(input, { cosign: twice, delayMs: 0 })).rejects.toThrow(/allowance/);
    expect(twice).toHaveBeenCalledTimes(2);

    const fails = vi
      .fn<(i: CosignInput) => Promise<string>>()
      .mockRejectedValue(new CosignRefused("the sponsored withdrawal would fail on chain (x)"));
    await expect(cosignSponsored(input, { cosign: fails, delayMs: 0 })).rejects.toThrow(/fail on chain/);
    expect(fails).toHaveBeenCalledTimes(1);
  });
});

describe("transactionSignature", () => {
  it("is the fee payer's signature in base58, read from the bytes before anything is sent", () => {
    const signed = VersionedTransaction.deserialize(fixture({ signers: [platform, user] }));
    const id = transactionSignature(signed.serialize());
    expect(id).not.toBeNull();
    expect(Array.from(base58.decode(id!))).toEqual(Array.from(signed.signatures[0]));
  });

  it("is null when the fee payer has not signed, or the bytes are not a transaction", () => {
    expect(transactionSignature(fixture({ signers: [user] }))).toBeNull();
    expect(transactionSignature(new Uint8Array([1, 2, 3]))).toBeNull();
  });
});

describe("sendRejectedBeforeRelay", () => {
  it("is true only for the node's own JSON-RPC refusal", () => {
    expect(sendRejectedBeforeRelay(new Error("Transaction simulation failed: Blockhash not found"))).toBe(true);
    expect(
      sendRejectedBeforeRelay(new Error("Transaction signature verification failure — Program log: whatever")),
    ).toBe(true);
  });

  it("is false for every failure that can come after the node relayed it", () => {
    const timeout = new Error("The operation was aborted due to timeout");
    timeout.name = "TimeoutError";
    expect(sendRejectedBeforeRelay(timeout)).toBe(false);
    expect(sendRejectedBeforeRelay(new Error("Solana RPC sendTransaction failed (HTTP 504)"))).toBe(false);
    expect(sendRejectedBeforeRelay(new TypeError("fetch failed"))).toBe(false);
    expect(sendRejectedBeforeRelay(new SyntaxError("Unexpected token < in JSON"))).toBe(false);
    expect(sendRejectedBeforeRelay(new Error("The RPC accepted the transaction but returned no signature."))).toBe(
      false,
    );
    expect(sendRejectedBeforeRelay("socket hang up")).toBe(false);
  });
});

describe("broadcastSponsored", () => {
  const signedBytes = fixture({ signers: [platform, user] });
  const signed = Buffer.from(signedBytes).toString("base64");
  const local = transactionSignature(signedBytes)!;
  const timeout = () => Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });

  it("passes a normal send through", async () => {
    const result = await broadcastSponsored(signed, {
      sendAndConfirm: async () => ({ signature: local, status: "confirmed" }),
      confirmSignature: async () => "pending",
    });
    expect(result).toEqual({ outcome: "confirmed", signature: local });
  });

  it("never calls a timed-out send a failure: it looks the signature up, and says unknown if unseen", async () => {
    const confirmSignature = vi.fn<Lookup>(async () => "pending");
    const result = await broadcastSponsored(signed, {
      sendAndConfirm: async () => {
        throw timeout();
      },
      confirmSignature,
      lookupMs: 5,
    });
    expect(result.outcome).toBe("unknown");
    expect(result.signature).toBe(local);
    expect(confirmSignature).toHaveBeenCalledWith(local, expect.objectContaining({ timeoutMs: 5 }));
  });

  it("reports a timed-out send that did land as landed", async () => {
    const result = await broadcastSponsored(signed, {
      sendAndConfirm: async () => {
        throw new Error("Solana RPC sendTransaction failed (HTTP 502)");
      },
      confirmSignature: async () => "confirmed",
      lookupMs: 5,
    });
    expect(result).toEqual({ outcome: "confirmed", signature: local });
  });

  it("says rejected only for the node's refusal, after one look", async () => {
    const confirmSignature = vi.fn<Lookup>(async () => "pending");
    const result = await broadcastSponsored(signed, {
      sendAndConfirm: async () => {
        throw new Error("Transaction simulation failed: Blockhash not found");
      },
      confirmSignature,
    });
    expect(result.outcome).toBe("rejected");
    expect(confirmSignature).toHaveBeenCalledWith(local, expect.objectContaining({ timeoutMs: 0 }));
  });

  it("catches the same bytes having gone through before, despite a refusal", async () => {
    const result = await broadcastSponsored(signed, {
      sendAndConfirm: async () => {
        throw new Error("Transaction simulation failed: This transaction has already been processed");
      },
      confirmSignature: async () => "confirmed",
    });
    expect(result).toEqual({ outcome: "confirmed", signature: local });
  });

  it("reports a transaction that landed and failed as failed", async () => {
    const result = await broadcastSponsored(signed, {
      sendAndConfirm: async () => {
        throw timeout();
      },
      confirmSignature: async () => "failed",
      lookupMs: 5,
    });
    expect(result).toEqual({ outcome: "failed", signature: local });
  });
});
