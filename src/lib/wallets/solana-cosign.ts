/**
 * The platform pays every Solana network fee (W8).
 *
 * On Base, Privy sponsors gas and bills the app. On Solana there is no such service: the
 * app runs its own fee payer, and Tocker's is the platform Solana wallet. So every
 * Solana transaction an agent or a user makes is built with that wallet as the fee
 * payer (and, where an account has to be opened, as the rent payer), signed by the
 * owner of the funds, and then co-signed here.
 *
 * Co-signing is the dangerous half. A transaction the platform signs as fee payer can
 * also spend the fee payer's SOL, so every co-signature goes through
 * {@link cosignAsPlatform}, which refuses unless:
 *
 *  1. the platform is the fee payer (static account 0) — never a hidden second signer;
 *  2. a simulation of the exact bytes shows the platform losing no more than the
 *     caller's declared budget (fees plus the rent it agreed to front) — the generic
 *     bound that catches anything a structural check missed; and
 *  3. the simulation succeeds — a transaction that would fail still burns the fee.
 *
 * Callers add their own structural validation on top (which programs, which amounts):
 * the funding path rebuilds its expected message byte for byte, the Jupiter path checks
 * every top-level instruction and decodes the route. This module is the floor every path
 * shares — including the platform's own refuel swap, which signs as the owner of the
 * funds through {@link signAsPlatformTaker} under the same simulation floor.
 */
import { authorizationContext, privy } from "@/lib/privy";
import { ensurePlatformWallet } from "@/lib/platform/wallets";
import { confirmSignature, getLamports, sendRawTransaction, simulateTransaction } from "./solana-rpc";

/** A fee plus rent for one new token account, with headroom: 0.0025 SOL. */
export const DEFAULT_PLATFORM_OUTFLOW_LAMPORTS = 2_500_000;

export class CosignRefused extends Error {
  constructor(reason: string) {
    super(`Tocker will not pay for this transaction: ${reason}. Nothing was sent.`);
    this.name = "CosignRefused";
  }
}

/** The platform Solana wallet's address — the fee payer to build transactions against. */
export async function platformFeePayer(): Promise<{ walletId: string; address: string }> {
  const wallet = await ensurePlatformWallet("solana");
  return { walletId: wallet.walletId, address: wallet.address };
}

/** Have a Tocker-held server wallet (an agent's) sign a transaction. Returns base64. */
export async function signAsServerWallet(walletId: string, transactionBase64: string): Promise<string> {
  const signed = await privy().wallets().solana().signTransaction(walletId, {
    transaction: transactionBase64,
    authorization_context: authorizationContext(),
  });
  return signed.signed_transaction;
}

/**
 * Pure: the fee payer of a serialized v0 or legacy transaction — static account 0.
 * Null when the bytes do not parse.
 */
export async function feePayerOf(transactionBase64: string): Promise<string | null> {
  try {
    const { VersionedTransaction } = await import("@solana/web3.js");
    const tx = VersionedTransaction.deserialize(Uint8Array.from(Buffer.from(transactionBase64, "base64")));
    return tx.message.staticAccountKeys[0]?.toBase58() ?? null;
  } catch {
    return null;
  }
}

/** Pure: lamports the platform would lose, from its balance before and the simulated after. */
export function platformOutflowLamports(before: number, after: number | null): number | null {
  if (after === null || !Number.isFinite(before) || !Number.isFinite(after)) return null;
  return Math.max(0, before - after);
}

export interface CosignInput {
  /** Base64 transaction, already signed by the owner of the funds (or unsigned by anyone else). */
  transactionBase64: string;
  /** Most lamports the platform may lose to this transaction (fees + rent it agreed to front). */
  maxOutflowLamports?: number;
  /** For the refusal message and the log line. */
  purpose: string;
}

/**
 * Add the platform's fee-payer signature after checking what it would cost. Returns the
 * fully signed base64 transaction. Throws {@link CosignRefused} with a readable reason.
 */
