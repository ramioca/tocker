import { describe, expect, it } from "vitest";
import { PublicKey } from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  SOLANA_USDC_MINT,
  TOKEN_PROGRAM_ID,
  associatedTokenAddress,
  createAtaIdempotentInstruction,
  toBaseUnits,
  transferCheckedInstruction,
  usdcTransferInstructions,
} from "./solana-transfer";

const OWNER = new PublicKey("9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM");
const AGENT = new PublicKey("HN7cABqLq46Es1jh92dQQisAq662SmxELLLsHHe4YWrH");

describe("toBaseUnits", () => {
  it("scales without floating-point drift", () => {
    expect(toBaseUnits(10, 6)).toBe(BigInt("10000000"));
    expect(toBaseUnits(0.1, 6)).toBe(BigInt("100000"));
    expect(toBaseUnits(1.005, 6)).toBe(BigInt("1005000"));
    expect(toBaseUnits(0.006667, 9)).toBe(BigInt("6667000"));
  });

  it("truncates beyond the token's precision rather than rounding up into money that is not there", () => {
    expect(toBaseUnits(1.2345678, 6)).toBe(BigInt("1234567"));
    expect(toBaseUnits(1.9999999, 6)).toBe(BigInt("1999999"));
  });

  it("is zero for nonsense", () => {
    expect(toBaseUnits(0, 6)).toBe(BigInt("0"));
    expect(toBaseUnits(-5, 6)).toBe(BigInt("0"));
    expect(toBaseUnits(Number.NaN, 6)).toBe(BigInt("0"));
  });
});

describe("associatedTokenAddress", () => {
  it("derives the canonical ATA", () => {
    // Known-good pair: the USDC ATA of 9WzDXwBb… is this account.
    const ata = associatedTokenAddress(OWNER, SOLANA_USDC_MINT);
    const [expected] = PublicKey.findProgramAddressSync(
      [OWNER.toBytes(), TOKEN_PROGRAM_ID.toBytes(), SOLANA_USDC_MINT.toBytes()],
      ASSOCIATED_TOKEN_PROGRAM_ID,
    );
    expect(ata.toBase58()).toBe(expected.toBase58());
    expect(ata.toBase58()).not.toBe(OWNER.toBase58());
  });

  it("gives different owners different accounts", () => {
    expect(associatedTokenAddress(OWNER, SOLANA_USDC_MINT).toBase58()).not.toBe(
      associatedTokenAddress(AGENT, SOLANA_USDC_MINT).toBase58(),
    );
  });
});

describe("createAtaIdempotentInstruction", () => {
  it("encodes discriminant 1 against the ATA program", () => {
    const ix = createAtaIdempotentInstruction({ payer: OWNER, owner: AGENT, mint: SOLANA_USDC_MINT });
    expect(ix.programId.toBase58()).toBe(ASSOCIATED_TOKEN_PROGRAM_ID.toBase58());
    expect([...ix.data]).toEqual([1]);
    expect(ix.keys[0]).toMatchObject({ isSigner: true, isWritable: true });
    expect(ix.keys[1].pubkey.toBase58()).toBe(associatedTokenAddress(AGENT, SOLANA_USDC_MINT).toBase58());
    expect(ix.keys[2].pubkey.toBase58()).toBe(AGENT.toBase58());
    expect(ix.keys[3].pubkey.toBase58()).toBe(SOLANA_USDC_MINT.toBase58());
  });
});

describe("transferCheckedInstruction", () => {
  it("encodes tag 12, a little-endian u64 amount and the decimals", () => {
    const ix = transferCheckedInstruction({
      source: OWNER,
      destination: AGENT,
      owner: OWNER,
      mint: SOLANA_USDC_MINT,
      amount: BigInt("12500000"),
      decimals: 6,
    });
    expect(ix.programId.toBase58()).toBe(TOKEN_PROGRAM_ID.toBase58());
    expect(ix.data.length).toBe(10);
    expect(ix.data[0]).toBe(12);
    expect(ix.data[9]).toBe(6);
    const view = new DataView(Uint8Array.from(ix.data).buffer);
    expect(view.getBigUint64(1, true)).toBe(BigInt("12500000"));
  });

  it("makes the owner the only signer", () => {
    const ix = transferCheckedInstruction({
      source: OWNER,
      destination: AGENT,
      owner: OWNER,
      mint: SOLANA_USDC_MINT,
      amount: BigInt("1"),
      decimals: 6,
    });
    expect(ix.keys.filter((k) => k.isSigner).map((k) => k.pubkey.toBase58())).toEqual([OWNER.toBase58()]);
  });
});

describe("usdcTransferInstructions", () => {
  it("creates the destination account before transferring into it", () => {
    const [create, transfer] = usdcTransferInstructions({ from: OWNER, to: AGENT, amount: 25 });
    expect(create.programId.toBase58()).toBe(ASSOCIATED_TOKEN_PROGRAM_ID.toBase58());
    expect(transfer.programId.toBase58()).toBe(TOKEN_PROGRAM_ID.toBase58());
    // Source and destination are token accounts, never the wallets themselves.
    expect(transfer.keys[0].pubkey.toBase58()).toBe(
      associatedTokenAddress(OWNER, SOLANA_USDC_MINT).toBase58(),
    );
    expect(transfer.keys[2].pubkey.toBase58()).toBe(
      associatedTokenAddress(AGENT, SOLANA_USDC_MINT).toBase58(),
    );
    expect(new DataView(Uint8Array.from(transfer.data).buffer).getBigUint64(1, true)).toBe(BigInt("25000000"));
  });
});
