/**
 * Client-side Solana transfers: SOL, and USDC as an SPL token.
 *
 * The user signs these with their own Privy embedded wallet — the server never
 * sees the key. Kept out of `src/lib/wallets/index.ts` on purpose: that module
 * is `server-only`, this one runs in the browser.
 *
 * Instruction encoding is hand-rolled rather than pulled from `@solana/spl-token`,
 * which is not a dependency of this app. Both instructions we need are tiny and
 * frozen by their programs, and both are covered by tests.
 */
import {
  Connection,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";

export const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
export const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
/** Circle's USDC on Solana mainnet. Not USDT, not a wrapped variant. */
export const SOLANA_USDC_MINT = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
export const SOLANA_USDC_DECIMALS = 6;
export const LAMPORTS_PER_SOL = 1_000_000_000;

/**
 * Public RPC by default, rate-limited and fine for one transfer. Point
 * `NEXT_PUBLIC_SOLANA_RPC_URL` at a real endpoint before anyone relies on it.
 */
export function solanaRpcUrl(): string {
  return process.env.NEXT_PUBLIC_SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
}

/**
 * Human units → base units, without floating-point drift at the last digit.
 * Truncates rather than rounds: never try to send a unit that is not there.
 */
export function toBaseUnits(amount: number, decimals: number): bigint {
  if (!Number.isFinite(amount) || amount <= 0) return BigInt(0);
  const [whole, fraction = ""] = amount.toFixed(decimals + 3).split(".");
  const digits = `${whole}${fraction.slice(0, decimals).padEnd(decimals, "0")}`;
  return BigInt(digits);
}

/** The associated token account for `owner` holding `mint`. */
export function associatedTokenAddress(owner: PublicKey, mint: PublicKey): PublicKey {
  const [address] = PublicKey.findProgramAddressSync(
    [owner.toBytes(), TOKEN_PROGRAM_ID.toBytes(), mint.toBytes()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  return address;
}

/**
 * `CreateIdempotent` (discriminant 1) on the Associated Token Account program.
 *
 * A freshly created agent wallet has no USDC account, and idempotent means we
 * can always include this instruction without having to ask the chain first —
 * one fewer RPC round trip, and no race if two funding attempts overlap.
 */
export function createAtaIdempotentInstruction(input: {
  payer: PublicKey;
  owner: PublicKey;
  mint: PublicKey;
}): TransactionInstruction {
  const ata = associatedTokenAddress(input.owner, input.mint);
  return new TransactionInstruction({
    programId: ASSOCIATED_TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: input.payer, isSigner: true, isWritable: true },
      { pubkey: ata, isSigner: false, isWritable: true },
      { pubkey: input.owner, isSigner: false, isWritable: false },
      { pubkey: input.mint, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    // web3.js types this as Buffer; a Uint8Array is what it actually reads.
    data: Uint8Array.from([1]) as unknown as Buffer,
  });
}

/**
 * `TransferChecked` (discriminant 12) on the SPL Token program.
 *
 * Checked rather than plain `Transfer` on purpose: it makes the program verify
 * the mint and the decimals, so a wrong-token or wrong-decimals mistake fails
 * on chain instead of moving the wrong amount of the wrong thing.
 */
export function transferCheckedInstruction(input: {
  source: PublicKey;
  destination: PublicKey;
  owner: PublicKey;
  mint: PublicKey;
  amount: bigint;
  decimals: number;
}): TransactionInstruction {
  const data = new Uint8Array(10);
  data[0] = 12;
  new DataView(data.buffer).setBigUint64(1, input.amount, true);
  data[9] = input.decimals;

  return new TransactionInstruction({
    programId: TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: input.source, isSigner: false, isWritable: true },
      { pubkey: input.mint, isSigner: false, isWritable: false },
      { pubkey: input.destination, isSigner: false, isWritable: true },
      { pubkey: input.owner, isSigner: true, isWritable: false },
    ],
    data: data as unknown as Buffer,
  });
}

/** The instructions for sending USDC from one Solana wallet to another. */
export function usdcTransferInstructions(input: {
  from: PublicKey;
  to: PublicKey;
  amount: number;
}): TransactionInstruction[] {
  const source = associatedTokenAddress(input.from, SOLANA_USDC_MINT);
  const destination = associatedTokenAddress(input.to, SOLANA_USDC_MINT);
  return [
    createAtaIdempotentInstruction({ payer: input.from, owner: input.to, mint: SOLANA_USDC_MINT }),
    transferCheckedInstruction({
      source,
      destination,
      owner: input.from,
      mint: SOLANA_USDC_MINT,
      amount: toBaseUnits(input.amount, SOLANA_USDC_DECIMALS),
      decimals: SOLANA_USDC_DECIMALS,
    }),
  ];
}

export function solTransferInstructions(input: {
  from: PublicKey;
  to: PublicKey;
  amount: number;
}): TransactionInstruction[] {
  return [
    SystemProgram.transfer({
      fromPubkey: input.from,
      toPubkey: input.to,
      lamports: Number(toBaseUnits(input.amount, 9)),
    }),
  ];
}

/**
 * In the browser the blockhash comes from our own `/api/solana/blockhash`, so the RPC
 * URL (and any provider key in it) stays on the server. Anywhere else, or if the proxy
 * is unreachable, it falls back to asking an RPC directly.
 */
async function latestBlockhash(rpcUrl?: string): Promise<string> {
  if (typeof window !== "undefined" && !rpcUrl) {
    try {
      const res = await fetch("/api/solana/blockhash", { cache: "no-store" });
      if (res.ok) {
        const body = (await res.json()) as { blockhash?: string };
        if (body.blockhash) return body.blockhash;
      }
    } catch {
      // fall through to a direct RPC call
    }
  }
  const connection = new Connection(rpcUrl ?? solanaRpcUrl(), "confirmed");
  return (await connection.getLatestBlockhash("confirmed")).blockhash;
}

/**
 * Build a signed-by-nobody v0 transaction ready for Privy's
 * `signAndSendTransaction`. Fetches a blockhash, so it needs the network.
 */
export async function buildSolanaTransfer(input: {
  from: string;
  to: string;
  asset: "usdc" | "native";
  amount: number;
  rpcUrl?: string;
}): Promise<Uint8Array> {
  const from = new PublicKey(input.from);
  const to = new PublicKey(input.to);
  const instructions =
    input.asset === "usdc"
      ? usdcTransferInstructions({ from, to, amount: input.amount })
      : solTransferInstructions({ from, to, amount: input.amount });

  const blockhash = await latestBlockhash(input.rpcUrl);
  const message = new TransactionMessage({
    payerKey: from,
    recentBlockhash: blockhash,
    instructions,
  }).compileToV0Message();

  return new VersionedTransaction(message).serialize();
}

/**
 * A transaction that creates `owner`'s USDC associated token account, paid for by
 * `payer`. Built for the *platform* wallet to sign: the rent (~0.00204 SOL) is the
 * platform's cost of making an agent fundable, never the user's.
 *
 * Idempotent on chain, so it is safe to send even if the account appeared between the
 * check and the send.
 */
export async function buildCreateUsdcAtaTransaction(input: {
  payer: string;
  owner: string;
  rpcUrl?: string;
}): Promise<Uint8Array> {
  const payer = new PublicKey(input.payer);
  const owner = new PublicKey(input.owner);
  const blockhash = await latestBlockhash(input.rpcUrl);
  const message = new TransactionMessage({
    payerKey: payer,
    recentBlockhash: blockhash,
    instructions: [createAtaIdempotentInstruction({ payer, owner, mint: SOLANA_USDC_MINT })],
  }).compileToV0Message();

  return new VersionedTransaction(message).serialize();
}