export async function cosignAsPlatform(input: CosignInput): Promise<string> {
  const platform = await platformFeePayer();
  const payer = await feePayerOf(input.transactionBase64);
  if (payer === null) throw new CosignRefused(`the ${input.purpose} transaction does not parse`);
  if (payer !== platform.address) {
    throw new CosignRefused(`its fee payer is ${payer}, not Tocker's fee wallet`);
  }

  await assertWithinOutflow(platform.address, input);
  return signAsServerWallet(platform.walletId, input.transactionBase64);
}

/**
 * Pure: where `address` sits among a transaction's required signers (0 is the fee payer),
 * or null when it is not one or the bytes do not parse. A v0 message cannot load a signer
 * from a lookup table, so this answer never depends on an RPC.
 */
export async function requiredSignerIndex(transactionBase64: string, address: string): Promise<number | null> {
  try {
    const { VersionedTransaction } = await import("@solana/web3.js");
    const tx = VersionedTransaction.deserialize(Uint8Array.from(Buffer.from(transactionBase64, "base64")));
    const signers = tx.message.staticAccountKeys.slice(0, tx.message.header.numRequiredSignatures);
    const index = signers.findIndex((key) => key.toBase58() === address);
    return index === -1 ? null : index;
  } catch {
    return null;
  }
}

/**
 * The platform's signature on a swap it makes **for itself** — its own USDC→SOL refuel —
 * where it signs as the owner of the funds (the taker), not only as a fee payer. It may
 * be the fee payer too (account 0), or Jupiter's gasless relayer may be.
 *
 * Never a raw signature over Jupiter's bytes: the caller checks the route's structure
 * first (which accounts the swap may touch), and this adds the same floor
 * {@link cosignAsPlatform} has — the platform must be a required signer, the exact bytes
 * must simulate successfully, and its simulated lamport loss must fit the budget
 * (`maxOutflowLamports` defaults to zero here: a refuel gains SOL).
 */
export async function signAsPlatformTaker(input: CosignInput): Promise<string> {
  const platform = await platformFeePayer();
  const index = await requiredSignerIndex(input.transactionBase64, platform.address);
  if (index === null) {
    throw new CosignRefused(`the ${input.purpose} transaction is not one Tocker's fee wallet signs`);
  }
  await assertWithinOutflow(platform.address, { ...input, maxOutflowLamports: input.maxOutflowLamports ?? 0 });
  return signAsServerWallet(platform.walletId, input.transactionBase64);
}

/** Simulate the exact bytes and refuse unless they succeed within the platform's budget. */
async function assertWithinOutflow(platformAddress: string, input: CosignInput): Promise<void> {
  const budget = input.maxOutflowLamports ?? DEFAULT_PLATFORM_OUTFLOW_LAMPORTS;
  const [before, simulation] = await Promise.all([
    getLamports(platformAddress),
    simulateTransaction(input.transactionBase64, [platformAddress]),
  ]);
  if (simulation.err !== null) {
    const last = simulation.logs.filter((line) => /error|failed/i.test(line)).slice(-1)[0];
    throw new CosignRefused(
      `the ${input.purpose} would fail on chain (${JSON.stringify(simulation.err)}${last ? `: ${last}` : ""})`,
    );
  }
  const outflow = platformOutflowLamports(before, simulation.accounts[0]?.lamportsAfter ?? null);
  if (outflow === null) throw new CosignRefused(`the ${input.purpose} could not be simulated against Tocker's fee wallet`);
  if (outflow > budget) {
    throw new CosignRefused(
      `the ${input.purpose} would take ${(outflow / 1e9).toFixed(6)} SOL from Tocker's fee wallet, over its ${(
        budget / 1e9
      ).toFixed(6)} SOL allowance`,
    );
  }
}

/** Broadcast a fully signed transaction and wait for it. */
export async function sendAndConfirm(
  signedBase64: string,
  timeoutMs = 25_000,
): Promise<{ signature: string; status: "confirmed" | "pending" | "failed" }> {
  const signature = await sendRawTransaction(signedBase64);
  const status = await confirmSignature(signature, { timeoutMs });
  return { signature, status };
}
